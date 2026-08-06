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
 * Record (or update) a download entry.
 *
 * The same task is updated in place by matching label+kind while it is still
 * marked 'downloading' — this is the fix for "ghost downloads": previously
 * every update appended a NEW entry, so the original one stayed stuck on
 * 'downloading' forever. Failures/completions now overwrite the same entry.
 */
export function recordDownload(entry: Omit<DownloadEntry, 'id' | 'at'>): void {
  const existing = downloadHistory.find(
    (d) => d.status === 'downloading' && d.label === entry.label && d.kind === entry.kind
  )
  if (existing) {
    existing.status = entry.status
    existing.percent = entry.percent
    existing.downloadedBytes = entry.downloadedBytes
    existing.totalBytes = entry.totalBytes
    return
  }
  downloadHistory.unshift({ ...entry, id: String(++downloadSeq), at: new Date().toISOString() })
  if (downloadHistory.length > 40) downloadHistory.length = 40
}

export function listDownloads(): DownloadEntry[] {
  return [...downloadHistory]
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
