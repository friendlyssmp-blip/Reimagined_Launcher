/**
 * Instance screenshots (v1.0.88).
 *
 * Lists / exports / deletes the F2 screenshots inside ONE instance's own
 * screenshots folder (games/<gameDir>/screenshots). Rendered via the locked-
 * down reimagined-shot:// protocol (same pattern as the music library).
 */
import path from 'node:path'
import fsp from 'node:fs/promises'
import { dialog } from 'electron'
import { paths } from '../paths'
import { profileManager } from '../profiles/profile-manager'
import { logger } from '../logs/logger'

const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])

export interface ScreenshotEntry {
  id: string
  name: string
  size: number
  at: string
  url: string
}

export async function shotsDirFor(profileId: string): Promise<string | null> {
  const profile = await profileManager.get(profileId)
  if (!profile) return null
  return path.join(paths.games, profile.gameDir, 'screenshots')
}

export async function listScreenshots(profileId: string): Promise<ScreenshotEntry[]> {
  const dir = await shotsDirFor(profileId)
  if (!dir) return []
  const files = await fsp.readdir(dir).catch(() => [])
  const out: ScreenshotEntry[] = []
  for (const f of files) {
    if (!IMG_EXT.has(path.extname(f).toLowerCase())) continue
    const p = path.join(dir, f)
    const st = await fsp.stat(p).catch(() => null)
    if (!st || !st.isFile()) continue
    out.push({
      id: f,
      name: f,
      size: st.size,
      at: st.mtime.toISOString(),
      url: `reimagined-shot://shot/${encodeURIComponent(profileId)}/${encodeURIComponent(f)}`
    })
  }
  out.sort((a, b) => (a.at < b.at ? 1 : -1))
  return out
}

/** Export one or more screenshots to a folder the user picks. */
export async function exportScreenshots(profileId: string, ids: string[]): Promise<number> {
  const dir = await shotsDirFor(profileId)
  if (!dir || ids.length === 0) return 0
  const res = await dialog.showOpenDialog({
    title: 'Export screenshots to…',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Export here'
  })
  if (res.canceled || res.filePaths.length === 0) return 0
  const dest = res.filePaths[0]
  let copied = 0
  for (const id of ids) {
    const safe = path.basename(id)
    if (!safe || safe === '.' || safe === '..') continue
    await fsp.copyFile(path.join(dir, safe), path.join(dest, safe)).then(() => copied++).catch(() => {})
  }
  logger.info(`Screenshots: exported ${copied} file(s) to ${dest}`)
  return copied
}

export async function deleteScreenshot(profileId: string, id: string): Promise<void> {
  const dir = await shotsDirFor(profileId)
  if (!dir) return
  const safe = path.basename(id)
  if (!safe || safe === '.' || safe === '..') return
  await fsp.rm(path.join(dir, safe), { force: true }).catch(() => {})
  logger.info(`Screenshots: deleted ${safe}`)
}

export const screenshotsService = { listScreenshots, exportScreenshots, deleteScreenshot, shotsDirFor }
