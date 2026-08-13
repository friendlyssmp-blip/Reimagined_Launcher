/**
 * v1.0.92 — Safe instance reorganization migration.
 *
 * Reimagined used to store every instance at data/games/<slug>-<id8>/.
 * This migration moves each instance to data/Instances/<Human Name>/ while
 * keeping the internal `gameDir` id untouched and NEVER deleting data.
 *
 * If ANY step fails, the original data is left untouched and the profile is
 * reported as failed — it keeps resolving to its legacy location through
 * the central `instancePath()` resolver, so nothing breaks.
 */
import path from 'node:path'
import fs from 'node:fs'
import { paths } from '../paths'
import { logger } from '../logs/logger'
import { sanitizeInstanceName, instancePathFromFolder, instancesRoot } from './paths'
import { exists, writeJson, countEntries, rename, copyDir, remove, mkdirp } from '../utils/fs'
import type { Profile } from '@shared/types'

export interface MigrationItem {
  profileId: string
  name: string
  oldDir: string
  newDir: string
  status: 'moved' | 'already' | 'failed'
  files?: number
  error?: string
}

export interface MigrationResult {
  ranAt: string
  total: number
  moved: MigrationItem[]
  failed: MigrationItem[]
  migratedSomething: boolean
}

const MANIFEST = 'migration-manifest.json'

function manifestFile(): string {
  return path.join(instancesRoot(), MANIFEST)
}

function readManifest(): MigrationResult | null {
  try {
    if (!fs.existsSync(manifestFile())) return null
    return JSON.parse(fs.readFileSync(manifestFile(), 'utf-8')) as MigrationResult
  } catch {
    return null
  }
}

/** All folder names already claimed (existing dirs + already-migrated profiles). */
async function claimedFolders(profiles: Profile[]): Promise<Set<string>> {
  const claimed = new Set<string>()
  for (const p of profiles) {
    if (p.folder) claimed.add(p.folder.toLowerCase())
  }
  try {
    const { listDir } = await import('../utils/fs')
    const dirs = await listDir(instancesRoot()).catch(() => [] as string[])
    for (const d of dirs) claimed.add(d.toLowerCase())
  } catch {
    /* best effort */
  }
  return claimed
}

/** Compute a unique folder name for a profile (collision-safe). */
export async function uniqueFolderName(name: string, profiles: Profile[], excludeId?: string): Promise<string> {
  const claimed = await claimedFolders(profiles.filter((p) => p.id !== excludeId))
  const base = sanitizeInstanceName(name)
  let candidate = base
  let n = 2
  while (claimed.has(candidate.toLowerCase())) {
    candidate = `${base} (${n})`
    n++
  }
  claimed.add(candidate.toLowerCase())
  return candidate
}

/** Verify a directory copy by comparing entry counts (best-effort). */
async function verifyCopy(src: string, dst: string): Promise<boolean> {
  try {
    const [a, b] = await Promise.all([countEntries(src), countEntries(dst)])
    return b >= a
  } catch {
    return false
  }
}

/**
 * Run the migration. Safe to call on every startup — it is a no-op once
 * every profile has a `folder` and nothing is left in the legacy location.
 */
export async function migrateInstances(): Promise<MigrationResult> {
  const started = new Date().toISOString()
  const { profileManager } = await import('../profiles/profile-manager')
  const profiles = await profileManager.list()
  const pending = profiles.filter((p) => !p.folder)
  const items: MigrationItem[] = []
  const failed: MigrationItem[] = []
  const claimed = await claimedFolders(profiles)

  for (const profile of pending) {
    const base = sanitizeInstanceName(profile.name)
    let folder = base
    let n = 2
    while (claimed.has(folder.toLowerCase())) {
      folder = `${base} (${n})`
      n++
    }
    claimed.add(folder.toLowerCase())

    const oldDir = path.join(paths.games, profile.gameDir)
    const newDir = instancePathFromFolder(folder)

    // Nothing to move — the legacy folder never existed. Just record the folder.
    if (!exists(oldDir)) {
      items.push({ profileId: profile.id, name: profile.name, oldDir, newDir, status: 'already' })
      await profileManager.update(profile.id, { folder }).catch(() => {})
      continue
    }

    // Destination already exists (partial previous run / user created it).
    if (exists(newDir)) {
      const ok = await verifyCopy(oldDir, newDir)
      if (ok) {
        items.push({ profileId: profile.id, name: profile.name, oldDir, newDir, status: 'already' })
        await profileManager.update(profile.id, { folder }).catch(() => {})
        try {
          const { removeWithProgress } = await import('../utils/fs')
          await removeWithProgress(oldDir, () => {})
        } catch (err) {
          logger.warn(`[migrate] could not remove legacy copy for "${profile.name}": ${(err as Error).message}`)
        }
        continue
      }
      failed.push({
        profileId: profile.id,
        name: profile.name,
        oldDir,
        newDir,
        status: 'failed',
        error: 'Destination already exists with different content — data kept in both locations.'
      })
      logger.warn(`[migrate] collision for "${profile.name}": both ${oldDir} and ${newDir} have content — nothing moved.`)
      continue
    }

    try {
      mkdirp(path.dirname(newDir))
      try {
        await rename(oldDir, newDir)
      } catch {
        // Cross-volume fallback: copy, verify, then remove source.
        await copyDir(oldDir, newDir)
        if (!(await verifyCopy(oldDir, newDir))) throw new Error('copy verification failed')
        await remove(oldDir)
      }
      items.push({ profileId: profile.id, name: profile.name, oldDir, newDir, status: 'moved', files: await countEntries(newDir).catch(() => 0) })
      await profileManager.update(profile.id, { folder }).catch((err) => logger.warn(`[migrate] folder persisted but profile update failed: ${(err as Error).message}`))
      logger.info(`[migrate] "${profile.name}" → Instances/${folder} (${profile.gameDir})`)
    } catch (err) {
      failed.push({
        profileId: profile.id,
        name: profile.name,
        oldDir,
        newDir,
        status: 'failed',
        error: (err as Error).message
      })
      logger.warn(`[migrate] could not move "${profile.name}": ${(err as Error).message} — original data preserved at ${oldDir}`)
    }
  }

  const result: MigrationResult = {
    ranAt: started,
    total: profiles.length,
    moved: items.filter((i) => i.status === 'moved'),
    failed,
    migratedSomething: items.some((i) => i.status === 'moved')
  }
  try {
    await writeJson(manifestFile(), result)
  } catch {
    /* manifest is best-effort */
  }
  return result
}

export const instanceMigration = { migrate: migrateInstances, manifest: readManifest }
