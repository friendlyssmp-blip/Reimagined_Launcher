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
  // Reimagined Performance Engine: auto-tune by default, engine-chosen tier.
  perfAutoTune: true,
  perfTier: 'auto',
  // Shader / crash safety (v1.0.12): auto-reduce render distance on low VRAM
  // when shaders are enabled, and auto-disable shaders after a shader crash.
  shaderAutoReduceRd: true,
  autoDisableShadersOnCrash: true,
  // v1.0.13 frame-rate safety: the engine ALWAYS applies a sane FPS cap by
  // default. `unlimitedFps` is a clearly-warned, explicit opt-in that removes
  // the cap — OFF by default (uncapped FPS can trigger thermal shutdown).
  unlimitedFps: false,
  // v1.0.29 — Extended View: on by default (genuinely low-cost, purely additive
  // static visuals beyond render distance — cached terrain is NOT simulated).
  extendedView: true,
  extendedViewDistance: 32,
  extendedCacheLimitMB: 512,
  // v1.0.30 — async server-chunk decode: on by default (server joins are the
  // worst jank case; decoding off the game thread never blocks the tick).
  asyncChunkDecode: true,
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
  autoCheckUpdates: true,
  // v1.0.34: silent auto-update is gone — a detected release shows the
  // 3-option prompt (Update / Cancel / Remind Me Later); the launcher NEVER
  // updates itself without the user choosing "Update".
  // Re-check GitHub every 15 s while the launcher is open (15 s – 15 min).
  updateCheckIntervalSec: 15,
  // V2 download queue: 1 = strict queue (default), 3 / 5 = parallel installs.
  downloadConcurrency: 1
}

class SettingsManager {
  private settings: LauncherSettings = { ...DEFAULT_SETTINGS }
  private loaded = false

  async load(): Promise<LauncherSettings> {
    if (this.loaded) return this.settings
    const saved = await readJson<Partial<LauncherSettings>>(paths.settingsFile, {})
    // v1.0.34 — drop removed settings keys left in an old settings.json (e.g.
    // autoInstallUpdates, which no longer exists: silent auto-update is gone).
    const REMOVED_KEYS = new Set(['autoInstallUpdates'])
    this.settings = { ...DEFAULT_SETTINGS, ...Object.fromEntries(
      Object.entries(saved).filter(([k, v]) => !REMOVED_KEYS.has(k) && v !== '' && v !== null && v !== undefined)
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

/**
 * Calculate recommended RAM via the Performance Engine (50% of system RAM,
 * clamped 2-8 GB, aligned to the detected hardware). Async so the engine can
 * run its hardware detection lazily; falls back to a safe sync estimate.
 */
export async function getRecommendedMemory(): Promise<number> {
  try {
    const { engine } = await import('../perf/engine')
    const hw = await engine.detectHardware(false)
    return engine.recommendMemoryMB(hw, DEFAULT_SETTINGS.memory)
  } catch {
    const totalMB = getSystemMemoryMB()
    const recommended = Math.floor(totalMB * 0.5)
    return Math.max(2048, Math.min(8192, recommended))
  }
}

export const settingsManager = new SettingsManager()
export type { RecentActivity }
