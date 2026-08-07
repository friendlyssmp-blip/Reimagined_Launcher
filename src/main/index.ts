/**
 * Reimagined — application entry point.
 *
 * Boot order: data dirs → settings → logger → account → window → IPC.
 * Supports `--smoke-test` for CI-style verification without a window.
 */
import path from 'node:path'
import { app, dialog, Menu } from 'electron'
import { paths, ensureDataDirs, appVersion } from './paths'
import { logger, configureLogger, cleanupOldLogs } from './logs/logger'
import { settingsManager } from './settings/settings-manager'
import { accountStore } from './auth/account-store'
import { microsoftAuth } from './auth/microsoft-auth'
import { profileManager } from './profiles/profile-manager'
import { shareService } from './share/share'
import { detectJavaRuntimes } from './minecraft/java'
import { registerIpcHandlers } from './ipc'
import { createMainWindow, getMainWindow } from './window'
import { eventBus } from './core/event-bus'
import type { Profile } from '@shared/types'

// Windows + hardware-accelerated Chromium can corrupt the UI surface and draw
// garbage glyphs/ghost text on top of the launcher (a known frameless-window
// compositor issue). Software rendering is visually flawless for a launcher UI
// and fixes it everywhere: main window, splash and the game console window.
// Must run before `app.whenReady()` — see https://electronjs.org/docs/latest/api/app#appdisablehardwareacceleration
app.disableHardwareAcceleration()

// Crash net: an uncaught error must be logged (with stack) before anything
// else happens — never silently swallowed, never crashing the window silently.
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException', err)
  try {
    logger.exception('Uncaught exception in main process', err)
  } catch {
    /* logger itself may be unavailable during early boot */
  }
})
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason))
  console.error('[main] unhandledRejection', err)
  try {
    logger.warn(`Unhandled rejection in main process: ${err.message}`)
  } catch {
    /* ignore */
  }
})

const SMOKE = process.argv.includes('--smoke-test')
// Any of the bench flags implies benchmark mode (so `--bench-baseline` alone
// does not silently open the normal launcher window).
const BENCH =
  process.argv.includes('--bench') ||
  process.argv.includes('--bench-baseline') ||
  process.argv.includes('--bench-optimized')
const BENCH_BASELINE = process.argv.includes('--bench-baseline')
const BENCH_OPTIMIZED = process.argv.includes('--bench-optimized')

/** Seconds to keep the benchmark game running (default 180). */
function benchDuration(): number {
  const hit = process.argv.find((a) => a.startsWith('--bench-duration='))
  if (!hit) return 180
  const n = Number(hit.split('=')[1])
  return Number.isFinite(n) && n > 0 ? n : 180
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock && !SMOKE && !BENCH) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const win = getMainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
    // v1.0.19: a reimagined://share/<CODE> link opened while running.
    handleDeepLinkArgs(argv.slice(1))
  })

  app
    .whenReady()
    .then(async () => {
      Menu.setApplicationMenu(null)
      app.setAppUserModelId('com.reimagined.launcher')

      try {
        ensureDataDirs()
        const settings = await settingsManager.load()
        configureLogger(settings)
        await accountStore.load()

        logger.info('Launcher started successfully')
        logger.info(`Reimagined v${appVersion} — platform ${process.platform}/${process.arch}`)
        logger.info(`Data directory: ${paths.data}`)

        // Silent background token refresh + log cleanup.
        void microsoftAuth.refreshIfNeeded().catch(() => {})
        void cleanupOldLogs(settings.keepLogDays).catch(() => {})

        if (SMOKE) {
          await runSmokeTest()
          return
        }
        if (BENCH) {
          await runBench()
          return
        }

        const win = createMainWindow()
        registerIpcHandlers(win)

        // v1.0.19: Minecraft survives launcher restarts — reconnect to any
        // game process still running from a previous session (validated PIDs).
        void import('./minecraft/session-state')
          .then((m) => m.restoreRunningSessions())
          .catch(() => {})

        // v1.0.19: deep links — reimagined://share/<CODE> opens Import with the code.
        registerProtocol()
        handleDeepLinkArgs(process.argv.slice(1))
      } catch (err) {
        logger.exception('Fatal startup error', err)
        if (!SMOKE) {
          dialog.showErrorBox(
            'Reimagined could not start',
            'Something went wrong during startup. Check the log file for details:\n' + logger.todayPath()
          )
        }
        app.exit(1)
      }
    })
    .catch((err) => {
      console.error('whenReady failed', err)
      app.exit(1)
    })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  // v1.0.19: before a normal quit, remember which Minecraft processes are
  // still running so the next launch reconnects to them (never kill them).
  // The quit is deferred until the snapshot is safely on disk — `before-quit`
  // is not awaited by Electron, so a fire-and-forget write could be lost.
  let quitSessionsSaved = false
  app.on('before-quit', (e) => {
    if (SMOKE || BENCH || quitSessionsSaved) return
    quitSessionsSaved = true
    e.preventDefault()
    void import('./minecraft/session-state')
      .then((m) => m.saveRunningSessions())
      .catch(() => {})
      .finally(() => app.exit())
  })

  app.on('activate', () => {
    if (process.platform === 'darwin' && !getMainWindow()) createMainWindow()
  })
}

/* ------------------------------ deep links (v1.0.19) ------------------------------ */

/** Register the reimagined:// protocol so links open this launcher (packaged). */
function registerProtocol(): void {
  try {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('reimagined', process.execPath, [path.resolve(process.argv[1])])
    } else {
      app.setAsDefaultProtocolClient('reimagined')
    }
    logger.info('reimagined:// protocol registered')
  } catch (err) {
    logger.warn(`Could not register reimagined:// protocol: ${(err as Error).message}`)
  }
}

/** Emit a share deep-link event for every reimagined://share/<CODE> argv entry. */
function handleDeepLinkArgs(argv: string[]): void {
  for (const raw of argv) {
    const code = shareCodeFromUrl(raw)
    if (code) {
      logger.info(`Deep link received — share code ${code}`)
      // Keep it for the renderer even if it is not listening yet, and push
      // a live event in case the UI is already open.
      try {
        shareService.setPendingDeepLink(code)
      } catch {
        /* best-effort */
      }
      eventBus.emit('share:deep-link', { code })
    }
  }
}

function shareCodeFromUrl(raw: string): string | null {
  const s = String(raw).trim()
  if (!s.startsWith('reimagined://')) return null
  const m = s.match(/reimagined:\/\/share\/([A-Za-z0-9]+)/i)
  if (!m) return null
  return m[1].toUpperCase()
}

/** Headless verification used by `npm run smoke`. */
async function runSmokeTest(): Promise<void> {
  const checks: string[] = []
  const ok = async (name: string, fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn()
      checks.push(`  ✓ ${name}`)
    } catch (err) {
      checks.push(`  ✗ ${name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  logger.info('Smoke test started')

  await ok('profile create + delete', async () => {
    const p = await profileManager.create({
      name: 'Smoke Test',
      minecraftVersion: '1.21.4',
      loader: { type: 'vanilla', version: null }
    })
    await profileManager.delete(p.id)
  })

  await ok('java detection', async () => {
    const runtimes = detectJavaRuntimes()
    logger.info(`Java runtimes found: ${runtimes.map((r) => `Java ${r.major}`).join(', ') || 'none'}`)
  })

  await ok('settings persistence', async () => {
    await settingsManager.update({ memory: 4096 })
    const reloaded = await settingsManager.load()
    if (reloaded.memory !== 4096) throw new Error('settings did not persist')
  })

  await ok('logger wrote daily file', async () => {
    const { exists } = await import('./utils/fs')
    if (!exists(logger.todayPath())) throw new Error('no log file written')
  })

  await ok('game launch + boot (window stays alive)', async () => {
    const { launcher } = await import('./minecraft/launcher')
    const profiles = await profileManager.list()
    const target = process.env.REIMAGINED_SMOKE_PROFILE
      ? profiles.find((p) => p.id === process.env.REIMAGINED_SMOKE_PROFILE)
      : profiles.find((p) => p.loader.type !== 'vanilla') ?? profiles[0]
    // Skip (never fail) on machines where there is nothing to launch — the
    // pre-existing smoke test must keep passing on fresh setups.
    if (!target || !accountStore.get()) {
      logger.info('Smoke launch: skipped (no profile or account available)')
      return
    }

    logger.info(`Smoke launch: "${target.name}" (${target.loader.type} ${target.minecraftVersion})`)
    const handle = await launcher.launch(target.id)
    if (!handle.running) throw new Error('launch returned but game is not running')

    // A healthy launch keeps the java process alive through the whole boot
    // window (classpath errors like a missing KnotClient exit within seconds).
    const bootStart = handle.startedAt ? new Date(handle.startedAt).getTime() : Date.now()
    const deadline = Date.now() + 120_000
    let aliveAt = 0
    while (Date.now() < deadline) {
      if (!launcher.isRunning()) break
      aliveAt = Date.now()
      await new Promise((r) => setTimeout(r, 2500))
    }
    if (aliveAt - bootStart < 45_000) {
      throw new Error('game exited before it could finish booting')
    }
    logger.info(`Smoke launch OK — game stayed alive ${Math.round((aliveAt - bootStart) / 1000)}s`)
    await launcher.stop()
    logger.info('Smoke launch stopped cleanly')
  })

  await ok('share: prepare + code (7-day expiry) + zip round-trip + import', async () => {
    const { shareService } = await import('./share/share')
    const { writeJson } = await import('./utils/fs')
    const fsp = await import('node:fs/promises')
    const pathMod = await import('node:path')

    // A loader-less profile keeps the test fully offline (nothing to download).
    const source = await profileManager.create({
      name: 'Share Smoke',
      minecraftVersion: '1.21.4',
      loader: { type: 'vanilla', version: null }
    })

    const snapshot = await shareService.prepareSnapshot(source.id)
    if (snapshot.schema !== 'reimagined-profile') throw new Error('bad snapshot schema')

    const created = await shareService.createCode(source.id)
    if (!created.code || created.code.length < 8) throw new Error('code not generated')
    const ttl = new Date(created.expiresAt).getTime() - Date.now()
    if (ttl < 6.9 * 24 * 60 * 60 * 1000 || ttl > 7.1 * 24 * 60 * 60 * 1000) {
      throw new Error('code expiry is not ~7 days')
    }

    const resolved = await shareService.resolveCode(created.code)
    if (resolved.name !== 'Share Smoke') throw new Error('code resolved to wrong snapshot')

    // .zip export → read back → import (offline profile, no mods to fetch).
    const zipPath = pathMod.join(process.env.TEMP ?? '/tmp', `smoke-share-${Date.now()}.zip`)
    await shareService.exportZip(source.id, zipPath)
    const readBack = await shareService.readZip(zipPath)
    if (readBack.name !== 'Share Smoke') throw new Error('zip round-trip mismatch')
    const imported = await shareService.importZip(zipPath)
    const importedProfile = await profileManager.get(imported.profileId)
    if (!importedProfile || importedProfile.name !== 'Share Smoke') {
      throw new Error('import did not create the profile')
    }

    // Expired codes must be rejected with a clear error.
    const shareFile = pathMod.join(await import('./paths').then((m) => m.paths.data), 'share-codes.json')
    const records = (await import('./utils/fs').then((m) => m.readJson(shareFile, {}))) as Record<string, { expiresAt?: string }>
    records[created.code] = { ...(records[created.code] ?? {}), expiresAt: new Date(Date.now() - 1000).toISOString() }
    await writeJson(shareFile, records)
    let expiredCaught = false
    try {
      await shareService.resolveCode(created.code)
    } catch (err) {
      expiredCaught = (err as { code?: string }).code === 'SHARE_EXPIRED'
    }
    if (!expiredCaught) throw new Error('expired code was not rejected')

    // Leave no trace: remove the test record, zip and profiles.
    delete records[created.code]
    await writeJson(shareFile, records)
    await fsp.rm(zipPath, { force: true }).catch(() => {})
    await profileManager.delete(imported.profileId)
    await profileManager.delete(source.id)
    logger.info('Share flow OK (prepare → code → resolve → zip → import → expiry)')
  })

  await ok('config guard: backup + restore preserves options.txt', async () => {
    const fsMod = await import('node:fs')
    const pathMod = await import('node:path')
    const p = await profileManager.create({
      name: 'Guard Smoke',
      minecraftVersion: '1.21.4',
      loader: { type: 'vanilla', version: null }
    })
    try {
      const dir = pathMod.join(paths.games, p.gameDir)
      fsMod.mkdirSync(dir, { recursive: true })
      fsMod.writeFileSync(pathMod.join(dir, 'options.txt'), 'maxFps:120\nrenderDistance:12\n')
      const { configGuard } = await import('./minecraft/config-guard')
      const backupId = await configGuard.backupInstanceConfig(p)
      if (!backupId) throw new Error('backup produced no snapshot')
      // Simulate an operation clobbering options.txt, then restore.
      fsMod.writeFileSync(pathMod.join(dir, 'options.txt'), 'maxFps:60\n')
      const restored = await configGuard.restoreInstanceConfig(p, pathMod.basename(backupId))
      const content = fsMod.readFileSync(pathMod.join(dir, 'options.txt'), 'utf-8')
      if (restored < 1 || !content.includes('renderDistance:12')) {
        throw new Error('restore did not bring back the user settings')
      }
      logger.info('Config guard round-trip OK (backup → clobber → restore)')
    } finally {
      await profileManager.delete(p.id)
    }
  })

  const summary = `Smoke test results\n${checks.join('\n')}`
  logger.info(summary)
  console.log('=== SMOKE TEST ===')
  console.log(summary)
  const failed = checks.some((c) => c.includes('✗'))
  app.exit(failed ? 1 : 0)
}

/* ------------------------------ benchmark (--bench) ------------------------------ */

/** One perf window reported by the in-game reporter every 30s. */
interface PerfWindow {
  avg: number
  low: number
  heap: number
}

/**
 * Headless performance verification (native-optimization pass, Part 5).
 *
 * Generates a deterministic world once (via the bundled dedicated server,
 * no GUI interaction), then launches the game twice through the normal
 * pipeline — once with every native optimization disabled (baseline) and
 * once enabled — sampling the in-game perf reporter
 * (`[FPS Boost] PERF avg=.. low=.. heapMB=..`) over `--bench-duration`
 * seconds each. Prints a real measured before/after comparison.
 */
async function runBench(): Promise<void> {
  const duration = benchDuration()
  const lines: string[] = []
  const say = (s: string): void => {
    console.log(s)
    lines.push(s)
  }

  try {
    const account = accountStore.get()
    if (!account?.profile) {
      say('✗ Benchmark aborted: no signed-in Minecraft account is available (the game must launch to be measured).')
      app.exit(1)
      return
    }

    const pathMod = await import('node:path')
    const { launcher } = await import('./minecraft/launcher')

    const BENCH_MC = '26.2'
    const BENCH_LOADER = '0.19.3'
    const BENCH_WORLD = 'reimagined-bench'

    // One reusable benchmark profile (Fabric — FPS Boost is Fabric-only).
    let profile = (await profileManager.list()).find((p) => p.name === 'Reimagined Bench')
    if (!profile) {
      say(`Creating benchmark profile (MC ${BENCH_MC}, Fabric ${BENCH_LOADER})…`)
      profile = await profileManager.create({
        name: 'Reimagined Bench',
        minecraftVersion: BENCH_MC,
        loader: { type: 'fabric', version: BENCH_LOADER },
        memory: 4096
      })
    } else {
      const { ensureFabricApi } = await import('./mods/fabric-api')
      const { ensureFpsBoost } = await import('./mods/fps-boost')
      await ensureFabricApi(profile)
      const after = await profileManager.get(profile.id)
      if (after) {
        await ensureFpsBoost(after)
        profile = (await profileManager.get(profile.id)) ?? profile
      }
    }

    const gameDir = pathMod.join(paths.games, profile.gameDir)
    await ensureBenchWorld(profile, BENCH_WORLD, say)

    // `--quickPlaySingleplayer` takes the world name as its VALUE (the
    // launcher's earlier separate --quickPlaySingleplayerWorld flag is not a
    // recognized argument in this version and gets silently ignored).
    const quickPlay = [
      `--quickPlaySingleplayer ${BENCH_WORLD}`,
      `--quickPlayPath ${pathMod.join(gameDir, 'quickplay.log')}`
    ].join(' ')

    const passes = BENCH_BASELINE ? ['baseline'] : BENCH_OPTIMIZED ? ['optimized'] : ['baseline', 'optimized']
    const results: Record<string, PerfWindow | null> = {}

    for (const pass of passes) {
      const enabled = pass === 'optimized'
      say(`\n=== Pass "${pass}" — native optimizations ${enabled ? 'ON' : 'OFF'} — sampling ${duration}s ===`)
      try {
        await setFpsBoostConfig(gameDir, enabled)
        const fresh = await profileManager.get(profile.id)
        if (!fresh) throw new Error('benchmark profile disappeared')
        await profileManager.update(fresh.id, { extraGameArgs: quickPlay })

        const handle = await launcher.launch(fresh.id)
        if (!handle.running) throw new Error('game process did not start')

        const windows = await collectPerfWindows(launcher, duration, gameDir)
        if (windows.length === 0) {
          results[pass] = null
          say('  ✗ no perf windows collected (the game may not have reached a world)')
        } else {
          // Skip the first window — it covers boot + world load.
          const clean = windows.length > 1 ? windows.slice(1) : windows
          const avg = clean.reduce((s, w) => s + w.avg, 0) / clean.length
          const low = Math.min(...clean.map((w) => w.low))
          const heap = clean.reduce((s, w) => s + w.heap, 0) / clean.length
          results[pass] = { avg, low, heap }
          say(`  ✓ avg ${avg.toFixed(1)} FPS · low ${low.toFixed(1)} FPS · ${heap.toFixed(0)} MB heap (${clean.length} windows)`)
        }
      } catch (err) {
        logger.exception(`Benchmark pass "${pass}" failed`, err)
        results[pass] = null
        say(`  ✗ ${pass}: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        await launcher.stop().catch(() => {})
        // Undo the bench's side-effects on the shared profile: without this a
        // later normal Play would quick-play into the benchmark world, and the
        // mod config would stay at this pass's enabled value.
        await profileManager.update(profile.id, { extraGameArgs: '' }).catch(() => {})
        await setFpsBoostConfig(gameDir, true).catch(() => {})
        await new Promise((r) => setTimeout(r, 4000))
      }
    }

    const base = results['baseline']
    const opt = results['optimized']
    say('\n=== BENCHMARK SUMMARY ===')
    if (base) say(`Baseline  (optimizations OFF): avg ${base.avg.toFixed(1)} FPS · low ${base.low.toFixed(1)} FPS · ${base.heap.toFixed(0)} MB heap`)
    if (opt) say(`Optimized (Reimagined native): avg ${opt.avg.toFixed(1)} FPS · low ${opt.low.toFixed(1)} FPS · ${opt.heap.toFixed(0)} MB heap`)
    if (base && opt && base.avg > 0) {
      const dAvg = ((opt.avg - base.avg) / base.avg) * 100
      const dLow = ((opt.low - base.low) / base.low) * 100
      say(`Delta: avg ${dAvg >= 0 ? '+' : ''}${dAvg.toFixed(1)}% · low ${dLow >= 0 ? '+' : ''}${dLow.toFixed(1)}%`)
    }
    logger.info('Benchmark summary:\n' + lines.join('\n'))
    // A pass that produced no windows is a failure — surface it in the exit
    // code so the harness can be used as a CI/automation signal.
    const anyData = Object.values(results).some((r) => r !== null)
    app.exit(anyData ? 0 : 1)
  } catch (err) {
    logger.exception('Benchmark crashed', err)
    console.log('✗ Benchmark crashed:', err instanceof Error ? err.message : String(err))
    app.exit(1)
  }
}

/** Write the FPS Boost mod config for a benchmark pass (off = vanilla-like baseline). */
async function setFpsBoostConfig(gameDir: string, enabled: boolean): Promise<void> {
  const fsMod = await import('node:fs')
  const pathMod = await import('node:path')
  const dir = pathMod.join(gameDir, 'config')
  fsMod.mkdirSync(dir, { recursive: true })
  fsMod.writeFileSync(
    pathMod.join(dir, 'reimagined-fps-boost.json'),
    JSON.stringify(
      {
        enabled,
        reduceParticles: enabled,
        simplifyClouds: enabled,
        // 1.0.1: entity-animation throttle removed from the bundled mod.
        limitEntityAnimations: false,
        smartRenderDistance: enabled,
        reduceVisualEffects: false,
        showFps: false,
        perfReport: true,
        smartRdCap: 16,
        entityAnimDistance: 48
      },
      null,
      2
    )
  )
}

function parsePerf(text: string, windows: PerfWindow[], seen: Set<string>): void {
  // A single read can carry several 30s windows when output was buffered —
  // capture every match, not just the first.
  const re = /PERF avg=([\d.]+) low=([\d.]+) heapMB=([\d.]+) frames=(\d+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const key = `${m[1]}|${m[2]}|${m[3]}|${m[4]}`
    if (!seen.has(key)) {
      seen.add(key)
      windows.push({ avg: Number(m[1]), low: Number(m[2]), heap: Number(m[3]) })
    }
  }
}

/**
 * Collect perf windows for `duration` seconds while the game runs.
 *
 * Reads two sources (deduped): the launcher's stdout stream AND the game's
 * own `logs/latest.log` — the game flushes its log4j file appender reliably,
 * whereas the stdout pipe can sit block-buffered when the game is quiet.
 */
async function collectPerfWindows(launcher: { isRunning(): boolean; stop(): Promise<void> }, duration: number, gameDir: string): Promise<PerfWindow[]> {
  const windows: PerfWindow[] = []
  const seen = new Set<string>()
  const off = eventBus.on('launch:log', (event) => {
    const text = (event.payload as { text?: string } | undefined)?.text ?? ''
    parsePerf(text, windows, seen)
  })

  const pathMod = await import('node:path')
  const fsMod = await import('node:fs')
  const latestPath = pathMod.join(gameDir, 'logs', 'latest.log')
  let offset = 0
  const readNew = (): void => {
    try {
      if (!fsMod.existsSync(latestPath)) return
      const size = fsMod.statSync(latestPath).size
      if (size < offset) offset = 0 // log rotated
      if (size === offset) return
      const fd = fsMod.openSync(latestPath, 'r')
      const buf = Buffer.alloc(size - offset)
      fsMod.readSync(fd, buf, 0, buf.length, offset)
      fsMod.closeSync(fd)
      offset = size
      parsePerf(buf.toString('utf-8'), windows, seen)
    } catch {
      /* the game may briefly lock the file — retried next poll */
    }
  }

  const started = Date.now()
  try {
    while (Date.now() - started < duration * 1000 && launcher.isRunning()) {
      await new Promise((r) => setTimeout(r, 3000))
      readNew()
    }
    if (launcher.isRunning()) {
      await launcher.stop().catch(() => {})
    }
  } finally {
    off()
  }
  return windows
}

/**
 * Generate (once) a deterministic single-player world for the benchmark
 * profile using the bundled dedicated server — fully headless, no GUI
 * interaction. The server writes DIRECTLY into `saves/<world>` (1.21.2+ world
 * format: `data/minecraft/world_gen_settings.dat` + chunks under
 * `dimensions/minecraft/overworld/region/`), so there is no copy step to race
 * with the server's writes. The client then quick-plays into that world like
 * any normal single-player session.
 */
async function ensureBenchWorld(profile: Profile, worldName: string, say: (s: string) => void): Promise<void> {
  const pathMod = await import('node:path')
  const fsMod = await import('node:fs')
  const gameDir = pathMod.join(paths.games, profile.gameDir)
  const savesDir = pathMod.join(gameDir, 'saves')
  const worldDir = pathMod.join(savesDir, worldName)

  // A usable world has both the level data AND the world-gen settings the
  // client needs to build its dimensions (missing settings = "Overworld
  // settings missing" when the client tries to open the world).
  const worldReady = (): boolean =>
    fsMod.existsSync(pathMod.join(worldDir, 'level.dat')) &&
    fsMod.existsSync(pathMod.join(worldDir, 'data', 'minecraft', 'world_gen_settings.dat'))

  if (worldReady()) {
    say(`  Reusing existing benchmark world "${worldName}"`)
    return
  }

  say(`  Generating benchmark world "${worldName}" (headless dedicated server, one-time)…`)
  const versionId = `${profile.minecraftVersion}-fabric-${profile.loader.version}`
  const { versionManager } = await import('./minecraft/version-manager')
  const { classpath } = await versionManager.ensureLibraries(versionId, () => undefined)
  const clientJar = await versionManager.ensureClient(versionId)
  const { pickJava } = await import('./minecraft/java')
  const java = (await pickJava(25)) ?? (await pickJava(21)) ?? (await pickJava(17))
  if (!java) throw new Error('no Java runtime found for world generation')

  const sep = process.platform === 'win32' ? ';' : ':'
  const cp = [...classpath, clientJar].join(sep)
  const { spawn } = await import('node:child_process')

  // Two attempts — a partial world from an interrupted run is wiped and retried.
  for (let attempt = 1; attempt <= 2; attempt++) {
    fsMod.rmSync(worldDir, { recursive: true, force: true })
    fsMod.mkdirSync(savesDir, { recursive: true })
    fsMod.writeFileSync(pathMod.join(savesDir, 'eula.txt'), 'eula=true\n')
    fsMod.writeFileSync(
      pathMod.join(savesDir, 'server.properties'),
      [
        `level-name=${worldName}`,
        'level-seed=42',
        'online-mode=false',
        'max-tick-time=-1',
        'view-distance=8',
        'simulation-distance=6',
        'gamemode=creative',
        'spawn-protection=0',
        'sync-chunk-writes=false',
        'server-port=25599'
      ].join('\n') + '\n'
    )

    const child = spawn(java.path, ['-Xmx2G', '-cp', cp, 'net.minecraft.server.Main', '--nogui'], {
      cwd: savesDir,
      windowsHide: true,
      env: { ...process.env }
    })
    try {
      const done = await new Promise<boolean>((resolve) => {
        let out = ''
        const timer = setTimeout(() => resolve(false), 240_000)
        const check = (): void => {
          if (out.includes('Done')) {
            clearTimeout(timer)
            resolve(true)
          }
        }
        child.stdout?.on('data', (d: Buffer) => {
          out += d.toString('utf-8')
          check()
        })
        child.stderr?.on('data', (d: Buffer) => {
          out += d.toString('utf-8')
          check()
        })
        child.on('close', () => {
          clearTimeout(timer)
          resolve(out.includes('Done'))
        })
      })
      if (!done) {
        if (attempt === 2) throw new Error('world generation did not complete ("Done" never appeared)')
        continue
      }

      // Let the server flush its chunk/world writes before killing it — on
      // Windows a process kill is forced (no shutdown hooks), so the settle
      // window is what guarantees world_gen_settings.dat + spawn regions exist.
      say(`  Attempt ${attempt}: spawn area generated — flushing chunks…`)
      await new Promise((r) => setTimeout(r, 25_000))
    } finally {
      // Never leave a world-gen server running, whatever happened above.
      if (child.exitCode === null) {
        try {
          child.kill('SIGTERM')
        } catch {
          /* already dead */
        }
      }
    }

    if (worldReady()) {
      // Windows can briefly hold handles to the server's log files after the
      // process dies — cleanup is best-effort and must never crash the bench.
      await new Promise((r) => setTimeout(r, 2000))
      const tryClean = (p: string): void => {
        try {
          fsMod.rmSync(p, { recursive: true, force: true })
        } catch {
          /* locked by the dying process — harmless */
        }
      }
      tryClean(pathMod.join(savesDir, 'eula.txt'))
      tryClean(pathMod.join(savesDir, 'server.properties'))
      tryClean(pathMod.join(savesDir, 'logs'))
      say(`  World ready at saves/${worldName}`)
      return
    }

    say('  World incomplete — retrying generation…')
  }
  throw new Error(`world generation produced an incomplete world after 2 attempts (missing world_gen_settings.dat)`)
}
