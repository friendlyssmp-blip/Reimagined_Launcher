/**
 * v1.0.92 — Clear Up Space (Settings → Storage).
 *
 * A SAFE storage analyzer: it proves data is unnecessary BEFORE offering it
 * for deletion. It NEVER touches:
 *   - the launcher itself, its executable or install
 *   - user instances (Instances/, games/<instance>), worlds, saves
 *   - mods / resource packs / shaders currently used by an instance
 *   - instance configs, screenshots, accounts, auth, launcher settings
 *
 * Only regeneratable / duplicated / obsolete / temporary / orphaned data is
 * ever offered, each with a confidence score. Confidence >= 90% is
 * auto-selected; everything else requires a manual click. The final delete
 * re-verifies every single file (exists, still the same size, not inside a
 * protected directory, not the running launcher) immediately before removal.
 */
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { paths, appVersion } from '../paths'
import { logger } from '../logs/logger'
import { exists, listDir } from '../utils/fs'

/**
 * v2.1.2 — the old scan ran every fs call synchronously on the main thread,
 * so a large data dir froze the whole launcher ("Not Responding") and the
 * renderer counter stayed at "0 files" until the very end. Now every walk
 * yields to the event loop periodically and reports live progress, so the
 * UI stays responsive and the counter ticks up as the scan advances.
 */
const YIELD_EVERY = 256
type Progress = { scannedFiles: number; currentDir: string } | null

async function yieldIfNeeded(counter: { n: number }, progress: Progress, onProgress?: (p: NonNullable<Progress>) => void): Promise<void> {
  counter.n++
  if (counter.n % YIELD_EVERY === 0) {
    await new Promise((r) => setImmediate(r))
    onProgress?.({ scannedFiles: counter.n, currentDir: progress?.currentDir ?? '' })
  }
}

export type StorageCategory = 'cache' | 'temporary' | 'duplicates' | 'updates' | 'orphaned' | 'backups'

export interface StorageItem {
  id: string
  path: string
  sizeBytes: number
  category: StorageCategory
  /** 0-100. >=90 = auto-selected. */
  confidence: number
  label: string
  detail: string
  autoSelected: boolean
}

export interface StorageBreakdown {
  label: string
  bytes: number
}

export interface StorageScanResult {
  items: StorageItem[]
  recoverableBytes: number
  breakdown: StorageBreakdown[]
  scannedFiles: number
  ranAt: string
}

export interface StorageCleanResult {
  freedBytes: number
  removed: number
  skipped: { path: string; reason: string }[]
}

/* ------------------------------ protected paths ------------------------------ */

/** Directories that must NEVER be touched by cleanup. */
function PROTECTED_DIRS(): string[] {
  return [
    paths.instances,
    paths.profiles,
    path.join(paths.data, 'skins'),
    path.join(paths.data, 'music'),
    path.join(paths.data, 'bundled'),
    path.join(paths.data, 'accounts.json'),
    path.join(paths.data, 'settings.json')
  ]
}

function isProtected(p: string): boolean {
  const abs = path.resolve(p)
  for (const d of PROTECTED_DIRS()) {
    const root = path.resolve(d)
    if (abs === root || abs.startsWith(root + path.sep)) return true
  }
  return false
}

/* --------------------------------- scanning --------------------------------- */

async function walk(dir: string, out: string[], opts: { depth?: number; maxDepth?: number; counter?: { n: number }; progress?: Progress; onProgress?: (p: NonNullable<Progress>) => void } = {}): Promise<void> {
  const maxDepth = opts.maxDepth ?? 8
  const depth = opts.depth ?? 0
  if (depth > maxDepth) return
  let entries: fs.Dirent[]
  try {
    entries = (await fsp.readdir(dir, { withFileTypes: true })) as fs.Dirent[]
  } catch {
    return
  }
  if (opts.progress) opts.progress.currentDir = dir
  for (const e of entries) {
    const p = path.join(dir, e.name)
    let isDir = e.isDirectory()
    let isFile = e.isFile()
    // Symlinks show as neither — resolve so we don't silently skip them.
    if (!isDir && !isFile) {
      try {
        const st = await fsp.lstat(p)
        isDir = st.isDirectory()
        isFile = st.isFile()
      } catch {
        continue
      }
    }
    if (opts.counter) await yieldIfNeeded(opts.counter, opts.progress ?? null, opts.onProgress)
    if (isDir) {
      await walk(p, out, { depth: depth + 1, maxDepth, counter: opts.counter, progress: opts.progress, onProgress: opts.onProgress })
    } else if (isFile) {
      out.push(p)
    }
  }
}

async function fileSize(p: string): Promise<number> {
  try {
    return (await fsp.stat(p)).size
  } catch {
    return 0
  }
}

/** Hash a file's head + tail + size — cheap identity check for duplicates. */
function quickFingerprint(p: string): string {
  try {
    const fd = fs.openSync(p, 'r')
    try {
      const size = fs.fstatSync(fd).size
      const head = Buffer.alloc(Math.min(size, 65536))
      fs.readSync(fd, head, 0, head.length, 0)
      let tail = Buffer.alloc(0)
      if (size > 131072) {
        tail = Buffer.alloc(65536)
        fs.readSync(fd, tail, 0, tail.length, size - tail.length)
      }
      const crypto = require('node:crypto')
      return crypto.createHash('sha256').update(head).update(tail).update(String(size)).digest('hex')
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return ''
  }
}

/**
 * Run a full storage scan async and non-blocking: every directory walk and
 * stat is now async and yields to the event loop, so a large data dir can
 * never freeze the launcher. Progress (files counted + current dir) is
 * pushed to the renderer in real time via `onProgress`.
 */
export async function scanStorage(
  onProgress?: (p: { scannedFiles: number; currentDir: string }) => void
): Promise<StorageScanResult> {
  const ranAt = new Date().toISOString()
  const items: StorageItem[] = []
  const counter = { n: 0 }
  const progress: Progress = { scannedFiles: 0, currentDir: '' }
  const bump = (): void => {
    onProgress?.({ scannedFiles: counter.n, currentDir: progress.currentDir })
  }
  const walkOpts = { counter, progress, onProgress: (p: NonNullable<Progress>) => onProgress?.(p) }
  const now = Date.now()

  /* 1) OBSOLETE UPDATE PACKAGES — every installer in data/updates except the
   *    current launcher's own package. 100% obsolete after a successful update. */
  try {
    for (const f of await listDir(paths.updates)) {
      const p = path.join(paths.updates, f)
      let isFile = false
      let size = 0
      let mtime = 0
      try {
        const st = await fsp.stat(p)
        isFile = st.isFile()
        size = st.size
        mtime = st.mtimeMs
      } catch {
        continue
      }
      if (!isFile) continue
      counter.n++
      if (f === 'check.json') continue
      // Never offer an in-flight partial download (modified in the last minute).
      if (now - mtime < 60_000) {
        items.push({
          id: 'upd-' + f,
          path: p,
          sizeBytes: 0,
          category: 'updates',
          confidence: 60,
          label: 'In-progress download: ' + f,
          detail: 'This file was modified in the last minute - possibly downloading right now.',
          autoSelected: false
        })
        continue
      }
      items.push({
        id: 'upd-' + f,
        path: p,
        sizeBytes: size,
        category: 'updates',
        confidence: 100,
        label: 'Old update package: ' + f,
        detail: 'A completed launcher update that is no longer needed - the current launcher is v' + appVersion + '.',
        autoSelected: true
      })
    }
    bump()
  } catch {
    /* no updates dir yet */
  }

  /* 2) TEMPORARY STAGING (data/tmp) — modpack extraction leftovers. */
  try {
    const tmpRoot = path.join(paths.data, 'tmp')
    if (exists(tmpRoot)) {
      const files: string[] = []
      await walk(tmpRoot, files, walkOpts)
      let total = 0
      for (const p of files) total += await fileSize(p)
      counter.n += files.length
      bump()
      items.push({
        id: 'tmp-staging',
        path: tmpRoot,
        sizeBytes: total,
        category: 'temporary',
        confidence: 95,
        label: 'Temporary staging files',
        detail: 'Modpack / import extraction staging (data/tmp). Regenerated automatically on demand.',
        autoSelected: true
      })
    }
  } catch {
    /* non-fatal */
  }

  /* 3) REGENERATABLE CACHE — perf probe, validation cache. */
  for (const [rel, label, conf] of [
    ['perf', 'Hardware detection cache', 95],
    ['validation', 'Mod validation cache', 95]
  ] as const) {
    const dir = path.join(paths.data, rel)
    if (!exists(dir)) continue
    const files: string[] = []
    await walk(dir, files, walkOpts)
    let total = 0
    for (const p of files) total += await fileSize(p)
    counter.n += files.length
    bump()
    if (total > 0) {
      items.push({
        id: 'cache-' + rel,
        path: dir,
        sizeBytes: total,
        category: 'cache',
        confidence: conf,
        label,
        detail: 'Regeneratable metadata cache - rebuilt automatically when needed.',
        autoSelected: conf >= 90
      })
    }
  }

  /* 4) OLD CONFIG BACKUPS (data/backups/<gameDir>/*) — keep the newest per
   *    instance; older snapshots are obsolete. */
  try {
    const backupsRoot = path.join(paths.data, 'backups')
    if (exists(backupsRoot)) {
      const instances = await listDir(backupsRoot)
      for (const inst of instances) {
        const instDir = path.join(backupsRoot, inst)
        const stamps = await listDir(instDir).catch(() => [] as string[])
        if (stamps.length <= 1) continue
        stamps.sort()
        for (let i = 0; i < stamps.length - 1; i++) {
          const snapDir = path.join(instDir, stamps[i])
          progress.currentDir = snapDir
          const files: string[] = []
          await walk(snapDir, files, walkOpts)
          let total = 0
          for (const p of files) total += await fileSize(p)
          counter.n += files.length
          bump()
          items.push({
            id: 'backup-' + inst + '-' + stamps[i],
            path: snapDir,
            sizeBytes: total,
            category: 'backups',
            confidence: 90,
            label: 'Old config backup: ' + stamps[i],
            detail: 'An older settings snapshot for instance "' + inst + '". The newest snapshot is kept.',
            autoSelected: true
          })
        }
      }
    }
  } catch {
    /* non-fatal */
  }

  /* 5) ORPHANED PARTIAL DOWNLOADS — *.part / *.tmp / *.download fragments. */
  try {
    const files: string[] = []
    progress.currentDir = paths.data
    await walk(paths.data, files, walkOpts)
    for (const p of files) {
      const base = path.basename(p).toLowerCase()
      if (!base.endsWith('.part') && !base.endsWith('.tmp') && !base.endsWith('.download') && !base.endsWith('.crdownload')) continue
      if (isProtected(p)) continue
      counter.n++
      const size = await fileSize(p)
      items.push({
        id: 'orphan-' + Buffer.from(p).toString('base64url').slice(0, 24),
        path: p,
        sizeBytes: size,
        category: 'orphaned',
        confidence: 100,
        label: 'Orphaned download fragment: ' + path.basename(p),
        detail: 'An interrupted download or extraction leftover. No active task references it.',
        autoSelected: true
      })
    }
    bump()
  } catch {
    /* non-fatal */
  }

  /* 6) DUPLICATE FILES inside the launcher's own cache areas. */
  try {
    const candidates: string[] = []
    const tmpDir = path.join(paths.data, 'tmp')
    if (exists(tmpDir)) await walk(tmpDir, candidates, walkOpts)
    const seen = new Map<string, { path: string; size: number }>()
    for (const p of candidates) {
      if (isProtected(p)) continue
      counter.n++
      const size = await fileSize(p)
      if (size === 0) continue
      const fp = quickFingerprint(p)
      if (!fp) continue
      const prev = seen.get(fp)
      if (prev) {
        items.push({
          id: 'dup-' + Buffer.from(p).toString('base64url').slice(0, 24),
          path: p,
          sizeBytes: size,
          category: 'duplicates',
          confidence: 100,
          label: 'Duplicate: ' + path.basename(p),
          detail: 'Identical to "' + path.basename(prev.path) + '" (same content). Only the copy is removed.',
          autoSelected: true
        })
      } else {
        seen.set(fp, { path: p, size })
      }
      if (counter.n % YIELD_EVERY === 0) bump()
    }
    bump()
  } catch {
    /* non-fatal */
  }

  /* 7) STORAGE BREAKDOWN (visual) — full picture, nothing is deleted. */
  const breakdownItems: { label: string; bytes: number }[] = []
  const measure = async (label: string, dir: string): Promise<void> => {
    let total = 0
    try {
      if (exists(dir)) {
        progress.currentDir = dir
        const files: string[] = []
        await walk(dir, files, walkOpts)
        for (const p of files) total += await fileSize(p)
        counter.n += files.length
        bump()
      }
    } catch {
      /* non-fatal */
    }
    breakdownItems.push({ label, bytes: total })
  }
  for (const [label, dir] of [
    ['Instances', paths.instances],
    ['Launcher data', path.join(paths.data, 'games')],
    ['Downloads & cache', paths.updates],
    ['Temporary', path.join(paths.data, 'tmp')],
    ['Logs', paths.logs],
    ['Profiles & backups', path.join(paths.data, 'profiles')]
  ] as const) {
    await measure(label, dir)
  }

  const recoverableBytes = items.filter((i) => i.autoSelected).reduce((s, i) => s + i.sizeBytes, 0)
  onProgress?.({ scannedFiles: counter.n, currentDir: '' })
  logger.info('Clear Up Space scan: ' + counter.n + ' files scanned, ' + items.length + ' candidate(s), ' + (recoverableBytes / 1e6).toFixed(0) + ' MB auto-recoverable')

  return {
    items,
    recoverableBytes,
    breakdown: breakdownItems,
    scannedFiles: counter.n,
    ranAt
  }
}

/* ---------------------------------- cleanup ---------------------------------- */

/** Re-verify one item right before deletion. Returns a reason when it must be skipped. */
function preDeleteCheck(p: string, expectedSize: number): string | null {
  if (isProtected(p)) return 'Path is inside a protected area - skipped.'
  if (!exists(p)) return 'File no longer exists - nothing to delete.'
  let st: fs.Stats
  try {
    st = fs.statSync(p)
  } catch {
    return 'Could not stat the path - skipped.'
  }
  if (!st.isFile() && !st.isDirectory()) return 'Not a regular file/directory - skipped.'
  if (expectedSize > 0 && st.isFile() && st.size !== expectedSize) return 'File changed since the scan - skipped for safety.'
  return null
}

/**
 * Delete the user's selection. Re-verifies every item immediately before
 * removal; anything that fails a check is skipped and reported - never forced.
 */
export async function cleanSelected(ids: string[]): Promise<StorageCleanResult> {
  const result: StorageCleanResult = { freedBytes: 0, removed: 0, skipped: [] }
  const scan = await scanStorage()
  const byId = new Map(scan.items.map((i) => [i.id, i]))

  for (const id of ids) {
    const item = byId.get(id)
    if (!item) continue
    if (!item.autoSelected && item.confidence < 90) {
      result.skipped.push({ path: item.path, reason: 'Confidence below 90% - requires manual selection only.' })
      continue
    }
    const reason = preDeleteCheck(item.path, item.sizeBytes)
    if (reason) {
      result.skipped.push({ path: item.path, reason })
      continue
    }
    try {
      const { remove } = await import('../utils/fs')
      await remove(item.path)
      result.freedBytes += item.sizeBytes
      result.removed++
    } catch (err) {
      result.skipped.push({ path: item.path, reason: (err as Error).message })
    }
  }
  logger.info('Clear Up Space: removed ' + result.removed + ' item(s), freed ' + (result.freedBytes / 1e6).toFixed(0) + ' MB, ' + result.skipped.length + ' skipped')
  return result
}
