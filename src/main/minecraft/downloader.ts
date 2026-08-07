/**
 * Concurrent download queue with aggregate progress.
 * Used for libraries, assets and mods so big installs stream fast.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { eventBus } from '../core/event-bus'
import { downloadFile, type DownloadProgress } from '../utils/http'
import { logger } from '../logs/logger'
import type { DownloadKind } from '@shared/types'

export interface DownloadItem {
  url: string
  dest: string
  /** Expected size in bytes when known (from manifests / asset index). */
  expectedSize?: number
  /** Expected sha1 when known — the file is verified after download. */
  expectedSha1?: string
}

/** How many attempts before a download is reported as failed. */
const MAX_ATTEMPTS = 3

/** Abort controllers for every in-flight download (real cancel support). */
const inflight = new Set<AbortController>()

/** Abort every running download — files stop being written immediately. */
export function abortAllDownloads(): void {
  for (const ctrl of inflight) ctrl.abort()
  inflight.clear()
}

/** sha1 hex of a file, or null when unreadable. */
async function sha1Of(file: string): Promise<string | null> {
  try {
    const data = await fs.promises.readFile(file)
    return createHash('sha1').update(data).digest('hex')
  } catch {
    return null
  }
}

/** True when an existing file is already valid (size + sha1 when given). */
async function isFresh(dest: string, expectedSize?: number, expectedSha1?: string): Promise<boolean> {
  const sizeOk = (await (await import('../utils/fs')).sizeOf(dest)) >= (expectedSize ?? 1)
  if (!sizeOk) return false
  if (!expectedSha1) return true
  return (await sha1Of(dest)) === expectedSha1
}

export interface BatchProgress {
  kind: DownloadKind
  label: string
  done: number
  total: number
  received: number
  totalBytes: number
  percent: number
  currentFile: string
}

export interface DownloadBatchOptions {
  kind: DownloadKind
  label: string
  concurrency?: number
}

export async function runDownloadBatch(
  items: DownloadItem[],
  opts: DownloadBatchOptions
): Promise<{ downloaded: number; skipped: number }> {
  const { recordDownload } = await import('../game/content')
  const concurrency = opts.concurrency ?? 4
  const totalBytes = items.reduce((sum, it) => sum + (it.expectedSize ?? 0), 0)
  let done = 0
  let skipped = 0
  let received = 0
  let currentFile = ''
  recordDownload({ label: opts.label, kind: opts.kind, status: 'downloading', percent: 0, downloadedBytes: 0, totalBytes })

  const emit = (): void => {
    const progress: BatchProgress = {
      kind: opts.kind,
      label: opts.label,
      done,
      total: items.length,
      received,
      totalBytes,
      percent: items.length === 0 ? 100 : Math.min(100, (done + (totalBytes ? received / totalBytes : 0)) * 100 / items.length),
      currentFile
    }
    eventBus.emit('download:progress', progress)
  }

  if (items.length === 0) {
    emit()
    recordDownload({ label: opts.label, kind: opts.kind, status: 'done', percent: 100, downloadedBytes: 0, totalBytes: 0 })
    return { downloaded: 0, skipped: 0 }
  }

  const queue = [...items]
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!
      currentFile = item.dest.split(/[\\/]/).pop() ?? item.dest
      // Skip files that are already fully and correctly on disk.
      if (await isFresh(item.dest, item.expectedSize, item.expectedSha1)) {
        done++
        skipped++
        emit()
        continue
      }
      // Download with retry + sha1 verification — a corrupt or partial file
      // is deleted and re-fetched, never accepted silently. An abort (user
      // cancel) stops the current attempt immediately and is NOT retried.
      let attempts = 0
      for (;;) {
        attempts++
        const ctrl = new AbortController()
        inflight.add(ctrl)
        try {
          let lastReported = 0
          let fileReported = 0
          await downloadFile(item.url, item.dest, (p: DownloadProgress) => {
            // p.received is cumulative for this file — add only the delta.
            received += p.received - lastReported
            lastReported = p.received
            fileReported = p.received
            emit()
          }, 120_000, ctrl.signal)
          if (item.expectedSha1) {
            const actual = await sha1Of(item.dest)
            if (actual !== item.expectedSha1) {
              throw new Error('Downloaded file failed its sha1 verification')
            }
          }
          // Progress callbacks already counted every byte of this file, so
          // NEVER re-add its size here (that double-counted bytes and pushed
          // the bar to 100% at ~halfway — the "phantom download"). Only top
          // up the known size when the server sent no content-length and the
          // callback never fired for this file.
          received += Math.max(0, (item.expectedSize ?? 0) - fileReported)
          break
        } catch (err) {
          // Clean up the partial/corrupt file before retrying.
          await (await import('../utils/fs')).remove(item.dest).catch(() => {})
          if (ctrl.signal.aborted) {
            logger.info(`Download cancelled: ${item.url}`)
            throw err
          }
          if (attempts >= MAX_ATTEMPTS) {
            logger.exception(`Download failed after ${attempts} attempts: ${item.url}`, err)
            throw err
          }
          logger.warn(`Download failed (attempt ${attempts}/${MAX_ATTEMPTS}), retrying: ${item.url}`)
          await new Promise((r) => setTimeout(r, 400 * attempts))
        } finally {
          inflight.delete(ctrl)
        }
      }
      done++
      emit()
    }
  })

  try {
    await Promise.all(workers)
    logger.info(`[${opts.label}] downloaded ${items.length - skipped}/${items.length} file(s)`)
    recordDownload({ label: opts.label, kind: opts.kind, status: 'done', percent: 100, downloadedBytes: totalBytes, totalBytes })
    return { downloaded: items.length - skipped, skipped }
  } catch (err) {
    // Never leave the entry stuck in 'downloading' — mark it failed.
    recordDownload({ label: opts.label, kind: opts.kind, status: 'failed', percent: 0, downloadedBytes: received, totalBytes })
    throw err
  }
}
