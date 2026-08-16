/**
 * Reimagined UI sounds — the Aurora sound library (premium v1.0.54).
 *
 * One theme, everywhere, unconditionally. A small synthesized library built
 * on gentle sine tones with soft rounded attacks, extended releases and the
 * same tonal family as before — continuity over new sounds:
 *
 *  - SAME IDENTITY: every existing cue keeps its exact notes and character.
 *  - MIXER: all tones route through an sfx bus, music through a music bus,
 *    both into a master gain and a soft limiter (compressor) so several UI
 *    sounds at once can never spike or clip.
 *  - NO HARD CUTOFFS: every tone carries a natural release + a micro-tail (a
 *    faint harmonic resonance for ~60–200ms) instead of ending abruptly.
 *  - DUCKING: an important cue (notify / install complete / update available /
 *    success / error) dips the menu music ~45% for a third of a second.
 *  - VOICE POOL (v1.0.54): instead of aggressive cooldowns, short UI sounds
 *    share a small pool of concurrent voices with priorities:
 *      0 important feedback (notify, install, download, success, error…)
 *      1 clicks / tabs / panels / menus
 *      2 hover ticks
 *    Rapid mouse sweeps now sound EVERY hover (hover has no suppressing
 *    cooldown — only a 1ms same-event dedupe), the pool allows ~8 hover
 *    voices at once, and when it fills the OLDEST lowest-priority voice is
 *    faded out — a hover never interrupts important feedback, and an
 *    important cue can always claim a slot from a hover. When many hovers
 *    overlap their individual gain eases down automatically so the result
 *    is a soft roll, never a machine-gun or a volume spike.
 *  - CONTEXT CUES: tab(), panelOpen(), panelClose(), menuOpen().
 *  - STARTUP PHASES: startupPhase('atmosphere'|'ring'|'logo'|'word'|
 *    'signature'|'transition'); startup() stays as an alias for the
 *    atmosphere phase.
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
/* v1.0.85 — the menu music source can be overridden with a local library
 * track (reimagined-music://…). null = the bundled track. */
let musicUrl: string | null = null
let musicEndedCb: (() => void) | null = null
let musicPaused = false
/* v1.0.99 — the background-music volume is FULLY INDEPENDENT from the UI
 * sound volume: it lives on the audio element (el.volume) instead of being
 * folded into the master cfg.volume, so turning UI sounds up/down never
 * touches the music. Matches the audioMusicVolume setting default (0.35). */
let musicBase = 0.35
let ducking = false
let lastHoverAt = 0
let lastClickAt = 0

/* ------------------------- voice pool (v1.0.54) ------------------------- */
/* A small set of concurrent short voices with priorities. Voices never hard-
 * cancel each other by default; only when the pool is full does the oldest
 * LOWEST-priority voice get faded out to make room (a hover can be replaced
 * by a click, but never the other way around). */
const POOL_MAX = 10
/** Priorities — LOWER number = more important. */
const PRIO_IMPORTANT = 0
const PRIO_CLICK = 1
const PRIO_HOVER = 2
interface Voice {
  key: string
  prio: number
  started: number
  stop: () => void
}
const pool: Voice[] = []

/**
 * Reserve a voice slot. Returns null when the pool is full AND the incoming
 * sound is not important enough to justify evicting an older one. The
 * returned release() removes the slot (eviction fades the tone out first).
 */
function acquireVoice(key: string, prio: number, lifeMs: number): (() => void) | null {
  if (pool.length >= POOL_MAX) {
    /* Find the oldest voice with the LOWEST priority (highest number). */
    let worst = -1
    let worstPrio = -Infinity
    for (let i = 0; i < pool.length; i++) {
      const v = pool[i]
      if (v.prio > worstPrio) {
        worstPrio = v.prio
        worst = i
      } else if (v.prio === worstPrio && (worst < 0 || v.started < pool[worst].started)) {
        worst = i
      }
    }
    if (worst >= 0 && worstPrio > prio) {
      /* The incoming sound matters more — fade the old voice out instantly. */
      pool[worst].stop()
      pool.splice(worst, 1)
    } else {
      return null
    }
  }
  const voice: Voice = { key, prio, started: Date.now(), stop: () => {} }
  pool.push(voice)
  let done = false
  const release = () => {
    if (done) return
    done = true
    const idx = pool.indexOf(voice)
    if (idx >= 0) pool.splice(idx, 1)
  }
  window.setTimeout(release, lifeMs)
  return release
}

function activeCount(key: string): number {
  let n = 0
  for (const v of pool) if (v.key === key) n++
  return n
}

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

/** Subtle ±1.5% pitch variation so repeats never sound mechanical. */
function jitter(base: number): number {
  return base * (1 + (Math.random() - 0.5) * 0.03)
}

/**
 * A soft Aurora tone: rounded attack, elegant decay, natural release and a
 * faint harmonic micro-tail. Returns a stop() handle so the voice pool can
 * fade a replaced voice out in ~30ms instead of hard-cutting it.
 */
function tone(freq: number, dur: number, vol: number, when = 0, glideTo?: number, tail = 90): () => void {
  if (!cfg.enabled || vol <= 0) return () => {}
  const c = ac()
  if (!c || !sfxBus) return () => {}
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
  let res: OscillatorNode | null = null
  let rg: GainNode | null = null
  if (tail > 40) {
    res = c.createOscillator()
    rg = c.createGain()
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
  let stopped = false
  const stop = (): void => {
    if (stopped) return
    stopped = true
    try {
      const t1 = c.currentTime
      gain.gain.cancelScheduledValues(t1)
      gain.gain.setTargetAtTime(0.0001, t1, 0.015)
      if (rg) {
        rg.gain.cancelScheduledValues(t1)
        rg.gain.setTargetAtTime(0.0001, t1, 0.02)
      }
    } catch {
      /* ignore */
    }
    window.setTimeout(() => {
      try {
        osc.stop()
        res?.stop()
      } catch {
        /* already stopped */
      }
    }, 90)
  }
  return stop
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
    /* v1.0.99 — music is independent from the UI-sounds toggle: turning UI
     * sounds off must NOT stop the user's background music (they control it
     * with their own volume slider). */
  },
  isEnabled(): boolean {
    return cfg.enabled
  },

  /**
   * Soft whisper of a tick on hover. v1.0.54 — NO suppressing cooldown: every
   * legitimate hover gets a voice (the app-level lastHovered dedupe already
   * prevents per-element repeats). When several hovers overlap their gains
   * ease down so rapid sweeps roll instead of stacking loud.
   */
  hover(): void {
    if (!cfg.hover) return
    /* 1ms dedupe only guards the same physical event double-firing. */
    const now = Date.now()
    if (now - lastHoverAt < 1) return
    lastHoverAt = now
    const release = acquireVoice('hover', PRIO_HOVER, 170)
    if (!release) return
    const n = activeCount('hover')
    const norm = n >= 6 ? 0.55 : n >= 4 ? 0.78 : 1
    tone(440, 0.05, 0.035 * norm, 0, undefined, 60)
  },
  /** Gentle double-tap: a soft primary note plus a quiet low harmonic. */
  click(): void {
    if (!cfg.click || Date.now() - lastClickAt < 28) return
    lastClickAt = Date.now()
    const release = acquireVoice('click', PRIO_CLICK, 220)
    if (!release) return
    const f = jitter(520)
    tone(f, 0.07, 0.07, 0, undefined, 90)
    tone(f * 1.5, 0.055, 0.03, 0.014, undefined, 70)
  },
  /** Calm notification ping — important cue: duck the music. */
  notify(): void {
    if (!cfg.notify) return
    acquireVoice('notify', PRIO_IMPORTANT, 600)
    duck(340)
    tone(720, 0.16, 0.06, 0, undefined, 180)
  },
  /** Download finished — a quiet, satisfying two-note chime. */
  download(): void {
    if (!cfg.download) return
    acquireVoice('download', PRIO_IMPORTANT, 600)
    duck(320)
    tone(587, 0.12, 0.07, 0, undefined, 140)
    tone(880, 0.18, 0.06, 0.07, undefined, 180)
  },
  /** v1.0.35 — install/operation completed: a short, satisfying completion
   *  payoff that lands with the success checkmark — warm, rounded, brief. */
  installComplete(): void {
    if (!cfg.download) return
    acquireVoice('install', PRIO_IMPORTANT, 700)
    duck(360)
    tone(523, 0.1, 0.075, 0, undefined, 130)
    tone(784, 0.15, 0.07, 0.07, undefined, 160)
    tone(1046, 0.2, 0.045, 0.13, undefined, 200)
  },
  /** v1.0.35 — update available: a gentle, positive "something worth
   *  noticing" cue. Routine news, not an alarm. */
  updateAvailable(): void {
    if (!cfg.notify) return
    acquireVoice('update', PRIO_IMPORTANT, 700)
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
  /**
   * v1.0.88 — the startup is ONE continuous sound-design piece, rebuilt from
   * scratch (no Aurora material). New luminous D(add9) palette, longer and
   * more developed: a broad warm bed wakes, activation pulses rise, the logo
   * gets a brand-new three-note sonic signature, and everything resolves into
   * a warm D(add9) landing that fades naturally into the launcher. Soft
   * attacks, no piercing frequencies, controlled volume — pleasant on the
   * hundredth launch too. Scheduled slightly after each visual beat so the
   * sound feels welded to the animation. Plays exactly once per startup
   * (SplashScreen guards against double-fire) and respects master volume.
   */
  startupPhase(phase: 'atmosphere' | 'ring' | 'logo' | 'word' | 'signature' | 'transition'): void {
    if (!cfg.enabled) return
    switch (phase) {
      case 'atmosphere':
        /* 0.00s — a wide, slow-swelling warm bed on D(add9): sub drone
         * (D1 -> D2), fifth, root, third and air, all with long glides so the
         * whole thing breathes open over the first beat. */
        tone(36.71, 3.6, 0.05, 0, 73.42, 620)
        tone(73.42, 3.2, 0.04, 0.06, 110, 540)
        tone(110, 2.9, 0.034, 0.14, 146.83, 480)
        tone(146.83, 2.6, 0.026, 0.24, 220, 420)
        tone(220, 2.3, 0.02, 0.36, 261.63, 380)
        tone(329.63, 1.9, 0.014, 0.5, 440, 340)
        tone(587.33, 1.5, 0.008, 0.66, 739.99, 300)
        break
      case 'ring':
        /* 0.55s — the ring draws: a luminous rising arpeggio (A3-C#4-E4-A4)
         * over a soft activation tick; the bed is still breathing below. */
        tone(220, 0.9, 0.024, 0.0, 277.18, 300)
        tone(277.18, 0.7, 0.02, 0.12, 329.63, 260)
        tone(329.63, 0.72, 0.018, 0.26, 440, 260)
        tone(440, 0.85, 0.016, 0.42, 554.37, 280)
        tone(164.81, 0.5, 0.012, 0.0, 220, 220)
        break
      case 'logo':
        /* 1.46s — the logo forms: a warm harmonic swell, then the brand-new
         * logo signature — a clean three-note confirmation (A4-C#5-E5) that
         * lands exactly as the logo completes. Distinct, elegant, soft. */
        tone(146.83, 1.8, 0.04, 0.04, 220, 460)
        tone(220, 1.6, 0.03, 0.12, 329.63, 420)
        tone(329.63, 1.4, 0.022, 0.22, 440, 380)
        tone(440, 1.2, 0.016, 0.34, 554.37, 360)
        tone(739.99, 1.2, 0.008, 0.5, 880, 340)
        /* Logo signature — the identifiable Reimagined moment. */
        tone(440, 0.17, 0.028, 0.94, undefined, 200)
        tone(554.37, 0.17, 0.024, 1.06, undefined, 200)
        tone(659.25, 0.42, 0.02, 1.18, 880, 300)
        break
      case 'word':
        /* 3.0s — a quiet high shimmer while the wordmark settles. */
        tone(587.33, 0.26, 0.016, 0.04, undefined, 200)
        tone(739.99, 0.3, 0.012, 0.14, undefined, 240)
        break
      case 'signature':
        /* 3.16s — the finale: the whole cue resolves into a warm D(add9)
         * swell with a high sparkle. Longer and more developed than any UI
         * tick, but always soft. */
        tone(36.71, 2.6, 0.045, 0, 73.42, 560)
        tone(73.42, 2.4, 0.038, 0.06, 110, 500)
        tone(146.83, 2.2, 0.03, 0.14, 220, 440)
        tone(220, 2.0, 0.024, 0.22, 277.18, 400)
        tone(329.63, 1.8, 0.018, 0.3, 440, 360)
        tone(554.37, 1.2, 0.014, 0.38, 659.25, 340)
        tone(880, 1.3, 0.01, 0.46, 1174.66, 420)
        tone(1479.98, 1.5, 0.006, 0.6, 1975.53, 500)
        break
      case 'transition':
        /* 3.76s — everything settles: a gentle falling fifth (A3 -> D3) into
         * the resolved root; the launcher fades in underneath. */
        tone(440, 1.2, 0.024, 0.04, 329.63, 420)
        tone(220, 1.4, 0.02, 0.1, 146.83, 460)
        tone(554.37, 1.0, 0.01, 0.22, 440, 380)
        tone(73.42, 1.8, 0.018, 0.18, 73.42, 520)
        break
    }
  },
  /** Success — soft ascending arpeggio (completion moments). */
  success(): void {
    if (!cfg.success) return
    acquireVoice('success', PRIO_IMPORTANT, 700)
    duck(340)
    tone(523, 0.16, 0.07, 0, undefined, 170)
    tone(659, 0.16, 0.07, 0.08, undefined, 170)
    tone(784, 0.22, 0.07, 0.16, undefined, 210)
  },
  /** Error — two gentle descending tones, never harsh. */
  error(): void {
    if (!cfg.error) return
    acquireVoice('error', PRIO_IMPORTANT, 700)
    duck(340)
    tone(330, 0.22, 0.07, 0, 262, 190)
    tone(247, 0.26, 0.06, 0.09, 196, 200)
  },

  /* ------------------------- context-aware cues (v1.0.53) ------------------------- */

  /** Switching tabs — a quick, connected two-note glide. */
  tab(): void {
    if (!cfg.click || Date.now() - lastClickAt < 24) return
    lastClickAt = Date.now()
    const release = acquireVoice('tab', PRIO_CLICK, 200)
    if (!release) return
    tone(540, 0.07, 0.055, 0, undefined, 80)
    tone(810, 0.1, 0.028, 0.028, undefined, 100)
  },
  /** A panel opens — the click family with a soft rising layer (expanding). */
  panelOpen(): void {
    if (!cfg.click || Date.now() - lastClickAt < 20) return
    lastClickAt = Date.now()
    const release = acquireVoice('panel', PRIO_CLICK, 240)
    if (!release) return
    tone(480, 0.09, 0.06, 0, 560, 110)
    tone(720, 0.13, 0.028, 0.05, undefined, 130)
  },
  /** A panel closes — softer, shorter, gently falling (settling). */
  panelClose(): void {
    if (!cfg.click || Date.now() - lastClickAt < 20) return
    lastClickAt = Date.now()
    const release = acquireVoice('panel', PRIO_CLICK, 220)
    if (!release) return
    tone(560, 0.08, 0.042, 0, 470, 90)
    tone(420, 0.11, 0.026, 0.04, undefined, 110)
  },
  /** A menu opens — the interface feels like it is expanding. */
  menuOpen(): void {
    if (!cfg.click || Date.now() - lastClickAt < 24) return
    lastClickAt = Date.now()
    const release = acquireVoice('menu', PRIO_CLICK, 200)
    if (!release) return
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
    if (musicEl) return
    /* v1.0.94 — the "Menu music" toggle is gone: the bundled menu loop only
       plays when cfg.music is on, but custom library tracks always play. */
    if (!musicUrl && !cfg.music) return
    musicPaused = false
    try {
      // v1.0.85 — a custom library track when one is set (loop off so the
      // player can auto-advance to the next song), else the bundled loop.
      const custom = !!musicUrl
      /* v1.0.99 — FIX: the launcher's audio element is routed through
       * WebAudio (createMediaElementSource) for ducking/limiter, and WebAudio
       * SILENCES media that was fetched cross-origin without CORS approval.
       * The reimagined-music:// source is cross-origin to the renderer, so we
       * must fetch it in CORS mode (crossOrigin) and the main process serves
       * it with Access-Control-Allow-Origin (see index.ts serveLocalFile).
       * The element is created without src first so crossOrigin is set BEFORE
       * the fetch starts — otherwise the track stays silent forever. */
      const el = new Audio()
      el.crossOrigin = 'anonymous'
      el.src = musicUrl ?? './ui/sound/menu1.ogg'
      el.loop = !custom
      /* v1.0.99 — volume lives on the element (independent of master); the
       * bus runs at unity so ducking still works on top. */
      el.volume = Math.min(1, Math.max(0, musicBase))
      if (custom) el.onended = () => musicEndedCb?.()
      const c = ac()
      if (c && musicBus) {
        /* Route through WebAudio so the limiter + ducking cover it too. */
        const src = c.createMediaElementSource(el)
        src.connect(musicBus)
        musicBus.gain.setTargetAtTime(1, c.currentTime, 0.05)
      }
      el.play().catch(() => {})
      musicEl = el
    } catch {
      /* audio unavailable */
    }
  },
  /** v1.0.85 — override the menu music source with a local library track. */
  setMusicUrl(url: string | null): void {
    if (url === musicUrl) return
    const wasPlaying = !!musicEl
    if (musicEl) this.musicStop()
    musicUrl = url
    if (wasPlaying && url) this.musicStart()
  },
  /** v1.0.85 — callback fired when a custom track finishes (auto-advance). */
  onMusicEnded(cb: (() => void) | null): void {
    musicEndedCb = cb
  },
  /** v1.0.87 — real pause: keeps the element + position (resume continues). */
  musicPause(): void {
    if (!musicEl) return
    musicPaused = true
    musicEl.pause()
  },
  /** v1.0.87 — resume a paused track from where it stopped. */
  musicResume(): void {
    if (!musicEl) return
    musicPaused = false
    musicEl.play().catch(() => {})
  },
  /** v1.0.87 — replay the current custom track from the beginning. */
  musicRestart(): void {
    const url = musicUrl
    if (musicEl) this.musicStop()
    musicUrl = url
    musicPaused = false
    if (url) this.musicStart()
  },
  /** v1.0.87 — forget the custom source (back to the bundled menu loop). */
  clearMusicUrl(): void {
    musicUrl = null
  },
  musicStop(): void {
    musicPaused = false
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
    return !!musicEl && !musicPaused
  },
  isMusicPaused(): boolean {
    return musicPaused
  },
  /** v1.0.99 — the background-music volume (0..1), fully independent from the
   * UI sound volume. Applied live to the element; the WebAudio bus stays at
   * unity so ducking can still dip it briefly for important UI cues. */
  setMusicVolume(v: number): void {
    musicBase = Math.min(1, Math.max(0, v))
    if (musicEl) musicEl.volume = musicBase
  }
}
