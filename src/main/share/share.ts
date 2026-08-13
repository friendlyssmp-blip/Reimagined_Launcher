/**
 * Profile share & import (Part 1/2 of the additive pass).
 *
 * A profile's *setup* can be shared two ways, both built from the exact same
 * immutable snapshot:
 *
 *   1. EXPORT AS .ZIP — a small package (manifest + README) written to disk
 *      that the receiver imports offline until the install step runs.
 *   2. ONLINE CODE — the same snapshot stored in `data/share-codes.json`
 *      behind a unique, non-guessable code valid for exactly 7 days.
 *
 * Imports always create a brand-new independent profile and re-resolve every
 * item from its original source (Modrinth / CurseForge). Items that can no
 * longer be resolved are skipped and reported — the import never fails as a
 * whole. Account data, worlds, saves and screenshots are never shared.
 */
import path from 'node:path'
import { instancePath } from '../instances/paths'
import fsp from 'node:fs/promises'
import zlib from 'node:zlib'
import { randomBytes } from 'node:crypto'
import { paths } from '../paths'
import { exists, readJson, writeJson, mkdirp, dirSize } from '../utils/fs'
import { zipCreate, zipReadEntry, zipExtractPrefix } from '../utils/zip'
import { profileManager } from '../profiles/profile-manager'
import { modManager } from '../mods/mod-manager'
import { installCurseforgeFile } from '../mods/cf-keyless'
import { settingsManager } from '../settings/settings-manager'
import { eventBus } from '../core/event-bus'
import { logger } from '../logs/logger'
import { LauncherError } from '../core/errors'
import { iso } from '../utils/format'
import type { ShareSnapshot, ShareItem } from '@shared/types'

const CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const MANIFEST_NAME = 'reimagined-manifest.json'
const FORMAT_VERSION = 2
/* v1.0.81 — exports may now carry REAL instance folders (saves, mods…), so
 * the import cap grows to 1 GB; only absurd files are rejected. Exports cap
 * raw payload at 1 GB too (the archive builder works in memory). */
const MAX_ZIP_BYTES = 1024 * 1024 * 1024
const MAX_EXPORT_BYTES = 1024 * 1024 * 1024
const MAX_SINGLE_FILE_BYTES = 256 * 1024 * 1024

/**
 * v1.0.81 — the folders a .zip export can bundle as REAL files.
 * `default: true` is the pre-checked set (mods, resource packs, shaders,
 * data packs, worlds). The rest are available on demand (config, settings,
 * screenshots, logs). `settings` maps to `reimagined-settings/` inside the
 * zip (options.txt, servers.dat…) so extraction lands at the instance root.
 */
export const SHARE_FOLDERS: { id: string; label: string; hint: string; default: boolean }[] = [
  { id: 'mods', label: 'Mods', hint: 'Installed mod JARs', default: true },
  { id: 'resourcepacks', label: 'Resource Packs', hint: 'Texture / resource packs', default: true },
  { id: 'shaderpacks', label: 'Shader Packs', hint: 'Iris / OptiFine shaders', default: true },
  { id: 'datapacks', label: 'Data Packs', hint: 'Datapacks (copied into every world)', default: true },
  { id: 'saves', label: 'Worlds (saves)', hint: 'Your singleplayer worlds', default: true },
  { id: 'config', label: 'Config', hint: 'Mod configuration files', default: false },
  { id: 'settings', label: 'Game Settings', hint: 'options.txt + multiplayer server list', default: false },
  { id: 'screenshots', label: 'Screenshots', hint: 'F2 screenshots', default: false },
  { id: 'logs', label: 'Logs', hint: 'Recent game logs', default: false }
]

const FOLDER_SET = new Set(SHARE_FOLDERS.map((f) => f.id))
const CONTENT_FOLDERS = new Set(['mods', 'resourcepacks', 'shaderpacks', 'datapacks'])

/** The instance folder that owns an item type (null = no folder / re-resolve). */
function folderForType(t: string | undefined): string | null {
  if (t === 'mod' || t === 'modpack') return 'mods'
  if (t === 'resourcepack') return 'resourcepacks'
  if (t === 'shader') return 'shaderpacks'
  if (t === 'datapack') return 'datapacks'
  return null
}

/** Settings files bundled under the special `settings` folder id. */
const SETTINGS_FILES = ['options.txt', 'servers.dat', 'optionsof.txt']

/** URL of the Reimagined backend that hosts online share codes. */
async function shareServerBase(): Promise<string | null> {
  try {
    const s = await settingsManager.load()
    const base = String(s.curseforgeProxyUrl ?? '').trim().replace(/\/+$/, '')
    return base || null
  } catch {
    return null
  }
}

/** POST a snapshot to the share server → { code, expiresAt } or null. */
async function postSnapshotToServer(snapshot: ShareSnapshot): Promise<{ code: string; expiresAt: string } | null> {
  const base = await shareServerBase()
  if (!base) return null
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(`${base}/api/share`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ snapshot }),
      signal: ctrl.signal
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const data = (await res.json().catch(() => null)) as { code?: string; expiresAt?: string } | null
    if (!data?.code) return null
    return {
      code: String(data.code).toUpperCase(),
      expiresAt: String(data.expiresAt ?? new Date(Date.now() + CODE_TTL_MS).toISOString())
    }
  } catch {
    return null
  }
}

/**
 * GET a snapshot from the share server. Returns null when the server says
 * the code is unknown/expired; throws when the server is unreachable so the
 * caller can tell the user the network is the problem, not the code.
 */
async function resolveFromServer(code: string): Promise<ShareSnapshot | null> {
  const base = await shareServerBase()
  if (!base) return null
  let res: Response
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    res = await fetch(`${base}/api/share/${encodeURIComponent(code)}`, { signal: ctrl.signal })
    clearTimeout(timer)
  } catch {
    throw new LauncherError(
      'SHARE_SERVER_UNREACHABLE',
      'Could not reach the Reimagined share server.',
      'Check your connection and the backend URL in Settings → Advanced.'
    )
  }
  if (!res.ok) return null
  const data = (await res.json().catch(() => null)) as { snapshot?: ShareSnapshot } | null
  if (!data?.snapshot) return null
  return sanitizeSnapshot(data.snapshot)
}

/** The single active import (for cancellation) — one at a time is fine. */
let activeImport: { cancelled: boolean } | null = null

/** Ask the active import (if any) to stop after the current item. */
export function cancelImport(): void {
  if (activeImport) activeImport.cancelled = true
  // Also abort any in-flight download RIGHT NOW (not just between items), so
  // a CurseForge/Modrinth file stops mid-fetch and its partial file is cleaned.
  void import('../minecraft/downloader').then((m) => m.abortAllDownloads()).catch(() => {})
}

/* --------------------------- deep links (v1.0.19) --------------------------- */

/**
 * Share codes arriving via `reimagined://share/<CODE>` links. The code is
 * kept until the renderer asks for it (it may open before the UI is ready),
 * and also pushed as a live event in case the UI is already listening.
 */
let pendingDeepLink: string | null = null

export function setPendingDeepLink(code: string | null): void {
  pendingDeepLink = code ? String(code).trim().toUpperCase() : null
}

/** Consume the pending deep-link code (renderer mount). */
export function takePendingDeepLink(): string | null {
  const c = pendingDeepLink
  pendingDeepLink = null
  return c
}

interface StoredRecord extends ShareSnapshot {
  code: string
}

function shareFile(): string {
  return path.join(paths.data, 'share-codes.json')
}

async function readRecords(): Promise<Record<string, StoredRecord>> {
  try {
    return await readJson<Record<string, StoredRecord>>(shareFile(), {})
  } catch {
    return {}
  }
}

async function writeRecords(records: Record<string, StoredRecord>): Promise<void> {
  await writeJson(shareFile(), records)
}

/** Drop expired codes so the store never grows stale. */
function pruneExpired(records: Record<string, StoredRecord>): boolean {
  let changed = false
  const now = Date.now()
  for (const code of Object.keys(records)) {
    const rec = records[code]
    if (rec.expiresAt && new Date(rec.expiresAt).getTime() < now) {
      delete records[code]
      changed = true
    }
  }
  return changed
}

/**
 * Build the immutable, portable description of a profile's setup. Every item
 * (mod, resource pack, data pack, shader) keeps its source + version so the
 * receiving launcher can re-download the exact same files. `opts.folders`
 * (v1.0.81) marks a .zip export that ALSO bundles real instance folders.
 */
export async function prepareSnapshot(profileId: string, opts: { folders?: string[] } = {}): Promise<ShareSnapshot> {
  const profile = await profileManager.get(profileId)
  if (!profile) throw new LauncherError('PROFILE_MISSING', 'Profile not found.')

  const items: ShareItem[] = (profile.mods ?? []).map((m) => ({
    id: m.id,
    title: m.title,
    source: m.source,
    projectType: m.projectType,
    versionId: m.versionId,
    versionNumber: m.versionNumber,
    iconUrl: m.iconUrl,
    disabled: m.disabled
  }))

  const folders = (opts.folders ?? []).filter((f) => FOLDER_SET.has(f))
  return sanitizeSnapshot({
    schema: 'reimagined-profile',
    formatVersion: FORMAT_VERSION,
    name: profile.name,
    minecraftVersion: profile.minecraftVersion,
    loader: profile.loader,
    memory: profile.memory,
    resolution: profile.resolution,
    items,
    createdAt: iso(),
    folders: folders.length > 0 ? folders : undefined
  })
}

/**
 * Privacy + integrity sanitization (defense in depth): a share must never
 * carry local paths, separators, control characters or oversized strings —
 * only plain identifiers and whitelisted fields. Applied on the way out
 * (prepare) and on the way in (import), so a hand-crafted manifest can't
 * smuggle anything into the launcher.
 */
function sanitizeSnapshot(snap: ShareSnapshot): ShareSnapshot {
  const clean = (s: unknown): string =>
    String(s ?? '').replace(/[\\/\r\n\x00-\x1f]/g, ' ').trim().slice(0, 240)
  const PROJECT_TYPES = ['mod', 'resourcepack', 'datapack', 'shader', 'modpack']
  const ICON_RE = /^(https?:|data:)/i
  const items: ShareItem[] = (snap.items ?? []).map((it) => ({
    id: clean(it.id) || `p-${Math.random().toString(36).slice(2, 8)}`,
    title: clean(it.title) || 'Shared item',
    source: it.source === 'curseforge' ? 'curseforge' : 'modrinth',
    projectType: (PROJECT_TYPES.includes(it.projectType ?? 'mod') ? it.projectType ?? 'mod' : 'mod') as ShareItem['projectType'],
    versionId: clean(it.versionId),
    versionNumber: clean(it.versionNumber),
    iconUrl: it.iconUrl && ICON_RE.test(String(it.iconUrl)) && String(it.iconUrl).length <= 600 ? String(it.iconUrl) : undefined,
    disabled: Boolean(it.disabled)
  }))
  // v1.0.81 — only known instance folders can travel inside an export.
  const folders = Array.isArray(snap.folders)
    ? snap.folders.map((f) => String(f)).filter((f) => FOLDER_SET.has(f)).slice(0, SHARE_FOLDERS.length)
    : []
  const res = snap.resolution
  const out: ShareSnapshot = {
    schema: 'reimagined-profile',
    formatVersion: FORMAT_VERSION,
    name: clean(snap.name) || 'Shared profile',
    minecraftVersion: clean(snap.minecraftVersion) || '1.21.4',
    loader: {
      type: snap.loader?.type === 'forge' || snap.loader?.type === 'fabric' ? snap.loader.type : 'vanilla',
      version: snap.loader?.version ? clean(snap.loader.version) : null
    },
    memory: typeof snap.memory === 'number' ? Math.max(512, Math.min(65536, Math.round(snap.memory))) : 4096,
    resolution:
      res && typeof res.width === 'number' && typeof res.height === 'number'
        ? { width: res.width, height: res.height, fullscreen: false }
        : { width: 1280, height: 720, fullscreen: false },
    items,
    createdAt: iso()
  }
  if (folders.length > 0) out.folders = folders
  return out
}

/* --------------------------- CurseForge modpacks (v1.0.21) --------------------------- */

/** The manifest.json layout CurseForge exports inside a modpack .zip. */
interface CurseForgeManifest {
  minecraft?: {
    version?: string
    modLoaders?: { id?: string; primary?: boolean }[]
  }
  name?: string
  version?: string
  author?: string
  manifestType?: string
  manifestVersion?: number
  files?: { projectID?: number; fileID?: number; required?: boolean }[]
  overrides?: string
}

/**
 * Map a CurseForge modLoader id ("forge-47.1.0", "fabric-0.14.21") to a
 * launcher loader. The launcher auto-resolves the newest compatible loader
 * version for the pack's Minecraft version, so only the TYPE is kept.
 */
function cfLoaderFromManifest(m: CurseForgeManifest): ShareSnapshot['loader'] {
  const loaders = (m.minecraft?.modLoaders ?? []).filter((l) => l.id)
  const pick = loaders.find((l) => l.primary) ?? loaders[0]
  const id = (pick?.id ?? '').toLowerCase()
  if (id.startsWith('neoforge')) {
    throw new LauncherError(
      'LOADER_UNSUPPORTED',
      'This modpack uses NeoForge, which Reimagined does not support yet.',
      'Fabric and Forge modpacks are supported — NeoForge packs will be added later.'
    )
  }
  if (id.startsWith('fabric')) return { type: 'fabric', version: null }
  if (id.startsWith('forge')) return { type: 'forge', version: null }
  return { type: 'vanilla', version: null }
}

/** Convert a parsed CurseForge manifest into the shared snapshot format. */
function snapshotFromCurseforge(m: CurseForgeManifest): ShareSnapshot {
  const mc = (m.minecraft?.version ?? '').trim()
  if (!mc || !/^\d/.test(mc)) {
    throw new LauncherError(
      'NOT_SHARE_EXPORT',
      'This CurseForge modpack has no usable Minecraft version.',
      'The manifest.json inside the .zip is missing minecraft.version.'
    )
  }
  const loader = cfLoaderFromManifest(m)
  const items: ShareItem[] = (m.files ?? [])
    .filter((f) => f && Number.isFinite(f.projectID) && Number.isFinite(f.fileID))
    .map((f) => ({
      id: String(f.projectID),
      title: `CurseForge #${f.projectID}`,
      source: 'curseforge' as const,
      projectType: 'mod' as const,
      versionId: String(f.fileID),
      versionNumber: '',
      disabled: false
    }))
  return {
    schema: 'reimagined-profile',
    formatVersion: FORMAT_VERSION,
    name: (m.name ?? 'CurseForge Modpack').trim().slice(0, 120) || 'CurseForge Modpack',
    minecraftVersion: mc,
    loader,
    memory: 4096,
    resolution: { width: 1280, height: 720, fullscreen: false },
    items,
    createdAt: iso()
  }
}

/* --------------------------- Modrinth .mrpack (v1.0.81) --------------------------- */

/** The modrinth.index.json layout every .mrpack ships (Modrinth App, Lunar Client, Prism…). */
interface MrpackIndex {
  formatVersion?: number
  game?: string
  versionId?: string
  name?: string
  summary?: string
  files?: {
    path?: string
    hashes?: { sha1?: string; sha512?: string }
    env?: { client?: 'required' | 'optional' | 'unsupported'; server?: 'required' | 'optional' | 'unsupported' }
    downloads?: string[]
    fileSize?: number
  }[]
  dependencies?: Record<string, string>
}

const MRPACK_INDEX = 'modrinth.index.json'

/** Instance folder implied by an mrpack file path (defaults to mod). */
function typeFromMrpackPath(p: string): ShareItem['projectType'] {
  const s = String(p ?? '').replace(/\\/g, '/')
  if (s.startsWith('resourcepacks/')) return 'resourcepack'
  if (s.startsWith('shaderpacks/')) return 'shader'
  if (s.startsWith('datapacks/')) return 'datapack'
  return 'mod'
}

/** Only files meant for a CLIENT install are restored (skip server-only). */
function isClientFile(f: NonNullable<MrpackIndex['files']>[number]): boolean {
  return !f.env || f.env.client !== 'unsupported'
}

/** Map an mrpack dependencies block to a launcher loader (+ MC version). */
function loaderFromMrpack(deps: Record<string, string> | undefined): ShareSnapshot['loader'] {
  const d = deps ?? {}
  if (d.neoforge) {
    throw new LauncherError(
      'LOADER_UNSUPPORTED',
      'This modpack uses NeoForge, which Reimagined does not support yet.',
      'Fabric and Forge modpacks are supported — NeoForge packs will be added later.'
    )
  }
  if (d['quilt-loader']) {
    throw new LauncherError(
      'LOADER_UNSUPPORTED',
      'This modpack uses Quilt, which Reimagined does not support yet.',
      'Fabric and Forge modpacks are supported.'
    )
  }
  if (d['fabric-loader']) return { type: 'fabric', version: d['fabric-loader'] || null }
  if (d.forge) return { type: 'forge', version: d.forge || null }
  return { type: 'vanilla', version: null }
}

/** Convert a parsed mrpack index into the shared snapshot format (preview + import). */
function snapshotFromMrpack(m: MrpackIndex): ShareSnapshot {
  const mc = (m.dependencies?.minecraft ?? '').trim()
  if (!mc || !/^\d/.test(mc)) {
    throw new LauncherError(
      'NOT_SHARE_EXPORT',
      'This Modrinth modpack has no usable Minecraft version.',
      'The modrinth.index.json is missing the minecraft dependency.'
    )
  }
  const loader = loaderFromMrpack(m.dependencies)
  const items: ShareItem[] = (m.files ?? [])
    .filter((f) => f.path && isClientFile(f))
    .map((f) => {
      const p = String(f.path ?? '').replace(/\\/g, '/')
      const type = typeFromMrpackPath(p)
      const host = (f.downloads?.[0] ?? '')
      return {
        // The file path is the unique id — it's also what the import uses to
        // skip excluded files and where each file lands in the instance.
        id: p,
        title: p.split('/').pop() || 'Modpack file',
        source: host.includes('cdn.modrinth.com') ? 'modrinth' : host.includes('forgecdn') || host.includes('curseforge') ? 'curseforge' : 'modrinth',
        projectType: type,
        versionId: '',
        versionNumber: '',
        disabled: false
      }
    })
  return {
    schema: 'reimagined-profile',
    formatVersion: FORMAT_VERSION,
    name: (m.name ?? 'Modrinth Modpack').trim().slice(0, 120) || 'Modrinth Modpack',
    minecraftVersion: mc,
    loader,
    memory: 4096,
    resolution: { width: 1280, height: 720, fullscreen: false },
    items,
    createdAt: iso()
  }
}

/** Best-effort: newest Fabric Loader compatible with a Minecraft version. */
async function latestFabricLoader(mc: string): Promise<string | null> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 6000)
    const res = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mc)}`, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const list = (await res.json().catch(() => null)) as { version?: string }[] | null
    return list?.[0]?.version ?? null
  } catch {
    return null
  }
}

/**
 * Parse a .zip buffer into a snapshot — Reimagined exports, Modrinth
 * .mrpack modpacks AND CurseForge modpack exports (manifest.json +
 * files[]/overrides) are all understood and auto-detected.
 */
export async function readZipBuffer(buf: Buffer): Promise<ShareSnapshot> {
  const reimagined = zipReadEntry(buf, MANIFEST_NAME)
  if (reimagined) {
    try {
      return validateSnapshot(JSON.parse(reimagined.toString('utf-8')))
    } catch (err) {
      if (err instanceof LauncherError) throw err
      throw new LauncherError('SHARE_CORRUPT', 'This profile export is corrupted or unreadable.')
    }
  }

  // Modrinth .mrpack — used by the Modrinth App, Lunar Client, Prism, ATLauncher…
  const mrRaw = zipReadEntry(buf, MRPACK_INDEX)
  if (mrRaw) {
    let m: MrpackIndex | null = null
    try {
      m = JSON.parse(mrRaw.toString('utf-8')) as MrpackIndex
    } catch {
      m = null
    }
    const looksMr =
      m && typeof m.name === 'string' && m.dependencies && typeof m.dependencies.minecraft === 'string' && Array.isArray(m.files)
    if (looksMr && m) return snapshotFromMrpack(m)
  }

  const cfRaw = zipReadEntry(buf, 'manifest.json')
  if (cfRaw) {
    let m: CurseForgeManifest | null = null
    try {
      m = JSON.parse(cfRaw.toString('utf-8')) as CurseForgeManifest
    } catch {
      m = null
    }
    const looksCf =
      m &&
      Array.isArray(m.files) &&
      m.files.length > 0 &&
      m.files.some((f) => f && Number.isFinite(f.projectID) && Number.isFinite(f.fileID)) &&
      (m.manifestType === 'minecraftModpack' || (m.minecraft && typeof m.minecraft.version === 'string'))
    if (looksCf && m) return snapshotFromCurseforge(m)
  }

  throw new LauncherError(
    'NOT_SHARE_EXPORT',
    "This doesn't look like a modpack this launcher can import.",
    'Expected a Modrinth .mrpack (modrinth.index.json), a CurseForge modpack (manifest.json with files) or a Reimagined export (reimagined-manifest.json).'
  )
}

/** Validate a parsed manifest, returning a typed snapshot or a clear error. */
function validateSnapshot(raw: unknown): ShareSnapshot {
  const snap = raw as ShareSnapshot | null
  if (!snap || snap.schema !== 'reimagined-profile') {
    throw new LauncherError(
      'NOT_SHARE_EXPORT',
      "This doesn't look like a Reimagined profile export.",
      'Expected a package containing a reimagined-manifest.json file.'
    )
  }
  if (!snap.name || !snap.minecraftVersion || !Array.isArray(snap.items)) {
    throw new LauncherError('SHARE_CORRUPT', 'This profile export is corrupted or incomplete.')
  }
  return sanitizeSnapshot(snap)
}

/* ------------------------------- ZIP export ------------------------------- */

/** Recursively add a folder's files to the export entries. Returns bytes. */
async function addDirEntries(
  entries: { name: string; data: Buffer }[],
  dir: string,
  prefix: string,
  depth: number
): Promise<number> {
  if (depth > 8) return 0
  let total = 0
  const items = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const it of items) {
    const full = path.join(dir, it.name)
    if (it.isDirectory()) {
      total += await addDirEntries(entries, full, `${prefix}/${it.name}`, depth + 1)
    } else if (it.isFile()) {
      const st = await fsp.stat(full).catch(() => null)
      if (!st || st.size <= 0) continue
      if (st.size > MAX_SINGLE_FILE_BYTES) continue // skip absurd single files
      const data = await fsp.readFile(full)
      entries.push({ name: `${prefix}/${it.name}`, data })
      total += data.length
    }
  }
  return total
}

/** Collect the selected instance folders as zip entries (v1.0.81). */
async function collectFolderEntries(
  profile: { gameDir: string },
  folders: string[]
): Promise<{ entries: { name: string; data: Buffer }[]; total: number; nonEmpty: string[] }> {
  const gameDir = instancePath(profile)
  const entries: { name: string; data: Buffer }[] = []
  const nonEmpty: string[] = []
  let total = 0
  for (const id of folders) {
    if (id === 'settings') {
      let added = 0
      for (const f of SETTINGS_FILES) {
        const p = path.join(gameDir, f)
        if (!exists(p)) continue
        const data = await fsp.readFile(p).catch(() => null)
        if (!data || data.length === 0) continue
        entries.push({ name: `overrides/reimagined-settings/${f}`, data })
        added += data.length
      }
      if (added > 0) nonEmpty.push(id)
      total += added
      continue
    }
    const dir = path.join(gameDir, id)
    if (!exists(dir)) continue
    // v1.0.81 — everything travels under overrides/ so the package is a valid
    // .mrpack: other launchers (Modrinth App, Lunar Client, Prism…) extract it
    // straight into the instance, exactly like Reimagined does.
    const added = await addDirEntries(entries, dir, `overrides/${id}`, 0)
    if (added > 0) nonEmpty.push(id)
    total += added
  }
  return { entries, total, nonEmpty }
}

/**
 * Write a profile to a UNIVERSAL .mrpack (Modrinth Modpack format) — the
 * format Modrinth App, Lunar Client, Prism, ATLauncher… all import. It ships:
 *   • modrinth.index.json — name, Minecraft + loader dependencies, files[]
 *   • overrides/          — the selected real folders (mods, worlds, config…)
 *                           extracted straight into the instance by any launcher
 *   • reimagined-manifest.json — embedded so Reimagined round-trips keep exact
 *                           version pinning and folder metadata (other
 *                           launchers simply ignore it)
 * files[] is intentionally left empty: everything is shipped as files under
 * overrides/, which every mrpack importer restores as-is — fully offline and
 * dependency-free, instead of relying on remote download URLs.
 */
export async function exportZip(profileId: string, savePath: string, folders: string[] = []): Promise<void> {
  const profile = await profileManager.get(profileId)
  if (!profile) throw new LauncherError('PROFILE_MISSING', 'Profile not found.')
  // Collect files first so the manifest only lists folders that actually
  // carry content (empty folders are skipped and re-resolved on import).
  const collected = folders.length > 0 ? await collectFolderEntries(profile, folders) : null
  const folderEntries = collected?.entries ?? []
  const nonEmpty = collected?.nonEmpty ?? []
  if (collected && collected.total > MAX_EXPORT_BYTES) {
    throw new LauncherError(
      'EXPORT_TOO_LARGE',
      'The selected folders are too large to export.',
      `They add up to more than 1 GB. Uncheck some folders (for example Worlds) and try again.`
    )
  }
  const snapshot = await prepareSnapshot(profileId, { folders: nonEmpty })
  const manifest = Buffer.from(JSON.stringify(snapshot, null, 2), 'utf-8')

  // Loader dependency for other launchers (best-effort when no version is pinned).
  const deps: Record<string, string> = { minecraft: snapshot.minecraftVersion }
  if (snapshot.loader.type === 'fabric') {
    const v = snapshot.loader.version ?? (await latestFabricLoader(snapshot.minecraftVersion))
    if (v) deps['fabric-loader'] = v
  } else if (snapshot.loader.type === 'forge') {
    if (snapshot.loader.version) deps.forge = snapshot.loader.version
  }
  const mrpackIndex = Buffer.from(
    JSON.stringify(
      {
        formatVersion: 1,
        game: 'minecraft',
        versionId: '1.0.0',
        name: snapshot.name,
        summary: `Exported from the Reimagined launcher (${snapshot.items.length} item(s)).`,
        files: [],
        dependencies: deps
      },
      null,
      2
    ),
    'utf-8'
  )

  const readme = Buffer.from(
    [
      'REIMAGINED PROFILE EXPORT (.mrpack)',
      '=================================',
      '',
      `Profile: ${snapshot.name}`,
      `Minecraft: ${snapshot.minecraftVersion}`,
      `Loader: ${snapshot.loader.type}${snapshot.loader.version ? ` (${snapshot.loader.version})` : ''}`,
      `Items: ${snapshot.items.length}`,
      `Files: ${nonEmpty.length > 0 ? nonEmpty.join(', ') : 'none (setup only)'}`,
      `Created: ${snapshot.createdAt}`,
      '',
      'This is a standard Modrinth modpack (.mrpack) — import it in the',
      'Reimagined launcher, the Modrinth App, Lunar Client, Prism or any',
      'launcher that supports .mrpack modpacks.',
      'No account data or personal information are included.',
      ''
    ].join('\n'),
    'utf-8'
  )
  const zip = zipCreate([
    { name: MRPACK_INDEX, data: mrpackIndex },
    { name: MANIFEST_NAME, data: manifest },
    { name: 'README.txt', data: readme },
    ...folderEntries
  ])
  mkdirp(path.dirname(savePath))
  await fsp.writeFile(savePath, zip)
  logger.info(
    `Profile exported to .mrpack: "${snapshot.name}" → ${savePath} (${snapshot.items.length} items, folders: ${nonEmpty.join(', ') || 'none'})`
  )
}

/** Open a save dialog and export the profile to the chosen location. */
export async function exportZipWithDialog(
  profileId: string,
  folders: string[] = []
): Promise<{ canceled: true } | { canceled: false; path: string; name: string }> {
  const profile = await profileManager.get(profileId)
  if (!profile) throw new LauncherError('PROFILE_MISSING', 'Profile not found.')
  const { dialog: electronDialog } = await import('electron')
  const showSaveDialog = electronDialog.showSaveDialog.bind(electronDialog)
  const safeName = (profile.name || 'profile').replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'profile'
  const result = await showSaveDialog({
    title: 'Export Reimagined profile',
    defaultPath: `${safeName}-modpack.mrpack`,
    filters: [{ name: 'Modrinth modpack (.mrpack)', extensions: ['mrpack'] }]
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  await exportZip(profileId, result.filePath, folders)
  return { canceled: false, path: result.filePath, name: profile.name }
}

/** Size of every exportable folder (bytes) for the export picker UI. */
export async function folderSizes(profileId: string): Promise<Record<string, number>> {
  const profile = await profileManager.get(profileId)
  if (!profile) throw new LauncherError('PROFILE_MISSING', 'Profile not found.')
  const gameDir = instancePath(profile)
  const out: Record<string, number> = {}
  for (const f of SHARE_FOLDERS) {
    if (f.id === 'settings') {
      let total = 0
      for (const name of SETTINGS_FILES) {
        const st = await fsp.stat(path.join(gameDir, name)).catch(() => null)
        if (st) total += st.size
      }
      out[f.id] = total
      continue
    }
    const p = path.join(gameDir, f.id)
    out[f.id] = exists(p) ? await dirSize(p) : 0
  }
  return out
}

/** Read + validate an export .zip (Reimagined or CurseForge) → snapshot. */
export async function readZip(zipPath: string): Promise<ShareSnapshot> {
  if (!exists(zipPath)) {
    throw new LauncherError('FILE_MISSING', 'The selected file no longer exists.')
  }
  const st = await fsp.stat(zipPath).catch(() => null)
  if (!st) throw new LauncherError('FILE_MISSING', 'The selected file no longer exists.')
  if (st.size > MAX_ZIP_BYTES) {
    throw new LauncherError('INVALID_FILE', 'This .zip is too large to be a valid profile export.')
  }
  return readZipBuffer(await fsp.readFile(zipPath))
}

/* ------------------------------ Online codes ------------------------------ */

/* ------------------------- PORTABLE CODES (v1.0.85) -------------------------
 *
 * A "portable" code embeds the ENTIRE snapshot inside the code string itself
 * (deflate → base32). It works on ANY launcher, on ANY PC, with NO server,
 * forever — the code IS the data. This is the fix for share codes failing on
 * another computer: the Render free-tier backend keeps codes in memory and
 * loses them on spin-down/restart, so a server-only code could vanish before
 * the receiver used it. A portable code can't.
 *
 * The alphabet is pure uppercase base32 (A–Z, 2–7, no padding) so codes
 * survive the existing .toUpperCase() normalization and the reimagined://
 * deep-link regex ([A-Za-z0-9]+) unchanged.
 */
const PORTABLE_PREFIX = 'R1'

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
function toBase32(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

function fromBase32(s: string): Buffer {
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of s) {
    const idx = B32_ALPHABET.indexOf(ch)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** Encode a snapshot into a self-contained, portable code. */
export function encodePortableCode(snapshot: ShareSnapshot): string {
  const deflated = zlib.deflateSync(Buffer.from(JSON.stringify(snapshot), 'utf-8'))
  return PORTABLE_PREFIX + toBase32(deflated)
}

/** Decode a portable code back to a snapshot (null if it isn't one). */
function decodePortableCode(key: string): ShareSnapshot | null {
  try {
    const raw = fromBase32(key.slice(PORTABLE_PREFIX.length))
    const json = zlib.inflateSync(raw).toString('utf-8')
    const snap = JSON.parse(json) as ShareSnapshot
    if (!snap || snap.schema !== 'reimagined-profile' || !Array.isArray(snap.items)) return null
    return sanitizeSnapshot(snap)
  } catch {
    return null
  }
}

/** True when a code is a self-contained portable code (R1 prefix + long). */
function isPortable(key: string): boolean {
  return key.startsWith(PORTABLE_PREFIX) && key.length > 40
}

function genLocalCode(): string {
  return randomBytes(8).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 11).toUpperCase()
}

/**
 * Store the profile's snapshot behind a unique code valid for 7 days.
 * Editing the original profile afterwards never changes what the code
 * resolves to (the snapshot is fixed at generation time).
 *
 * v1.0.81 — the code is PUBLISHED to the share server so it resolves on ANY
 * launcher (that's what "codes work" means). A local record is kept too, so
 * the generating machine can also resolve it offline. If the server is
 * unreachable the code still works on this device (with a warning).
 */
export async function createCode(profileId: string): Promise<{ code: string; portable: string; expiresAt: string; snapshot: ShareSnapshot; serverPublished?: boolean }> {
  const snapshot = await prepareSnapshot(profileId)
  const portable = encodePortableCode(snapshot)
  const records = await readRecords()
  pruneExpired(records)

  // Publish online first — a code that only lives on this disk can't be
  // imported from another launcher, which is the whole point of a code.
  let code = ''
  let expiresAt = ''
  let serverPublished = false
  const remote = await postSnapshotToServer(snapshot)
  if (remote) {
    code = remote.code
    expiresAt = remote.expiresAt
    serverPublished = true
    logger.info(`Share code published to server: ${code} ("${snapshot.name}")`)
  } else {
    for (let attempt = 0; attempt < 5; attempt++) {
      code = genLocalCode()
      if (!records[code]) break
      code = ''
    }
    if (!code) throw new LauncherError('SHARE_FAILED', 'Could not generate a unique share code. Try again.')
    expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString()
    logger.warn(`Share server unreachable — code ${code} works only on this device until the server is reachable.`)
  }

  // Always keep the local mirror too (offline / same-machine resolution).
  // If the local write fails the code still works via the server — never
  // fail the whole request because of a bookkeeping hiccup.
  try {
    records[code] = { ...snapshot, code, expiresAt, profileId }
    await writeRecords(records)
  } catch (err) {
    logger.warn(`Could not persist local share record for ${code}: ${(err as Error).message}`)
  }
  return { code, portable, expiresAt, snapshot, serverPublished }
}

/**
 * Resolve a code to its exact snapshot, enforcing the 7-day expiry.
 * v1.0.81 — local record first (covers offline + this device), then the
 * share server (codes generated on any other launcher).
 */
export async function resolveCode(code: string): Promise<ShareSnapshot> {
  const key = (code ?? '').trim().toUpperCase()
  if (!key) throw new LauncherError('SHARE_NOT_FOUND', 'Enter a share code first.')

  // v1.0.85 — a portable code IS the snapshot: decode it directly, no server,
  // no local record needed. Works on any PC even fully offline.
  if (isPortable(key)) {
    const portable = decodePortableCode(key)
    if (portable) {
      logger.info(`Share code resolved (portable): "${portable.name}" (${portable.minecraftVersion}, ${portable.items.length} items)`)
      return portable
    }
  }

  const records = await readRecords()
  const rec = records[key]
  if (rec) {
    if (rec.expiresAt && new Date(rec.expiresAt).getTime() < Date.now()) {
      throw new LauncherError(
        'SHARE_EXPIRED',
        'This share code has expired.',
        'Codes are valid for 7 days after they are generated.'
      )
    }
    logger.info(`Share code resolved (local): "${rec.name}" (${rec.minecraftVersion}, ${rec.items.length} items)`)
    const { code: _code, profileId: _pid, ...snapshot } = rec
    return snapshot
  }
  // Not generated on this device — ask the share server.
  const remote = await resolveFromServer(key)
  if (remote) {
    logger.info(`Share code resolved (server): "${remote.name}" (${remote.minecraftVersion}, ${remote.items.length} items)`)
    return remote
  }
  throw new LauncherError(
    'SHARE_NOT_FOUND',
    'This share code is invalid or has expired.',
    'Codes are valid for 7 days after they are generated.'
  )
}

/* -------------------------------- Importing ------------------------------- */

export interface ImportResult {
  profileId: string
  name: string
  skipped: string[]
}

export interface ImportOptions {
  /** v1.0.52 — items the user dropped from the import preview. */
  exclude?: string[]
  /**
   * v1.0.81 — .zip exports that bundle real instance folders: the archive
   * buffer + which folders it contains. Their files are extracted into the
   * new instance and matching items are NOT re-downloaded from source.
   */
  localZip?: Buffer
  localFolders?: string[]
}

/**
 * Create a brand-new independent profile from a snapshot and restore every
 * item from its original source, with step-by-step progress. Items that can
 * no longer be resolved are skipped and reported — never a hard failure.
 */
export async function importSnapshot(snapshot: ShareSnapshot, opts: ImportOptions | string[] = {}): Promise<ImportResult> {
  // v1.0.19: sanitize whatever came in (code or zip) before using it.
  // Back-compat: a bare array is treated as the old `exclude` argument.
  const { exclude = [], localZip, localFolders = [] } = Array.isArray(opts) ? { exclude: opts } : opts
  snapshot = sanitizeSnapshot(snapshot)
  const profile = await profileManager.create({
    name: snapshot.name,
    minecraftVersion: snapshot.minecraftVersion,
    loader: { type: snapshot.loader.type, version: snapshot.loader.version },
    memory: snapshot.memory,
    resolution: snapshot.resolution
  })

  activeImport = { cancelled: false }
  const emit = (phase: string, percent: number | null) =>
    eventBus.emit('profile:progress', {
      action: 'import',
      profileId: profile.id,
      name: profile.name,
      phase,
      percent,
      done: false
    })

  try {
    emit('Setting up folders…', 8)
    const { mkdirp } = await import('../utils/fs')
    const pathMod = await import('node:path')
    for (const d of ['mods', 'saves', 'logs', 'resourcepacks', 'shaderpacks', 'datapacks']) {
      mkdirp(pathMod.join(instancePath(profile), d))
    }

    /* v1.0.81 — restore the real files bundled in the archive (worlds,
     * mods, configs…) before the download loop, so those items don't need
     * re-downloading. Only folders that were actually non-empty on the
     * source machine are treated as restored-by-file. */
    const extractedFolders = new Set<string>()
    if (localZip && localFolders.length > 0) {
      const gameDir = instancePath(profile)
      for (const folder of localFolders) {
        // v1.0.81 — the universal .mrpack layout keeps everything under
        // overrides/, so extraction strips that prefix from each path.
        const prefix = `overrides/${folder === 'settings' ? 'reimagined-settings' : folder}`
        const dest = folder === 'settings' ? gameDir : pathMod.join(gameDir, folder)
        const written = zipExtractPrefix(localZip, prefix, dest)
        if (written.length > 0) {
          extractedFolders.add(folder)
          logger.info(`Import: restored ${written.length} file(s) from share zip folder "${folder}"`)
        }
      }
      // Register mods / resource packs / shaders / data packs that arrived
      // as files, so they show up installed (source: local) right away.
      if ([...extractedFolders].some((f) => CONTENT_FOLDERS.has(f))) {
        await modManager.identifyManualMods(profile.id)
      }
    }
    // Item types restored from files (not re-downloaded).
    const restoredByFile = new Set(
      ['mod', 'modpack', 'resourcepack', 'shader', 'datapack'].filter(
        (t) => extractedFolders.has(folderForType(t) ?? '')
      )
    )

    // v1.0.52 — the user can drop items from the import preview; excluded ids
    // are filtered out before anything is downloaded or installed.
    const items = (snapshot.items ?? []).filter(
      (it) => !exclude.includes(it.id) && !restoredByFile.has(it.projectType ?? 'mod')
    )
    const skipped: string[] = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (activeImport?.cancelled) {
        throw new LauncherError('IMPORT_CANCELLED', 'Import cancelled.', 'The partially-created profile was removed.')
      }
      emit(`Restoring ${item.title}…`, 15 + Math.round((i / Math.max(1, items.length)) * 80))
      try {
        const type = (item.projectType ?? 'mod') as 'mod' | 'resourcepack' | 'shader' | 'datapack'
        if (item.source === 'curseforge') {
          // v1.0.21: CurseForge items restore through the keyless resolver
          // (exact pinned file only — never silently substitutes versions).
          if (item.versionId) {
            await installCurseforgeFile(profile.id, item.id, item.versionId, type)
          } else {
            skipped.push(`${item.title} (no pinned CurseForge file)`)
            continue
          }
        } else if (item.source === 'modrinth') {
          // Exact version preferred; dependencies are resolved and deduped
          // (already-installed dependencies are never duplicated).
          await modManager.installWithDeps(profile.id, item.id, item.versionId ?? undefined, type)
        } else {
          skipped.push(`${item.title} (local content — not included in share)`)
          continue
        }
        // A shared disabled item must stay disabled in the new profile.
        const installed = await profileManager.get(profile.id)
        const mod = installed?.mods.find((m) => m.id === item.id)
        if (item.disabled && mod) {
          await modManager.setEnabled(profile.id, mod.slug, false)
        }
      } catch (err) {
        // Already present (e.g. installed as a dependency of an earlier item)
        // is a SUCCESS, not a skip — the shared content is fully there.
        if ((err as { code?: string }).code === 'MOD_INSTALLED') {
          logger.info(`Import: "${item.title}" was already installed — keeping it.`)
          continue
        }
        logger.warn(`Import: could not restore "${item.title}": ${(err as Error).message}`)
        skipped.push(item.title)
      }
    }

    emit('Finalizing…', 97)
    const finalProfile = await profileManager.get(profile.id)
    eventBus.emit('profile:changed', { action: 'created', profile: finalProfile })
    eventBus.emit('profile:progress', { action: 'import', profileId: profile.id, name: profile.name, phase: 'Done', percent: 100, done: true })

    logger.info(
      `Profile imported: "${snapshot.name}" (${snapshot.minecraftVersion}) — ${items.length - skipped.length}/${items.length} items restored`
    )
    return { profileId: profile.id, name: profile.name, skipped }
  } catch (err) {
    if ((err as { code?: string }).code === 'IMPORT_CANCELLED') {
      // Leave no trace: remove the partially-created profile and its instance.
      await profileManager.delete(profile.id, { deleteFiles: true }).catch(() => {})
      eventBus.emit('profile:progress', {
        action: 'import',
        profileId: profile.id,
        name: profile.name,
        phase: 'Cancelled',
        percent: 0,
        done: true
      })
      logger.warn(`Import cancelled by the user — profile "${snapshot.name}" removed.`)
    }
    throw err
  } finally {
    activeImport = null
  }
}

/** Import by online code. */
export async function importCode(code: string, exclude: string[] = []): Promise<ImportResult> {
  const snapshot = await resolveCode(code)
  return importSnapshot(snapshot, { exclude })
}

/** Import from an exported .zip file (Reimagined or CurseForge). */
export async function importZip(zipPath: string, exclude: string[] = []): Promise<ImportResult> {
  if (!exists(zipPath)) {
    throw new LauncherError('FILE_MISSING', 'The selected file no longer exists.')
  }
  const st = await fsp.stat(zipPath).catch(() => null)
  if (!st) throw new LauncherError('FILE_MISSING', 'The selected file no longer exists.')
  if (st.size > MAX_ZIP_BYTES) {
    throw new LauncherError('INVALID_FILE', 'This .zip is too large to be a valid profile export.')
  }
  const buf = await fsp.readFile(zipPath)
  return importZipBuffer(buf, exclude)
}

/**
 * Join a zip-relative path to a destination, refusing traversal (`..`,
 * absolute paths, drive letters). Returns null for unsafe paths.
 */
function safeJoinPath(destDir: string, rel: string): string | null {
  const clean = String(rel ?? '').replace(/\\/g, '/')
  if (!clean || clean.startsWith('/') || /^[a-zA-Z]:/.test(clean)) return null
  if (clean.split('/').includes('..')) return null
  return path.join(destDir, clean)
}

/**
 * Import a Modrinth .mrpack (Modrinth App / Lunar Client / Prism / ATLauncher…).
 * Every client-compatible file[] is downloaded to its exact path, overrides/
 * is applied, and the result is scanned so installed content is registered.
 */
async function importMrpack(buf: Buffer, snapshot: ShareSnapshot, exclude: string[] = []): Promise<ImportResult> {
  const raw = zipReadEntry(buf, MRPACK_INDEX)?.toString('utf-8')
  const index = (raw ? JSON.parse(raw) : null) as MrpackIndex | null
  // Defense in depth — never trust a hand-crafted mrpack (same as Reimagined).
  snapshot = sanitizeSnapshot(snapshot)
  const profile = await profileManager.create({
    name: snapshot.name,
    minecraftVersion: snapshot.minecraftVersion,
    loader: { type: snapshot.loader.type, version: snapshot.loader.version },
    memory: snapshot.memory,
    resolution: snapshot.resolution
  })

  activeImport = { cancelled: false }
  const emit = (phase: string, percent: number | null) =>
    eventBus.emit('profile:progress', {
      action: 'import',
      profileId: profile.id,
      name: profile.name,
      phase,
      percent,
      done: false
    })

  try {
    const { mkdirp } = await import('../utils/fs')
    const pathMod = await import('node:path')
    const gameDir = instancePath(profile)
    for (const d of ['mods', 'saves', 'logs', 'resourcepacks', 'shaderpacks', 'datapacks']) {
      mkdirp(pathMod.join(gameDir, d))
    }

    // 1. Apply overrides/ (configs, resource packs, worlds…) into the instance.
    emit('Applying overrides…', 12)
    const applied = zipExtractPrefix(buf, 'overrides', gameDir)
    if (applied.length > 0) {
      logger.info(`mrpack import: applied ${applied.length} override file(s) to "${profile.name}"`)
    }

    // 2. Download every client-compatible file to its exact path (excluded
    // items are honored by their preview id = normalized file path).
    const files = (index?.files ?? [])
      .filter(isClientFile)
      .filter((f) => f.path && !exclude.includes(String(f.path).replace(/\\/g, '/')))
    const downloads = files
      .map((f) => {
        const dest = safeJoinPath(gameDir, f.path ?? '')
        const url = f.downloads?.[0]
        if (!dest || !url) return null
        return {
          url,
          dest,
          expectedSize: typeof f.fileSize === 'number' ? f.fileSize : undefined,
          expectedSha1: f.hashes?.sha1 || undefined
        }
      })
      .filter((d): d is NonNullable<typeof d> => d !== null)
    emit(`Downloading ${downloads.length} file(s)…`, 25)
    if (downloads.length > 0) {
      if (activeImport?.cancelled) throw new LauncherError('IMPORT_CANCELLED', 'Import cancelled.', '')
      try {
        const { runDownloadBatch } = await import('../minecraft/downloader')
        await runDownloadBatch(downloads, { kind: 'mods', label: `Modpack "${profile.name}"` })
      } catch (err) {
        // A user cancel must not be swallowed — it cleans up the profile.
        if (activeImport?.cancelled) {
          throw new LauncherError('IMPORT_CANCELLED', 'Import cancelled.', '')
        }
        // Files that failed to download are skipped, not fatal — the import
        // still finishes and reports what's missing via identifyManualMods.
        logger.warn(`mrpack import: some files failed to download: ${(err as Error).message}`)
      }
    }

    // 3. Register whatever is on disk now (mods, packs…) with real identities.
    emit('Finalizing…', 92)
    await modManager.identifyManualMods(profile.id)
    const finalProfile = await profileManager.get(profile.id)
    eventBus.emit('profile:changed', { action: 'created', profile: finalProfile })
    eventBus.emit('profile:progress', { action: 'import', profileId: profile.id, name: profile.name, phase: 'Done', percent: 100, done: true })

    logger.info(
      `mrpack imported: "${snapshot.name}" (${snapshot.minecraftVersion}, ${downloads.length} file(s), ${applied.length} override(s))`
    )
    return { profileId: profile.id, name: profile.name, skipped: [] }
  } catch (err) {
    if ((err as { code?: string }).code === 'IMPORT_CANCELLED') {
      await profileManager.delete(profile.id, { deleteFiles: true }).catch(() => {})
      eventBus.emit('profile:progress', {
        action: 'import',
        profileId: profile.id,
        name: profile.name,
        phase: 'Cancelled',
        percent: 0,
        done: true
      })
      logger.warn(`mrpack import cancelled — profile "${snapshot.name}" removed.`)
    }
    throw err
  } finally {
    activeImport = null
  }
}

/**
 * Import from an in-memory .zip buffer. AUTO-DETECTS the format: Reimagined
 * exports (reimagined-manifest.json), Modrinth .mrpack (modrinth.index.json,
 * used by Modrinth App / Lunar Client / Prism / ATLauncher) and CurseForge
 * modpacks (manifest.json + overrides).
 */
export async function importZipBuffer(buf: Buffer, exclude: string[] = []): Promise<ImportResult> {
  const snapshot = await readZipBuffer(buf)

  // Modrinth .mrpack (from any launcher) → dedicated import path.
  if (zipReadEntry(buf, MRPACK_INDEX) && !zipReadEntry(buf, MANIFEST_NAME)) {
    return importMrpack(buf, snapshot, exclude)
  }

  // v1.0.81 — a Reimagined export may carry real instance folders; restore
  // them from the archive instead of re-downloading the matching items.
  const localFolders = snapshot.folders ?? []
  const result = await importSnapshot(snapshot, {
    exclude,
    localZip: localFolders.length > 0 ? buf : undefined,
    localFolders
  })

  // CurseForge packs ship config / resource packs / scripts inside the
  // archive's `overrides/` folder — apply them into the fresh instance.
  const isCurseforge = snapshot.items.length > 0 && snapshot.items[0].source === 'curseforge'
  if (isCurseforge) {
    const profile = await profileManager.get(result.profileId)
    if (profile) {
      const applied = zipExtractPrefix(buf, 'overrides', instancePath(profile))
      if (applied.length > 0) {
        logger.info(`CurseForge import: applied ${applied.length} override file(s) to "${profile.name}"`)
      }
    }
  }
  return result
}

export const shareService = {
  prepareSnapshot,
  exportZip,
  exportZipWithDialog,
  folderSizes,
  readZip,
  readZipBuffer,
  importZip,
  importZipBuffer,
  createCode,
  resolveCode,
  importCode,
  cancelImport,
  setPendingDeepLink,
  takePendingDeepLink
}
