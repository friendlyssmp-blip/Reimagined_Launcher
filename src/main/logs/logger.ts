/**
 * Professional logging system.
 *
 * Writes daily files: `data/logs/launcher-YYYY-MM-DD.log`
 * Line format: `[2026-08-04 20:00:00] INFO: message`
 *
 * Design rules:
 *  - Errors are NEVER hidden — they are always logged with a stack trace.
 *  - Logs are append-only and useful for debugging.
 *  - Old log files are cleaned automatically (Settings → keepLogDays).
 */
import fs from 'node:fs'
import path from 'node:path'
import { paths } from '../paths'
import { dateStamp, timestamp } from '../utils/format'
import type { LauncherSettings } from '@shared/types'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

interface LogOptions {
  /** Also push to the UI console (default true). */
  toConsole?: boolean
}

let minLevel: LogLevel = 'info'
let consoleSink: ((line: string, level: LogLevel) => void) | null = null
/** Recent lines kept in memory so the UI can replay the session console. */
const recentLines: { at: string; level: LogLevel; text: string }[] = []
const MAX_RECENT = 2000

export function configureLogger(settings: LauncherSettings): void {
  minLevel = settings.logLevel
}

export function setConsoleSink(fn: (line: string, level: LogLevel) => void): void {
  consoleSink = fn
}

function logFileFor(day: string): string {
  return path.join(paths.logs, `launcher-${day}.log`)
}

function write(level: LogLevel, message: string, data?: unknown): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return

  const line = `[${timestamp()}] ${level.toUpperCase()}: ${message}${data !== undefined ? `\n  ${JSON.stringify(data)}` : ''}`
  try {
    fs.appendFileSync(logFileFor(dateStamp()), line + '\n', 'utf-8')
  } catch (err) {
    console.error('Logger write failure:', err)
  }

  recentLines.push({ at: new Date().toISOString(), level, text: message })
  if (recentLines.length > MAX_RECENT) recentLines.splice(0, recentLines.length - MAX_RECENT)

  if (level === 'error' || level === 'warn') console.error(line)
  consoleSink?.(message, level)
}

export const logger = {
  debug(message: string, data?: unknown): void {
    write('debug', message, data)
  },
  info(message: string, data?: unknown): void {
    write('info', message, data)
  },
  warn(message: string, data?: unknown): void {
    write('warn', message, data)
  },
  error(message: string, data?: unknown): void {
    write('error', message, data)
  },
  /** Log an unknown exception with a human-readable prefix. */
  exception(context: string, err: unknown): void {
    const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
    write('error', `${context}: ${detail}`)
  },
  recent(): { at: string; level: LogLevel; text: string }[] {
    return [...recentLines]
  },
  todayPath(): string {
    return logFileFor(dateStamp())
  }
}

/** Remove log files older than `keepDays` days. */
export async function cleanupOldLogs(keepDays: number): Promise<number> {
  const cutoff = Date.now() - keepDays * 86_400_000
  const files = await import('../utils/fs').then((m) => m.listDir(paths.logs))
  let removed = 0
  for (const f of files) {
    if (!f.startsWith('launcher-') || !f.endsWith('.log')) continue
    const stamp = f.slice('launcher-'.length, 'launcher-YYYY-MM-DD'.length)
    const ms = Date.parse(stamp)
    if (!Number.isNaN(ms) && ms < cutoff) {
      await import('../utils/fs').then((m) => m.remove(path.join(paths.logs, f)))
      removed++
    }
  }
  if (removed > 0) logger.info(`Cleaned up ${removed} old log file(s)`)
  return removed
}

export async function clearLogs(): Promise<number> {
  const { listDir, remove } = await import('../utils/fs')
  const files = await listDir(paths.logs)
  let removed = 0
  for (const f of files) {
    if (f.endsWith('.log')) {
      await remove(path.join(paths.logs, f))
      removed++
    }
  }
  logger.info(`Cleared ${removed} log file(s)`)
  return removed
}
