/**
 * v1.0.92 — "Run a FPS Test" (Account → Run a FPS Test).
 *
 * Orchestrates a REAL, measurable Minecraft performance benchmark on the
 * user's chosen instance:
 *
 *   1. The user picks an instance (validated: exists, Fabric, FPS Boost
 *      compatible, can launch).
 *   2. A dedicated benchmark world (`reimagined-bench`) is generated once
 *      per instance (never touches real user worlds).
 *   3. `benchmark-request.json` is dropped into the instance's game dir —
 *      the bundled FPS Boost mod's BenchmarkDriver watches for it.
 *   4. The instance launches with `--quickPlaySingleplayer` straight into
 *      the benchmark world; the in-game driver runs every test, sampling
 *      REAL FPS once per second and recording the LOWEST value per test,
 *      writing progress + final results JSON into the game dir.
 *   5. The launcher polls the progress file (UI shows the live test name +
 *      progress + lowest FPS so far) and, when the game quits itself after
 *      finishing, reads the results and generates the plain-text report.
 *
 * Nothing is ever invented: a test that could not be measured reports N/A.
 * The report template matches the product spec exactly (plain .txt, `=`
 * between every test name and result, lowest FPS shown per test).
 */
import path from 'node:path'
import fs from 'node:fs'
import { paths, appVersion } from '../paths'
import { instancePath } from '../instances/paths'
import { profileManager } from '../profiles/profile-manager'
import { logger } from '../logs/logger'
import { ensureBenchWorld } from './world'
import { fpsBoostInstalled } from '../mods/fps-boost'
import { detectHardware } from '../perf/hardware'
import type { Profile } from '@shared/types'

const REQUEST_FILE = 'benchmark-request.json'
const PROGRESS_FILE = 'benchmark-progress.json'
const RESULTS_FILE = 'benchmark-results.json'
const BENCH_WORLD = 'reimagined-bench'

/** In-memory state of the currently running benchmark (one at a time). */
export interface FpsTestStatus {
  profileId: string
  profileName: string
  startedAt: number
  stage: 'world' | 'launching' | 'running' | 'finished' | 'failed'
  message: string
  currentTest: string
  progress: number
  lowestFps: number | null
  resultPath: string | null
  error: string | null
}

let run: FpsTestStatus | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null

/* ---------------------------------- public ---------------------------------- */

/** Instances eligible for the FPS test: Fabric + FPS Boost shipped. */
export async function listBenchmarkProfiles(): Promise<
  { id: string; name: string; minecraftVersion: string; loader: string; modCount: number; fpsBoost: boolean }[]
> {
  const profiles = await profileManager.list()
  return profiles
    .filter((p) => p.loader?.type === 'fabric' && fpsBoostInstalled(p))
    .map((p) => ({
      id: p.id,
      name: p.name,
      minecraftVersion: p.minecraftVersion,
      loader: p.loader?.version ?? 'fabric',
      modCount: p.mods?.length ?? 0,
      fpsBoost: true
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Current benchmark status (polled by the UI every second). */
export function fpsTestStatus(): FpsTestStatus | null {
  return run
}

/**
 * Start the FPS test on the given instance. The game process exits itself
 * when the benchmark completes; call `fpsTestResults()` afterwards.
 */
export async function startFpsTest(profileId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (run && run.stage !== 'finished' && run.stage !== 'failed') {
    return { ok: false, error: 'A FPS test is already running. Wait for it to finish first.' }
  }

  const profile = await profileManager.get(profileId)
  if (!profile) return { ok: false, error: 'The selected instance no longer exists.' }
  if (profile.loader?.type !== 'fabric') {
    return { ok: false, error: 'The FPS test requires a Fabric instance (FPS Boost only supports Fabric).' }
  }
  if (!fpsBoostInstalled(profile)) {
    return { ok: false, error: 'FPS Boost is not installed on this instance — install it from the Mods page first.' }
  }

  run = {
    profileId: profile.id,
    profileName: profile.name,
    startedAt: Date.now(),
    stage: 'world',
    message: 'Preparing benchmark world…',
    currentTest: 'Preparing',
    progress: 0,
    lowestFps: null,
    resultPath: null,
    error: null
  }

  try {
    const gameDir = instancePath(profile)
    fs.mkdirSync(path.join(gameDir, 'mods'), { recursive: true })

    // 1) Deterministic benchmark world (dedicated server, one-time).
    await ensureBenchWorld(profile, BENCH_WORLD, (m) => {
      if (run) run.message = m.trim()
      logger.info(`[FPS Test] ${m}`)
    })

    // 2) Drop the request file the in-game driver watches for.
    fs.writeFileSync(
      path.join(gameDir, REQUEST_FILE),
      JSON.stringify(
        {
          profileId: profile.id,
          world: BENCH_WORLD,
          version: appVersion,
          startedAt: Date.now()
        },
        null,
        2
      )
    )

    // 3) Launch with quickPlay into the benchmark world.
    run.stage = 'launching'
    run.message = 'Launching the benchmark instance…'
    const quickPlay = [
      `--quickPlaySingleplayer ${BENCH_WORLD}`,
      `--quickPlayPath ${path.join(gameDir, 'quickplay.log')}`
    ].join(' ')

    const savedArgs = profile.extraGameArgs ?? ''
    await profileManager.update(profile.id, { extraGameArgs: quickPlay })
    const fresh = await profileManager.get(profile.id)
    if (!fresh) throw new Error('profile disappeared during launch')
    const { launcher } = await import('../minecraft/launcher')

    let handle: { running: boolean } | null = null
    try {
      handle = await launcher.launch(fresh.id)
      if (!handle.running) throw new Error('the game process did not start')
    } finally {
      // Restore the user's args immediately — quickPlay is only for this run.
      await profileManager.update(profile.id, { extraGameArgs: savedArgs }).catch(() => {})
    }

    run.stage = 'running'
    run.message = 'Benchmark started — waiting for the game to enter the world…'

    // 4+5) Poll progress, game-exit and completion.
    startPolling(profile.id, gameDir)
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.exception('FPS test failed to start', err)
    if (run) {
      run.stage = 'failed'
      run.error = msg
      run.message = 'Failed to start the FPS test.'
    }
    return { ok: false, error: msg }
  }
}

/** Stop a running benchmark (kills the game + cancels polling). */
export async function cancelFpsTest(): Promise<void> {
  stopPolling()
  if (run && run.stage === 'running') {
    const { launcher } = await import('../minecraft/launcher')
    await launcher.stop(run.profileId).catch(() => {})
  }
  if (run) {
    run.stage = 'failed'
    run.message = 'FPS test cancelled.'
    run.error = 'cancelled'
  }
}

/**
 * Read the final results, generate the .txt report and return its path.
 * The game must have finished (or timed out) before calling this.
 */
export async function fpsTestResults(): Promise<{
  reportPath: string | null
  text: string
  raw: Record<string, unknown> | null
  profile: { name: string; minecraftVersion: string; loader: string; modCount: number } | null
}> {
  const empty = {
    reportPath: null,
    text: '',
    raw: null,
    profile: null
  }
  if (!run) return empty

  const profile = await profileManager.get(run.profileId)
  const gameDir = profile ? instancePath(profile) : null
  const resultsPath = gameDir ? path.join(gameDir, RESULTS_FILE) : null

  let raw: Record<string, unknown> | null = null
  if (resultsPath && fs.existsSync(resultsPath)) {
    try {
      raw = JSON.parse(fs.readFileSync(resultsPath, 'utf-8')) as Record<string, unknown>
    } catch {
      raw = null
    }
  }

  const profileInfo = profile
    ? {
        name: profile.name,
        minecraftVersion: profile.minecraftVersion,
        loader: profile.loader?.type ?? 'fabric',
        modCount: profile.mods?.length ?? 0
      }
    : null

  const text = await buildReport(raw, profileInfo, run)
  if (text && profile) {
    const dir = path.join(paths.data, 'fps-tests')
    fs.mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
    const reportPath = path.join(dir, `Reimagined_FPS_Test_${stamp}.txt`)
    fs.writeFileSync(reportPath, text, 'utf-8')
    if (run) run.resultPath = reportPath
    return { reportPath, text, raw, profile: profileInfo }
  }
  return { ...empty, text, raw, profile: profileInfo }
}

/** Absolute path to the last generated report (for "Open Folder"). */
export function fpsTestReportPath(): string | null {
  return run?.resultPath ?? null
}

/* ---------------------------------- internals ---------------------------------- */

function startPolling(profileId: string, gameDir: string): void {
  stopPolling()
  let launchedAt = Date.now()
  pollTimer = setInterval(async () => {
    if (!run || run.profileId !== profileId) return
    try {
      const progressPath = path.join(gameDir, PROGRESS_FILE)
      if (fs.existsSync(progressPath)) {
        const p = JSON.parse(fs.readFileSync(progressPath, 'utf-8'))
        if (typeof p.progress === 'number') run.progress = Math.max(run.progress, p.progress)
        if (typeof p.currentTest === 'string' && p.currentTest) run.currentTest = p.currentTest
        if (typeof p.lastMessage === 'string' && p.lastMessage) run.message = p.lastMessage
        // Live session-lowest FPS — written by the in-game driver every second.
        if (typeof p.lowFpsNow === 'number' && p.lowFpsNow > 0) {
          run.lowestFps = p.lowFpsNow
        }
      }

      const resultsPath = path.join(gameDir, RESULTS_FILE)
      let done = false
      if (fs.existsSync(resultsPath)) {
        try {
          const r = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'))
          done = r?.complete === true
        } catch {
          done = false
        }
      }

      if (done) {
        stopPolling()
        if (run) {
          run.stage = 'finished'
          run.progress = 100
          run.currentTest = 'Complete'
          run.message = 'Benchmark complete — generating report…'
        }
        void finishRun(profileId, gameDir)
        return
      }

      // Watchdog: fail a hung benchmark. The in-game test itself takes
      // ~2.5 minutes plus boot/load; 25 minutes is generous even on slow
      // machines. This catches quickPlay join failures and driver crashes
      // where the game stays alive at the menu forever.
      const { launcher } = await import('../minecraft/launcher')
      if (run.stage === 'running') {
        if (!launcher.isRunning(profileId)) {
          if (Date.now() - launchedAt > 30_000) {
            stopPolling()
            if (run) {
              run.stage = 'failed'
              run.message = 'The game closed before the benchmark finished.'
              run.error = 'game exited early'
            }
          }
        } else if (Date.now() - launchedAt > 25 * 60_000) {
          stopPolling()
          if (run) {
            run.stage = 'failed'
            run.message = 'The benchmark took too long and was stopped.'
            run.error = 'timeout after 25 minutes'
          }
          await launcher.stop(profileId).catch(() => {})
        }
      }
    } catch (err) {
      logger.warn(`[FPS Test] poll error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, 1500)
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

/** Called when the results file reports complete — cleans up run state. */
async function finishRun(profileId: string, gameDir: string): Promise<void> {
  // Remove the request file so a future normal launch is never treated as a
  // benchmark session.
  try {
    fs.rmSync(path.join(gameDir, REQUEST_FILE), { force: true })
  } catch {
    /* best-effort */
  }
}

/* ---------------------------------- report ---------------------------------- */

interface ReportProfileInfo {
  name: string
  minecraftVersion: string
  loader: string
  modCount: number
}

/** Build the plain-text report following the exact product template. */
async function buildReport(
  raw: Record<string, unknown> | null,
  profile: ReportProfileInfo | null,
  state: FpsTestStatus
): Promise<string> {
  const L: string[] = []
  const line = (s = ''): void => void L.push(s)

  const val = (k: string): string => {
    const v = raw?.[k]
    return v === null || v === undefined ? 'N/A' : String(v)
  }
  const fpsVal = (name: string): string => {
    const tests = (raw?.tests as Record<string, { lowFps?: number | null }> | undefined) ?? {}
    const t = tests[name]
    if (!t || t.lowFps === null || t.lowFps === undefined) return 'N/A'
    return String(t.lowFps)
  }

  line(`FPS TEST REIMAGINED LAUNCHER (V${appVersion})`)
  line()
  line('(IMPORTANT NOTE, ONLY THE LOWEST FPS RECORDED WILL BE SHOWN)')
  line()
  line('## TEST OF FPS')
  line()
  line(`- Normal Walking = ${fpsVal('Normal Walking')}`)
  line(`- Fast Flying = ${fpsVal('Fast Flying')}`)
  line(`- New World First FPS = ${val('worldFirstLowFps')}`)
  line(`- New World Load Time = ${val('worldLoadMs') !== 'N/A' ? `${val('worldLoadMs')} ms` : 'N/A'}`)
  line(`- Ocean Chunk Loading = ${fpsVal('Ocean Chunk Loading')}`)
  line(`- 27 TNT Explosion = ${fpsVal('27 TNT Explosion')}`)
  line(`- 125 TNT Explosion = ${fpsVal('125 TNT Explosion')}`)
  line(`- Old Chunk Loading = ${fpsVal('Old Chunk Loading')}`)
  const maxEnt = raw?.maxEntities as { count?: number; lowFps?: number | null } | null | undefined
  line(`- Maximum Entities Before Lag = ${maxEnt ? `${maxEnt.count} / ${maxEnt.lowFps ?? 'N/A'} (entities / lowest FPS)` : 'N/A'}`)
  line(`- Respawn Time = ${val('respawnMs') !== 'N/A' ? `${val('respawnMs')} ms` : 'N/A'}`)
  line(`- Fast Block Breaking = ${fpsVal('Fast Block Breaking')}`)
  line(`- 2-Minute Survival = ${fpsVal('2-Minute Survival')}`)
  line(`- Fast Entity Loading = ${fpsVal('Fast Entity Loading')}`)
  line(`- Creeper Explosion = ${fpsVal('Creeper Explosion')}`)
  line(`- AFK Performance = ${fpsVal('AFK Performance')}`)
  line(`- New World Camera Loading = ${fpsVal('New World Camera Loading')}`)
  line(`- Inventory Opening = ${fpsVal('Inventory Opening')}`)
  line(`- Fast F5 Switching = ${fpsVal('Fast F5 Switching')}`)
  line(`- RTP Chunk Loading = ${fpsVal('RTP Chunk Loading')}`)
  line(`- Minecraft Main Menu = ${val('menuLowFps')}`)
  line(`- Minecraft Startup Time = ${val('startupMs') !== 'N/A' ? `${val('startupMs')} ms` : 'N/A'}`)
  line(`- Instance Selected = ${profile?.name ?? state.profileName ?? 'N/A'}`)
  line(`- Minecraft Version = ${profile?.minecraftVersion ?? 'N/A'}`)
  line(`- Loader = ${profile?.loader ?? 'N/A'}`)
  line(`- Mod Count = ${profile?.modCount ?? 'N/A'}`)
  line()
  line('## SHADER TEST')
  line()
  line(`- Miniature Shader = ${val('miniatureShader')}`)
  line()
  line('## PC SPECS (HARDWARE)')
  line()
  try {
    const hwRaw = detectHardware()
    const hw = hwRaw instanceof Promise ? await hwRaw : hwRaw
    line(`CPU: ${hw?.cpu?.model ?? 'Unknown'} (${hw?.cpu?.cores ?? '?'} cores / ${hw?.cpu?.threads ?? '?'} threads, ${hw?.cpu?.speedGHz ?? '?'} GHz)`)
    line(`GPU: ${hw?.gpu?.map((g) => g.name).join(' + ') || 'Unknown'}`)
    line(`MEMORY: ${hw?.memory?.totalGB ?? '?'} GB${hw?.memory?.speedMHz ? ` ${hw.memory.speedMHz} MHz` : ''}`)
    line(`DISPLAY: ${hw?.display?.resolution ?? 'Unknown'}${hw?.display?.refreshHz ? ` ${hw.display.refreshHz} Hz` : ''}`)
    const st = hw?.storage
    line(`STORAGE: ${st?.drive ?? 'Unknown'} (${st?.totalGB ?? '?'} GB total${st?.freeGB ? `, ${st.freeGB} GB free` : ''})`)
    line(`JAVA: ${hw?.java?.version ?? 'Unknown'}`)
    line(`SYSTEM: ${hw?.os ?? 'Unknown'}`)
  } catch {
    line('CPU: Unknown')
    line('GPU: Unknown')
    line('MEMORY: Unknown')
    line('DISPLAY: Unknown')
    line('STORAGE: Unknown')
    line('JAVA: Unknown')
    line('SYSTEM: Unknown')
  }
  line()
  line('## EXTRA NOTES')
  line()
  line('-')
  line()
  return L.join('\n')
}
