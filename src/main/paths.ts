/**
 * Central runtime paths.
 *
 * In development the data folder lives inside the project (`data/`) so the
 * user sees the exact structure described by the spec. In a packaged build
 * it lives under the OS user-data directory (Program Files is read-only).
 */
import { app } from 'electron'
import { join } from 'node:path'
import { mkdirp } from './utils/fs'

const isDev = !app.isPackaged
const APP_ROOT = app.getAppPath()
const DATA_ROOT = isDev ? join(APP_ROOT, 'data') : join(app.getPath('userData'), 'data')

export const dataRoot = DATA_ROOT

export const paths = {
  data: DATA_ROOT,
  profiles: join(DATA_ROOT, 'profiles'),
  logs: join(DATA_ROOT, 'logs'),
  games: join(DATA_ROOT, 'games'),
  /** v1.0.92 — human-readable instance folders (data/Instances/<Name>). */
  instances: join(DATA_ROOT, 'Instances'),
  versions: join(DATA_ROOT, 'games', 'versions'),
  libraries: join(DATA_ROOT, 'games', 'libraries'),
  assets: join(DATA_ROOT, 'games', 'assets'),
  assetsIndexes: join(DATA_ROOT, 'games', 'assets', 'indexes'),
  assetsObjects: join(DATA_ROOT, 'games', 'assets', 'objects'),
  runtime: join(DATA_ROOT, 'games', 'runtime'),
  settingsFile: join(DATA_ROOT, 'settings.json'),
  accountsFile: join(DATA_ROOT, 'accounts.json'),
  eventsFile: join(DATA_ROOT, 'events.json'),
  updates: join(DATA_ROOT, 'updates')
} as const

/** Create every data directory on startup. */
export function ensureDataDirs(): void {
  Object.values(paths).forEach((p) => {
    if (p.endsWith('.json')) {
      mkdirp(p.split(/[\/]/).slice(0, -1).join('/') || DATA_ROOT)
    } else {
      mkdirp(p)
    }
  })
}

export const isPackaged = !isDev
export const appVersion = app.getVersion()
