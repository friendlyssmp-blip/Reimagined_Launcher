/**
 * Local background music store (v1.0.85).
 *
 * The user drops their own audio files (mp3/flac/ogg/wav…) into the launcher
 * and they are copied into `data/music/` — the renderer plays them through
 * the privileged `reimagined-music://` protocol, which only ever serves
 * files from that exact folder (no path traversal, no arbitrary file reads).
 */
import path from 'node:path'
import fsp from 'node:fs/promises'
import { dialog, shell } from 'electron'
import { paths } from '../paths'
import { exists, mkdirp } from '../utils/fs'
import { logger } from '../logs/logger'

export interface MusicTrack {
  id: string
  name: string
  size: number
  addedAt: string
}

const AUDIO_EXT = new Set(['.mp3', '.flac', '.ogg', '.wav', '.m4a', '.aac', '.opus'])

function musicDir(): string {
  return path.join(paths.data, 'music')
}

/** The protocol URL the renderer uses to stream this track. */
export function trackUrl(track: MusicTrack): string {
  return 'reimagined-music://music/' + encodeURIComponent(track.id)
}

async function readTracks(): Promise<MusicTrack[]> {
  mkdirp(musicDir())
  const files = await fsp.readdir(musicDir()).catch(() => [])
  const out: MusicTrack[] = []
  for (const f of files) {
    if (!AUDIO_EXT.has(path.extname(f).toLowerCase())) continue
    const p = path.join(musicDir(), f)
    const st = await fsp.stat(p).catch(() => null)
    if (!st || !st.isFile()) continue
    out.push({ id: f, name: path.basename(f, path.extname(f)), size: st.size, addedAt: st.mtime.toISOString() })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

export async function listTracks(): Promise<MusicTrack[]> {
  return readTracks()
}

/** Copy audio files into the library (shared by the picker + drag-and-drop). */
async function importPaths(srcs: string[]): Promise<{ added: number; skipped: number }> {
  mkdirp(musicDir())
  let added = 0
  let skipped = 0
  for (const src of srcs) {
    if (!AUDIO_EXT.has(path.extname(src).toLowerCase())) {
      skipped++
      continue
    }
    const base = path.basename(src)
    let dest = path.join(musicDir(), base)
    if (exists(dest)) {
      const ext = path.extname(base)
      dest = path.join(musicDir(), `${path.basename(base, ext)}-${Date.now()}${ext}`)
    }
    const ok = await fsp.copyFile(src, dest).then(() => true).catch(() => false)
    if (ok) added++
    else skipped++
  }
  logger.info(`Music: imported ${added} file(s) into the library (${skipped} skipped)`)
  return { added, skipped }
}

/** Pick audio files from anywhere on disk and import them into the library. */
export async function addTracks(): Promise<MusicTrack[]> {
  const res = await dialog.showOpenDialog({
    title: 'Add background music',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio files', extensions: ['mp3', 'flac', 'ogg', 'wav', 'm4a', 'aac', 'opus'] }]
  })
  if (res.canceled || res.filePaths.length === 0) return readTracks()
  await importPaths(res.filePaths)
  return readTracks()
}

/** v1.0.99 — import files dragged onto the launcher (paths come from the
 * renderer's drop event). Returns the refreshed library. */
export async function importFiles(paths: string[]): Promise<MusicTrack[]> {
  await importPaths((paths ?? []).filter((p) => typeof p === 'string' && p.length > 0))
  return readTracks()
}

/** v1.0.99 — open the music folder in Explorer so the user can see exactly
 * where their files live (and drop more in if they want). */
export async function openMusicFolder(): Promise<void> {
  mkdirp(musicDir())
  await shell.openPath(musicDir())
}

/** Remove a track from the library (deletes its copied file). */
export async function removeTrack(id: string): Promise<MusicTrack[]> {
  const safe = path.basename(String(id ?? ''))
  if (safe && safe !== '.' && safe !== '..') {
    await fsp.rm(path.join(musicDir(), safe), { force: true }).catch(() => {})
    logger.info(`Music: removed "${safe}"`)
  }
  return readTracks()
}

export const musicStore = { listTracks, addTracks, importFiles, openMusicFolder, removeTrack, trackUrl }
