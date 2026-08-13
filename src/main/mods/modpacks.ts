/**
 * Modrinth Modpack support.
 *
 * Searches the Modrinth catalog for modpacks and installs them with one click:
 * the .mrpack archive is downloaded, its index (Minecraft version, loader and
 * mod dependencies) is resolved, a brand-new profile is created with the right
 * version/loader, every Modrinth mod dependency is installed, and the pack's
 * `overrides/` (config, resource packs, shader packs, …) are copied into the
 * instance. Failures on individual mods are skipped and reported — the pack
 * install never fails as a whole.
 */
import path from 'node:path'
import { instancePath } from '../instances/paths'
import fs from 'node:fs'
import { paths } from '../paths'
import { logger } from '../logs/logger'
import { eventBus } from '../core/event-bus'
import { getJson, downloadFile } from '../utils/http'
import { zipExtractAll } from '../utils/zip'
import { profileManager } from '../profiles/profile-manager'
import { modManager } from './mod-manager'
import { curseforge } from './curseforge'
import { runDownloadBatch } from '../minecraft/downloader'
import { iso } from '../utils/format'
import type { ModrinthSearchResult, LoaderType, ProfileMod } from '@shared/types'

const API = 'https://api.modrinth.com/v2'
const USER_AGENT = 'ReimaginedLauncher/1.0.0 (Minecraft launcher)'

function headers(): Record<string, string> {
  return { 'User-Agent': USER_AGENT }
}

export interface ModpackSearchOptions {
  query?: string
  mcVersion?: string
  loader?: LoaderType | 'any'
  offset?: number
  limit?: number
}

/** Search Modrinth for modpacks (version + loader facets applied server-side). */
export async function searchModpacks(opts: ModpackSearchOptions): Promise<{ items: ModrinthSearchResult[]; totalHits: number }> {
  const facets: string[][] = [['project_type:modpack']]
  if (opts.mcVersion) facets.push([`versions:${opts.mcVersion}`])
  if (opts.loader && opts.loader !== 'any' && opts.loader !== 'vanilla') {
    facets.push([`categories:${opts.loader}`])
  }
  const params = new URLSearchParams({
    query: opts.query || '',
    facets: JSON.stringify(facets),
    limit: String(opts.limit ?? 24),
    index: 'downloads',
    offset: String(opts.offset ?? 0)
  })
  const res = await getJson<{
    total_hits: number
    hits: {
      project_id: string
      slug: string
      title: string
      description: string
      icon_url?: string
      downloads: number
      follows: number
      categories: string[]
      versions: string[]
      latest_version: string
      author?: string
    }[]
  }>(`${API}/search?${params.toString()}`, { headers: headers(), timeoutMs: 15_000 })
  return {
    items: res.hits.map((h) => ({
      projectId: h.project_id,
      slug: h.slug,
      title: h.title,
      description: h.description,
      iconUrl: h.icon_url,
      downloads: h.downloads,
      followCount: h.follows,
      categories: h.categories,
      versions: h.versions,
      latestVersion: h.latest_version,
      author: h.author
    })),
    totalHits: res.total_hits ?? 0
  }
}

interface MrpackIndex {
  formatVersion: number
  game?: string
  versionId?: string
  name?: string
  summary?: string
  files?: { path?: string; downloads?: string[] }[]
  dependencies?: {
    minecraft?: string
    'fabric-loader'?: string
    forge?: string
    quilt?: string
    modrinth?: Record<string, string>
    curseforge?: Record<string, string>
  }
}

/**
 * Install a Modrinth modpack: download the .mrpack, create a fresh profile
 * with the pack's Minecraft version + loader, install every mod dependency
 * from Modrinth, and copy the pack's overrides into the instance.
 */
export async function installModpack(
  projectId: string,
  versionId: string,
  name?: string
): Promise<{ profileId: string; name: string; installed: number; skipped: string[] }> {
  const version = await getJson<{
    id: string
    version_number: string
    game_versions: string[]
    loaders: string[]
    files?: { filename: string; url: string; size: number }[]
  }>(`${API}/version/${versionId}`, { headers: headers(), timeoutMs: 15_000 })

  const mrpack = version.files?.find((f) => f.filename.toLowerCase().endsWith('.mrpack'))
  if (!mrpack) throw new Error('This modpack version has no installable .mrpack file.')

  // 1. Download the pack archive.
  const tmpDir = path.join(paths.data, 'tmp', 'modpacks')
  fs.mkdirSync(tmpDir, { recursive: true })
  const packPath = path.join(tmpDir, `${projectId}-${versionId}.mrpack`)
  if (fs.existsSync(packPath)) fs.rmSync(packPath, { force: true })
  logger.info(`Downloading modpack ${version.version_number} (${mrpack.filename})`)
  const { recordDownload } = await import('../game/content')
  recordDownload({ label: `Modpack ${name ?? projectId}`, kind: 'mods', status: 'downloading', percent: 0, downloadedBytes: 0, totalBytes: mrpack.size ?? 0 })
  try {
    await downloadFile(mrpack.url, packPath, (p) => {
      recordDownload({ label: `Modpack ${name ?? projectId}`, kind: 'mods', status: 'downloading', percent: p.percent, downloadedBytes: p.received, totalBytes: p.total })
    }, 600_000)
  } catch (err) {
    recordDownload({ label: `Modpack ${name ?? projectId}`, kind: 'mods', status: 'failed', percent: 0, downloadedBytes: 0, totalBytes: mrpack.size ?? 0 })
    throw err
  }
  recordDownload({ label: `Modpack ${name ?? projectId}`, kind: 'mods', status: 'done', percent: 100, downloadedBytes: mrpack.size ?? 0, totalBytes: mrpack.size ?? 0 })

  // 2. Extract and read the pack index.
  const staging = path.join(tmpDir, `${projectId}-${versionId}`)
  fs.rmSync(staging, { recursive: true, force: true })
  const buf = fs.readFileSync(packPath)
  zipExtractAll(buf, staging)

  const indexPath = path.join(staging, 'index.json')
  if (!fs.existsSync(indexPath)) throw new Error('This .mrpack has no index.json — it is not a valid Modrinth pack.')
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as MrpackIndex
  if (index.formatVersion !== 1 || (index.game && index.game !== 'minecraft')) {
    throw new Error('This modpack uses an unsupported pack format.')
  }

  const deps = index.dependencies ?? {}
  const mcVersion = deps.minecraft ?? version.game_versions[0]
  if (!mcVersion) throw new Error('The modpack does not declare a Minecraft version.')
  const loaderType: LoaderType = deps['fabric-loader'] ? 'fabric' : deps.forge ? 'forge' : deps.quilt ? 'fabric' : 'vanilla'
  const loaderVersion = deps['fabric-loader'] ?? deps.forge ?? null
  const packName = name?.trim() || index.name?.trim() || `Modpack ${version.version_number}`

  // 3. Create the fresh profile.
  const profile = await profileManager.create({
    name: packName,
    minecraftVersion: mcVersion,
    loader: { type: loaderType, version: loaderVersion },
    memory: 4096,
    resolution: { width: 1280, height: 720, fullscreen: false }
  })

  const skipped: string[] = []
  let installed = 0

  // Files listed directly in the pack (e.g. CurseForge-sourced or bundled
  // jars) can't be resolved from Modrinth — report them transparently.
  const directFiles = (index.files ?? []).filter((f) => !(f.path ?? '').startsWith('overrides/'))
  if (directFiles.length > 0) {
    skipped.push(...directFiles.map((f) => `bundled file: ${f.path ?? '?'}`))
  }

  // 4. Install Modrinth mod dependencies.
  const modrinthDeps = deps.modrinth ?? {}
  const depEntries = Object.entries(modrinthDeps)
  for (let i = 0; i < depEntries.length; i++) {
    const [depProjectId, depVersionId] = depEntries[i]
    eventBus.emit('profile:progress', {
      action: 'import',
      profileId: profile.id,
      name: packName,
      phase: `Installing mod ${i + 1}/${depEntries.length}…`,
      percent: Math.round((i / Math.max(1, depEntries.length)) * 100),
      done: false
    })
    try {
      await modManager.installVersion(profile.id, 'modrinth', depProjectId, depVersionId, 'mod')
      installed++
    } catch (err) {
      skipped.push(depProjectId)
      logger.warn(`Modpack dependency ${depProjectId} could not be restored: ${(err as Error).message}`)
    }
  }

  // 5. Fabric packs always get the official Fabric API.
  if (loaderType === 'fabric') {
    const fresh = await profileManager.get(profile.id)
    if (fresh) {
      const { ensureFabricApi } = await import('./fabric-api')
      await ensureFabricApi(fresh).catch(() => {})
    }
  }

  // 6. Copy overrides (config / resourcepacks / shaderpacks / …) into the instance.
  // v1.0.19 settings persistence: snapshot the config first so an override
  // that ever touches user settings (options.txt, config/) is recoverable.
  const overridesSrc = path.join(staging, 'overrides')
  const gameDir = instancePath(profile)
  if (fs.existsSync(overridesSrc)) {
    try {
      const { configGuard } = await import('../minecraft/config-guard')
      await configGuard.backupInstanceConfig(profile).catch(() => {})
      fs.cpSync(overridesSrc, gameDir, { recursive: true })
      logger.info(`Modpack overrides applied to ${profile.gameDir}`)
    } catch (err) {
      logger.warn(`Modpack overrides could not be copied: ${(err as Error).message}`)
    }
  }

  // 7. Cleanup.
  fs.rmSync(staging, { recursive: true, force: true })
  fs.rmSync(packPath, { force: true })

  logger.info(`Modpack installed: ${packName} (MC ${mcVersion}, ${loaderType}) — ${installed} mods, ${skipped.length} skipped`)
  return { profileId: profile.id, name: packName, installed, skipped }
}

export interface ModpackFileInfo {
  path: string
  size: number
  source: 'modrinth' | 'curseforge' | 'bundled'
}

/**
 * What a modpack version actually contains, read from its .mrpack index:
 * every bundled/curated file with its path + size + source. Powers the
 * preview page's "Includes" tab — no guessing, real manifest data.
 */
export async function modpackContents(versionId: string): Promise<ModpackFileInfo[]> {
  const version = await getJson<{ files?: { filename: string; url: string; size: number }[] }>(
    `${API}/version/${versionId}`,
    { headers: headers(), timeoutMs: 15_000 }
  )
  const mrpack = version.files?.find((f) => f.filename.toLowerCase().endsWith('.mrpack'))
  if (!mrpack) return []

  const tmpDir = path.join(paths.data, 'tmp', 'modpacks')
  fs.mkdirSync(tmpDir, { recursive: true })
  const packPath = path.join(tmpDir, `contents-${versionId}.mrpack`)
  fs.rmSync(packPath, { force: true })
  try {
    await downloadFile(mrpack.url, packPath, undefined, 300_000)
    const staging = path.join(tmpDir, `contents-${versionId}`)
    fs.rmSync(staging, { recursive: true, force: true })
    zipExtractAll(fs.readFileSync(packPath), staging)
    const indexPath = path.join(staging, 'index.json')
    if (!fs.existsSync(indexPath)) return []
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as {
      files?: { path?: string; downloads?: string[]; size?: number }[]
    }
    return (index.files ?? [])
      .filter((f) => f.path && !f.path.startsWith('overrides/'))
      .map((f) => ({
        path: String(f.path),
        size: f.size ?? 0,
        source: f.downloads?.some((d) => d.includes('modrinth.com'))
          ? ('modrinth' as const)
          : f.downloads?.some((d) => d.includes('curseforge.com'))
            ? ('curseforge' as const)
            : ('bundled' as const)
      }))
  } finally {
    fs.rmSync(packPath, { force: true })
  }
}

/* ---------------------- CurseForge modpacks (v1.0.40) ---------------------- */

/** Map a project type to its folder inside the instance (local mirror). */
function cfFolderFor(projectType: string): string {
  switch (projectType) {
    case 'resourcepack': return 'resourcepacks'
    case 'shader': return 'shaderpacks'
    case 'datapack': return 'datapacks'
    default: return 'mods'
  }
}

/** Safe single-component file name (never escapes the instance folder). */
function cfSafeBaseName(name: string): string {
  const base = path.basename(name || '').replace(/[\x00-\x1f]/g, '_')
  return base || 'download.jar'
}

/**
 * Search CurseForge for modpacks (classId 4471). Results are mapped onto the
 * same ModrinthSearchResult shape the Modpacks UI already renders, so both
 * providers share one row. Requires the user's proxy to be configured
 * (throws CF_NO_PROXY otherwise — the UI shows the setup card).
 */
export async function searchCurseforgeModpacks(opts: {
  query?: string
  mcVersion?: string
  offset?: number
  limit?: number
}): Promise<{ items: ModrinthSearchResult[]; totalHits: number }> {
  const hits = await curseforge.searchMods({
    query: opts.query ?? '',
    mcVersion: opts.mcVersion,
    projectType: 'modpack',
    limit: opts.limit ?? 24
  })
  // CurseForge search returns no total-hit count — report the page length.
  return { items: hits, totalHits: hits.length }
}

interface CfModpackManifest {
  minecraft?: { version?: string; modLoaders?: { id?: string; primary?: boolean }[] }
  name?: string
  version?: string
  author?: string
  files?: { projectID?: number; fileID?: number; required?: boolean }[]
  overrides?: string
}

/** Map a CurseForge loader id ("fabric-0.14.21", "forge-47.1.0") to a loader. */
function cfLoaderFromId(id?: string): { type: 'fabric' | 'forge' | 'vanilla'; version: string | null } {
  const v = id ?? ''
  const lower = v.toLowerCase()
  if (lower.startsWith('fabric')) return { type: 'fabric', version: v.slice('fabric-'.length) || null }
  if (lower.startsWith('forge')) return { type: 'forge', version: v.slice('forge-'.length) || null }
  if (lower.startsWith('neoforge')) return { type: 'forge', version: v.slice('neoforge-'.length) || null }
  return { type: 'vanilla', version: null }
}

/**
 * Install a CurseForge modpack. CurseForge packs are plain zips containing a
 * `manifest.json` (Minecraft version + loader + a list of projectID/fileID
 * pairs) plus an `overrides/` folder. The flow mirrors the Modrinth installer:
 * download the archive → read the manifest → create a fresh profile with the
 * pack's MC version + loader → resolve + install every file through the
 * CurseForge API → copy overrides into the instance. Failures on individual
 * files are skipped and reported; the pack install never fails as a whole.
 */
export async function installCurseforgeModpack(
  projectId: string,
  fileId: string,
  name?: string
): Promise<{ profileId: string; name: string; installed: number; skipped: string[] }> {
  const file = await curseforge.fileById(projectId, fileId)
  if (!file) throw new Error('This modpack file is no longer available on CurseForge.')

  const tmpDir = path.join(paths.data, 'tmp', 'modpacks')
  fs.mkdirSync(tmpDir, { recursive: true })
  const packPath = path.join(tmpDir, `cf-${projectId}-${fileId}.zip`)
  if (fs.existsSync(packPath)) fs.rmSync(packPath, { force: true })

  logger.info(`Downloading CurseForge modpack ${name ?? projectId} (${file.filename})`)
  const { recordDownload } = await import('../game/content')
  recordDownload({ label: `Modpack ${name ?? projectId}`, kind: 'mods', status: 'downloading', percent: 0, downloadedBytes: 0, totalBytes: file.size })
  try {
    await downloadFile(file.url, packPath, (p) => {
      recordDownload({ label: `Modpack ${name ?? projectId}`, kind: 'mods', status: 'downloading', percent: p.percent, downloadedBytes: p.received, totalBytes: p.total })
    }, 600_000)
  } catch (err) {
    recordDownload({ label: `Modpack ${name ?? projectId}`, kind: 'mods', status: 'failed', percent: 0, downloadedBytes: 0, totalBytes: file.size })
    throw err
  }
  recordDownload({ label: `Modpack ${name ?? projectId}`, kind: 'mods', status: 'done', percent: 100, downloadedBytes: file.size, totalBytes: file.size })

  // Extract + read manifest.json.
  const staging = path.join(tmpDir, `cf-${projectId}-${fileId}`)
  fs.rmSync(staging, { recursive: true, force: true })
  const buf = fs.readFileSync(packPath)
  zipExtractAll(buf, staging)

  const manifestPath = path.join(staging, 'manifest.json')
  if (!fs.existsSync(manifestPath)) throw new Error('This CurseForge pack has no manifest.json — it is not a valid modpack.')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as CfModpackManifest

  const mcVersion = manifest.minecraft?.version
  if (!mcVersion) throw new Error('The modpack does not declare a Minecraft version.')
  const primary = manifest.minecraft?.modLoaders?.find((l) => l.primary) ?? manifest.minecraft?.modLoaders?.[0]
  const { type: loaderType, version: loaderVersion } = cfLoaderFromId(primary?.id)
  const packName = name?.trim() || manifest.name?.trim() || `Modpack ${projectId}`

  // Create the fresh profile.
  const profile = await profileManager.create({
    name: packName,
    minecraftVersion: mcVersion,
    loader: { type: loaderType, version: loaderVersion },
    memory: 4096,
    resolution: { width: 1280, height: 720, fullscreen: false }
  })

  // Resolve + install every file through the CurseForge API.
  const files = (manifest.files ?? []).filter((f) => f.projectID && f.fileID)
  const skipped: string[] = []
  const installedMods: ProfileMod[] = []
  let installed = 0
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    eventBus.emit('profile:progress', {
      action: 'import',
      profileId: profile.id,
      name: packName,
      phase: `Installing mod ${i + 1}/${files.length}…`,
      percent: Math.round((i / Math.max(1, files.length)) * 100),
      done: false
    })
    try {
      const cfFile = await curseforge.fileById(String(f.projectID), String(f.fileID))
      if (!cfFile || !cfFile.url) {
        skipped.push(String(f.projectID))
        continue
      }
      // CurseForge manifests list every project file (mods + resource packs);
      // route non-jar files (resource/shader packs) to their own folders.
      const lower = cfFile.filename.toLowerCase()
      const projectType: 'mod' | 'resourcepack' | 'shader' =
        lower.endsWith('.zip') && lower.includes('shader') ? 'shader'
          : lower.endsWith('.zip') ? 'resourcepack'
            : 'mod'
      const destDir = path.join(instancePath(profile), cfFolderFor(projectType))
      const { mkdirp } = await import('../utils/fs')
      mkdirp(destDir)
      const dest = path.join(destDir, cfSafeBaseName(cfFile.filename))
      if (fs.existsSync(dest)) fs.rmSync(dest, { force: true })
      logger.info(`Modpack file ${projectId}/${fileId} → ${cfFile.filename}`)
      await runDownloadBatch([{ url: cfFile.url, dest, expectedSize: cfFile.size }], {
        kind: 'mods',
        label: cfFile.filename
      })
      // v1.0.40 — register the file so it shows in Installed with real
      // remove/change-version/update support (like the Modrinth installer).
      let title = cfFile.filename.replace(/\.(jar|zip)$/i, '')
      let iconUrl: string | undefined
      try {
        const pr = await curseforge.getProjectFull(String(f.projectID), projectType)
        if (pr) {
          title = pr.title
          iconUrl = pr.iconUrl
        }
      } catch {
        /* keep the file-name title */
      }
      const entry: ProfileMod = {
        id: String(f.projectID),
        slug: String(f.projectID),
        title,
        filename: cfFile.filename,
        versionId: String(f.fileID),
        versionNumber: cfFile.version || 'latest',
        downloads: 0,
        iconUrl,
        source: 'curseforge',
        projectType,
        installedAt: iso(),
        updateAvailable: null
      }
      installedMods.push(entry)
      installed++
    } catch (err) {
      skipped.push(String(f.projectID))
      logger.warn(`CurseForge modpack file ${f.projectID}/${f.fileID} could not be installed: ${(err as Error).message}`)
    }
  }

  // Persist every installed file as a tracked mod in the new profile.
  if (installedMods.length > 0) {
    const fresh = await profileManager.get(profile.id)
    if (fresh) {
      await profileManager.update(profile.id, { mods: [...(fresh.mods ?? []), ...installedMods] })
    }
  }

  // Fabric packs always get the official Fabric API.
  if (loaderType === 'fabric') {
    const fresh = await profileManager.get(profile.id)
    if (fresh) {
      const { ensureFabricApi } = await import('./fabric-api')
      await ensureFabricApi(fresh).catch(() => {})
    }
  }

  // Copy overrides (config / resourcepacks / shaderpacks / …) into the instance.
  const overridesSrc = path.join(staging, manifest.overrides ?? 'overrides')
  const gameDir = instancePath(profile)
  if (fs.existsSync(overridesSrc)) {
    try {
      const { configGuard } = await import('../minecraft/config-guard')
      await configGuard.backupInstanceConfig(profile).catch(() => {})
      fs.cpSync(overridesSrc, gameDir, { recursive: true })
      logger.info(`CurseForge modpack overrides applied to ${profile.gameDir}`)
    } catch (err) {
      logger.warn(`CurseForge modpack overrides could not be copied: ${(err as Error).message}`)
    }
  }

  // Cleanup.
  fs.rmSync(staging, { recursive: true, force: true })
  fs.rmSync(packPath, { force: true })

  logger.info(`CurseForge modpack installed: ${packName} (MC ${mcVersion}, ${loaderType}) — ${installed} files, ${skipped.length} skipped`)
  return { profileId: profile.id, name: packName, installed, skipped }
}
