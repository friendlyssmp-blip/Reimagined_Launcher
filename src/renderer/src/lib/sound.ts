/**
 * Reimagined premium UI sounds.
 *
 * Soft, clean, elegant — a small synthesized sound library built on gentle
 * sine/triangle tones with slow envelopes, tuned to stay pleasant during
 * long sessions. Three sound packs (Aurora / Crystal / Zen) shift pitch and
 * timbre, and every action has its own toggle + instant preview.
 * Menu music (the bundled menu1.ogg) respects the master volume.
 */

export type SoundPack = 'aurora' | 'crystal' | 'zen'

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
  pack: SoundPack
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
  music: false,
  pack: 'aurora'
}

export const SOUND_PACKS: { id: SoundPack; label: string; desc: string }[] = [
  { id: 'aurora', label: 'Aurora', desc: 'Default — balanced, warm' },
  { id: 'crystal', label: 'Crystal', desc: 'Brighter, airier tones' },
  { id: 'zen', label: 'Zen', desc: 'Deeper, softer and calmer' }
]

const PACKS: Record<SoundPack, { shift: number; type: OscillatorType }> = {
  aurora: { shift: 1, type: 'sine' },
  crystal: { shift: 1.13, type: 'sine' },
  zen: { shift: 0.86, type: 'triangle' }
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

/** A soft tone: quick gentle attack, long elegant decay. */
function tone(freq: number, dur: number, vol: number, when = 0, type: OscillatorType = 'sine', glideTo?: number): void {
  if (!cfg.enabled || vol <= 0) return
  const c = ac()
  if (!c) return
  const t0 = c.currentTime + when
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(Math.max(40, freq), t0)
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(40, glideTo), t0 + dur)
  const v = Math.min(0.5, vol * cfg.volume)
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, v), t0 + 0.012)
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

  /** Soft whisper of a tick on hover — barely there. */
  hover(): void {
    if (!cfg.hover) return
    const s = PACKS[cfg.pack].shift
    tone(980 * s, 0.05, 0.05)
  },
  /** Gentle double-tap: a soft primary note plus a quiet harmonic. */
  click(): void {
    if (!cfg.click) return
    const s = PACKS[cfg.pack].shift
    tone(540 * s, 0.07, 0.1, 0, PACKS[cfg.pack].type)
    tone(880 * s, 0.055, 0.045, 0.014)
  },
  /** Calm notification ping. */
  notify(): void {
    if (!cfg.notify) return
    const s = PACKS[cfg.pack].shift
    tone(840 * s, 0.16, 0.075)
  },
  /** Download finished — a quiet two-note chime. */
  download(): void {
    if (!cfg.download) return
    const s = PACKS[cfg.pack].shift
    tone(660 * s, 0.11, 0.08)
    tone(990 * s, 0.17, 0.075, 0.07)
  },
  /** Success — soft ascending arpeggio. */
  success(): void {
    if (!cfg.success) return
    const s = PACKS[cfg.pack].shift
    tone(523 * s, 0.16, 0.085)
    tone(659 * s, 0.16, 0.085, 0.09)
    tone(784 * s, 0.24, 0.085, 0.18)
  },
  /** Error — two gentle descending tones, never harsh. */
  error(): void {
    if (!cfg.error) return
    const s = PACKS[cfg.pack].shift
    tone(330 * s, 0.22, 0.08, 0, PACKS[cfg.pack].type, 262 * s)
    tone(247 * s, 0.26, 0.07, 0.09, PACKS[cfg.pack].type, 196 * s)
  },
  /** Instant preview for the settings panel — ignores per-action toggles so
   *  the user always hears what they're about to pick, but respects volume. */
  preview(kind: 'hover' | 'click' | 'notify' | 'download' | 'success' | 'error'): void {
    const prev = cfg
    cfg = { ...cfg, hover: true, click: true, notify: true, download: true, success: true, error: true }
    if (kind === 'hover') sound.hover()
    else if (kind === 'click') sound.click()
    else if (kind === 'notify') sound.notify()
    else if (kind === 'download') sound.download()
    else if (kind === 'success') sound.success()
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
