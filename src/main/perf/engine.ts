/**
 * Reimagined Performance Engine (RPE).
 *
 * The brain that adapts Minecraft to the user's hardware automatically:
 *
 *  - Scores the detected hardware into a tier (potato / balanced / high),
 *    with human-readable reasons, and picks RAM, JVM flags and the FPS Boost
 *    config for that tier.
 *  - Records every play session's REAL measured performance (parsed from the
 *    game's own PERF reporter lines - never fake numbers) and self-learns:
 *    a machine that consistently stays far above target raises its render
 *    distance cap; one that struggles lowers it.
 *  - Produces clear, actionable recommendations the user chooses to apply.
 *
 * Everything is transparent: settings are only changed when the user asks
 * (or via the opt-in auto-tune), and every decision is logged.
 */
import path from 'node:path'
import fs from 'node:fs'
import { paths } from '../paths'
import { logger } from '../logs/logger'
import { settingsManager } from '../settings/settings-manager'
import { detectHardware } from './hardware'

/** Re-export so launcher/ipc can reach detection through the engine module. */
export { detectHardware }
import { readJson, writeJson } from '../utils/fs'
import type { HardwareProfile, PerfSessionMetrics, PerfStatus, PerfRecommendation, PerfTier, LauncherSettings } from '@shared/types'

const SESSIONS_FILE = () => path.join(paths.data, 'perf', 'sessions.json')
const TUNING_FILE = () => path.join(paths.data, 'perf', 'tuning.json')
const MAX_SESSIONS = 20

/* --------------------------------- scoring --------------------------------- */

interface TierDecision {
  tier: PerfTier
  reasons: string[]
}

/** Score the hardware and pick the best tier, explaining why. */
export function scoreHardware(hw: HardwareProfile | null): TierDecision {
  if (!hw) return { tier: 'balanced', reasons: ['Hardware details unavailable - using a safe default.'] }
  const reasons: string[] = []
  let points = 0

  const cores = hw.cpu.cores || 1
  const threads = hw.cpu.threads || cores
  const speed = hw.cpu.speedGHz || 2
  if (threads >= 12) { points += 3; reasons.push(threads + ' threads - plenty of headroom for chunk building.') }
  else if (threads >= 8) { points += 2; reasons.push(threads + ' threads handle chunk building well.') }
  else if (threads >= 4) { points += 1; reasons.push(threads + ' threads are workable - chunk build pool stays conservative.') }
  else reasons.push('Only ' + threads + ' thread(s) - the engine keeps background work minimal.')
  if (speed >= 4) points += 1
  if (speed <= 2.4) points -= 1

  const mainGpu = hw.gpu[0]
  const vram = mainGpu?.vramGB ?? 0
  if (mainGpu) {
    if (!mainGpu.integrated && vram >= 8) { points += 3; reasons.push(mainGpu.name + ' with ' + vram + ' GB VRAM handles full detail.') }
    else if (!mainGpu.integrated && vram >= 4) { points += 2; reasons.push(mainGpu.name + ' (' + vram + ' GB) is a solid mid-range GPU.') }
    else if (vram >= 2) { points += 1; reasons.push('Dedicated GPU with ' + vram + ' GB VRAM.') }
    else { points -= 1; reasons.push('Integrated or small-VRAM graphics - lighter rendering settings help.') }
  }

  const ramGB = hw.memory.totalGB || 8
  if (ramGB >= 32) { points += 2; reasons.push(ramGB + ' GB RAM is generous.') }
  else if (ramGB >= 16) { points += 1; reasons.push(ramGB + ' GB RAM is comfortable.') }
  else if (ramGB >= 8) { reasons.push(ramGB + ' GB RAM - memory is limited, heap stays conservative.') }
  else { points -= 2; reasons.push(ramGB + ' GB RAM is tight - minimum footprint.') }

  if (hw.storage.type === 'SSD') { points += 1; reasons.push('SSD storage keeps world loading snappy.') }
  else if (hw.storage.type === 'HDD') reasons.push('HDD storage - chunk streaming is kept light.')
  if (hw.laptop && mainGpu?.integrated) { points -= 1; reasons.push('Laptop with integrated graphics - thermals and battery matter.') }

  const tier: PerfTier = points >= 7 ? 'high' : points >= 3 ? 'balanced' : 'potato'
  return { tier, reasons: reasons.slice(0, 6) }
}

/** RAM recommendation: ~50% of system RAM, never starving the OS, capped. */
export function recommendMemoryMB(hw: HardwareProfile | null, current = 4096): number {
  const totalGB = hw?.memory.totalGB ?? 8
  const totalMB = totalGB * 1024
  const rec = Math.floor(totalMB * 0.5)
  const clamped = Math.max(2048, Math.min(8192, rec))
  if (clamped <= 0) return current
  return Math.round(clamped / 512) * 512
}

/** The tier that is actually in effect (auto -> engine, else manual). */
export function effectiveTier(settings: LauncherSettings, hw: HardwareProfile | null): { tier: PerfTier; source: 'auto' | 'manual' } {
  if (settings.perfTier && settings.perfTier !== 'auto') {
    return { tier: settings.perfTier, source: 'manual' }
  }
  const auto = scoreHardware(hw).tier
  const tier = settings.perfAutoTune ? auto : settings.preset
  return { tier, source: 'auto' }
}

/* ------------------------------- config builders ------------------------------- */

/**
 * The exact shape the in-game Reimagined FPS Boost mod reads.
 *
 * v1.0.12 adds the native render techniques (LOD distance, async chunk
 * upload, overdraw reduction, texture-atlas batching) as real config keys the
 * client's rendering layer consumes — always-on baseline, tuned by tier.
 * "Turbo" (beyond Potato) trades the most visual fidelity for absolute FPS
 * and is never the default.
 */
export function fpsConfigFor(tier: PerfTier, hw: HardwareProfile | null): Record<string, unknown> {
  // Frame-rate safety (v1.0.13): the engine NEVER lets the GPU run uncapped by
  // default — an unbounded frame rate is the #1 cause of whole-PC thermal /
  // power-delivery shutdowns on weaker machines. The cap tracks the detected
  // monitor refresh rate (safe 120 when unknown) and is bounded to 240, snapped
  // to vanilla's real framerateLimit values so options.txt stays clean. The
  // in-game watchdog also enforces the same value (`-Dreimagined.maxfps`).
  // v1.0.41 — FPS regression fix: the old engine forced a 60-120 FPS cap on
  // EVERY launch (options.txt + -Dreimagined.maxfps + in-game watchdog). On a
  // discrete GPU that could run 290 FPS uncapped, that cap silently dragged it
  // down to ~100-120. The safe cap is now OPT-IN ONLY (potato tier keeps 60
  // for thermal safety on weak iGPUs); balanced/high/turbo default to 260
  // (vanilla "Unlimited"). The user can still enable a cap in Settings.
  // v1.0.41 — the monitor-refresh-derived safeCap is intentionally unused now:
  // the default is Unlimited (260) except on potato (60 for thermal safety).
  const base = {
    enabled: true,
    reduceParticles: true,
    simplifyClouds: true,
    // Off by default since 1.0.1: the entity-animation state cache was removed
    // from the bundled mod (it could cause visual artifacts such as the
    // enchantment glint disappearing). Kept in the schema for compat.
    limitEntityAnimations: false,
    smartRenderDistance: true,
    reduceVisualEffects: false,
    showFps: false,
    // v1.0.12 — native render techniques (always-on foundation).
    lodDistance: 64,          // chunks beyond this use simplified merged geometry
    asyncChunkUpload: true,   // mesh upload off the main render thread
    overdrawReduction: true,  // early-Z / depth-sorted opaque pass
    textureBatching: true,    // atlas-friendly batching to cut texture swaps
    // v1.0.13 — frame-rate cap. v1.0.41: NOT applied by default anymore (it
    // was the FPS regression — 290 -> ~100 FPS on discrete GPUs). 260 =
    // vanilla "Unlimited"; potato tier overrides to 60 for thermal safety.
    unlimitedFps: false,
    maxFps: 260,
    // v1.0.29 — Extended View (Bobby-style, native): persist previously-loaded
    // chunks as compact static snapshots and render them as ghost terrain far
    // beyond the real render distance. Zero simulation out there — the live
    // simulation radius stays exactly what the user set. Tuned per tier below.
    extendedView: true,
    extendedViewDistance: 32,
    extendedCacheLimitMB: 512,
    // v1.0.30 — async server-chunk decode: decode chunk packets off the game
    // thread (bounded, relevance-ordered, per-tick apply budget). 0 threads =
    // auto by hardware (1..3); stands down when Sodium is present.
    asyncChunkDecode: true,
    decodeThreads: 0
  }
  const slowStorage = hw?.storage.type === 'HDD'
  if (tier === 'potato') {
    return { ...base, reduceVisualEffects: true, smartRdCap: slowStorage ? 8 : 10, entityAnimDistance: 32, lodDistance: 48, maxFps: 60, extendedViewDistance: 16, extendedCacheLimitMB: 256 }
  }
  if (tier === 'balanced') {
    return { ...base, smartRdCap: slowStorage ? 10 : 12, entityAnimDistance: 48, lodDistance: 64, maxFps: 260, extendedViewDistance: 16, extendedCacheLimitMB: 512 }
  }
  if (tier === 'high') {
    return { ...base, reduceParticles: false, simplifyClouds: false, limitEntityAnimations: false, smartRdCap: 16, entityAnimDistance: 64, lodDistance: 96, maxFps: 260, extendedViewDistance: 24, extendedCacheLimitMB: 768 }
  }
  // Turbo — maximum FPS, clearly a trade-off preset (never the default).
  // Note: limitEntityAnimations stays OFF — the v1.0.1 bundled mod removed the
  // entity-animation state cache because it caused the enchantment glint
  // artifact; Turbo must not re-enable that broken path. It trades geometry,
  // particles and LOD instead. Turbo still keeps a safe frame cap — "unlimited"
  // is a separate, explicitly-warned opt-in (`unlimitedFps`), never a default.
  return {
    ...base,
    reduceVisualEffects: true,
    limitEntityAnimations: false,
    smartRdCap: slowStorage ? 6 : 8,
    entityAnimDistance: 24,
    lodDistance: 32,            // far terrain simplified much sooner
    asyncChunkUpload: true,
    overdrawReduction: true,
    textureBatching: true,
    fogDistanceCutoff: true,    // fog-assisted distance cutoff for distant terrain
    particleDensity: 0.25,      // quarter-density particles
    maxFps: 260,
    extendedViewDistance: 8,    // Turbo keeps the extra radius small — fidelity
    extendedCacheLimitMB: 256   // trades for absolute FPS
  }
}

/** Tier-tuned JVM flags (G1GC tuning + preset hand-off). Memory is added by the launcher. */
export function jvmFlagsFor(tier: PerfTier): string[] {
  // v1.0.34 — periodic-stutter pass: tighten the G1 pause target further
  // (measured PROF data showed gcMs spikes coinciding with recurring
  // 60→30→60 FPS drops). Lower pause goals make G1 run smaller, more
  // frequent young collections instead of one visible large pause.
  const pause = tier === 'potato' || tier === 'turbo' ? 35 : tier === 'balanced' ? 45 : 60
  const newSize = tier === 'potato' || tier === 'turbo' ? 25 : 30
  const maxNewSize = tier === 'potato' || tier === 'turbo' ? 50 : 60
  const presetId = tier === 'potato' ? 0 : tier === 'balanced' ? 1 : tier === 'high' ? 2 : 3
  return [
    '-XX:+UseG1GC',
    '-XX:MaxGCPauseMillis=' + pause,
    '-XX:+UnlockExperimentalVMOptions',
    '-XX:G1NewSizePercent=' + newSize,
    '-XX:G1MaxNewSizePercent=' + maxNewSize,
    '-Dreimagined.preset=' + presetId,
    '-XX:+ParallelRefProcEnabled',
    '-XX:+UseStringDeduplication',
    // Turbo also trims GC work for the absolute-lowest-latency frames.
    ...(tier === 'turbo' ? ['-XX:+UseCompressedOops', '-XX:+DisableExplicitGC'] : [])
  ]
}

/** Vanilla's real framerateLimit slider values (10..260). */
const VANILLA_FPS_STEPS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 144, 160, 180, 240, 260]

/** Snap a target FPS to the nearest vanilla framerateLimit value (>= 60). */
function snapFpsCap(target: number): number {
  const t = Math.max(60, Math.min(260, target))
  let best = 120
  for (const step of VANILLA_FPS_STEPS) {
    if (Math.abs(step - t) < Math.abs(best - t)) best = step
  }
  return best
}

/**
 * Write the engine's frame-rate cap into the instance's real `options.txt`
 * (vanilla key `maxFps`, valid range 10..260 where 260 = "Unlimited"). Called
 * on every launch so the game NEVER starts with an unbounded GPU load by
 * default. Minecraft reads options.txt at startup and rewrites it on exit,
 * so re-applying it here each launch is the correct, real mechanism.
 */
export function applyFrameCap(gameDir: string, maxFps: number): void {
  if (maxFps >= 260) return // v1.0.41 — uncapped default; nothing to enforce
  // v1.0.19 settings persistence: snapshot options.txt (at most once a day)
  // before the per-launch cap write so the user's settings are always
  // recoverable — the cap edit itself only rewrites the maxFps line.
  void import('../minecraft/config-guard').then((m) => m.configGuard.backupOptionsTxt(gameDir)).catch(() => {})
  try {
    const file = path.join(gameDir, 'options.txt')
    const cap = snapFpsCap(maxFps)
    let content = ''
    try {
      content = fs.readFileSync(file, 'utf-8')
    } catch {
      content = ''
    }
    const capped = content.replace(/^maxFps:.*$/m, `maxFps:${cap}`)
    if (capped === content) {
      fs.writeFileSync(file, content + `\nmaxFps:${cap}\n`, 'utf-8')
    } else {
      fs.writeFileSync(file, capped, 'utf-8')
    }
    logger.info(`RPE: frame-rate cap ${cap} FPS applied for this session.`)
  } catch (err) {
    logger.warn('RPE: could not apply frame-rate cap: ' + (err as Error).message)
  }
}

/* ------------------------------ sessions & learning ------------------------------ */

interface TuningState {
  renderDistanceCap: number
  lastAvgFps: number
  sessionsLearned: number
}

function defaultTuning(): TuningState {
  return { renderDistanceCap: 12, lastAvgFps: 0, sessionsLearned: 0 }
}

async function loadTuning(): Promise<TuningState> {
  const t = await readJson<Partial<TuningState> | null>(TUNING_FILE(), null)
  return { ...defaultTuning(), ...(t ?? {}) }
}

async function saveTuning(t: TuningState): Promise<void> {
  try {
    await writeJson(TUNING_FILE(), t)
  } catch {
    /* best-effort */
  }
}

async function loadSessions(): Promise<PerfSessionMetrics[]> {
  const s = await readJson<PerfSessionMetrics[] | null>(SESSIONS_FILE(), null)
  return Array.isArray(s) ? s : []
}

/**
 * Parse the game's PERF reporter lines out of a session log and record a
 * real measured session (skipping the boot window). Never fakes data - if
 * there are no measurements, nothing is recorded.
 */
export async function recordSessionFromLog(profileId: string, profileName: string, logPath: string | null): Promise<void> {
  if (!logPath) return
  try {
    if (!fs.existsSync(logPath)) return
    const text = fs.readFileSync(logPath, 'utf-8')
    // Backward-compatible: the 30s PERF line (avg/low/heap/frames) still
    // parses; the v1.0.15 10s PROF line adds the real frame-time statistics
    // (1%/0.1% lows, max frame ms, tick ms, GC ms) that identify stutter
    // instead of guessing at it.
    const re = /PERF avg=([\d.]+) low=([\d.]+) heapMB=([\d.]+) frames=(\d+)/g
    const profRe = /PROF avg=([\d.]+) low=([\d.]+) p1=([\d.]+) p01=([\d.]+) maxMs=([\d.]+) tickMs=([\d.]+) gcMs=(\d+) frames=(\d+) heapMB=([\d.]+)/g
    const windows: { avg: number; low: number; heap: number; frames: number; p1?: number; p01?: number; maxMs?: number; tickMs?: number; gcMs?: number }[] = []
    let m: RegExpExecArray | null
    while ((m = profRe.exec(text)) !== null) {
      windows.push({
        avg: Number(m[1]), low: Number(m[2]), heap: Number(m[10]), frames: Number(m[8]),
        p1: Number(m[3]), p01: Number(m[4]), maxMs: Number(m[5]), tickMs: Number(m[6]), gcMs: Number(m[7])
      })
    }
    if (windows.length === 0) {
      while ((m = re.exec(text)) !== null) {
        windows.push({ avg: Number(m[1]), low: Number(m[2]), heap: Number(m[3]), frames: Number(m[4]) })
      }
    }
    if (windows.length === 0) return
    // Skip the first window (boot + world load are not representative).
    const clean = windows.length > 1 ? windows.slice(1) : windows
    const avgFps = clean.reduce((s, w) => s + w.avg, 0) / clean.length
    const lowFps = Math.min(...clean.map((w) => w.low))
    const heapMB = clean.reduce((s, w) => s + w.heap, 0) / clean.length
    const frames = clean.reduce((s, w) => s + w.frames, 0)
    const rich = clean.filter((w) => w.p1 !== undefined)
    const session: PerfSessionMetrics = {
      at: new Date().toISOString(),
      profileId,
      profileName: profileName || 'Unknown profile',
      avgFps: Math.round(avgFps * 10) / 10,
      lowFps: Math.round(lowFps * 10) / 10,
      heapMB: Math.round(heapMB),
      frames,
      durationSec: 0,
      // v1.0.15 profiler fields (when PROF lines were present).
      ...(rich.length > 0
        ? {
            p1Fps: Math.round((rich.reduce((s, w) => s + (w.p1 ?? 0), 0) / rich.length) * 10) / 10,
            p01Fps: Math.round((rich.reduce((s, w) => s + (w.p01 ?? 0), 0) / rich.length) * 10) / 10,
            maxFrameMs: Math.round(Math.max(...rich.map((w) => w.maxMs ?? 0)) * 10) / 10,
            avgTickMs: Math.round((rich.reduce((s, w) => s + (w.tickMs ?? 0), 0) / rich.length) * 10) / 10,
            gcMs: Math.round(rich.reduce((s, w) => s + (w.gcMs ?? 0), 0))
          }
        : {})
    }

    const sessions = await loadSessions()
    sessions.unshift(session)
    await writeJson(SESSIONS_FILE(), sessions.slice(0, MAX_SESSIONS)).catch(() => {})

    // Self-learning: nudge the render distance cap toward a healthy target.
    const tuning = await loadTuning()
    if (avgFps < 40 && tuning.renderDistanceCap > 6) {
      tuning.renderDistanceCap = Math.max(6, tuning.renderDistanceCap - 2)
      logger.info('RPE self-learn: avg ' + avgFps.toFixed(0) + ' FPS below target - render distance cap lowered to ' + tuning.renderDistanceCap)
    } else if (avgFps > 110 && tuning.renderDistanceCap < 24) {
      tuning.renderDistanceCap = Math.min(24, tuning.renderDistanceCap + 1)
      logger.info('RPE self-learn: avg ' + avgFps.toFixed(0) + ' FPS - headroom, render distance cap raised to ' + tuning.renderDistanceCap)
    }
    tuning.lastAvgFps = Math.round(avgFps)
    tuning.sessionsLearned += 1
    await saveTuning(tuning)

    logger.info('RPE session recorded: ' + session.profileName + ' - avg ' + session.avgFps + ' FPS, low ' + session.lowFps + ', ' + session.heapMB + ' MB heap (' + clean.length + ' windows)')
  } catch (err) {
    logger.warn('RPE session recording failed: ' + (err as Error).message)
  }
}

/* ------------------------------ status & recommendations ------------------------------ */

export async function perfStatus(forceDetect = false): Promise<PerfStatus> {
  const hw = await detectHardware(forceDetect)
  const settings = settingsManager.get()
  const { tier, source } = effectiveTier(settings, hw)
  const decision = scoreHardware(hw)
  return {
    hardware: hw,
    tier,
    tierSource: source,
    tierReasons: decision.reasons,
    recommendedMemoryMB: recommendMemoryMB(hw, settings.memory),
    sessions: await loadSessions(),
    tuning: (await loadTuning()) as unknown as Record<string, number>,
    fpsConfig: fpsConfigFor(tier, hw)
  }
}

export async function buildRecommendations(profileId?: string): Promise<PerfRecommendation[]> {
  const hw = await detectHardware(false)
  const settings = settingsManager.get()
  const sessions = await loadSessions()
  const tuning = await loadTuning()
  const { tier } = effectiveTier(settings, hw)
  const auto = scoreHardware(hw)
  const recs: PerfRecommendation[] = []

  // Preset suggestions (only when not manually overridden).
  if (settings.perfTier === 'auto' || settings.perfTier === undefined) {
    if (tier !== settings.preset) {
      recs.push({
        id: 'preset-' + auto.tier,
        title: 'Apply the "' + auto.tier + '" profile for your hardware',
        detail: auto.reasons.join(' '),
        category: 'graphics',
        applyLabel: 'Apply profile'
      })
    }
  }

  // Memory: recommend based on measured heap pressure.
  const recMem = recommendMemoryMB(hw, settings.memory)
  const recent = sessions[0]
  if (recent && recent.heapMB > 0) {
    const allocated = settings.memory || 4096
    if (recent.heapMB > allocated * 0.8 && recMem > allocated) {
      recs.push({
        id: 'memory-' + recMem,
        title: 'Increase memory to ' + Math.round(recMem / 1024) + ' GB',
        detail: 'Your last session used ' + recent.heapMB + ' MB of the ' + Math.round(allocated / 1024) + ' GB allocated - the engine suggests ' + Math.round(recMem / 1024) + ' GB.',
        category: 'memory',
        applyLabel: 'Use ' + Math.round(recMem / 1024) + ' GB'
      })
    }
  } else if (settings.memory < recMem - 1024) {
    recs.push({
      id: 'memory-' + recMem,
      title: 'Set the default memory to ' + Math.round(recMem / 1024) + ' GB',
      detail: 'Your machine has ' + (hw?.memory.totalGB ?? '?') + ' GB of RAM - ' + Math.round(recMem / 1024) + ' GB is the recommended heap for new profiles.',
      category: 'memory',
      applyLabel: 'Use ' + Math.round(recMem / 1024) + ' GB'
    })
  }

  // Self-learning nudges.
  if (tuning.sessionsLearned > 0 && tuning.renderDistanceCap < (tier === 'high' ? 16 : tier === 'balanced' ? 12 : 10)) {
    recs.push({
      id: 'cap-lower',
      title: 'Keep render distance capped at ' + tuning.renderDistanceCap,
      detail: 'Learned from ' + tuning.sessionsLearned + ' measured session(s): your PC stays smooth with the engine auto render-distance cap of ' + tuning.renderDistanceCap + '.',
      category: 'graphics',
      applyLabel: 'Keep cap'
    })
  }

  // System-level advice (always actionable but non-blocking).
  if (!hw?.java) {
    recs.push({
      id: 'java-missing',
      title: 'No Java detected - one will be downloaded automatically',
      detail: 'The launcher downloads a compatible Java runtime on your first launch, so you never need to install Java manually.',
      category: 'java',
      applyLabel: 'OK'
    })
  }
  if (hw?.storage.type === 'HDD') {
    recs.push({
      id: 'hdd',
      title: 'HDD detected - lighter chunk settings',
      detail: 'The engine already keeps chunk streaming light on HDD storage. An SSD would speed up world loading noticeably.',
      category: 'system',
      applyLabel: 'Got it'
    })
  }
  if (hw?.laptop && hw.gpu[0]?.integrated && tier !== 'potato') {
    recs.push({
      id: 'laptop-integrated',
      title: 'Laptop with integrated graphics',
      detail: 'The balanced profile balances battery, thermals and visuals. Lowering to Potato squeezes more battery life.',
      category: 'system',
      applyLabel: 'Keep balanced'
    })
  }

  // Performance mods (only when a compatible profile is selected).
  if (profileId) {
    try {
      const { listPerfMods } = await import('./mods')
      const result = await listPerfMods(profileId)
      const missing = result.mods.filter((mo) => !mo.installed && mo.compatible).slice(0, 2)
      for (const mo of missing) {
        recs.push({
          id: 'mod-' + mo.slug,
          title: 'Install ' + mo.title,
          detail: mo.note + ' - a trusted, compatible performance mod for this profile. You choose - nothing installs without your click.',
          category: 'mods',
          applyLabel: 'Install',
          profileId,
          projectId: mo.projectId
        })
      }
    } catch {
      /* mods listing is optional */
    }
  }

  return recs
}

/** Apply a recommendation. Never throws - returns a human message. */
export async function applyRecommendation(payload: { id?: string; profileId?: string }): Promise<{ ok: boolean; message: string }> {
  const id = payload?.id ?? ''
  try {
    if (id.startsWith('preset-')) {
      const tier = id.replace('preset-', '') as PerfTier
      await settingsManager.update({ preset: tier, perfTier: tier })
      logger.info('RPE: applied preset "' + tier + '"')
      return { ok: true, message: 'Performance profile set to ' + tier + '.' }
    }
    if (id.startsWith('memory-')) {
      const mb = Number(id.replace('memory-', ''))
      if (mb > 0) {
        await settingsManager.update({ memory: mb })
        logger.info('RPE: default memory set to ' + mb + ' MB')
        return { ok: true, message: 'Default memory set to ' + Math.round(mb / 1024) + ' GB.' }
      }
    }
    if (id === 'cap-lower' || id === 'hdd' || id === 'laptop-integrated' || id === 'java-missing') {
      return { ok: true, message: 'Noted - no change needed.' }
    }
    if (id.startsWith('mod-')) {
      const { installPerfMod } = await import('./mods')
      if (!payload.profileId) return { ok: false, message: 'Select a profile to install mods into.' }
      await installPerfMod
      await installPerfMod(payload.profileId, id.replace('mod-', ''))
      logger.info('RPE: installed perf mod ' + id + ' into ' + payload.profileId)
      return { ok: true, message: 'Mod installed - it will be enabled the next time you play.' }
    }
    return { ok: false, message: 'Unknown recommendation.' }
  } catch (err) {
    logger.warn('RPE apply recommendation failed (' + id + '): ' + (err as Error).message)
    return { ok: false, message: (err as Error).message }
  }
}

export const engine = { detectHardware, scoreHardware, recommendMemoryMB, effectiveTier, fpsConfigFor, jvmFlagsFor, perfStatus, buildRecommendations, applyRecommendation, recordSessionFromLog, applyFrameCap }
