/**
 * Mod manager.
 *
 * Mods belong to a profile (its instance `mods/` folder). This module
 * wires the UI to Modrinth: search → install → list → remove → update.
 * `checkUpdates` compares the installed version id against the newest
 * available version for the profile's MC version + loader.
 */
import path from 'node:path'
import { paths } from '../paths'
import { exists, remove, rename } from '../utils/fs'
import { zipReadEntry } from '../utils/zip'
import { logger } from '../logs/logger'
import { eventBus } from '../core/event-bus'
import { LauncherError, Errors } from '../core/errors'
import { runDownloadBatch } from '../minecraft/downloader'
import { runQueued } from '../downloads/queue'
import { modrinth, type ProjectType } from './modrinth'
import { isLegacyFabricMc } from './fabric-api'
import { curseforge } from './curseforge'
import { profileManager } from '../profiles/profile-manager'
import { iso } from '../utils/format'
import type {
  Profile,
  ProfileMod,
  ModrinthSearchResult,
  LoaderType,
  ProjectVersionInfo,
  InstallDepInfo,
  InstallWithDepsResult
} from '@shared/types'

/** Map a project type to its folder inside the instance. */
function folderFor(projectType: ProjectType): string {
  switch (projectType) {
    case 'resourcepack': return 'resourcepacks'
    case 'shader': return 'shaderpacks'
    case 'datapack': return 'datapacks'
    case 'modpack': return 'modpacks'
    default: return 'mods'
  }
}

/* ------------------- manual-jar metadata (v1.0.22) ------------------- */

interface ModMeta {
  id?: string
  name?: string
  version?: string
}

/**
 * Read the mod's real identity out of a jar: `fabric.mod.json` for Fabric,
 * `META-INF/mods.toml` / `neoforge.mods.toml` for Forge. Never trusts the
 * file name alone — the name shown to the user comes from the mod itself.
 */
function readModMetadata(buf: Buffer, filename: string): ModMeta {
  try {
    const fabric = zipReadEntry(buf, 'fabric.mod.json')
    if (fabric) {
      const j = JSON.parse(fabric.toString('utf-8')) as { id?: unknown; name?: unknown; version?: unknown }
      if (j && (j.id || j.name)) {
        return {
          id: typeof j.id === 'string' ? j.id : undefined,
          name: typeof j.name === 'string' ? j.name : undefined,
          version: typeof j.version === 'string' ? j.version : undefined
        }
      }
    }
  } catch {
    /* fall through to Forge */
  }
  for (const entry of ['META-INF/mods.toml', 'META-INF/neoforge.mods.toml']) {
    try {
      const toml = zipReadEntry(buf, entry)
      if (!toml) continue
      const text = toml.toString('utf-8')
      const modSection = text.split(/\[\[mods\]\]/i)[1] ?? ''
      const modId = /(?:^|\n)\s*modId\s*=\s*["']?([^"'\n]+)["']?/.exec(modSection)?.[1]?.trim()
      const name = /(?:^|\n)\s*(?:displayName|name)\s*=\s*["']([^"'\n]+)["']/.exec(modSection)?.[1]?.trim()
      if (modId || name) return { id: modId, name: name || modId || filename.replace(/\.jar$/i, ''), version: undefined }
    } catch {
      /* try next */
    }
  }
  return { name: filename.replace(/\.jar$/i, '') }
}

/* ---------------- manual content metadata (v1.0.23) ---------------- */

/** Strip Minecraft § color codes from a pack description. */
function stripMcCodes(s: string): string {
  return s.replace(/§[0-9a-fk-or]/gi, '').replace(/§./g, '').trim()
}

/**
 * Read a resource-pack-style identity out of a zip buffer:
 * `pack.mcmeta` → pack.description (plain string or text component), and for
 * shader packs `shaders/shaders.json` → name. Falls back to the file name.
 */
function readPackMetadata(packMcmeta: Buffer | null, shadersJson: Buffer | null, filename: string): ModMeta {
  if (shadersJson) {
    try {
      const j = JSON.parse(shadersJson.toString('utf-8')) as { name?: unknown }
      if (j && typeof j.name === 'string' && j.name.trim()) {
        return { name: stripMcCodes(j.name) }
      }
    } catch {
      /* fall through to pack.mcmeta */
    }
  }
  if (packMcmeta) {
    try {
      const j = JSON.parse(packMcmeta.toString('utf-8')) as { pack?: { description?: unknown } }
      const d = j?.pack?.description
      if (typeof d === 'string') {
        const clean = stripMcCodes(d)
        if (clean) return { name: clean }
      } else if (d && typeof d === 'object') {
        const text = (d as { text?: unknown }).text
        if (typeof text === 'string') {
          const clean = stripMcCodes(text)
          if (clean) return { name: clean }
        }
      }
    } catch {
      /* fall through */
    }
  }
  return { name: filename.replace(/\.(zip|jar)$/i, '') }
}

/** "My_Cool_Pack-1.2.zip" → "My Cool Pack-1.2" for the fallback name. */
function prettifyLocalName(filename: string): string {
  const base = filename.replace(/\.(zip|jar)$/i, '').replace(/_/g, ' ').trim()
  return base || filename
}

/**
 * Best-effort match for PACKS by EXACT normalized title — never the first
 * search hit blindly. Lets a manually-installed resource pack / shader /
 * data pack show as "Installed" in Browse with its real icon, slug and
 * provider. v1.0.50 — the matched provider is returned explicitly so the
 * entry is tracked against the RIGHT platform (Modrinth first, CurseForge
 * as fallback), never guessed from icon presence.
 */
async function matchPackByName(
  name: string,
  projectType: ProjectType,
  mc: string,
  loader: LoaderType
): Promise<{ id: string; slug: string; title: string; iconUrl?: string; source: 'modrinth' | 'curseforge' } | null> {
  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const target = norm(name)
  if (!target) return null
  try {
    const res = await modrinth.searchMods({ query: name, projectType, mcVersion: mc, loader, limit: 24 })
    const hit = res.items.find((i) => norm(i.title) === target)
    if (hit) return { id: hit.projectId, slug: hit.slug, title: hit.title, iconUrl: hit.iconUrl, source: 'modrinth' }
  } catch {
    /* fall through to CurseForge */
  }
  // v1.0.40 — packs that only live on CurseForge (or whose exact title is not
  // on Modrinth) still resolve to their real project with icon + tracking.
  try {
    const cf = await curseforge.matchByExactName(name, projectType, mc)
    if (cf) return { ...cf, source: 'curseforge' }
  } catch {
    /* name match is best-effort */
  }
  return null
}

/**
 * v1.0.50 — extract an icon EMBEDDED in the item's own file, so a manual
 * mod/pack with no provider match never shows a bare placeholder:
 *  - mods:      `fabric.mod.json` → "icon" → that asset inside the jar
 *  - zip packs: `pack.png` at the zip root
 *  - folder packs: `pack.png` on disk
 * Returns a `data:` URL (or null when the file has no embedded icon).
 */
function mimeForPath(name: string): string | null {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'svg') return 'image/svg+xml'
  return null
}

function bufferDataUrl(buf: Buffer, mime: string, limit = 512 * 1024): string | null {
  if (!buf || buf.length === 0 || buf.length > limit) return null
  return `data:${mime};base64,${buf.toString('base64')}`
}

/**
 * Read the embedded icon for a manual item file. `buf` is the raw file for
 * jars/zips (null for folder packs — read pack.png from disk instead).
 */
async function extractEmbeddedIcon(
  filePath: string,
  projectType: ProjectType,
  isDir: boolean,
  buf: Buffer | null
): Promise<string | null> {
  try {
    if (projectType === 'mod' && buf) {
      const fabric = zipReadEntry(buf, 'fabric.mod.json')
      if (fabric) {
        const j = JSON.parse(fabric.toString('utf-8')) as { icon?: unknown }
        const icon = typeof j.icon === 'string' ? j.icon.trim() : ''
        if (icon && !icon.startsWith('http')) {
          const mime = mimeForPath(icon.split('?')[0] ?? '')
          if (mime) {
            const data = zipReadEntry(buf, icon)
            const url = bufferDataUrl(data ?? Buffer.alloc(0), mime)
            if (url) return url
          }
        }
      }
      return null
    }
    if (!isDir) {
      const mime = mimeForPath('pack.png')
      const data = buf ? zipReadEntry(buf, 'pack.png') : null
      const url = bufferDataUrl(data ?? Buffer.alloc(0), mime ?? 'image/png')
      if (url) return url
      return null
    }
    const { readFileSync } = await import('node:fs')
    const iconPath = path.join(filePath, 'pack.png')
    if (exists(iconPath)) {
      return bufferDataUrl(readFileSync(iconPath), 'image/png')
    }
  } catch {
    /* icon extraction is best-effort */
  }
  return null
}

/** Session set — provider matching for tracked local items runs ONCE per
 *  profile per session (139 network lookups every Installed-open would be
 *  wasteful). Icon extraction stays cheap and runs every time. */
const enrichNetworkOnce = new Set<string>()

/** Normalized title — the shared identity key across Modrinth ↔ CurseForge. */
const normTitle = (t: string): string => (t ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const sleepMs = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** True when a profile already has this item under ANY provider — matching by
 *  real id/slug first, then by normalized title so the same mod installed
 *  from Modrinth is recognized when browsing CurseForge (and vice versa). */
function alreadyInstalled(
  profile: { mods: ProfileMod[] },
  project: { id?: string; slug?: string; title?: string } | null | undefined,
  projectType?: string
): ProfileMod | undefined {
  if (!project) return undefined
  const hit = profile.mods.find(
    (m) => (project.id && (m.id === project.id || m.slug === project.id)) || (project.slug && m.slug === project.slug)
  )
  if (hit) return hit
  const nt = normTitle(project.title ?? '')
  if (!nt) return undefined
  // Title matching is scoped to the same content type so a mod and a resource
  // pack that happen to share a name never collide.
  const type = projectType ?? 'mod'
  return profile.mods.find((m) => (m.projectType ?? 'mod') === type && normTitle(m.title) === nt)
}

/**
 * v1.0.50 — re-run provider matching for ALREADY-TRACKED local items.
 *
 * identifyManualMods only processes UNTRACKED files, so items registered
 * before the matching pipeline existed (or while it was failing) stay
 * `source: 'local'` forever: no real icon, empty versionId, and therefore
 * no Update / Change Version / Update All participation — even for real,
 * known mods. This pass re-reads each tracked local item's metadata and
 * upgrades matches to FULL provider tracking:
 *   mods:  SHA1 → Modrinth exact version, else fabric.mod.json id →
 *          Modrinth project, else exact name → CurseForge.
 *   packs: exact normalized title → Modrinth, else CurseForge.
 * Items with NO provider match keep their manual identity but gain an icon
 * extracted from the file itself (never a bare placeholder).
 */
async function enrichManualModsImpl(profileId: string): Promise<{ enriched: number; matched: number }> {
  const profile = await profileManager.get(profileId)
  if (!profile) return { enriched: 0, matched: 0 }
  const fsp = await import('node:fs/promises')
  const doNetwork = !enrichNetworkOnce.has(profileId)
  if (doNetwork) enrichNetworkOnce.add(profileId)
  let enriched = 0
  let matched = 0
  const byIndex = new Map<number, ProfileMod>()

  const candidates = profile.mods.map((m, idx) => ({ m, idx })).filter(
    ({ m }) => m.source === 'local' && m.id !== 'reimagined-fps-boost' && m.slug !== 'fabric-api'
  )
  const processOne = async ({ m, idx }: { m: ProfileMod; idx: number }): Promise<void> => {
    try {
      const projectType: ProjectType = (m.projectType ?? 'mod') as ProjectType
      const dir = path.join(paths.games, profile.gameDir, folderFor(projectType))
      const activeName = m.filename.endsWith('.disabled')
        ? m.filename.slice(0, -'.disabled'.length)
        : m.filename
      const p = path.join(dir, activeName)
      const st = await fsp.stat(p).catch(() => null)
      if (!st) return
      const buf = st.isFile() ? await fsp.readFile(p) : null
      let meta: ModMeta
      if (projectType === 'mod') {
        meta = readModMetadata(buf ?? Buffer.alloc(0), activeName)
      } else if (st.isDirectory()) {
        const mcmeta = await fsp.readFile(path.join(p, 'pack.mcmeta')).catch(() => null)
        meta = readPackMetadata(mcmeta, null, activeName)
      } else {
        meta = readPackMetadata(
          zipReadEntry(buf ?? Buffer.alloc(0), 'pack.mcmeta'),
          zipReadEntry(buf ?? Buffer.alloc(0), 'shaders/shaders.json'),
          activeName
        )
      }

      let project: { id: string; slug: string; title: string; iconUrl?: string } | null = null
      let source: ProfileMod['source'] = 'local'
      let versionId = ''
      let versionNumber = m.versionNumber || 'manual'

      if (doNetwork && projectType === 'mod') {
        await sleepMs(45) // gentle pacing — Modrinth throttles bursts (429)
        try {
          const { createHash } = await import('node:crypto')
          const sha1 = createHash('sha1').update(buf ?? Buffer.alloc(0)).digest('hex')
          const hit = await modrinth.lookupVersionByHash(sha1)
          if (hit) {
            const pr = await modrinth.getProject(hit.projectId)
            source = 'modrinth'
            versionId = hit.version.id
            versionNumber = hit.version.versionNumber
            project = { id: pr.id, slug: pr.slug, title: pr.title, iconUrl: pr.icon_url }
            logger.info(`Enriched manual mod "${m.filename}" → Modrinth "${pr.slug}" (${pr.title}) by sha1`)
          } else {
            logger.info(`Enrich: "${m.filename}" has no Modrinth match by hash (sha1 ${sha1.slice(0, 10)}…)`)
          }
        } catch {
          /* best-effort */
        }
        if (!project && meta.id) {
          try {
            const pr = await modrinth.getProject(meta.id)
            project = { id: pr.id, slug: pr.slug, title: pr.title, iconUrl: pr.icon_url }
            source = 'modrinth'
            logger.info(`Enriched manual mod "${m.filename}" → Modrinth "${pr.slug}" by id`)
          } catch {
            project = null
          }
        }
        if (!project && meta.name) {
          try {
            const cf = await curseforge.matchByExactName(meta.name, 'mod', profile.minecraftVersion)
            if (cf) {
              project = cf
              source = 'curseforge'
              logger.info(`Enriched manual mod "${m.filename}" → CurseForge "${cf.slug}" (${cf.title}) by name`)
            }
          } catch {
            /* best-effort */
          }
        }
        if (project && source !== 'local' && !versionId) {
          try {
            const versions =
              source === 'curseforge'
                ? await curseforge.listVersions(project.id, 'mod')
                : await modrinth.listVersions(project.id, 'mod')
            const inst = versions.find((v) => v.filename === activeName) ?? null
            if (inst) {
              versionId = inst.id
              versionNumber = inst.versionNumber
            } else {
              logger.info(`Enrich: "${m.filename}" matched ${source} but no version matches its file name — update tracking needs a rename or reinstall.`)
            }
          } catch {
            /* best-effort */
          }
        }
      } else if (doNetwork && meta.name) {
        try {
          const pk = await matchPackByName(meta.name, projectType, profile.minecraftVersion, profile.loader.type)
          if (pk) {
            project = pk
            source = pk.source
            logger.info(`Enriched manual pack "${m.filename}" → ${pk.source} "${pk.title}"`)
          }
        } catch {
          /* best-effort */
        }
      }

      const embedded = await extractEmbeddedIcon(p, projectType, Boolean(st.isDirectory()), buf)
      if (project) {
        byIndex.set(idx, {
          ...m,
          id: project.id,
          slug: project.slug,
          title: project.title,
          iconUrl: project.iconUrl ?? embedded ?? m.iconUrl,
          source,
          versionId: versionId || m.versionId,
          versionNumber: versionNumber || m.versionNumber,
          updateAvailable: null
        })
        matched++
      } else if (embedded && !m.iconUrl) {
        byIndex.set(idx, { ...m, iconUrl: embedded })
      }
      enriched++
    } catch {
      /* skip unreadable items */
    }
  }

  // Small concurrency cap + gentle pacing — SHA1 + provider lookups are
  // IO/network-bound, and Modrinth throttles bursts (HTTP 429). 4 workers
  // with a short stagger between starts keeps the enrich well under the
  // rate limit while still finishing a large folder in seconds.
  let cursor = 0
  const workers = Array.from({ length: Math.min(4, candidates.length) }, async (_, i) => {
    await sleepMs(i * 120)
    while (cursor < candidates.length) {
      const c = candidates[cursor++]
      if (c) await processOne(c)
    }
  })
  await Promise.all(workers)

  if (byIndex.size > 0) {
    await profileManager.update(profileId, {
      mods: profile.mods.map((m, i) => byIndex.get(i) ?? m)
    })
    eventBus.emit('mods:changed', { profileId, action: 'enriched', count: byIndex.size })
    logger.info(`Enriched ${byIndex.size} tracked local item(s) in "${profile.name}" (${matched} matched to a provider)`)
  }
  return { enriched, matched }
}

/**
 * Reduce a provider-supplied file name to a safe single component so it can
 * never escape the instance folder via `..` or absolute paths.
 */
function safeBaseName(name: string): string {
  const base = path.basename(name || '').replace(/[\x00-\x1f]/g, '_')
  return base || 'download.jar'
}

class ModManager {
  private modsDir(profile: Profile, projectType: ProjectType = 'mod'): string {
    return path.join(paths.games, profile.gameDir, folderFor(projectType))
  }

  /**
   * List a profile's installed items — VERIFIED against the real filesystem
   * (V2): a tracked item whose file no longer exists on disk (deleted by the
   * user outside the launcher) is dropped from the list and the persisted
   * metadata, so the UI always reflects reality and never shows ghosts.
   */
  async list(profileId: string): Promise<ProfileMod[]> {
    const profile = await profileManager.get(profileId)
    if (!profile) return []
    let changed = false
    const verified = (profile.mods ?? []).filter((mod) => {
      const dir = this.modsDir(profile, mod.projectType ?? 'mod')
      const activeName = mod.filename.endsWith('.disabled')
        ? mod.filename.slice(0, -'.disabled'.length)
        : mod.filename
      const present = exists(path.join(dir, mod.filename)) || exists(path.join(dir, `${activeName}.disabled`))
      if (!present) changed = true
      return present
    })
    if (changed) {
      await profileManager.update(profileId, { mods: verified })
      eventBus.emit('mods:changed', { profileId, action: 'reconciled' })
    }
    return verified
  }

  /**
   * Modrinth search — the Mods section only browses mods (never packs).
   * Filter overrides let the UI relax the profile's version/loader facets
   * (dismissible chips) and add a server-side category filter.
   */
  async search(
    profileId: string,
    query: string,
    index?: string,
    opts?: { mcVersion?: string; loader?: string; category?: string; projectType?: ProjectType; offset?: number; limit?: number }
  ): Promise<{ items: ModrinthSearchResult[]; totalHits: number }> {
    const profile = await this.requireProfile(profileId)
    const projectType = opts?.projectType ?? 'mod'
    // v1.0.50 — Legacy Fabric profiles (MC ≤ 1.13.2) browse without a loader
    // facet: their mods are tagged 'fabric' OR 'ornithe' on Modrinth, and a
    // strict fabric-only filter would hide every ornith build.
    const legacyFabric = profile.loader.type === 'fabric' && isLegacyFabricMc(profile.minecraftVersion)
    return modrinth.searchMods({
      query,
      mcVersion: opts?.mcVersion ?? profile.minecraftVersion,
      loader: legacyFabric ? undefined : (opts?.loader as LoaderType | undefined) ?? profile.loader.type,
      projectType,
      index,
      category: opts?.category,
      offset: opts?.offset,
      limit: opts?.limit
    })
  }

  /** Real category list for the filter sidebar (Modrinth tags API), scoped
   *  to the browsing content type (mods, resource packs, shaders…). */
  async categories(projectType: string = 'mod'): Promise<string[]> {
    return modrinth.getCategories(projectType as ProjectType)
  }

  /** CurseForge search — requires an API key configured in Settings. */
  async searchCurseforge(
    profileId: string,
    query: string,
    sort?: 'downloads' | 'newest' | 'recent' | 'name',
    projectType?: ProjectType,
    category?: string,
    opts?: { offset?: number; limit?: number }
  ): Promise<ModrinthSearchResult[]> {
    const profile = await this.requireProfile(profileId)
    // v1.0.50 — mods get the profile's real loader filter on CurseForge too
    // (fabric → 4, forge → 1). Packs aren't loader-scoped.
    const loader = projectType === 'mod' && profile.loader.type !== 'vanilla' ? profile.loader.type : undefined
    // v1.0.58 — pass the real offset/limit through so the UI can paginate
    // (previously CurseForge was hard-locked to page 0 — no infinite scroll).
    return curseforge.searchMods({
      query,
      mcVersion: profile.minecraftVersion,
      sort,
      projectType: projectType ?? 'mod',
      category,
      loader,
      offset: opts?.offset ?? 0,
      limit: opts?.limit ?? 24
    })
  }

  /** Every install runs inside the global queue (V2): the user's
   *  `downloadConcurrency` (1/3/5) decides how many installs download at once.
   *  Nested installs (installWithDeps → installVersion) run inline — no deadlock. */
  async install(profileId: string, projectId: string, projectType: ProjectType = 'mod'): Promise<ProfileMod> {
    return runQueued(() => this.installQueued(profileId, projectId, projectType))
  }

  private async installQueued(profileId: string, projectId: string, projectType: ProjectType = 'mod'): Promise<ProfileMod> {
    const profile = await this.requireProfile(profileId)
    const mc = profile.minecraftVersion
    const loader: LoaderType = profile.loader.type

    // Already-installed check matches by real project id OR slug — so the
    // Fabric API (stored under 'fabric-api' on older profiles) can never be
    // installed twice from a Modrinth search result.
    const project = await modrinth.getProject(projectId)
    if (alreadyInstalled(profile, project, projectType)) {
      throw new LauncherError('MOD_INSTALLED', 'This is already installed in the profile.')
    }

    const version = await modrinth.latestVersionFor(projectId, mc, loader, projectType)
    if (!version || version.files.length === 0) {
      const label = projectType === 'mod' ? (loader === 'vanilla' ? 'Minecraft' : loader) : 'Minecraft'
      throw new LauncherError(
        'MOD_VERSION_MISSING',
        `No ${label} version of this project supports Minecraft ${mc}.`,
        'Try a different project or Minecraft version.'
      )
    }

    const file = version.files[0]
    const destDir = this.modsDir(profile, projectType)
    const dest = path.join(destDir, file.filename)

    // Ensure the target folder exists (mods/ exists, but packs/ may not on fresh instances).
    const { mkdirp } = await import('../utils/fs')
    mkdirp(destDir)

    // Guard against name collisions.
    if (exists(dest)) await remove(dest)

    logger.info(`Installing mod ${projectId} → ${file.filename}`)
    await runDownloadBatch([{ url: file.url, dest, expectedSize: file.size }], {
      kind: 'mods',
      label: `${project.title} — ${version.versionNumber}`,
      iconUrl: project.icon_url
    })

    const mod: ProfileMod = {
      id: projectId,
      slug: project.slug,
      title: project.title,
      filename: file.filename,
      versionId: version.id,
      versionNumber: version.versionNumber,
      downloads: project.downloads,
      iconUrl: project.icon_url,
      source: 'modrinth',
      projectType,
      installedAt: iso(),
      updateAvailable: null
    }

    await profileManager.update(profileId, { mods: [...profile.mods, mod] })
    eventBus.emit('mods:changed', { profileId, action: 'installed', mod })
    return mod
  }

  /**
   * Install a SPECIFIC version of a project (detail page “Install this
   * version”). The version's compatibility with the profile's MC version +
   * loader is enforced before anything is downloaded.
   */
  async installVersion(
    profileId: string,
    provider: 'modrinth' | 'curseforge',
    projectId: string,
    versionId: string,
    projectType: ProjectType = 'mod',
    itemTitle?: string
  ): Promise<ProfileMod> {
    return runQueued(() => this.installVersionQueued(profileId, provider, projectId, versionId, projectType, itemTitle))
  }

  private async installVersionQueued(
    profileId: string,
    provider: 'modrinth' | 'curseforge',
    projectId: string,
    versionId: string,
    projectType: ProjectType = 'mod',
    itemTitle?: string
  ): Promise<ProfileMod> {
    const profile = await this.requireProfile(profileId)
    const mc = profile.minecraftVersion
    const loader: LoaderType = profile.loader.type
    const isMod = projectType === 'mod'

    // Already-installed guard — matches by real project id AND by resolved
    // slug, so the Fabric API (keyed by 'fabric-api' on older profiles) can
    // never be installed twice from a detail page either.
    let projectSlug: string | null = null
    if (provider === 'modrinth') {
      try {
        const p = await modrinth.getProject(projectId)
        projectSlug = p.slug
      } catch {
        /* best-effort — the id check below still applies */
      }
    }
    if (alreadyInstalled(profile, { id: projectId, slug: projectSlug ?? undefined, title: itemTitle }, projectType)) {
      throw new LauncherError('MOD_INSTALLED', 'This is already installed in the profile.')
    }

    let file: { filename: string; url: string; size: number; version: string }
    let title = itemTitle ?? projectId
    let slug = projectId

    if (provider === 'curseforge') {
      const cf = await curseforge.fileById(projectId, versionId)
      if (!cf) {
        throw new LauncherError('MOD_VERSION_MISSING', 'That version is no longer available on CurseForge.')
      }
      if (cf.gameVersions.length > 0 && !cf.gameVersions.includes(mc)) {
        throw new LauncherError('MOD_INCOMPATIBLE', `This version does not support Minecraft ${mc}.`)
      }
      if (isMod && cf.loaders.length > 0 && !cf.loaders.includes(loader) && !cf.loaders.includes('any')) {
        throw new LauncherError('MOD_INCOMPATIBLE', `This version does not support the ${loader} loader.`)
      }
      file = { filename: cf.filename, url: cf.url, size: cf.size, version: cf.version }
    } else {
      const versions = await modrinth.listVersions(projectId, projectType)
      const target = versions.find((v) => v.id === versionId)
      if (!target || !target.fileUrl) {
        throw new LauncherError('MOD_VERSION_MISSING', 'That version is no longer available on Modrinth.')
      }
      if (target.gameVersions.length > 0 && !target.gameVersions.includes(mc)) {
        throw new LauncherError('MOD_INCOMPATIBLE', `This version does not support Minecraft ${mc}.`)
      }
      if (isMod && target.loaders.length > 0 && !target.loaders.includes(loader)) {
        throw new LauncherError('MOD_INCOMPATIBLE', `This version does not support the ${loader} loader.`)
      }
      file = {
        filename: target.filename ?? `${target.versionNumber.replace(/[^a-zA-Z0-9._-]/g, '-')}.jar`,
        url: target.fileUrl,
        size: target.size ?? 0,
        version: target.versionNumber
      }
      try {
        const p = await modrinth.getProject(projectId)
        title = p.title
        slug = p.slug
      } catch {
        /* keep ids */
      }
    }

    const destDir = this.modsDir(profile, projectType)
    const dest = path.join(destDir, safeBaseName(file.filename))
    file = { ...file, filename: safeBaseName(file.filename) }
    const { mkdirp } = await import('../utils/fs')
    mkdirp(destDir)
    if (exists(dest)) await remove(dest)

    logger.info(`Installing ${provider} ${projectId} @ ${versionId} → ${file.filename}`)
    await runDownloadBatch([{ url: file.url, dest, expectedSize: file.size }], {
      kind: 'mods',
      label: `${title} — ${file.version}`
    })

    const mod: ProfileMod = {
      id: projectId,
      slug,
      title,
      filename: file.filename,
      versionId,
      versionNumber: file.version,
      downloads: 0,
      source: provider,
      projectType,
      installedAt: iso(),
      updateAvailable: null
    }
    await profileManager.update(profileId, { mods: [...profile.mods, mod] })
    eventBus.emit('mods:changed', { profileId, action: 'installed', mod })
    return mod
  }

  /** Install a CurseForge mod (projectId is the numeric CurseForge id). */
  async installCurseforge(
    profileId: string,
    projectId: string,
    meta?: { title?: string; iconUrl?: string; downloads?: number },
    projectType: ProjectType = 'mod'
  ): Promise<ProfileMod> {
    return runQueued(() => this.installCurseforgeQueued(profileId, projectId, meta, projectType))
  }

  private async installCurseforgeQueued(
    profileId: string,
    projectId: string,
    meta?: { title?: string; iconUrl?: string; downloads?: number },
    projectType: ProjectType = 'mod'
  ): Promise<ProfileMod> {
    const profile = await this.requireProfile(profileId)
    const mc = profile.minecraftVersion
    const loader: LoaderType = profile.loader.type

    if (alreadyInstalled(profile, { id: String(projectId), slug: String(projectId), title: meta?.title }, projectType)) {
      throw new LauncherError('MOD_INSTALLED', 'This is already installed in the profile.')
    }

    // Loader filtering only applies to mods — packs aren't loader-specific.
    const file = await curseforge.latestFile(projectId, mc, projectType === 'mod' ? loader : 'vanilla')
    if (!file) {
      const label = projectType === 'mod' ? (loader === 'vanilla' ? 'Minecraft' : loader) : 'Minecraft'
      throw new LauncherError(
        'MOD_VERSION_MISSING',
        `No ${label} version of this project supports Minecraft ${mc}.`,
        'Try a different project or Minecraft version.'
      )
    }

    const destDir = this.modsDir(profile, projectType)
    const dest = path.join(destDir, file.filename)
    const { mkdirp } = await import('../utils/fs')
    mkdirp(destDir)
    if (exists(dest)) await remove(dest)

    logger.info(`Installing CurseForge mod ${projectId} → ${file.filename}`)
    await runDownloadBatch([{ url: file.url, dest, expectedSize: file.size }], {
      kind: 'mods',
      label: file.filename,
      iconUrl: meta?.iconUrl
    })

    const mod: ProfileMod = {
      id: projectId,
      slug: projectId,
      title: meta?.title ?? projectId,
      filename: file.filename,
      versionId: String(file.fileId),
      versionNumber: file.version || 'latest',
      downloads: meta?.downloads ?? 0,
      iconUrl: meta?.iconUrl,
      source: 'curseforge',
      projectType,
      installedAt: iso(),
      updateAvailable: null
    }

    await profileManager.update(profileId, { mods: [...profile.mods, mod] })
    eventBus.emit('mods:changed', { profileId, action: 'installed', mod })
    return mod
  }

  /** v1.0.50 — re-match already-tracked local items against the providers so
   *  they gain real icons + version tracking (Update / Change Version /
   *  Update All). Provider lookups run once per profile per session. */
  async enrichManualMods(profileId: string): Promise<{ enriched: number; matched: number }> {
    return enrichManualModsImpl(profileId)
  }

  async remove(profileId: string, slug: string): Promise<void> {
    const profile = await this.requireProfile(profileId)
    const mod = profile.mods.find((m) => m.slug === slug)
    if (!mod) return
    // Route through the mod's own project type so packs are removed from the right folder.
    await remove(path.join(this.modsDir(profile, mod.projectType ?? 'mod'), mod.filename)).catch(() => {})
    await profileManager.update(profileId, { mods: profile.mods.filter((m) => m.slug !== slug) })
    logger.info(`Mod removed: ${mod.title}`)
    eventBus.emit('mods:changed', { profileId, action: 'removed', slug })
  }

  /**
   * Compare installed mods against the newest available versions.
   *
   * Updates are detected by REAL RELEASE ORDER (datePublished), never naive
   * string comparison — so "1.10" is never treated as older than "1.9". The
   * Update badge only appears when the installed version is genuinely older
   * than the newest compatible one: already-latest and installed-newer builds
   * (pre-releases, manual installs ahead of the listing) show "up to date".
   */
  async checkUpdates(profileId: string): Promise<ProfileMod[]> {
    const profile = await this.requireProfile(profileId)
    let changed = false
    // v1.0.55 — bounded concurrency: profiles with 100+ mods would otherwise
    // fire 100+ simultaneous provider calls and get rate-limited (HTTP 429),
    // which made the whole check fail and left stale update badges behind.
    // Pre-allocated + index-assigned so the resulting array keeps profile.mods
    // order no matter which worker finishes first.
    const updatedMods: ProfileMod[] = new Array(profile.mods.length)
    let idx = 0
    const checkOne = async (): Promise<void> => {
      while (idx < profile.mods.length) {
        const i = idx++
        const mod = profile.mods[i]
        if (mod.source !== 'modrinth' && mod.source !== 'curseforge') {
          updatedMods[i] = mod
          continue
        }
        try {
          // v1.0.55 — SINGLE SOURCE OF TRUTH: resolve the newest file with the
          // EXACT same resolver the install/update path uses
          // (curseforge.latestFile / modrinth.latestVersionFor) instead of a
          // looser listVersions+versionCompatible pass. The old listing pulled
          // files from every loader (and accepted loader-less entries), so it
          // could flag a newer file that Update would never install — e.g.
          // another loader's/pre-release build with a later date — and
          // re-flag freshly-updated mods as outdated forever (the “Update All
          // never persists” loop, seen with YetAnotherConfigLib). If the same
          // resolver says the installed version IS the newest, there is
          // nothing to update. No date heuristics needed: consistency with
          // what Update would actually install is the correct criterion.
          let latestId: string | null = null
          let latestVersion: string | null = null
          const projectType = mod.projectType ?? 'mod'
          if (mod.source === 'curseforge') {
            const file = await curseforge.latestFile(mod.id, profile.minecraftVersion, profile.loader.type)
            if (file) {
              latestId = String(file.fileId)
              latestVersion = file.version || null
            }
          } else {
            // versionCompatible is a final sanity gate: latestVersionFor's
            // relaxed fallback (no loader match found) could hand back a
            // cross-loader file (e.g. Forge for a Fabric profile) — never flag
            // an update to something this profile can't actually run.
            const v = await modrinth.latestVersionFor(mod.id, profile.minecraftVersion, profile.loader.type, projectType)
            if (v && this.versionCompatible(v, profile.minecraftVersion, profile.loader.type, projectType)) {
              latestId = v.id
              latestVersion = v.versionNumber
            }
          }
          const needsUpdate = Boolean(latestId && latestId !== mod.versionId)
          const next = needsUpdate
            ? { ...mod, updateAvailable: { versionId: latestId!, versionNumber: latestVersion || 'latest' } }
            : mod.updateAvailable
              ? { ...mod, updateAvailable: null }
              : mod
          if (next !== mod) changed = true
          updatedMods[i] = next
        } catch {
          updatedMods[i] = mod
        }
      }
    }
    await Promise.all(Array.from({ length: 6 }, () => checkOne()))

    if (changed) {
      await profileManager.update(profileId, { mods: updatedMods })
      eventBus.emit('mods:changed', { profileId, action: 'updates-checked' })
    }
    return updatedMods
  }

  /** Update a mod to its latest compatible version (Modrinth or CurseForge). */
  async update(profileId: string, slug: string): Promise<ProfileMod> {
    return runQueued(() => this.updateQueued(profileId, slug))
  }

  /**
   * v1.0.58 — update is now a SAFE SWAP. The old flow removed the installed
   * file (and its profile entry) BEFORE the new file was downloaded, so any
   * failure mid-download (HTTP 429, network drop, proxy down) permanently
   * deleted the mod — “mods deleting themselves”. Now the newest file is
   * resolved with the SAME resolver checkUpdates uses, downloaded to a temp
   * name first, and only after a successful download is the old file removed
   * and the new one moved into place. A failed update never touches the
   * installed mod.
   */
  private async updateQueued(profileId: string, slug: string): Promise<ProfileMod> {
    const profile = await this.requireProfile(profileId)
    const mod = profile.mods.find((m) => m.slug === slug)
    if (!mod) throw new LauncherError('MOD_MISSING', 'Mod not found in this profile.')
    const projectType = mod.projectType ?? 'mod'
    const mc = profile.minecraftVersion
    const loader: LoaderType = profile.loader.type

    // Resolve the newest compatible file — exactly what checkUpdates flagged.
    let file: { filename: string; url: string; size: number; version: string }
    let newVersionId = ''
    let newVersionNumber = ''
    if (mod.source === 'curseforge') {
      const cf = await curseforge.latestFile(mod.id, mc, loader)
      if (!cf) {
        throw new LauncherError('MOD_VERSION_MISSING', 'No newer compatible version found on CurseForge.')
      }
      file = { filename: safeBaseName(cf.filename), url: cf.url, size: cf.size, version: cf.version || 'latest' }
      newVersionId = String(cf.fileId)
      newVersionNumber = cf.version || 'latest'
    } else if (mod.source === 'modrinth') {
      const v = await modrinth.latestVersionFor(mod.id, mc, loader, projectType)
      if (!v || !v.files.length || !this.versionCompatible(v, mc, loader, projectType)) {
        throw new LauncherError('MOD_VERSION_MISSING', 'No newer compatible version found on Modrinth.')
      }
      const f = v.files[0]
      file = { filename: safeBaseName(f.filename), url: f.url, size: f.size, version: v.versionNumber }
      newVersionId = v.id
      newVersionNumber = v.versionNumber
    } else {
      throw new LauncherError('MOD_LOCAL', 'This item was added manually and has no remote updates.')
    }

    const destDir = this.modsDir(profile, projectType)
    const { mkdirp } = await import('../utils/fs')
    mkdirp(destDir)

    // Download to a TEMP name first — the installed mod stays untouched until
    // the new file is fully and successfully on disk.
    const tmp = path.join(destDir, `.update-${Date.now()}-${file.filename}`)
    try {
      logger.info(`Updating ${mod.title} → ${file.filename}`)
      await runDownloadBatch([{ url: file.url, dest: tmp, expectedSize: file.size }], {
        kind: 'mods',
        label: `${mod.title} — ${newVersionNumber}`
      })
    } catch (err) {
      await remove(tmp).catch(() => {})
      throw err
    }

    // Success — now swap: remove the old file (and any .disabled twin), move
    // the new one into place.
    const activeName = mod.filename.endsWith('.disabled')
      ? mod.filename.slice(0, -'.disabled'.length)
      : mod.filename
    await remove(path.join(destDir, activeName)).catch(() => {})
    await remove(path.join(destDir, `${activeName}.disabled`)).catch(() => {})
    let finalName = file.filename
    const dest = path.join(destDir, finalName)
    if (exists(dest)) await remove(dest)
    await rename(tmp, dest)

    // A disabled mod stays disabled after an update.
    if (mod.disabled && !finalName.endsWith('.disabled')) {
      await rename(dest, path.join(destDir, `${finalName}.disabled`))
      finalName = `${finalName}.disabled`
    }

    const fresh: ProfileMod = {
      ...mod,
      filename: finalName,
      versionId: newVersionId,
      versionNumber: newVersionNumber,
      updateAvailable: null,
      installedAt: iso()
    }
    await profileManager.update(profileId, {
      mods: profile.mods.map((m) => (m.slug === slug ? fresh : m))
    })
    eventBus.emit('mods:changed', { profileId, action: 'updated', mod: fresh })
    logger.info(`Mod updated: ${mod.title} → ${fresh.versionNumber}`)
    return fresh
  }

  /** Local-only mods (dropped in the mods folder manually) not tracked in JSON. */
  async localModFiles(profileId: string, projectType: ProjectType = 'mod'): Promise<string[]> {
    const profile = await this.requireProfile(profileId)
    const dir = this.modsDir(profile, projectType)
    if (!exists(dir)) return []
    const { listDir } = await import('../utils/fs')
    const fsp = await import('node:fs/promises')
    const entries = await listDir(dir)
    // Track per-type so the same file name in two folders (e.g. foo.zip in
    // resourcepacks/ AND shaderpacks/) never hides the other copy.
    const tracked = new Set(
      profile.mods.filter((m) => (m.projectType ?? 'mod') === projectType).map((m) => m.filename)
    )
    const out: string[] = []
    for (const f of entries) {
      if (tracked.has(f)) continue
      if (projectType === 'mod') {
        if (f.endsWith('.jar')) out.push(f)
        continue
      }
      if (f.endsWith('.zip')) {
        out.push(f)
        continue
      }
      // Folder packs count as manual content too.
      const st = await fsp.stat(path.join(dir, f)).catch(() => null)
      if (st?.isDirectory()) out.push(f)
    }
    return out
  }

  /**
   * v1.0.22 — detect jars dropped manually into the mods/ folder and resolve
   * them to their REAL project (name + icon via Modrinth, when the mod id is
   * the slug), registering them as installed items. Once registered, Modrinth
   * search marks them "Installed" and reinstalling is blocked — a manually
   * installed mod can never be double-installed from the catalog.
   */
  /**
   * v1.0.23 — scan ALL content folders (mods, resourcepacks, shaderpacks,
   * datapacks) for untracked files/folders and register them as installed
   * with their REAL identity (fabric.mod.json / mods.toml for mods,
   * pack.mcmeta / shaders.json for packs), matched to Modrinth when possible.
   */
  async identifyManualMods(profileId: string): Promise<{ identified: number; matched: number }> {
    const profile = await this.requireProfile(profileId)
    const fsp = await import('node:fs/promises')
    const { listDir } = await import('../utils/fs')
    const projectTypes: ProjectType[] = ['mod', 'resourcepack', 'shader', 'datapack']
    let identified = 0
    let matched = 0
    const additions: ProfileMod[] = []

    for (const projectType of projectTypes) {
      const dir = this.modsDir(profile, projectType)
      if (!exists(dir)) continue
      const tracked = new Set(
        profile.mods.filter((m) => (m.projectType ?? 'mod') === projectType).map((m) => m.filename)
      )
      const entries = await listDir(dir)
      // v1.0.26 — process files with a small concurrency cap (SHA1 + Modrinth
      // lookups are IO/network-bound; 4 in parallel keeps a bulk folder drop
      // snappy without hammering the API). Per-file work is fully independent.
      const pending = entries.filter((f) => {
        if (tracked.has(f)) return false
        if (projectType === 'mod' && !f.endsWith('.jar')) return false
        return true
      })
      let pendingIdx = 0
      const scanOne = async (): Promise<void> => {
        while (pendingIdx < pending.length) {
          const filename = pending[pendingIdx++]
          if (!filename) continue
          try {
          const p = path.join(dir, filename)
          const st = await fsp.stat(p).catch(() => null)
          if (!st) continue
          if (projectType !== 'mod' && !st.isDirectory() && !filename.endsWith('.zip')) continue
          let meta: ModMeta
          if (projectType === 'mod') {
            meta = readModMetadata(await fsp.readFile(p), filename)
          } else if (st.isDirectory()) {
            const mcmeta = await fsp.readFile(path.join(p, 'pack.mcmeta')).catch(() => null)
            meta = readPackMetadata(mcmeta, null, filename)
          } else {
            const buf = await fsp.readFile(p)
            meta = readPackMetadata(zipReadEntry(buf, 'pack.mcmeta'), zipReadEntry(buf, 'shaders/shaders.json'), filename)
          }
          let project: { id: string; slug: string; title: string; iconUrl?: string } | null = null
          let source: ProfileMod['source'] = 'local'
          let versionId = ''
          let versionNumber = meta.version || 'manual'
          if (projectType === 'mod') {
            // v1.0.26 — exact SHA1 hash match first: Modrinth's
            // /version_file/{hash}?algorithm=sha1 endpoint returns the exact
            // version that ships this file (same approach real launchers use
            // to recognize manually-dropped mods). A match upgrades the entry
            // to a full Modrinth-tracked one (name/icon/version/update support).
            try {
              const { createHash } = await import('node:crypto')
              const sha1 = createHash('sha1').update(await fsp.readFile(p)).digest('hex')
              const hit = await modrinth.lookupVersionByHash(sha1)
              if (hit) {
                const pr = await modrinth.getProject(hit.projectId)
                source = 'modrinth'
                versionId = hit.version.id
                versionNumber = hit.version.versionNumber
                project = { id: pr.id, slug: pr.slug, title: pr.title, iconUrl: pr.icon_url }
                logger.info(
                  `Manual mod "${filename}" matched to Modrinth project "${pr.slug}" (${pr.title}) by sha1 ${sha1.slice(0, 10)}… — now fully tracked.`
                )
              } else {
                logger.info(`Manual mod "${filename}" has no Modrinth match by hash (sha1 ${sha1.slice(0, 10)}…) — keeping it as a manual item.`)
              }
            } catch {
              /* hash lookup is best-effort */
            }
            if (!project && meta.id) {
              try {
                const pr = await modrinth.getProject(meta.id)
                project = { id: pr.id, slug: pr.slug, title: pr.title, iconUrl: pr.icon_url }
                source = 'modrinth'
                logger.info(
                  `Manual mod "${filename}" matched to Modrinth project "${pr.slug}" (${pr.title}) by id — now tracked.`
                )
              } catch {
                project = null
              }
            }
            // v1.0.40 — CurseForge fallback by exact name: mods that exist
            // only on CurseForge (or whose build is not on Modrinth) still
            // resolve to their REAL project with icon + update support.
            if (!project && meta.name) {
              try {
                const cf = await curseforge.matchByExactName(meta.name, 'mod', profile.minecraftVersion)
                if (cf) {
                  project = cf
                  source = 'curseforge'
                  logger.info(
                    `Manual mod "${filename}" matched to CurseForge project "${cf.slug}" (${cf.title}) by name — now tracked.`
                  )
                }
              } catch {
                /* name match is best-effort */
              }
            }
          } else if (meta.name) {
            const pk = await matchPackByName(meta.name, projectType, profile.minecraftVersion, profile.loader.type)
            if (pk) {
              project = pk
              source = pk.source
              logger.info(`Manual ${projectType} "${filename}" matched to ${pk.source} project "${pk.slug}" (${pk.title}) — now tracked.`)
            }
          }
          // v1.0.40 — when a manual mod was matched by name/id (not SHA1), the
          // installed versionId is still unknown. Resolve it by matching the
          // local filename against the provider's version list — the same
          // technique the SHA1 path uses — so the "Update" check can find the
          // installed version and compare real release dates. Packs skip this
          // (their version isn't pinned the same way).
          if (project && source !== 'local' && projectType === 'mod' && !versionId) {
            try {
              const versions =
                source === 'curseforge'
                  ? await curseforge.listVersions(project.id, 'mod')
                  : await modrinth.listVersions(project.id, 'mod')
              const inst = versions.find((v) => v.filename === filename) ?? null
              if (inst) {
                versionId = inst.id
                versionNumber = inst.versionNumber
                logger.info(`Manual mod "${filename}" version resolved: ${versionNumber}`)
              }
            } catch {
              /* version resolution is best-effort */
            }
          }
          // v1.0.50 — an item with no provider match still shows a real icon
          // extracted from its own file (fabric.mod.json icon / pack.png).
          // (Re-read the buffer here — the meta reads above were scoped to
          // their branches and can't be referenced after.)
          const embedBuf = projectType === 'mod' || !st.isDirectory() ? await fsp.readFile(p) : null
          const embeddedIcon = await extractEmbeddedIcon(p, projectType, Boolean(st.isDirectory()), embedBuf)
          const entry: ProfileMod = {
            id: project?.id ?? meta.id ?? filename,
            slug: project?.slug ?? meta.id ?? filename,
            title: project?.title ?? meta.name ?? prettifyLocalName(filename),
            filename,
            versionId,
            versionNumber,
            downloads: 0,
            iconUrl: project?.iconUrl ?? embeddedIcon ?? undefined,
            source,
            projectType,
            installedAt: iso(),
            updateAvailable: null
          }
          additions.push(entry)
          identified++
          if (project) matched++
          } catch {
            /* unreadable — leave it in the manual list */
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, pending.length) }, () => scanOne()))
    }

    if (additions.length > 0) {
      await profileManager.update(profileId, { mods: [...profile.mods, ...additions] })
      eventBus.emit('mods:changed', { profileId, action: 'manual-identified', count: additions.length })
      logger.info(
        `Identified ${additions.length} manually-installed item(s) (${matched} matched to Modrinth) in "${profile.name}"`
      )
    }
    return { identified, matched }
  }

  /**
   * v1.0.24 — backfill missing Modrinth icons for already-installed items
   * (installed before icons were stored, or packs installed through older
   * paths). Fire-and-forget from the Installed tab; emits mods:changed once
   * resolved so the UI refreshes with the real icons.
   */
  async ensureIcons(profileId: string): Promise<void> {
    const profile = await this.requireProfile(profileId)
    const missing = profile.mods.filter((m) => (m.source === 'modrinth' || m.source === 'curseforge') && !m.iconUrl)
    if (missing.length === 0) return
    const resolved = await Promise.all(
      missing.map(async (m) => {
        try {
          if (m.source === 'curseforge') {
            const p = await curseforge.getProjectFull(m.id, m.projectType ?? 'mod')
            if (p?.iconUrl) return { key: `${m.id}|${m.filename}`, iconUrl: p.iconUrl }
          } else {
            const p = await modrinth.getProject(m.id)
            if (p?.icon_url) return { key: `${m.id}|${m.filename}`, iconUrl: p.icon_url }
          }
        } catch {
          /* project gone — keep as-is */
        }
        return null
      })
    )
    const map = new Map<string, string>()
    for (const r of resolved) {
      if (r) map.set(r.key, r.iconUrl)
    }
    if (map.size === 0) return
    const next = profile.mods.map((m) => {
      const icon = map.get(`${m.id}|${m.filename}`)
      return icon ? { ...m, iconUrl: icon } : m
    })
    await profileManager.update(profileId, { mods: next })
    eventBus.emit('mods:changed', { profileId, action: 'icons-resolved', count: map.size })
    logger.info(`Resolved ${map.size} missing project icon(s) for "${profile.name}"`)
  }

  /** Delete a manually-dropped jar from the profile's mods folder. */
  async removeLocalFile(profileId: string, filename: string, projectType: ProjectType = 'mod'): Promise<void> {
    const profile = await this.requireProfile(profileId)
    const dir = this.modsDir(profile, projectType)
    const dest = path.join(dir, filename)
    const base = path.basename(filename)
    const fsp = await import('node:fs/promises')
    const isDir = await fsp.stat(dest).then((s) => s.isDirectory()).catch(() => false)
    if (base !== filename || (!filename.endsWith('.jar') && !filename.endsWith('.zip') && !isDir)) {
      throw new LauncherError('INVALID_FILE', 'Invalid file name.')
    }
    if (!exists(dest)) throw new LauncherError('MOD_MISSING', 'File not found in the content folder.')
    await remove(dest)
    logger.info(`Local ${projectType} file removed: ${filename}`)
  }

  /**
   * Swap the installed file of a tracked item to a different version of the
   * same project (Part 4). The old file is removed first, the new one is
   * downloaded with real progress, and the profile entry is replaced — never
   * leaving both versions installed or a half-swapped state.
   */
  async changeVersion(profileId: string, slug: string, versionId: string): Promise<ProfileMod> {
    return runQueued(() => this.changeVersionQueued(profileId, slug, versionId))
  }

  private async changeVersionQueued(profileId: string, slug: string, versionId: string): Promise<ProfileMod> {
    const profile = await this.requireProfile(profileId)
    const mod = profile.mods.find((m) => m.slug === slug)
    if (!mod) throw new LauncherError('MOD_MISSING', 'Mod not found in this profile.')
    const projectType = mod.projectType ?? 'mod'
    const disabled = Boolean(mod.disabled)

    let file: { filename: string; url: string; size: number; version: string } | null = null
    let newVersionId = versionId
    let newVersionNumber = ''

    if (mod.source === 'curseforge') {
      const cfFile = await curseforge.fileById(mod.id, versionId)
      if (!cfFile) {
        throw new LauncherError('MOD_VERSION_MISSING', 'That version is no longer available on CurseForge.')
      }
      file = cfFile
      newVersionNumber = cfFile.version || 'latest'
    } else if (mod.source === 'modrinth') {
      const versions = await modrinth.listVersions(mod.id, projectType)
      const target = versions.find((v) => v.id === versionId)
      if (!target || !target.fileUrl) {
        throw new LauncherError(
          'MOD_VERSION_MISSING',
          'That version is no longer available on Modrinth.'
        )
      }
      file = {
        filename: target.filename ?? `${mod.slug}-${target.versionNumber}.jar`,
        url: target.fileUrl,
        size: target.size ?? 0,
        version: target.versionNumber
      }
      newVersionNumber = target.versionNumber
    } else {
      throw new LauncherError('MOD_LOCAL', 'This item was added manually and has no remote versions.')
    }

    const destDir = this.modsDir(profile, projectType)
    const { mkdirp } = await import('../utils/fs')
    mkdirp(destDir)

    // Never trust a provider-supplied filename for the destination path.
    file = { ...file, filename: safeBaseName(file.filename) }

    // v1.0.58 — safe swap: download the new file to a TEMP name first; the
    // currently installed file is removed only after the new one is fully on
    // disk, so a failed/aborted download never deletes the mod.
    const tmp = path.join(destDir, `.swap-${Date.now()}-${file.filename}`)
    logger.info(`Changing version of ${mod.title} → ${file.filename}`)
    try {
      await runDownloadBatch([{ url: file.url, dest: tmp, expectedSize: file.size }], {
        kind: 'mods',
        label: `${mod.title} — ${newVersionNumber}`
      })
    } catch (err) {
      await remove(tmp).catch(() => {})
      throw err
    }

    // Success — remove the currently installed file (including its .disabled
    // twin) and move the freshly-downloaded one into place.
    const activeName = mod.filename.endsWith('.disabled')
      ? mod.filename.slice(0, -'.disabled'.length)
      : mod.filename
    await remove(path.join(destDir, activeName)).catch(() => {})
    await remove(path.join(destDir, `${activeName}.disabled`)).catch(() => {})

    let finalName = file.filename
    const dest = path.join(destDir, finalName)
    if (exists(dest)) await remove(dest)
    await rename(tmp, dest)

    // A disabled mod stays disabled after a version swap.
    if (disabled && !finalName.endsWith('.disabled')) {
      await rename(dest, path.join(destDir, `${finalName}.disabled`))
      finalName = `${finalName}.disabled`
    }

    const updated: ProfileMod = {
      ...mod,
      filename: finalName,
      versionId: newVersionId,
      versionNumber: newVersionNumber,
      updateAvailable: null,
      installedAt: iso()
    }
    await profileManager.update(profileId, {
      mods: profile.mods.map((m) => (m.slug === slug ? updated : m))
    })
    eventBus.emit('mods:changed', { profileId, action: 'version-changed', mod: updated })
    logger.info(`Version changed: ${mod.title} ${mod.versionNumber} → ${newVersionNumber}`)
    return updated
  }

  /**
   * Enable/disable an installed item without uninstalling it — the standard
   * loader mechanism: the file is renamed to `<name>.disabled` (or back).
   * Disabled items stay visible in the UI with a muted state.
   */
  async setEnabled(profileId: string, slug: string, enabled: boolean): Promise<ProfileMod> {
    const profile = await this.requireProfile(profileId)
    const mod = profile.mods.find((m) => m.slug === slug)
    if (!mod) throw new LauncherError('MOD_MISSING', 'Mod not found in this profile.')
    const projectType = mod.projectType ?? 'mod'
    const dir = this.modsDir(profile, projectType)

    const activeName = mod.filename.endsWith('.disabled')
      ? mod.filename.slice(0, -'.disabled'.length)
      : mod.filename
    const activePath = path.join(dir, activeName)
    const disabledPath = path.join(dir, `${activeName}.disabled`)

    if (enabled) {
      if (exists(disabledPath)) {
        await rename(disabledPath, activePath)
        logger.info(`Item enabled: ${mod.title}`)
      }
    } else {
      if (exists(activePath)) {
        await rename(activePath, disabledPath)
        logger.info(`Item disabled: ${mod.title}`)
      } else if (!exists(disabledPath)) {
        // Nothing on disk to toggle — create the marker so state matches.
        const { mkdirp } = await import('../utils/fs')
        mkdirp(dir)
        await rename(activePath, disabledPath).catch(() => {})
      }
    }

    const updated: ProfileMod = {
      ...mod,
      filename: enabled ? activeName : `${activeName}.disabled`,
      disabled: !enabled
    }
    await profileManager.update(profileId, {
      mods: profile.mods.map((m) => (m.slug === slug ? updated : m))
    })
    eventBus.emit('mods:changed', { profileId, action: enabled ? 'enabled' : 'disabled', mod: updated })
    return updated
  }

  /** Available versions of an installed item, filtered to the profile's MC + loader. */
  async availableVersions(profileId: string, slug: string): Promise<ProjectVersionInfo[]> {
    const profile = await this.requireProfile(profileId)
    const mod = profile.mods.find((m) => m.slug === slug)
    if (!mod) throw new LauncherError('MOD_MISSING', 'Mod not found in this profile.')
    const projectType = mod.projectType ?? 'mod'

    let versions: ProjectVersionInfo[]
    if (mod.source === 'curseforge') {
      versions = await curseforge.listVersions(mod.id, projectType)
    } else if (mod.source === 'modrinth') {
      versions = await modrinth.listVersions(mod.id, projectType)
    } else {
      return []
    }

    const isMod = projectType === 'mod'
    const wantedLoader = profile.loader.type
    return versions.filter((v) => {
      const mcOk = v.gameVersions.length === 0 || v.gameVersions.includes(profile.minecraftVersion)
      if (!mcOk) return false
      if (!isMod) return true // packs aren't loader-specific
      if (v.loaders.length === 0) return true
      return v.loaders.includes(wantedLoader) || v.loaders.includes('any')
    })
  }

  /** True when a version supports the profile's MC version + loader. */
  private versionCompatible(v: ProjectVersionInfo, mc: string, loader: LoaderType, projectType: ProjectType = 'mod'): boolean {
    if (v.gameVersions.length > 0 && !v.gameVersions.includes(mc)) return false
    if (projectType !== 'mod') return true // packs aren't loader-specific
    if (v.loaders.length === 0) return true
    return v.loaders.includes(loader) || v.loaders.includes('any')
  }

  /**
   * Resolve the FULL dependency tree of a version (recursive, de-duplicated)
   * from Modrinth's real dependency data. Returns a flat-ish tree where every
   * entry carries its resolved version + installed status for the profile.
   */
  async resolveDependencies(
    profileId: string,
    projectId: string,
    versionId: string,
    projectType: ProjectType = 'mod'
  ): Promise<InstallDepInfo[]> {
    const profile = await this.requireProfile(profileId)
    return this.resolveDepTree(profile, projectId, versionId, projectType, 0, new Set([projectId]))
  }

  private async resolveDepTree(
    profile: Profile,
    projectId: string,
    versionId: string,
    projectType: ProjectType,
    depth: number,
    seen: Set<string>
  ): Promise<InstallDepInfo[]> {
    if (depth > 6) return []
    const mc = profile.minecraftVersion
    const loader: LoaderType = profile.loader.type
    const versions = await modrinth.listVersions(projectId, projectType)
    const target = versions.find((v) => v.id === versionId) ?? versions[0]
    const declared = (target?.dependencies ?? []).filter((d) => d.dependencyType !== 'incompatible' && d.projectId)
    const out: InstallDepInfo[] = []
    for (const dep of declared) {
      if (seen.has(dep.projectId)) continue
      seen.add(dep.projectId)
      // Dependencies are mods on Modrinth even when the parent is a pack
      // (e.g. a shader that depends on Iris) — resolve them as mods.
      const depVersions = await modrinth.listVersions(dep.projectId, 'mod')
      let chosen: ProjectVersionInfo | null = null
      if (dep.versionId) {
        const pinned = depVersions.find((x) => x.id === dep.versionId)
        if (pinned && this.versionCompatible(pinned, mc, loader, 'mod')) chosen = pinned
      }
      if (!chosen) chosen = depVersions.find((x) => this.versionCompatible(x, mc, loader, 'mod')) ?? null
      let meta: { title: string; slug: string; icon_url?: string }
      try {
        meta = await modrinth.getProject(dep.projectId)
      } catch {
        meta = { title: dep.projectId, slug: dep.projectId }
      }
      const info: InstallDepInfo = {
        projectId: dep.projectId,
        title: meta.title,
        slug: meta.slug,
        iconUrl: meta.icon_url,
        dependencyType: dep.dependencyType,
        versionId: chosen?.id ?? null,
        versionNumber: chosen?.versionNumber ?? null,
        installed: Boolean(alreadyInstalled(profile, { id: dep.projectId, slug: meta.slug, title: meta.title }, 'mod'))
      }
      const children = await this.resolveDepTree(
        profile,
        dep.projectId,
        chosen?.id ?? dep.versionId ?? '',
        'mod',
        depth + 1,
        seen
      )
      if (children.length > 0) info.children = children
      out.push(info)
    }
    return out
  }

  /**
   * Install an item AND every currently-missing dependency together.
   * Dependencies that are already installed are skipped (never duplicated);
   * failures on individual dependencies are reported, not fatal to the rest.
   */
  async installWithDeps(
    profileId: string,
    projectId: string,
    versionId?: string,
    projectType: ProjectType = 'mod'
  ): Promise<InstallWithDepsResult> {
    return runQueued(() => this.installWithDepsQueued(profileId, projectId, versionId, projectType))
  }

  private async installWithDepsQueued(
    profileId: string,
    projectId: string,
    versionId?: string,
    projectType: ProjectType = 'mod'
  ): Promise<InstallWithDepsResult> {
    const profile = await this.requireProfile(profileId)
    const project = await modrinth.getProject(projectId)
    if (profile.mods.some((m) => m.id === projectId || m.slug === project.slug)) {
      throw new LauncherError('MOD_INSTALLED', 'This is already installed in the profile.')
    }
    let targetVersionId = versionId
    if (!targetVersionId) {
      const latest = await modrinth.latestVersionFor(projectId, profile.minecraftVersion, profile.loader.type, projectType)
      if (!latest || latest.files.length === 0) {
        throw new LauncherError('MOD_VERSION_MISSING', 'No compatible version of this project exists for this profile.')
      }
      targetVersionId = latest.id
    }

    // 1. The item itself.
    const mod = await this.installVersion(profileId, 'modrinth', projectId, targetVersionId, projectType)
    const installedTitles = [mod.title]
    const skipped: string[] = []

    // 2. Every missing dependency, in tree order, deduped, already-installed skipped.
    const tree = await this.resolveDepTree(profile, projectId, targetVersionId, projectType, 0, new Set([projectId]))
    const flat: InstallDepInfo[] = []
    const seenDeps = new Set<string>()
    const flatten = (list: InstallDepInfo[]): void => {
      for (const d of list) {
        if (seenDeps.has(d.projectId)) continue
        seenDeps.add(d.projectId)
        flat.push(d)
        if (d.children) flatten(d.children)
      }
    }
    flatten(tree)
    for (const dep of flat) {
      if (dep.installed) continue
      if (!dep.versionId) {
        if (dep.dependencyType === 'required') skipped.push(`${dep.title} (no compatible version for this profile)`)
        continue
      }
      try {
        const dmod = await this.installVersion(profileId, 'modrinth', dep.projectId, dep.versionId, 'mod')
        installedTitles.push(dmod.title)
      } catch (err) {
        skipped.push(`${dep.title} (${(err as Error).message})`)
        logger.warn(`Dependency install failed for ${dep.title}: ${(err as Error).message}`)
      }
    }
    logger.info(`Install with dependencies: ${mod.title} + ${installedTitles.length - 1} dep(s), ${skipped.length} skipped`)
    return { mod, installed: installedTitles, skipped }
  }

  private async requireProfile(profileId: string): Promise<Profile> {
    const profile = await profileManager.get(profileId)
    if (!profile) throw new LauncherError('PROFILE_MISSING', 'Profile not found.')
    return profile
  }
}

export const modManager = new ModManager()
