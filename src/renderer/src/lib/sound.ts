/**
 * Reimagined UI sounds — the Aurora sound library (premium v1.0.53).
 *
 * One theme, everywhere, unconditionally. A small synthesized library built
 * on gentle sine tones with soft rounded attacks, extended releases and the
 * same tonal family as before — the v1.0.53 pass is about CONTINUITY, not
 * new sounds:
 *
 *  - SAME IDENTITY: every existing cue keeps its exact notes and character.
 *  - MIXER: all tones route through an sfx bus, music through a music bus,
 *    both into a master gain and a soft limiter (compressor) so several UI
 *    sounds at once can never spike or clip.
 *  - NO HARD CUTOFFS: every tone now carries a natural release + a micro-tail
 *    (a faint harmonic resonance for ~60–200ms) instead of ending abruptly,
 *    so consecutive sounds feel connected — click ──╮ then ╰─ subtle tail.
 *  - DUCKING: when an important cue plays (notify / install complete / update
 *    available / success / error), the menu music dips ~45% for a third of a
 *    second and glides back — barely noticeable, always smooth.
 *  - INTELLIGENT REPEATS: hover has a 55ms cooldown and clicks a 28ms one,
 *    with a tiny ±1.5% pitch jitter so rapid interaction sounds like a roll,
 *    never a machine-gun. Cues also self-limit in-flight voices.
 *  - CONTEXT CUES: tab(), panelOpen(), panelClose(), menuOpen() — each is the
 *    same family, shaped to feel like the UI is expanding / settling.
 *  - STARTUP PHASES: startupPhase('atmosphere'|'ring'|'logo'|'word'|
 *    'signature'|'transition') lets the splash drive one continuous
 *    composition; startup() stays as an alias for the atmosphere phase.
 *  - MASTER VOLUME is always respected; the Settings surface is unchanged.
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
let sfxBus: GainNode | null = null
let musicBus: GainNode | null = null
let masterGain: GainNode | null = null
let limiter: DynamicsCompressorNode | null = null
let musicEl: HTMLAudioElement | null = null
let musicBase = 0.45 /* music bus level before ducking, relative to master */
let ducking = false
let lastHoverAt = 0
let lastClickAt = 0
/* Per-cue in-flight voice counters — prevents runaway stacking. */
const voices = new Map<string, number>()

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    const W = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
    if (!ctx) {
      const c = new (W.AudioContext ?? W.webkitAudioContext!)()
      /* Build the mixer graph once: sfx + music buses → master → limiter → out. */
      masterGain = c.createGain()
      masterGain.gain.value = cfg.volume
      limiter = c.createDynamicsCompressor()
      limiter.threshold.value = -14
      limiter.knee.value = 22
      limiter.ratio.value = 12
      limiter.attack.value = 0.003
      limiter.release.value = 0.24
      sfxBus = c.createGain()
      sfxBus.gain.value = 1
      musicBus = c.createGain()
      musicBus.gain.value = 0
      sfxBus.connect(masterGain)
      musicBus.connect(masterGain)
      masterGain.connect(limiter)
      limiter.connect(c.destination)
      ctx = c
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

/** Master duck — menu music dips for a moment, then glides back. */
function duck(durMs = 320): void {
  const c = ctx
  if (!c || !musicBus || ducking) return
  ducking = true
  try {
    const t0 = c.currentTime
    const level = musicBus.gain.value
    musicBus.gain.cancelScheduledValues(t0)
    musicBus.gain.setValueAtTime(Math.max(0.0001, level), t0)
    musicBus.gain.linearRampToValueAtTime(Math.max(0.0001, level * 0.45), t0 + 0.035)
    musicBus.gain.linearRampToValueAtTime(Math.max(0.0001, level), t0 + durMs / 1000)
  } catch {
    /* ignore */
  }
  window.setTimeout(() => {
    ducking = false
  }, durMs)
}

/** Cooldown + in-flight voice accounting for a cue key. Returns false to skip. */
function gate(key: string, cooldownMs: number, maxVoices: number): boolean {
  const now = Date.now()
  if (key === 'hover' && now - lastHoverAt < cooldownMs) return false
  if (key === 'click' && now - lastClickAt < cooldownMs) return false
  const active = voices.get(key) ?? 0
  if (active >= maxVoices) return false
  voices.set(key, active + 1)
  const release = () => {
    const next = (voices.get(key) ?? 1) - 1
    if (next <= 0) voices.delete(key)
    else voices.set(key, next)
  }
  /* Release after the tone's full life (dur + tail + slack). */
  window.setTimeout(release, 900)
  if (key === 'hover') lastHoverAt = now
  if (key === 'click') lastClickAt = now
  return true
}

/** Subtle ±1.5% pitch variation so repeats never sound mechanical. */
function jitter(base: number): number {
  return base * (1 + (Math.random() - 0.5) * 0.03)
}

/**
 * A soft Aurora tone: rounded attack, elegant decay, natural release and a
 * faint harmonic micro-tail. The gain never slams to zero — the envelope
 * steps down to a whisper at the end of the note, then dissolves over the
 * tail, so adjacent sounds feel connected instead of chopped.
 */
function tone(freq: number, dur: number, vol: number, when = 0, glideTo?: number, tail = 90): void {
  if (!cfg.enabled || vol <= 0) return
  const c = ac()
  if (!c || !sfxBus) return
  const t0 = c.currentTime + when + 0.004 /* tiny timing offset — feels natural */
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(Math.max(40, freq), t0)
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(40, glideTo), t0 + dur)
  const v = Math.min(0.5, vol * cfg.volume)
  gain.gain.setValueAtTime(0.0001, t0)
  /* Soft rounded attack (14 ms) — no clicky onset. */
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, v), t0 + 0.014)
  /* Body of the note. */
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, v * 0.4), t0 + dur * 0.72)
  /* Enter the release — a whisper, not a stop. */
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, v * 0.02), t0 + dur)
  /* Micro-tail: dissolve completely over the tail window. */
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + tail / 1000)
  osc.connect(gain)
  gain.connect(sfxBus)
  osc.start(t0)
  osc.stop(t0 + dur + tail / 1000 + 0.06)
  /* Faint harmonic resonance riding the tail — the "small acoustic space". */
  if (tail > 40) {
    const res = c.createOscillator()
    const rg = c.createGain()
    res.type = 'sine'
    res.frequency.value = Math.max(40, freq * 2)
    const rv = Math.min(0.5, v * 0.09)
    rg.gain.setValueAtTime(0.0001, t0 + dur - 0.01)
    rg.gain.exponentialRampToValueAtTime(Math.max(0.0001, rv), t0 + dur + 0.03)
    rg.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + tail / 1000 + 0.02)
    res.connect(rg)
    rg.connect(sfxBus)
    res.start(t0 + dur - 0.01)
    res.stop(t0 + dur + tail / 1000 + 0.06)
  }
}

export const sound = {
  configure(patch: Partial<SoundSettings>): void {
    cfg = { ...cfg, ...patch }
    /* Keep the master gain live when the volume slider moves. */
    if (masterGain && typeof patch.volume === 'number') {
      masterGain.gain.setTargetAtTime(Math.max(0.0001, patch.volume), ctx!.currentTime, 0.02)
    }
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
    if (!cfg.hover || !gate('hover', 55, 3)) return
    tone(440, 0.05, 0.035, 0, undefined, 60)
  },
  /** Gentle double-tap: a soft primary note plus a quiet low harmonic. */
  click(): void {
    if (!cfg.click || !gate('click', 28, 4)) return
    const f = jitter(520)
    tone(f, 0.07, 0.07, 0, undefined, 90)
    tone(f * 1.5, 0.055, 0.03, 0.014, undefined, 70)
  },
  /** Calm notification ping — important cue: duck the music. */
  notify(): void {
    if (!cfg.notify) return
    duck(340)
    tone(720, 0.16, 0.06, 0, undefined, 180)
  },
  /** Download finished — a quiet, satisfying two-note chime. */
  download(): void {
    if (!cfg.download) return
    duck(320)
    tone(587, 0.12, 0.07, 0, undefined, 140)
    tone(880, 0.18, 0.06, 0.07, undefined, 180)
  },
  /**
   * v1.0.35 — install/operation completed: a short, satisfying completion
   * payoff that lands with the success checkmark — warm, rounded, and brief.
   */
  installComplete(): void {
    if (!cfg.download) return
    duck(360)
    tone(523, 0.1, 0.075, 0, undefined, 130)
    tone(784, 0.15, 0.07, 0.07, undefined, 160)
    tone(1046, 0.2, 0.045, 0.13, undefined, 200)
  },
  /**
   * v1.0.35 — update available: a gentle, positive "something worth noticing"
   * cue. Routine news, not an alarm — soft two-note rise in the Aurora family.
   */
  updateAvailable(): void {
    if (!cfg.notify) return
    duck(380)
    tone(660, 0.12, 0.065, 0, undefined, 150)
    tone(880, 0.17, 0.06, 0.1, undefined, 180)
    tone(1100, 0.2, 0.035, 0.2, undefined, 210)
  },
  /**
   * v1.0.36+ — startup. Alias for the atmosphere phase; SplashScreen drives
   * the full composition through startupPhase() at each visual beat.
   */
  startup(): void {
    if (!cfg.enabled) return
    sound.startupPhase('atmosphere')
  },
  /**
   * v1.0.53 — one continuous startup composition, phase by phase. Each beat
   * is scheduled slightly AFTER its visual moment (~40–70ms) so the audio
   * feels like it belongs to the motion, not bolted onto it.
   */
  startupPhase(phase: 'atmosphere' | 'ring' | 'logo' | 'word' | 'signature' | 'transition'): void {
    if (!cfg.enabled) return
    switch (phase) {
      case 'atmosphere':
        /* Low warm pad breathing in with the dark atmosphere. */
        tone(110, 1.6, 0.05, 0, 165, 300)
        tone(220, 1.3, 0.032, 0.12, 330, 260)
        break
      case 'ring':
        /* The energy ring draws — a faint rising shimmer. */
        tone(440, 0.6, 0.032, 0.05, 660, 220)
        tone(660, 0.4, 0.02, 0.32, 880, 180)
        break
      case 'logo':
        /* Logo reveal — gentle bloom at the construction moment. */
        tone(523, 0.42, 0.05, 0.06, 784, 200)
        tone(880, 0.5, 0.026, 0.2, undefined, 220)
        break
      case 'word':
        /* REIMAGINED typography — subtle secondary accent. */
        tone(660, 0.16, 0.04, 0.05, undefined, 140)
        tone(880, 0.22, 0.028, 0.12, undefined, 180)
        break
      case 'signature':
        /* Signature moment — a soft resolving chord, nothing cinematic. */
        tone(523, 0.7, 0.045, 0.05, undefined, 260)
        tone(659, 0.7, 0.04, 0.08, undefined, 260)
        tone(784, 0.75, 0.035, 0.11, undefined, 280)
        break
      case 'transition':
        /* Final dissolve — a quiet settling tone. */
        tone(440, 0.9, 0.035, 0.05, 330, 340)
        break
    }
  },
  /** Success — soft ascending arpeggio (completion moments). */
  success(): void {
    if (!cfg.success) return
    duck(340)
    tone(523, 0.16, 0.07, 0, undefined, 170)
    tone(659, 0.16, 0.07, 0.08, undefined, 170)
    tone(784, 0.22, 0.07, 0.16, undefined, 210)
  },
  /** Error — two gentle descending tones, never harsh. */
  error(): void {
    if (!cfg.error) return
    duck(340)
    tone(330, 0.22, 0.07, 0, 262, 190)
    tone(247, 0.26, 0.06, 0.09, 196, 200)
  },

  /* ------------------------- context-aware cues (v1.0.53) ------------------------- */

  /** Switching tabs — a quick, connected two-note glide. */
  tab(): void {
    if (!cfg.click || !gate('click', 24, 4)) return
    tone(540, 0.07, 0.055, 0, undefined, 80)
    tone(810, 0.1, 0.028, 0.028, undefined, 100)
  },
  /** A panel opens — the click family with a soft rising layer (expanding). */
  panelOpen(): void {
    if (!cfg.click || !gate('click', 20, 4)) return
    tone(480, 0.09, 0.06, 0, 560, 110)
    tone(720, 0.13, 0.028, 0.05, undefined, 130)
  },
  /** A panel closes — softer, shorter, gently falling (settling). */
  panelClose(): void {
    if (!cfg.click || !gate('click', 20, 4)) return
    tone(560, 0.08, 0.042, 0, 470, 90)
    tone(420, 0.11, 0.026, 0.04, undefined, 110)
  },
  /** A menu opens — the interface feels like it is expanding. */
  menuOpen(): void {
    if (!cfg.click || !gate('click', 24, 3)) return
    tone(520, 0.08, 0.05, 0, 600, 100)
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

  /** Menu music loop — routed through the music bus so ducking applies. */
  musicStart(): void {
    if (!cfg.enabled || !cfg.music || musicEl) return
    try {
      const el = new Audio('./ui/sound/menu1.ogg')
      el.loop = true
      el.volume = Math.min(1, cfg.volume * musicBase)
      const c = ac()
      if (c && musicBus) {
        /* Route through WebAudio so the limiter + ducking cover it too. */
        const src = c.createMediaElementSource(el)
        src.connect(musicBus)
        musicBus.gain.setTargetAtTime(musicBase, c.currentTime, 0.05)
      }
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
    if (musicBus && ctx) musicBus.gain.setTargetAtTime(0, ctx.currentTime, 0.03)
    musicEl = null
  },
  isMusicPlaying(): boolean {
    return !!musicEl
  },
  /** Update loop volume live (called when the volume slider moves). */
  setMusicVolume(v: number): void {
    musicBase = 0.45
    if (musicEl) musicEl.volume = Math.min(1, v * 0.45)
  }
}
