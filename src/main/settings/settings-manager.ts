/**
 * Settings manager — a tiny typed store persisted to `data/settings.json`.
 * Handles defaults, safe updates and the "recent activity" feed used by Home.
 */
import { paths } from '../paths'
import { readJson, writeJson } from '../utils/fs'
import { logger } from '../logs/logger'
import { eventBus } from '../core/event-bus'
import { iso } from '../utils/format'
import type { LauncherSettings, RecentActivity } from '@shared/types'

export const DEFAULT_SETTINGS: LauncherSettings = {
  memory: 4096,
  javaPath: '',
  theme: 'night',
  logLevel: 'info',
  keepLogDays: 30,
  microsoftClientId: 'c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb',
  closeOnLaunch: false,
  showConsoleOnLaunch: true,
  showSnapshots: false,
  performanceMode: false,
  preset: 'balanced',
  recentActivity: [],
  audioEnabled: true,
  audioVolume: 0.7,
  audioHover: true,
  audioClick: true,
  audioNotify: true,
  audioDownload: true,
  audioSuccess: true,
  audioError: true,
  // Menu music is OFF by default — opt-in from Settings → Audio.
  audioMusic: false,
  audioPack: 'aurora',
  autoCheckUpdates: true
}

class SettingsManager {
  private settings: LauncherSettings = { ...DEFAULT_SETTINGS }
  private loaded = false

  async load(): Promise<LauncherSettings> {
    if (this.loaded) return this.settings
    const saved = await readJson<Partial<LauncherSettings>>(paths.settingsFile, {})
    this.settings = { ...DEFAULT_SETTINGS, ...Object.fromEntries(
      Object.entries(saved).filter(([k, v]) => v !== '' && v !== null && v !== undefined)
    ), recentActivity: saved.recentActivity ?? [] }
    this.loaded = true
    return this.settings
  }

  get(): LauncherSettings {
    return this.settings
  }

  async update(patch: Partial<LauncherSettings>): Promise<LauncherSettings> {
    this.settings = { ...this.settings, ...patch }
    await writeJson(paths.settingsFile, this.settings)
    eventBus.emit('settings:changed', this.settings)
    return this.settings
  }

  /** Record a user-facing activity for the Home "Recent activity" panel. */
  async addRecent(type: RecentActivity['type'], label: string): Promise<void> {
    const entry: RecentActivity = { type, label, at: iso() }
    this.settings.recentActivity = [entry, ...this.settings.recentActivity].slice(0, 10)
    await writeJson(paths.settingsFile, this.settings)
    eventBus.emit('settings:changed', this.settings)
  }
}


/** Get total system memory in MB. */
export function getSystemMemoryMB(): number {
  try {
    return Math.floor(require('os').totalmem() / 1024 / 1024)
  } catch {
    return 8192 // default fallback
  }
}

/** Calculate recommended RAM: 50% of system RAM, clamped to 2-12 GB. */
export function getRecommendedMemory(): number {
  const totalMB = getSystemMemoryMB()
  const recommended = Math.floor(totalMB * 0.5)
  return Math.max(2048, Math.min(12288, recommended))
}

export const settingsManager = new SettingsManager()
export type { RecentActivity }
