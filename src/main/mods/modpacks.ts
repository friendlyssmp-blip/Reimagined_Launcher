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
import fs from 'node:fs'
import { paths } from '../paths'
import { logger } from '../logs/logger'
import { eventBus } from '../core/event-bus'
import { getJson, downloadFile } from '../utils/http'
import { zipExtractAll } from '../utils/zip'
import { profileManager } from '../profiles/profile-manager'
import { modManager } from './mod-manager'
import type { ModrinthSearchResult, LoaderType } from '@shared/types'

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
  const gameDir = path.join(paths.games, profile.gameDir)
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
