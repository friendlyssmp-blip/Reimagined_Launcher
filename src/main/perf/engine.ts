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
import os from 'node:os'
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
  // down to ~100-120. The safe cap is now OPT-IN ONLY; ALL tiers (potato
  // included) default to 260 (vanilla "Unlimited"). The user can still enable
  // a cap in Settings.
  // v1.0.41 — the monitor-refresh-derived safeCap is intentionally unused now:
  // the default is Unlimited (260) except on potato (60 for thermal safety).
  const base = {
    enabled: true,
    reduceParticles: true,
    simplifyClouds: true,
    // v1.0.64 — the bundled mod's entity-animation extraction cache is the
    // modern rewrite (per-tick cleared, near-distance exempt, crowd-aware);
    // the old v1.0.1 glint artifact no longer applies. On by default so the
    // density-aware crowd budget actually works (a real CPU win for packed
    // mob/item farms). Toggleable in-game.
    limitEntityAnimations: true,
    // v1.0.19/1.0.64 — particle occlusion culling (Cull-Particles style):
    // particles inside solid-render blocks are dropped before ticking +
    // rendering. The big TNT/explosion win; density-gated (>=120 in a group).
    occludeParticles: true,
    // v1.0.21 — same sweep also drops particles beyond 128 blocks (sub-pixel
    // storm rain at the horizon, distant farm ambient). On by default.
    particleDistanceCull: true,
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
    // vanilla "Unlimited". v1.0.44: even potato no longer forces 60 — a weak
    // iGPU can still run vanilla uncapped far above 60 (screen-tear risk only),
    // and the cap silently confused users into thinking their GPU was bad.
    unlimitedFps: false,
    maxFps: 260,
    // v1.0.30 — async server-chunk decode: decode chunk packets off the game
    // thread (bounded, relevance-ordered, per-tick apply budget). 0 threads =
    // auto by hardware (1..3); stands down when Sodium is present.
    asyncChunkDecode: true,
    decodeThreads: 0
  }
  const slowStorage = hw?.storage.type === 'HDD'
  if (tier === 'potato') {
    // v1.0.98 — Stutter Guard replaces the v1.0.44 uncapped potato: running
    // 200+ FPS on a 2C/4T iGPU laptop (60 Hz panel) buries the CPU in GC churn
    // — the measured multi-second freezes. 120 is still double the refresh
    // rate and visually identical, but halves allocation/heat. Everything else
    // stays conservative (RD 8-10, LOD 48, reduced FX).
    return { ...base, reduceVisualEffects: true, smartRdCap: slowStorage ? 8 : 10, entityAnimDistance: 32, lodDistance: 48, maxFps: 120 }
  }
  if (tier === 'balanced') {
    return { ...base, smartRdCap: slowStorage ? 10 : 12, entityAnimDistance: 48, lodDistance: 64, maxFps: 260 }
  }
  if (tier === 'high') {
    return { ...base, reduceParticles: false, simplifyClouds: false, smartRdCap: 16, entityAnimDistance: 64, lodDistance: 96, maxFps: 260 }
  }
  // Turbo — maximum FPS, clearly a trade-off preset (never the default).
  // Turbo keeps a safe frame cap — "unlimited" is a separate, explicitly-
  // warned opt-in (`unlimitedFps`), never a default.
  return {
    ...base,
    reduceVisualEffects: true,
    smartRdCap: slowStorage ? 6 : 8,
    entityAnimDistance: 24,
    lodDistance: 32,            // far terrain simplified much sooner
    asyncChunkUpload: true,
    overdrawReduction: true,
    textureBatching: true,
    fogDistanceCutoff: true,    // fog-assisted distance cutoff for distant terrain
    particleDensity: 0.25,      // quarter-density particles
    // v1.0.98 — Stutter Guard on the most thread-starved tier (see potato note).
    maxFps: 120,

  }
}

/** Tier-tuned JVM flags (GC choice + tuning + preset hand-off). Memory is added by the launcher. */
export function jvmFlagsFor(tier: PerfTier): string[] {
  // v1.0.34 — periodic-stutter pass: tighten the GC pause target further
  // (measured PROF data showed gcMs spikes coinciding with recurring
  // 60→30→60 FPS drops). Lower pause goals make the collector run smaller,
  // more frequent young collections instead of one visible large pause.
  const pause = tier === 'potato' || tier === 'turbo' ? 35 : tier === 'balanced' ? 45 : 60
  const newSize = tier === 'potato' || tier === 'turbo' ? 25 : 30
  const maxNewSize = tier === 'potato' || tier === 'turbo' ? 50 : 60
  const presetId = tier === 'potato' ? 0 : tier === 'balanced' ? 1 : tier === 'high' ? 2 : 3
  // v1.0.64 — GC thread caps for weak CPUs: on a 4-thread machine G1 defaults
  // to ~4 parallel GC threads, so a collection pause pre-empts the game AND
  // the integrated server at the same time — the micro-hitches seen in
  // chunk-heavy moments (ocean/world load, TNT chains). Capping GC threads
  // leaves cores for the game; generous caps on strong machines (never more
  // than 4/2) so a beefy PC loses nothing.
  const cores = Math.max(1, os.cpus().length)
  const lowCore = cores <= 4
  // v1.0.68 — GC choice by core count, driven by REAL PROF data: on a
  // 4-thread iGPU laptop G1 spent up to 2.8s of a 10s window in GC with
  // 100-137ms pauses. G1's concurrent marking phase contends with the game
  // AND the integrated server on few threads; ParallelGC (parallel STW,
  // NO concurrent phase, soft pause goal via the adaptive size policy) is
  // measurably smoother there. Strong machines keep G1 (concurrent
  // collection wins on big heaps with threads to spare).
  const useParallel = tier === 'potato' || tier === 'turbo' || (tier === 'balanced' && lowCore)
  // v1.0.71 — ParallelGC path caps at 2 threads on ALL low-core tiers: these
  // machines have <=4 logical threads (often 2 PHYSICAL cores, e.g. the
  // i3-2120 2C/4T test PC), and hyperthreading gives a parallel GC pause no
  // speedup beyond 2 workers — 3 threads just spreads the same work thinner
  // while the game + integrated server sit stopped. G1 path (balanced-with-
  // cores, high): 4 — never more than cores.
  const pgc = useParallel ? Math.min(2, cores) : Math.min(4, cores)
  const cgc = Math.max(1, Math.min(2, cores))
  const flags: string[] = [
    '-Dreimagined.preset=' + presetId,
    '-XX:+ParallelRefProcEnabled',
    '-XX:+UseStringDeduplication',
  ]
  if (useParallel) {
    // No concurrent marking phase, no ConcGCThreads — every core stays on
    // the game + integrated server. MaxGCPauseMillis is a soft goal for
    // ParallelGC's adaptive size policy (UseAdaptiveSizePolicy, default on).
    flags.push(
      '-XX:+UseParallelGC',
      '-XX:ParallelGCThreads=' + Math.max(1, pgc),
      '-XX:MaxGCPauseMillis=' + pause,
    )
  } else {
    flags.push(
      '-XX:+UseG1GC',
      '-XX:MaxGCPauseMillis=' + pause,
      '-XX:ParallelGCThreads=' + Math.max(1, pgc),
      '-XX:ConcGCThreads=' + Math.max(1, cgc),
      '-XX:+UnlockExperimentalVMOptions',
      '-XX:G1NewSizePercent=' + newSize,
      '-XX:G1MaxNewSizePercent=' + maxNewSize,
    )
    // v1.0.68 — balanced-tier G1 hardening: 1MB regions make young
    // collections cheaper and more targeted on modest heaps, and starting
    // mixed collections earlier avoids the huge full GC that showed up as
    // 100-137ms pauses in the PROF data. High tier keeps the proven set.
    if (tier === 'balanced') {
      flags.push('-XX:G1HeapRegionSize=1M', '-XX:InitiatingHeapOccupancyPercent=45')
    }
  }
  // Turbo also trims GC work for the absolute-lowest-latency frames.
  if (tier === 'turbo') flags.push('-XX:+UseCompressedOops', '-XX:+DisableExplicitGC')
  return flags
}

/**
 * v1.0.74 — heap cap for low-core ParallelGC machines. A full GC with
 * ParallelGC is fully stop-the-world, and on a 2C/4T iGPU laptop an
 * oversized heap makes it a multi-second freeze (measured: 8GB heap ->
 * gcMs=3607, tickMs=5165, "Can't keep up! 102 ticks behind" in real PROF
 * data). Real usage is ~1-2GB, so capping at 4GB keeps the worst-case
 * pause short without ever hitting the ceiling. Strong machines (G1,
 * concurrent collection) keep whatever the user asked for.
 */
export function recommendedHeapFor(tier: PerfTier, cores: number, requestedXmx: number): number {
  const lowCore = cores <= 4
  const parallel = tier === 'potato' || tier === 'turbo' || (tier === 'balanced' && lowCore)
  if (parallel) {
    return Math.max(1024, Math.min(requestedXmx, 4096))
  }
  return requestedXmx
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
  // v1.0.42 — the uncapped path (>= 260) must STILL write options.txt: a stale
  // maxFps persisted by an older launcher (e.g. maxFps:60) would otherwise
  // silently cap every launch through vanilla's options.txt read at startup.
  // 260 is vanilla's "Unlimited" value, so writing it neutralizes old caps.
  const cap = maxFps >= 260 ? 260 : snapFpsCap(maxFps)
  // v1.0.19 settings persistence: snapshot options.txt (at most once a day)
  // before the per-launch cap write so the user's settings are always
  // recoverable — the cap edit itself only rewrites the maxFps line.
  void import('../minecraft/config-guard').then((m) => m.configGuard.backupOptionsTxt(gameDir)).catch(() => {})
  try {
    const file = path.join(gameDir, 'options.txt')
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

/**
 * v2.0.2 — make chunk saves non-blocking on weak tiers. Vanilla's
 * `syncChunkWrites:true` writes every chunk synchronously on the SERVER
 * thread; on a 2C/4T CPU a full autosave (all dimensions) turns into a
 * 1.5-3 s stall + ParallelGC full collection — the measured "chest opens
 * seconds later" freeze (PROF data: gcMs up to 5199, maxMs 2900, "Can't
 * keep up" 10.5 s behind). Setting it to false moves the writes to
 * background threads; the game waits for pending writes on quit, so data
 * safety is unchanged. Rewritten on every launch (the game owns the file
 * and overwrites it on exit) — same mechanism as applyFrameCap.
 */
export function applySyncChunkWrites(gameDir: string, asyncWrites: boolean): void {
  try {
    const file = path.join(gameDir, 'options.txt')
    let content = ''
    try {
      content = fs.readFileSync(file, 'utf-8')
    } catch {
      content = ''
    }
    const value = asyncWrites ? 'false' : 'true'
    const patched = content.replace(/^syncChunkWrites:.*$/m, 'syncChunkWrites:' + value)
    if (patched === content) {
      const sep = content && !content.endsWith('\n') ? '\n' : ''
      fs.writeFileSync(file, content + sep + 'syncChunkWrites:' + value + '\n', 'utf-8')
    } else {
      fs.writeFileSync(file, patched, 'utf-8')
    }
    logger.info('RPE: syncChunkWrites=' + value + ' for this session (async chunk writes on weak tier).')
  } catch (err) {
    logger.warn('RPE: could not apply syncChunkWrites: ' + (err as Error).message)
  }
}

/**
 * v1.0.43 — force VSync off in an instance's real options.txt. A 60 Hz panel
 * with VSync on caps the game at 60 FPS regardless of the frame cap, so when
 * the user enables "force VSync off" the launcher rewrites the enableVsync
 * line on every launch. Never touches any other setting.
 */
export function applyVsyncSetting(gameDir: string, forceOff: boolean): void {
  if (!forceOff) return
  try {
    const file = path.join(gameDir, 'options.txt')
    let content = ''
    try {
      content = fs.readFileSync(file, 'utf-8')
    } catch {
      content = ''
    }
    const patched = content.replace(/^enableVsync:.*$/m, 'enableVsync:false')
    if (patched === content) {
      const sep = content && !content.endsWith('\n') ? '\n' : ''
      fs.writeFileSync(file, content + sep + 'enableVsync:false\n', 'utf-8')
    } else {
      fs.writeFileSync(file, patched, 'utf-8')
    }
    logger.info('RPE: VSync forced off for this session (user setting).')
  } catch (err) {
    logger.warn('RPE: could not force VSync off: ' + (err as Error).message)
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
    // v1.0.65 — the PROF line is parsed as key=value TOKENS, not a positional
    // regex. The old regex skipped p95/p99 so it never matched the real line
    // and the rich stutter metrics (1%/0.1% lows, max frame ms, tick ms,
    // GC ms) were silently never recorded. A token parser is robust to the
    // mod reordering/adding/removing fields — the exact fragility that caused
    // the original silent failure can't recur.
    const profRe = /\bPROF\b[^\n]*/g
    const windows: { avg: number; low: number; heap: number; frames: number; p1?: number; p01?: number; maxMs?: number; tickMs?: number; gcMs?: number }[] = []
    let m: RegExpExecArray | null
    while ((m = profRe.exec(text)) !== null) {
      const kv: Record<string, string> = {}
      for (const token of m[0].split(' ')) {
        const eq = token.indexOf('=')
        if (eq > 0) kv[token.slice(0, eq)] = token.slice(eq + 1)
      }
      const avg = Number(kv['avg'])
      if (Number.isNaN(avg)) continue
      const w: { avg: number; low: number; heap: number; frames: number; p1?: number; p01?: number; maxMs?: number; tickMs?: number; gcMs?: number } = {
        avg,
        low: kv['low'] !== undefined ? Number(kv['low']) : avg,
        heap: kv['heapMB'] !== undefined ? Number(kv['heapMB']) : 0,
        frames: kv['frames'] !== undefined ? Number(kv['frames']) : 0
      }
      if (kv['p1'] !== undefined) w.p1 = Number(kv['p1'])
      if (kv['p01'] !== undefined) w.p01 = Number(kv['p01'])
      if (kv['maxMs'] !== undefined) w.maxMs = Number(kv['maxMs'])
      if (kv['tickMs'] !== undefined) w.tickMs = Number(kv['tickMs'])
      if (kv['gcMs'] !== undefined) w.gcMs = Number(kv['gcMs'])
      windows.push(w)
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

export const engine = { detectHardware, scoreHardware, recommendMemoryMB, effectiveTier, fpsConfigFor, jvmFlagsFor, perfStatus, buildRecommendations, applyRecommendation, recordSessionFromLog, applyFrameCap, applySyncChunkWrites }
