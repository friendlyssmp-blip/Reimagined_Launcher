/**
 * Central instance path resolver (v1.0.92).
 *
 * Every part of the launcher resolves an instance's physical location
 * through THIS module — never by constructing `paths.games/<gameDir>`
 * ad-hoc. This is what makes the v1.0.92 reorganization safe:
 *
 *   - New/renamed instances live under  data/Instances/<Human Name>/
 *   - `gameDir` (the unique slug, e.g. "my-survival-8f7d2a9c") stays as the
 *     internal identifier in profile metadata — it never changes.
 *   - Legacy instances (created before the reorganization) keep working
 *     from data/games/<gameDir> until the migration moves them, so no
 *     connection is ever broken.
 */
import path from 'node:path'
import { paths } from '../paths'

/** Characters Windows forbids in a folder name (and trailing dots/spaces). */
const FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f]/g

/**
 * Sanitize a profile name into a safe, human-readable folder name.
 * Only strips what Windows genuinely forbids — spaces, hyphens,
 * capitalization and Unicode are preserved.
 */
export function sanitizeInstanceName(name: string): string {
  const cleaned = (name ?? '')
    .replace(FORBIDDEN, '')
    .replace(/[. ]+$/g, '')
    .trim()
  return cleaned || 'Instance'
}

/** Canonical location of an instance's game directory. */
export function instancePath(profile: { folder?: string; gameDir: string }): string {
  // Post-migration instances live in Instances/<folder>. Profiles that
  // haven't been migrated yet (or whose migration failed) keep resolving
  // to their legacy data/games/<gameDir> location — data is never lost.
  if (profile.folder) return path.join(paths.instances, profile.folder)
  return path.join(paths.games, profile.gameDir)
}

/** Path for an instance folder name that is already known/migrated. */
export function instancePathFromFolder(folder: string): string {
  return path.join(paths.instances, folder)
}

/** Instance root used when only a gameDir-style key is available. */
export function instancePathFromGameDir(gameDir: string): string {
  return path.join(paths.games, gameDir)
}

/**
 * Resolve a path that may be either a full instance path OR a gameDir
 * folder name (legacy config-guard call sites). Full paths pass through
 * untouched so callers that already hold an absolute location keep working.
 */
export function resolveInstanceDir(gameDirOrPath: string): string {
  if (gameDirOrPath.includes('/') || gameDirOrPath.includes('\\')) return gameDirOrPath
  return instancePathFromGameDir(gameDirOrPath)
}

/** Root folder under which all instance game directories live now. */
export function instancesRoot(): string {
  return paths.instances
}
