/**
 * Keyless CurseForge file resolver (v1.0.21).
 *
 * CurseForge's public v3 API requires an API key, but the website's own
 * internal endpoints (`www.curseforge.com/api/v1/...`) work without one and
 * expose exactly what a modpack import needs:
 *
 *   GET /mods/{projectId}/files/{fileId}            → file name / size / title
 *   GET /mods/{projectId}/files/{fileId}/download   → 307 redirect to the CDN
 *
 * This module powers IMPORTING CurseForge modpack .zips. It does NOT revive
 * CurseForge browsing — the launcher remains Modrinth-only for discovery.
 */
import path from 'node:path'
import fsp from 'node:fs/promises'
import { paths } from '../paths'
import { exists, remove, mkdirp } from '../utils/fs'
import { profileManager } from '../profiles/profile-manager'
import { eventBus } from '../core/event-bus'
import { logger } from '../logs/logger'
import { LauncherError } from '../core/errors'
import { iso } from '../utils/format'
import type { ProfileMod } from '@shared/types'

export const CF_API = 'https://www.curseforge.com/api/v1'
const CF_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ReimaginedLauncher/1.0.0'

export interface CfFileInfo {
  fileName: string
  displayName: string
  size: number
}

/** Resolve a pinned CurseForge file (projectId + fileId) — no API key needed. */
export async function cfFileInfo(projectId: string, fileId: string): Promise<CfFileInfo | null> {
  try {
    const res = await fetch(`${CF_API}/mods/${projectId}/files/${fileId}`, {
      headers: { 'User-Agent': CF_UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000)
    })
    if (!res.ok) return null
    const body = (await res.json().catch(() => null)) as
      | { data?: { fileName?: string; displayName?: string; fileLength?: number } | null }
      | null
    const d = body?.data
    if (!d?.fileName) return null
    return {
      fileName: d.fileName,
      displayName: d.displayName || d.fileName,
      size: d.fileLength ?? 0
    }
  } catch {
    return null
  }
}

/** Download a CurseForge file (follows the CDN redirect) and verify its size. */
async function downloadFile(projectId: string, fileId: string, dest: string, expectedSize: number): Promise<void> {
  const res = await fetch(`${CF_API}/mods/${projectId}/files/${fileId}/download`, {
    headers: { 'User-Agent': CF_UA, Accept: '*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(300_000)
  })
  if (!res.ok || !res.body) {
    throw new LauncherError('CF_DOWNLOAD_FAILED', `CurseForge download failed (HTTP ${res.status}).`, 'Try the import again in a moment.')
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (expectedSize > 0 && buf.length !== expectedSize) {
    throw new LauncherError('CF_DOWNLOAD_FAILED', 'CurseForge download was incomplete.', 'Try the import again — the file will be re-fetched.')
  }
  await fsp.writeFile(dest, buf)
}

/** Map a project type to its instance folder name. */
function folderFor(projectType: string): string {
  switch (projectType) {
    case 'resourcepack': return 'resourcepacks'
    case 'shader': return 'shaderpacks'
    case 'datapack': return 'datapacks'
    default: return 'mods'
  }
}

/**
 * Install a pinned CurseForge file into a profile and register it, mirroring
 * the launcher's normal install bookkeeping (source 'curseforge'). Used by the
 * CurseForge .zip import — never by browsing.
 */
export async function installCurseforgeFile(
  profileId: string,
  projectId: string,
  fileId: string,
  projectType: 'mod' | 'resourcepack' | 'shader' | 'datapack' = 'mod'
): Promise<ProfileMod> {
  const profile = await profileManager.get(profileId)
  if (!profile) throw new LauncherError('PROFILE_MISSING', 'Profile not found.')
  if (profile.mods.some((m) => m.id === projectId && m.source === 'curseforge')) {
    throw new LauncherError('MOD_INSTALLED', 'This is already installed in the profile.')
  }

  const info = await cfFileInfo(projectId, fileId)
  if (!info) {
    throw new LauncherError('MOD_VERSION_MISSING', `CurseForge file ${fileId} is no longer available.`, 'The project may have been removed or the file ID changed.')
  }

  const safeName = info.fileName.replace(/[\/:*?"<>|]/g, '_')
  const destDir = path.join(paths.games, profile.gameDir, folderFor(projectType))
  mkdirp(destDir)
  const dest = path.join(destDir, safeName)
  if (exists(dest)) await remove(dest)

  logger.info(`Importing CurseForge ${projectId} @ ${fileId} → ${safeName} (${projectType})`)
  await downloadFile(projectId, fileId, dest, info.size)

  const mod: ProfileMod = {
    id: projectId,
    slug: projectId,
    title: info.displayName,
    filename: safeName,
    versionId: fileId,
    versionNumber: info.displayName,
    downloads: 0,
    source: 'curseforge',
    projectType,
    installedAt: iso(),
    updateAvailable: null
  }
  await profileManager.update(profileId, { mods: [...profile.mods, mod] })
  eventBus.emit('mods:changed', { profileId, action: 'installed', mod })
  return mod
}
