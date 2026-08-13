/**
 * Instance-configuration safety guard (v1.0.19).
 *
 * Minecraft settings belong to the user's instance and must NEVER reset as a
 * side effect of launcher operations. Before an operation that may touch an
 * instance's configuration we take a lightweight snapshot of the SMALL
 * user-owned files only:
 *
 *   • options.txt          (video/audio/controls/keybinds/resource-pack list…)
 *   • servers.dat          (multiplayer server list)
 *   • config/ top-level files (mod configuration, small ones only)
 *
 * Worlds, saves, resourcepacks, shaderpacks and screenshots are NEVER backed
 * up here — they are user content, not configuration, and are never touched
 * by the operations that use this guard.
 *
 * Backups live in `data/backups/<gameDir>/<stamp>/` and are pruned to the
 * newest 5 per profile. Restore only copies back the files that exist in the
 * backup — never unrelated files, so a failed operation rolls back exactly
 * what it may have affected.
 */
import path from 'node:path'
import { instancePath, resolveInstanceDir } from '../instances/paths'
import fsp from 'node:fs/promises'
import { paths } from '../paths'
import { logger } from '../logs/logger'
import { mkdirp, listDir, exists, remove } from '../utils/fs'
import type { Profile } from '@shared/types'

const MAX_KEEP = 5
/** Per-file cap for config/ files (large mod configs are never backed up). */
const MAX_FILE_BYTES = 2 * 1024 * 1024
/** Total budget for a config/ snapshot. */
const MAX_TOTAL_BYTES = 12 * 1024 * 1024
/** options.txt is re-backed-up at most once per day (per-instance, cheap). */
const OPTIONS_BACKUP_TTL_MS = 24 * 60 * 60 * 1000

function backupsRoot(gameDir: string): string {
  return path.join(paths.data, 'backups', gameDir)
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/** The profile's instance directory (same layout as launcher/profile-manager). */
function instanceDir(profile: Profile): string {
  return instancePath(profile)
}

/**
 * Take a lightweight config snapshot. Returns the backup directory (or null
 * when the instance has nothing worth backing up). Never throws — a failed
 * backup must never block the operation it guards.
 */
export async function backupInstanceConfig(profile: Profile): Promise<string | null> {
  try {
    const inst = instanceDir(profile)
    if (!exists(inst)) return null
    const dir = path.join(backupsRoot(profile.gameDir), stamp())
    mkdirp(dir)

    let copied = 0
    const copyIf = async (rel: string, maxBytes: number): Promise<void> => {
      const src = path.join(inst, rel)
      if (!exists(src)) return
      const st = await fsp.stat(src).catch(() => null)
      if (!st || !st.isFile() || st.size > maxBytes) return
      const dest = path.join(dir, rel)
      mkdirp(path.dirname(dest))
      await fsp.copyFile(src, dest)
      copied++
    }

    await copyIf('options.txt', MAX_FILE_BYTES)
    await copyIf('servers.dat', MAX_FILE_BYTES)

    // Top-level config/ files only — subfolders (per-mod trees) are skipped:
    // they can be huge and are the mod's own data. Never follow symlinks.
    const cfgDir = path.join(inst, 'config')
    if (exists(cfgDir)) {
      let total = 0
      for (const name of await listDir(cfgDir)) {
        const full = path.join(cfgDir, name)
        const st = await fsp.stat(full).catch(() => null)
        if (!st || !st.isFile() || st.size > MAX_FILE_BYTES) continue
        if (total + st.size > MAX_TOTAL_BYTES) break
        total += st.size
        mkdirp(path.join(dir, 'config'))
        await fsp.copyFile(full, path.join(dir, 'config', name))
        copied++
      }
    }

    if (copied === 0) {
      await remove(dir).catch(() => {})
      return null
    }
    await pruneOld(profile.gameDir)
    logger.info(`Config guard: backed up ${copied} config file(s) for "${profile.name}" → ${dir}`)
    return dir
  } catch (err) {
    logger.warn(`Config guard: backup failed for "${profile.name}": ${(err as Error).message}`)
    return null
  }
}

/**
 * Restore a config snapshot into the instance — ONLY the files present in the
 * backup are copied back. Never throws; reports the number of files restored.
 */
export async function restoreInstanceConfig(profile: Profile, backupId?: string): Promise<number> {
  try {
    const root = backupsRoot(profile.gameDir)
    if (!exists(root)) return 0
    const dirs = (await listDir(root)).sort()
    if (dirs.length === 0) return 0
    const target = backupId ? path.join(root, backupId) : path.join(root, dirs[dirs.length - 1])
    if (!exists(target)) return 0
    const inst = instanceDir(profile)
    let restored = 0
    const walk = async (srcDir: string, rel: string): Promise<void> => {
      for (const name of await listDir(srcDir)) {
        const src = path.join(srcDir, name)
        const st = await fsp.stat(src).catch(() => null)
        if (!st) continue
        const childRel = rel ? path.join(rel, name) : name
        if (st.isDirectory()) {
          await walk(src, childRel)
        } else {
          const dest = path.join(inst, childRel)
          mkdirp(path.dirname(dest))
          await fsp.copyFile(src, dest)
          restored++
        }
      }
    }
    await walk(target, '')
    if (restored > 0) {
      logger.info(`Config guard: restored ${restored} config file(s) for "${profile.name}" from ${target}`)
    }
    return restored
  } catch (err) {
    logger.warn(`Config guard: restore failed for "${profile.name}": ${(err as Error).message}`)
    return 0
  }
}

/**
 * Back up ONLY options.txt when the newest backup for this instance is older
 * than 24 h — used by the per-launch options.txt writers (frame cap, shader
 * render-distance cap) so every launch is safe without piling up snapshots.
 * Accepts either the full instance path or the gameDir folder name.
 */
export async function backupOptionsTxt(gameDirPath: string, profileName = '?'): Promise<void> {
  try {
    const inst =
      gameDirPath.includes('/') || gameDirPath.includes('\\')
        ? gameDirPath
        : resolveInstanceDir(gameDirPath)
    const gameDir = path.basename(inst)
    const src = path.join(inst, 'options.txt')
    if (!exists(src)) return
    const root = backupsRoot(gameDir)
    const dirs = exists(root) ? (await listDir(root)).sort() : []
    if (dirs.length > 0) {
      const newest = path.join(root, dirs[dirs.length - 1])
      const latestOpt = path.join(newest, 'options.txt')
      if (exists(latestOpt)) {
        const st = await fsp.stat(latestOpt).catch(() => null)
        if (st && Date.now() - st.mtimeMs < OPTIONS_BACKUP_TTL_MS) return
      }
    }
    await backupInstanceConfig({ gameDir, name: profileName } as Profile)
  } catch {
    /* best-effort — never breaks the launch */
  }
}

/** Keep only the newest MAX_KEEP snapshots per profile. */
async function pruneOld(gameDir: string): Promise<void> {
  try {
    const root = backupsRoot(gameDir)
    const dirs = (await listDir(root)).sort()
    for (const d of dirs.slice(0, Math.max(0, dirs.length - MAX_KEEP))) {
      await remove(path.join(root, d)).catch(() => {})
    }
  } catch {
    /* best-effort */
  }
}

/** All backup snapshot ids for an instance (for UI/debugging). */
export async function listBackups(gameDir: string): Promise<string[]> {
  const root = backupsRoot(gameDir)
  if (!exists(root)) return []
  return (await listDir(root)).sort()
}

export const configGuard = { backupInstanceConfig, restoreInstanceConfig, backupOptionsTxt, listBackups }
