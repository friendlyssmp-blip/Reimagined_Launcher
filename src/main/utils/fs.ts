/**
 * Filesystem helpers used across the launcher.
 * JSON writes are atomic (tmp file + rename) so a crash mid-write never
 * corrupts settings, accounts or profiles.
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

export function exists(p: string): boolean {
  return fs.existsSync(p)
}

export function mkdirp(p: string): void {
  fs.mkdirSync(p, { recursive: true })
}

export async function readJson<T>(p: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fsp.readFile(p, 'utf-8')) as T
  } catch {
    return fallback
  }
}

export async function writeJson(p: string, data: unknown): Promise<void> {
  mkdirp(path.dirname(p))
  const tmp = `${p}.tmp`
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8')
  await fsp.rename(tmp, p)
}

export async function remove(p: string): Promise<void> {
  await fsp.rm(p, { recursive: true, force: true })
}

/**
 * Remove a directory tree reporting real progress.
 *
 * Files are deleted one-by-one so callers can show a determinate progress
 * bar tied to actual disk operations; leftover empty directories are then
 * removed with a single recursive call.
 */
export async function removeWithProgress(
  p: string,
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  if (!exists(p)) return

  const files: string[] = []
  const walk = async (dir: string): Promise<void> => {
    const entries = await listDir(dir)
    for (const e of entries) {
      const full = path.join(dir, e)
      const st = await fsp.lstat(full).catch(() => null)
      if (!st) continue
      if (st.isDirectory()) await walk(full)
      else files.push(full)
    }
  }
  await walk(p)

  const total = files.length
  let done = 0
  for (const file of files) {
    await fsp.rm(file, { force: true }).catch(() => {})
    done += 1
    if (onProgress && (done % 25 === 0 || done === total)) onProgress(done, total)
  }
  // Remove whatever directory skeleton is left.
  await fsp.rm(p, { recursive: true, force: true }).catch(() => {})
  if (onProgress) onProgress(total, total)
}

/** Total number of entries (files + folders) inside a directory tree. */
export async function countEntries(p: string): Promise<number> {
  if (!exists(p)) return 0
  let count = 0
  const walk = async (dir: string): Promise<void> => {
    const entries = await listDir(dir)
    for (const e of entries) {
      count += 1
      const full = path.join(dir, e)
      const st = await fsp.lstat(full).catch(() => null)
      if (st?.isDirectory()) await walk(full)
    }
  }
  await walk(p)
  return count
}

export async function copy(src: string, dest: string): Promise<void> {
  mkdirp(path.dirname(dest))
  await fsp.copyFile(src, dest)
}

export async function rename(src: string, dest: string): Promise<void> {
  await fsp.rename(src, dest)
}

/** Recursively copy a directory tree. */
export async function copyDir(src: string, dest: string): Promise<void> {
  mkdirp(dest)
  const entries = await fsp.readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) await copyDir(from, to)
    else await fsp.copyFile(from, to)
  }
}

/**
 * Recursively copy a directory tree, skipping top-level folders listed in
 * `exclude` (e.g. `saves` when duplicating a profile without its worlds),
 * reporting real progress as files are copied.
 */
export async function copyDirExcluding(
  src: string,
  dest: string,
  exclude: string[] = [],
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  if (!exists(src)) return
  const skip = new Set(exclude)

  // Count total files first so progress can be determinate.
  let total = 0
  const countWalk = async (dir: string, topLevel: boolean): Promise<void> => {
    const entries = await listDir(dir)
    for (const e of entries) {
      if (topLevel && skip.has(e)) continue
      const full = path.join(dir, e)
      const st = await fsp.lstat(full).catch(() => null)
      if (!st) continue
      if (st.isDirectory()) await countWalk(full, false)
      else total += 1
    }
  }
  await countWalk(src, true)

  let done = 0
  const copyWalk = async (from: string, to: string, topLevel: boolean): Promise<void> => {
    mkdirp(to)
    const entries = await fsp.readdir(from, { withFileTypes: true })
    for (const entry of entries) {
      if (topLevel && skip.has(entry.name)) continue
      const f = path.join(from, entry.name)
      const t = path.join(to, entry.name)
      if (entry.isDirectory()) {
        await copyWalk(f, t, false)
      } else {
        await fsp.copyFile(f, t)
        done += 1
        if (onProgress && (done % 25 === 0 || done === total)) onProgress(done, total)
      }
    }
  }
  await copyWalk(src, dest, true)
  if (onProgress) onProgress(total, total)
}

export async function listDir(p: string): Promise<string[]> {
  try {
    return await fsp.readdir(p)
  } catch {
    return []
  }
}

export async function sizeOf(p: string): Promise<number> {
  try {
    const st = await fsp.stat(p)
    return st.size
  } catch {
    return 0
  }
}

/** Directory size in bytes (recursive). */
export async function dirSize(p: string): Promise<number> {
  let total = 0
  const walk = async (dir: string) => {
    const entries = await listDir(dir)
    for (const e of entries) {
      const full = path.join(dir, e)
      const st = await fsp.stat(full).catch(() => null)
      if (!st) continue
      if (st.isDirectory()) await walk(full)
      else total += st.size
    }
  }
  await walk(p).catch(() => {})
  return total
}
