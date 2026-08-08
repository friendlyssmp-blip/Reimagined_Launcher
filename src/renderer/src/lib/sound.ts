/**
 * Reimagined UI sounds — the Aurora sound library (v1.0.35).
 *
 * One theme, everywhere, unconditionally. A small synthesized library built
 * on gentle sine tones with soft rounded attacks and short durations, tuned
 * to stay pleasant through hundreds of repetitions per session:
 * frequent actions (hover/click/toggle) are near-subtle, meaningful moments
 * (install complete, error, update available) stand out by contrast.
 *
 * Design rules (v1.0.35 quality pass):
 *  - SHORT: every interaction cue is brief — long sounds fatigue fast.
 *  - SOFT ATTACK, NO HARSH FREQUENCIES: rounded exponential onsets, no
 *    clicky transients, no piercing high-end.
 *  - CONSISTENT LOUDNESS: all cues normalized to a moderate level relative
 *    to each other; the master volume is always respected.
 *  - SAME FAMILY: everything shares Aurora's tonal character (warm sine
 *    palette), including the two new cues (update available, install
 *    complete).
 * Menu music (the bundled menu1.ogg) also respects the master volume.
 */

export interface SoundSettings {
  enabled: boolean
  /** Master volume, 0..1 */
  volume: number
  hover: boolean
  click: boolean
  notify: boolean
  download: boolean
  success: boolean
  error: boolean
  /** Menu music — off by default, enabled from Settings. */
  music: boolean
}

export const DEFAULT_SOUND: SoundSettings = {
  enabled: true,
  volume: 0.7,
  hover: true,
  click: true,
  notify: true,
  download: true,
  success: true,
  error: true,
  music: false
}

let cfg: SoundSettings = { ...DEFAULT_SOUND }
let ctx: AudioContext | null = null
let musicEl: HTMLAudioElement | null = null

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    const W = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
    if (!ctx) ctx = new (W.AudioContext ?? W.webkitAudioContext!)()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

/**
 * A soft Aurora tone: rounded attack, elegant decay, no harsh transients.
 * A gentle lowpass shaper on the gain envelope keeps high-frequency content
 * from ever piercing — the most fatiguing range for repeated listening.
 */
function tone(freq: number, dur: number, vol: number, when = 0, glideTo?: number): void {
  if (!cfg.enabled || vol <= 0) return
  const c = ac()
  if (!c) return
  const t0 = c.currentTime + when
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(Math.max(40, freq), t0)
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(40, glideTo), t0 + dur)
  const v = Math.min(0.5, vol * cfg.volume)
  gain.gain.setValueAtTime(0.0001, t0)
  // Soft rounded attack (16 ms) — no clicky onset.
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, v), t0 + 0.016)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(gain)
  gain.connect(c.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.06)
}

export const sound = {
  configure(patch: Partial<SoundSettings>): void {
    cfg = { ...cfg, ...patch }
  },
  getSettings(): SoundSettings {
    return { ...cfg }
  },
  setEnabled(v: boolean): void {
    cfg.enabled = v
    if (!v) sound.musicStop()
  },
  isEnabled(): boolean {
    return cfg.enabled
  },

  /** Soft whisper of a tick on hover — barely there, felt more than heard. */
  hover(): void {
    if (!cfg.hover) return
    tone(440, 0.045, 0.035)
  },
  /** Gentle double-tap: a soft primary note plus a quiet low harmonic. */
  click(): void {
    if (!cfg.click) return
    tone(520, 0.065, 0.07)
    tone(780, 0.05, 0.03, 0.012)
  },
  /** Calm notification ping. */
  notify(): void {
    if (!cfg.notify) return
    tone(720, 0.14, 0.06)
  },
  /** Download finished — a quiet, satisfying two-note chime. */
  download(): void {
    if (!cfg.download) return
    tone(587, 0.1, 0.07)
    tone(880, 0.16, 0.06, 0.06)
  },
  /**
   * v1.0.35 — install/operation completed: a short, satisfying completion
   * payoff that lands with the success checkmark — warm, rounded, and brief.
   */
  installComplete(): void {
    if (!cfg.download) return
    tone(523, 0.09, 0.075)
    tone(784, 0.14, 0.07, 0.07)
    tone(1046, 0.18, 0.045, 0.13)
  },
  /**
   * v1.0.35 — update available: a gentle, positive \"something worth noticing\"
   * cue. Routine news, not an alarm — soft two-note rise in the Aurora family.
   */
  updateAvailable(): void {
    if (!cfg.notify) return
    tone(660, 0.11, 0.065)
    tone(880, 0.16, 0.06, 0.1)
    tone(1100, 0.18, 0.035, 0.2)
  },
  /** Success — soft ascending arpeggio (completion moments). */
  success(): void {
    if (!cfg.success) return
    tone(523, 0.14, 0.07)
    tone(659, 0.14, 0.07, 0.08)
    tone(784, 0.2, 0.07, 0.16)
  },
  /** Error — two gentle descending tones, never harsh. */
  error(): void {
    if (!cfg.error) return
    tone(330, 0.2, 0.07, 0, 262)
    tone(247, 0.24, 0.06, 0.09, 196)
  },
  /** Instant preview for the settings panel — ignores per-action toggles so
   *  the user always hears what they're about to pick, but respects volume. */
  preview(kind: 'hover' | 'click' | 'notify' | 'download' | 'success' | 'error' | 'update' | 'install'): void {
    const prev = cfg
    cfg = { ...cfg, hover: true, click: true, notify: true, download: true, success: true, error: true }
    if (kind === 'hover') sound.hover()
    else if (kind === 'click') sound.click()
    else if (kind === 'notify') sound.notify()
    else if (kind === 'download') sound.download()
    else if (kind === 'success') sound.success()
    else if (kind === 'update') sound.updateAvailable()
    else if (kind === 'install') sound.installComplete()
    else sound.error()
    cfg = prev
  },

  /** Menu music loop — respects the master volume and the Music toggle. */
  musicStart(): void {
    if (!cfg.enabled || !cfg.music || musicEl) return
    try {
      const el = new Audio('./ui/sound/menu1.ogg')
      el.loop = true
      el.volume = Math.min(1, cfg.volume * 0.45)
      el.play().catch(() => {})
      musicEl = el
    } catch {
      /* audio unavailable */
    }
  },
  musicStop(): void {
    if (!musicEl) return
    try {
      musicEl.pause()
      musicEl.src = ''
    } catch {
      /* ignore */
    }
    musicEl = null
  },
  isMusicPlaying(): boolean {
    return !!musicEl
  },
  /** Update loop volume live (called when the volume slider moves). */
  setMusicVolume(v: number): void {
    if (musicEl) musicEl.volume = Math.min(1, v * 0.45)
  }
}
