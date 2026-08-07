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
import { listDir, dirSize, exists } from '../utils/fs'
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

export function recordDownload(entry: Omit<DownloadEntry, 'id' | 'at' | 'updatedAt'>): string {
  // v1.0.24 — a TERMINAL update (done/failed) must always land on the entry
  // the user is looking at. Progress/start updates still match only live
  // 'downloading' entries; a terminal update matches the MOST RECENT entry
  // with the same label+kind regardless of status, so a 100% bar can never
  // be left stuck on 'downloading' while a duplicate entry takes the 'done'.
  const isTerminal = entry.status === 'done' || entry.status === 'failed'
  const existing = isTerminal
    ? downloadHistory.find((d) => d.label === entry.label && d.kind === entry.kind)
    : downloadHistory.find((d) => d.status === 'downloading' && d.label === entry.label && d.kind === entry.kind)
  const now = new Date().toISOString()
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
