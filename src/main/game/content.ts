/**
 * Instance content scanner.
 *
 * Reads real files from each profile's game directory:
 *  - `saves/`         → worlds (folder name + size + last modified)
 *  - `resourcepacks/` → resource packs (.zip / folders)
 *  - `shaderpacks/`   → shader packs (.zip / folders)
 * Everything is real filesystem data — no placeholders.
 */
import path from 'node:path'
import fsp from 'node:fs/promises'
import { paths } from '../paths'
import { profileManager } from '../profiles/profile-manager'
import { listDir, dirSize, exists, mkdirp } from '../utils/fs'
import { eventBus } from '../core/event-bus'

export interface WorldEntry {
  name: string
  folder: string
  sizeBytes: number
  lastModified: string | null
  icon: 'terrain'
}

export interface PackEntry {
  name: string
  kind: 'folder' | 'zip'
  sizeBytes: number
}

export interface DownloadEntry {
  id: string
  label: string
  kind: string
  status: 'downloading' | 'done' | 'failed'
  percent: number
  downloadedBytes: number
  totalBytes: number
  at: string
  /** Optional project icon — powers the fly-to-downloads animation (v1.0.24). */
  iconUrl?: string
  /** Last time the entry was touched — stale 'downloading' entries die here. */
  updatedAt?: string
}

function fmtSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`
  return `${bytes} B`
}

/** Instance root for a profile (data/games/<gameDir>). */
export async function instanceRoot(profileId: string): Promise<string | null> {
  const profile = await profileManager.get(profileId)
  if (!profile) return null
  return path.join(paths.games, profile.gameDir)
}

export async function listWorlds(profileId: string): Promise<WorldEntry[]> {
  const root = await instanceRoot(profileId)
  if (!root) return []
  const savesDir = path.join(root, 'saves')
  if (!exists(savesDir)) return []
  const entries = await listDir(savesDir)
  const worlds: WorldEntry[] = []
  for (const folder of entries) {
    const full = path.join(savesDir, folder)
    const st = await fsp.stat(full).catch(() => null)
    if (!st || !st.isDirectory()) continue // only directories
    const sizeBytes = await dirSize(full)
    worlds.push({
      name: folder,
      folder,
      sizeBytes,
      lastModified: st.mtime ? st.mtime.toISOString() : null,
      icon: 'terrain'
    })
  }
  // Largest worlds first.
  return worlds.sort((a, b) => b.sizeBytes - a.sizeBytes)
}

/**
 * v1.0.82 — install a CurseForge world/map into an instance's saves folder.
 * Downloads the world archive (resolved for the profile's MC version) and
 * extracts it under saves/<title>/. A safe folder name is derived from the
 * project title so it can never escape saves/.
 */
export async function installWorld(profileId: string, projectId: string): Promise<{ folder: string; title: string }> {
  const root = await instanceRoot(profileId)
  if (!root) throw new Error('Instance folder not found.')
  const profile = await profileManager.get(profileId)
  if (!profile) throw new Error('Profile not found.')
  const { curseforge } = await import('../mods/curseforge')
  const file = await curseforge.latestFile(projectId, profile.minecraftVersion, 'vanilla')
  if (!file) throw new Error(`No version of this world supports Minecraft ${profile.minecraftVersion}.`)
  const detail = await curseforge.getProjectFull(projectId, 'world').catch(() => null)
  const title = detail?.title ?? file.filename.replace(/\.zip$/i, '')
  // Safe single-folder name (never empty, never a traversal).
  const safeTitle = (title || 'world').replace(/[\\/:*?"<>|]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, 80) || 'world'

  const savesDir = path.join(root, 'saves')
  mkdirp(savesDir)
  const tmpZip = path.join(savesDir, `.world-dl-${Date.now()}.zip`)
  try {
    const { runDownloadBatch } = await import('../minecraft/downloader')
    await runDownloadBatch([{ url: file.url, dest: tmpZip, expectedSize: file.size }], {
      kind: 'mods',
      label: title
    })
    const { zipExtractAll } = await import('../utils/zip')
    const buf = await fsp.readFile(tmpZip)
    // Never overwrite an existing world silently — move it aside with a
    // unique "(imported)" suffix (incremented until a free name is found).
    const dest = path.join(savesDir, safeTitle)
    if (exists(dest)) {
      let n = 2
      let moved = `${dest} (imported)`
      while (exists(moved)) {
        moved = `${dest} (imported ${n})`
        n++
      }
      await fsp.rename(dest, moved)
    }
    mkdirp(dest)
    zipExtractAll(buf, dest)
    eventBus.emit('mods:changed', { profileId, action: 'world-installed', title })
    return { folder: safeTitle, title }
  } finally {
    await fsp.rm(tmpZip, { force: true }).catch(() => {})
  }
}

export async function listPacks(profileId: string, kind: 'resourcepacks' | 'shaders'): Promise<PackEntry[]> {
  const root = await instanceRoot(profileId)
  if (!root) return []
  const dirName = kind === 'shaders' ? 'shaderpacks' : 'resourcepacks'
  const packsDir = path.join(root, dirName)
  if (!exists(packsDir)) return []
  const entries = await listDir(packsDir)
  const packs: PackEntry[] = []
  for (const name of entries) {
    const full = path.join(packsDir, name)
    if (name.endsWith('.zip')) {
      const st = await fsp.stat(full).catch(() => null)
      if (!st || !st.isFile()) continue
      packs.push({ name: name.replace(/\.zip$/i, ''), kind: 'zip', sizeBytes: st.size })
    } else {
      const st = await fsp.stat(full).catch(() => null)
      if (!st || !st.isDirectory()) continue // only directories / zips
      const sizeBytes = await dirSize(full)
      packs.push({ name, kind: 'folder', sizeBytes })
    }
  }
  return packs.sort((a, b) => a.name.localeCompare(b.name))
}

/** Absolute path to a sub-folder of an instance (mods, saves, resourcepacks…). */
export async function instanceSubPath(profileId: string, sub: string): Promise<string | null> {
  const root = await instanceRoot(profileId)
  if (!root) return null
  const full = path.join(root, sub)
  return exists(full) ? full : null
}

/* ------------------------------ download tracker ------------------------------ */

const downloadHistory: DownloadEntry[] = []
let downloadSeq = 0

/**
 * Record (or update) a download entry and return its stable id.
 *
 * The same task is updated in place by matching label+kind while it is still
 * marked 'downloading' — this is the fix for "ghost downloads": previously
 * every update appended a NEW entry, so the original one stayed stuck on
 * 'downloading' forever. Failures/completions now overwrite the same entry.
 */
// v1.0.25 — throttle the change ping (250 ms) so a batch of files does not
// spam the renderer; the Downloads page refreshes on this event instead of
// polling the full list every 2 s.
let lastDownloadsNotify = 0
function notifyDownloadsChanged(): void {
  const now = Date.now()
  if (now - lastDownloadsNotify < 250) return
  lastDownloadsNotify = now
  try {
    eventBus.emit('downloads:changed', { at: new Date().toISOString() })
  } catch {
    /* notification is best-effort */
  }
}

export function recordDownload(entry: Omit<DownloadEntry, 'id' | 'at' | 'updatedAt'> & { id?: string }): string {
  // v1.0.50 — the downloader now passes its own stable entry id with
  // terminal updates (done/failed), so a completion can NEVER land on a
  // different, newer entry with the same label+kind while the one the user
  // is watching stays 'downloading' at 100% forever (the stuck-spinner
  // regression). The old label+kind matching remains as a fallback for
  // callers that don't track an id.
  const now = new Date().toISOString()
  let existing = entry.id ? downloadHistory.find((d) => d.id === entry.id) : undefined
  if (!existing) {
    const isTerminal = entry.status === 'done' || entry.status === 'failed'
    existing = isTerminal
      ? downloadHistory.find((d) => d.label === entry.label && d.kind === entry.kind)
      : downloadHistory.find((d) => d.status === 'downloading' && d.label === entry.label && d.kind === entry.kind)
  }
  // v1.0.52 — terminal states are STICKY: a late progress emit (status
  // 'downloading') must never resurrect a finished entry as a ghost stuck
  // at 100% in the active list while the real one sits in History.
  if (existing && (existing.status === 'done' || existing.status === 'failed') && entry.status === 'downloading') {
    return existing.id
  }
  // No live match and no id: guard against a non-terminal emit that races in
  // AFTER the terminal update already landed (a 'downloading' twin at 100%
  // that would never leave the active area). Only near-terminal progress
  // (>=99%) is treated as a late emit — a fresh re-download from a caller
  // that doesn't track ids (modpacks.ts) still records normally.
  if (!existing && entry.status === 'downloading' && entry.percent >= 99) {
    const recentlyDone = downloadHistory.find(
      (d) => d.label === entry.label && d.kind === entry.kind && (d.status === 'done' || d.status === 'failed')
    )
    if (recentlyDone && Date.now() - new Date(recentlyDone.updatedAt || recentlyDone.at).getTime() < 30_000) {
      return recentlyDone.id
    }
  }
  if (existing) {
    existing.status = entry.status
    existing.percent = entry.percent
    existing.downloadedBytes = entry.downloadedBytes
    existing.totalBytes = entry.totalBytes
    if (entry.iconUrl !== undefined) existing.iconUrl = entry.iconUrl
    existing.updatedAt = now
    notifyDownloadsChanged()
    return existing.id
  }
  const id = String(++downloadSeq)
  downloadHistory.unshift({ ...entry, id, at: now, updatedAt: now })
  if (downloadHistory.length > 40) downloadHistory.length = 40
  notifyDownloadsChanged()
  return id
}

/**
 * Entries still marked 'downloading' that were last touched a while ago are
 * the product of a crashed/killed session — they never completed. Flip them
 * to a terminal 'failed' state so the UI can never show a frozen spinner at
 * 100% forever (same state-sync rigor as the rest of the app).
 */
const STALE_DOWNLOAD_MS = 60 * 60 * 1000 // 60 minutes

export function listDownloads(): DownloadEntry[] {
  const cutoff = Date.now() - STALE_DOWNLOAD_MS
  for (const d of downloadHistory) {
    if (d.status === 'downloading') {
      const last = d.updatedAt ? new Date(d.updatedAt).getTime() : new Date(d.at).getTime()
      if (last < cutoff) {
        d.status = 'failed'
        d.percent = 0
      }
    }
  }
  return [...downloadHistory]
}

/**
 * Cancel one active download from the Downloads section. The underlying
 * network fetch is aborted (partial files cleaned by the downloader), the
 * entry flips to failed, and the operation is logged.
 */
export async function cancelDownload(id: string): Promise<boolean> {
  const { abortBatch } = await import('../minecraft/downloader')
  const entry = downloadHistory.find((d) => d.id === id)
  const aborted = abortBatch(id)
  if (entry) {
    if (entry.status === 'downloading') {
      entry.status = 'failed'
      entry.percent = 0
    }
    const { logger } = await import('../logs/logger')
    logger.info(`Download cancelled: ${entry.label} (${entry.kind}, stage ${Math.round(entry.percent)}%)`)
  }
  return aborted || Boolean(entry)
}

/**
 * Cancel every active download before a profile is deleted, so we never try
 * to remove files while they are being written to. Entries flip to a
 * terminal `failed` state — no ghost "downloading" entries survive.
 */
export function cancelActiveDownloads(): void {
  // Actually abort the in-flight fetches so nothing keeps writing to disk.
  void import('../minecraft/downloader').then((m) => m.abortAllDownloads()).catch(() => {})
  for (const d of downloadHistory) {
    if (d.status === 'downloading') {
      d.status = 'failed'
      d.percent = 0
    }
  }
}

export { fmtSize }
