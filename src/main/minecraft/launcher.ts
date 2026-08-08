/**
 * The launch pipeline — now multi-instance capable (v1.0.15).
 *
 * Every profile gets its OWN independent process session (child PID, logs,
 * window watch, crash detection, Stop). Multiple Minecraft instances can run
 * simultaneously: Instance A → Running, Instance B → Running. The Stop button
 * only stops the session bound to that specific profile.
 *
 * resolve → prepare (client/libraries/assets/log4j) → build JVM+game args →
 * spawn java → stream output → track session → record playtime.
 */
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { paths, appVersion } from '../paths'
import { logger } from '../logs/logger'
import { eventBus } from '../core/event-bus'
import { Errors, LauncherError } from '../core/errors'
import { settingsManager } from '../settings/settings-manager'
import { microsoftAuth } from '../auth/microsoft-auth'
import { accountStore } from '../auth/account-store'
import { profileManager } from '../profiles/profile-manager'
import { versionManager, targetOs, archMatchesCurrent } from './version-manager'
import { installFabric, latestFabricLoader } from './loaders/fabric'
import { installForge, recommendedForgeVersion } from './loaders/forge'
import { pickJava, type JavaRuntime } from './java'
import { dateStamp } from '../utils/format'
import { profileUsesShaders } from '../anti-crash/shader-guard'
import type { Profile, LaunchProgress, LaunchLogLine, LaunchHandle, LaunchStage, Account } from '@shared/types'

const CLASSPATH_SEP = process.platform === 'win32' ? ';' : ':'

interface ArgRule {
  action: 'allow' | 'disallow'
  os?: { name?: string; arch?: string }
  features?: Record<string, boolean>
}

type ArgEntry =
  | string
  | { rules?: ArgRule[]; value: string | string[] }

type VersionJson = Record<string, any> & {
  id: string
  mainClass: string
  type: string
  minecraftArguments?: string
  arguments?: {
    game?: ArgEntry[]
    jvm?: ArgEntry[]
  }
  javaVersion?: { majorVersion: number }
  assetIndex?: { id: string; url?: string; sha1?: string; size?: number; totalSize?: number; objects?: Record<string, unknown> }
}

/** One running (or recently exited) game process, fully independent per profile. */
interface GameSession {
  profile: Profile
  child: ChildProcess
  startedAt: number
  sessionLog: fs.WriteStream | null
  sessionLogPath: string | null
  /** Poller that detects when the game's actual window appears (real signal). */
  windowPoller: ReturnType<typeof setInterval> | null
  /** Epoch ms when the game window was confirmed open (0 = not yet). */
  windowOpenedAt: number
  /** v1.0.25 — tail of the game's OWN logs/latest.log (survives launcher restarts). */
  logTailFile: string | null
  logTailOffset: number
  logTailTimer: ReturnType<typeof setInterval> | null
  /** v1.0.26 — true for sessions reconnected after a launcher restart (no
   * child 'close' event exists; state must be cleared manually on stop). */
  reattached: boolean
}

class Launcher {
  /** profileId → session. This is the single source of truth for launch state. */
  private sessions = new Map<string, GameSession>()

  /**
   * True when a game is running. With no argument: ANY profile running.
   * With a profileId: only that profile's own session counts — so a running
   * Instance A never turns Instance B's Play button into Stop.
   */
  isRunning(profileId?: string): boolean {
    if (profileId) {
      const s = this.sessions.get(profileId)
      return !!s && s.child.exitCode === null
    }
    for (const s of this.sessions.values()) {
      if (s.child.exitCode === null) return true
    }
    return false
  }

  /** Handles for every session (running or recently finished). */
  get handles(): LaunchHandle[] {
    const out: LaunchHandle[] = []
    for (const [profileId, s] of this.sessions) {
      out.push({
        profileId,
        running: s.child.exitCode === null,
        pid: s.child.pid,
        startedAt: s.startedAt ? new Date(s.startedAt).toISOString() : undefined
      })
    }
    return out
  }

  /** The most recently started session — kept for legacy single-handle callers. */
  get handle(): LaunchHandle {
    let last: GameSession | null = null
    for (const s of this.sessions.values()) {
      if (!last || s.startedAt > last.startedAt) last = s
    }
    if (!last) return { profileId: '', running: false }
    return {
      profileId: last.profile.id,
      running: last.child.exitCode === null,
      pid: last.child.pid,
      startedAt: last.startedAt ? new Date(last.startedAt).toISOString() : undefined
    }
  }

  /** Launch-timing info for the game console's chronometer (per profile). */
  getLaunchTimes(profileId: string): { startedAt: number; windowOpenedAt: number } {
    const s = this.sessions.get(profileId)
    if (!s) return { startedAt: 0, windowOpenedAt: 0 }
    return { startedAt: s.startedAt, windowOpenedAt: s.windowOpenedAt }
  }

  async launch(profileId: string): Promise<LaunchHandle> {
    // v1.0.28 — launch-path instrumentation: every pipeline stage is timed and
    // logged as ONE line so a slow launch is diagnosable from REAL measured
    // data (never guesswork). The timing itself is ~free (Date.now deltas).
    const t0 = Date.now()
    const timings: string[] = []
    const mark = (name: string): void => {
      timings.push(`${name}=${Date.now() - t0}ms`)
    }
    const profile = await profileManager.get(profileId)
    if (!profile) throw Errors.launchFailed('The selected profile no longer exists.')
    // Only THIS profile is blocked when already running — other instances are
    // free to launch in parallel.
    if (this.isRunning(profileId)) {
      throw new LauncherError('ALREADY_RUNNING', `\"${profile.name}\" is already running.`, 'Stop it first, or launch another profile — multiple instances are supported.')
    }

    const account = accountStore.get()
    if (!account) throw Errors.notLoggedIn()
    const refreshed = await microsoftAuth.refreshIfNeeded()
    mark('auth')
    const acc = refreshed ?? account
    if (!acc.profile) throw Errors.launchFailed('Your Microsoft account has no Minecraft profile.')

    const session: GameSession = {
      profile,
      child: null as unknown as ChildProcess,
      startedAt: Date.now(),
      sessionLog: null,
      sessionLogPath: null,
      windowPoller: null,
      windowOpenedAt: 0,
      logTailFile: null,
      logTailOffset: 0,
      logTailTimer: null,
      reattached: false
    }
    this.sessions.set(profileId, session)

    try {
      const mc = profile.minecraftVersion
      let versionId = mc
      let loaderLabel = 'vanilla'

      if (profile.loader.type === 'fabric') {
        // Safety net: make sure the Fabric API mod is present so Fabric mods
        // work on a fresh instance (first-launch experience must just work).
        if (!profile.mods.some((m) => m.id === 'fabric-api' || m.slug === 'fabric-api')) {
          const { ensureFabricApi } = await import('../mods/fabric-api')
          await ensureFabricApi(profile)
        }
        // Seed / UPGRADE the bundled Reimagined FPS Boost mod (only when a
        // compatible Minecraft version — the mod targets 26.2.x). v1.0.34:
        // this ALWAYS runs ensureFpsBoost, not only when the mod is absent —
        // it internally no-ops when already current and UPGRADES profiles
        // carrying an older bundled jar. The old gate left every existing
        // profile stuck on the first-ever bundled version (e.g. 1.0.4, which
        // predates the async chunk pipeline and the Extended View cache fix),
        // which is exactly why those instances showed no Extended View data
        // and no EXTVIEW lines despite real exploration.
        {
          const { ensureFpsBoost } = await import('../mods/fps-boost')
          await ensureFpsBoost(profile)
        }
        this.emitProgress('installing-loader', `Resolving Fabric for ${mc}…`)
        const loaderVersion = profile.loader.version ?? (await latestFabricLoader(mc))
        const fabric = await installFabric(mc, loaderVersion)
        versionId = fabric.versionId
        loaderLabel = `fabric ${fabric.loaderVersion}`
        mark('loader-fabric')
      } else if (profile.loader.type === 'forge') {
        this.emitProgress('installing-loader', `Resolving Forge for ${mc}…`)
        const loaderVersion = profile.loader.version ?? (await recommendedForgeVersion(mc))
        if (!loaderVersion) {
          throw new LauncherError('FORGE_MISSING', `No Forge build was found for Minecraft ${mc}.`, 'Choose another version or loader.')
        }
        const forge = await installForge(mc, loaderVersion)
        versionId = forge.versionId
        loaderLabel = `forge ${forge.forgeVersion}`
        mark('loader-forge')
      } else {
        mark('loader-vanilla')
      }

      this.emitProgress('downloading', `Preparing ${mc} (${loaderLabel})…`, 0)
      // Resolve `inheritsFrom` chains (Forge installer JSONs inherit the base
      // version's client jar / asset index / base libraries).
      const vj = (await versionManager.ensureResolvedVersionJson(versionId)) as VersionJson
      mark('version-json')
      const { classpath, nativesDir } = await versionManager.ensureLibraries(versionId, (kind) => this.emitProgress('downloading', `Preparing ${kind}...`, 0))
      mark('libraries')
      const clientJar = await versionManager.ensureClient(versionId)
      mark('client')
      if (!vj.assetIndex) throw Errors.launchFailed(`Version ${versionId} has no asset index.`)
      const assetsDir = await versionManager.ensureAssets(
        vj.assetIndex.id,
        vj.assetIndex as { id: string; url: string }
      )
      mark('assets')
      const log4jConfig = await versionManager.ensureLog4jConfig(versionId)
      mark('log4j')

      const requiredMajor = vj.javaVersion?.majorVersion ?? 8
      const java = await pickJava(requiredMajor)
      mark('java')
      if (!java) throw Errors.missingJava(requiredMajor)

      const gameDir = path.join(paths.games, profile.gameDir)
      fs.mkdirSync(path.join(gameDir, 'mods'), { recursive: true })
      // FPS Boost is ON by default for EVERY profile, Vanilla included — the
      // Reimagined performance layer reads this config (the Fabric mod only
      // carries the in-game knobs; the JVM flags apply regardless). The
      // values come from the RPE for the current hardware tier.
      await this.seedFpsBoostConfig(gameDir)
      mark('fps-config')

      // Shader Guard (anti-crash, v1.0.12): a safety net, not a gate (v1.0.14).
      // Borderline hardware is warned but the launch proceeds; only a real
      // failure triggers the runtime fallback / auto-recovery.
      if (profileUsesShaders(profile)) {
        const guard = await import('../anti-crash/shader-guard')
        const guardHw = await (await import('../perf/engine')).detectHardware(false)
        const support = guard.assessShaderSupport(guardHw)
        if (support.level === 'unsupported') {
          logger.warn('Shader Guard: borderline hardware detected — proceeding anyway (' + support.reasons.join(' ') + ')')
        }
        // Auto-recovery: the previous session crashed with shaders armed —
        // disable shaders now and tell the user why (breaks the crash loop).
        if (settingsManager.get().autoDisableShadersOnCrash && guard.shaderCrashPending(profile)) {
          guard.disableShadersForSession(profile)
          eventBus.emit('shaders:auto-disabled', {
            profileId: profile.id,
            message: 'Minecraft crashed last time while shaders were enabled, so we disabled them for this session — you can re-enable them in the game.'
          })
        } else if (settingsManager.get().shaderAutoReduceRd) {
          // Low-VRAM safety: apply the real render-distance cap to options.txt
          // so the shader session starts at a distance this GPU can hold.
          const { rd, message } = guard.shaderRenderDistanceFor(guardHw, 12)
          guard.capRenderDistance(profile, rd)
          if (message) {
            logger.info('Shader Guard: ' + message)
            this.emitLog('system', 'Shader Guard: ' + message)
          }
        }
        guard.armShaderCrashFlag(profile)
      }
      mark('shader-guard')

      const args = await this.buildArgs({
        vj,
        versionId,
        classpath: [...classpath, clientJar],
        nativesDir,
        assetsDir,
        log4jConfig,
        profile,
        account: acc
      })
      mark('build-args')

      this.emitProgress('launching', `Launching ${profile.name}…`, 100)
      this.spawn(java, args, gameDir, profile, session)
      mark('spawn')
      // Single-line summary — the whole pipeline's measured cost, so launch
      // regressions are caught from real data (v1.0.28).
      logger.info(`LAUNCH TIMING "${profile.name}" total=${Date.now() - t0}ms · ${timings.join(' · ')}`)
    } catch (err) {
      // Log the stage timings on failure too — a failed launch is exactly
      // when you need to know which step ate the time (v1.0.28).
      logger.info(`LAUNCH TIMING "${profile.name}" FAILED total=${Date.now() - t0}ms · ${timings.join(' · ')}`)
      logger.exception('Launch pipeline failed', err)
      const message = err instanceof Error ? err.message : String(err)
      this.emitLog('system', `Launch failed: ${message}`)
      eventBus.emit('launch:status', { profileId, running: false, error: message })
      this.sessions.delete(profileId)
      throw err instanceof LauncherError ? err : Errors.launchFailed(message)
    }

    return this.handle
  }

  /* ---------------------------------- args ---------------------------------- */

  private async buildArgs(v: {
    vj: VersionJson
    versionId: string
    classpath: string[]
    nativesDir: string
    assetsDir: string
    log4jConfig: string | null
    profile: Profile
    account: Account
  }): Promise<string[]> {
    const { vj, versionId, classpath, nativesDir, assetsDir, log4jConfig, profile, account } = v
    const mcProfile = account.profile!
    // assetIndex is verified to exist before buildArgs is called (launch() guards it).
    const assetIndexId = vj.assetIndex?.id ?? ''
    const gameDir = path.join(paths.games, profile.gameDir)
    const jvm: string[] = []
    const game: string[] = []

    if (log4jConfig) jvm.push(`-Dlog4j.configurationFile=${log4jConfig}`)

    if (vj.arguments?.jvm?.length) {
      for (const entry of vj.arguments.jvm) {
        const vals = this.resolveArg(entry)
        if (vals) jvm.push(...vals)
      }
    } else {
      jvm.push('-XX:+UseG1GC', '-XX:-OmitStackTraceInFastThrow', '-Djava.net.preferIPv4Stack=true')
    }

    jvm.push(`-Xmx${profile.memory}M`, '-Xms256M', `-Djava.library.path=${nativesDir}`)
    jvm.push('-Dminecraft.launcher.brand=reimagined', `-Dminecraft.launcher.version=${appVersion}`)

    // Reimagined Performance Engine: tier-tuned JVM flags (G1GC tuning +
    // preset hand-off, ordered so UnlockExperimentalVMOptions precedes the
    // G1 size flags). The in-game client reads -Dreimagined.preset.
    const rpe = await import('../perf/engine')
    const hw = await rpe.detectHardware(false)
    const { tier } = rpe.effectiveTier(settingsManager.get(), hw)
    jvm.push(...rpe.jvmFlagsFor(tier))
    // v1.0.13/v1.0.41: hand the frame cap to the in-game watchdog. v1.0.41
    // fix: the default cap was the FPS regression (290 -> ~100 FPS), so the
    // flag is only passed when a REAL cap is configured (user-set cap < 260);
    // otherwise the game runs at vanilla Unlimited and the watchdog stands
    // down. The in-game client reads -Dreimagined.maxfps.
    if (!settingsManager.get().unlimitedFps) {
      const fpsCfg = rpe.fpsConfigFor(tier, hw)
      // v1.0.41 — test the RAW value first: 260 (vanilla "Unlimited") must
      // never be clamped to 240 and pushed as a real cap.
      const raw = Number(fpsCfg.maxFps) || 260
      if (raw < 260) {
        const cap = Math.max(60, Math.min(240, raw))
        jvm.push(`-Dreimagined.maxfps=${cap}`)
      }
    }
    jvm.push('-cp', classpath.join(CLASSPATH_SEP))
    if (profile.extraJvmArgs.trim()) jvm.push(...this.splitArgs(profile.extraJvmArgs))

    const replace = (s: string): string =>
      s
        .replaceAll('${auth_player_name}', mcProfile.name)
        .replaceAll('${auth_uuid}', mcProfile.id.replaceAll('-', ''))
        .replaceAll('${auth_access_token}', account.tokens.accessToken)
        .replaceAll('${user_type}', 'msa')
        .replaceAll('${version_name}', versionId)
        .replaceAll('${game_directory}', gameDir)
        .replaceAll('${assets_root}', assetsDir)
        .replaceAll('${assets_index_name}', assetIndexId)
        .replaceAll('${version_type}', vj.type)
        .replaceAll('${resolution_width}', String(profile.resolution.width))
        .replaceAll('${resolution_height}', String(profile.resolution.height))

    if (vj.arguments?.game?.length) {
      for (const entry of vj.arguments.game) {
        const vals = this.resolveArg(entry)
        if (vals) game.push(...vals.map(replace))
      }
    } else if (vj.minecraftArguments) {
      game.push(...vj.minecraftArguments.split(' ').map(replace))
    }

    // Safety net: guarantee identity args exist even for unusual version JSONs.
    const joined = game.join(' ')
    if (!joined.includes('--username')) game.push('--username', mcProfile.name)
    if (!joined.includes('--uuid')) game.push('--uuid', mcProfile.id.replaceAll('-', ''))
    if (!joined.includes('--accessToken')) game.push('--accessToken', account.tokens.accessToken)
    if (!joined.includes('--userType')) game.push('--userType', 'msa')
    if (!joined.includes('--version')) game.push('--version', versionId)
    if (!joined.includes('--gameDir')) game.push('--gameDir', gameDir)
    if (!joined.includes('--assetsDir')) game.push('--assetsDir', assetsDir)
    if (!joined.includes('--assetIndex')) game.push('--assetIndex', assetIndexId)
    if (!joined.includes('--versionType')) game.push('--versionType', vj.type)

    if (profile.resolution.fullscreen) {
      game.push('--fullscreen')
    } else {
      game.push('--width', String(profile.resolution.width), '--height', String(profile.resolution.height))
    }
    if (profile.extraGameArgs.trim()) game.push(...this.splitArgs(profile.extraGameArgs))

    return [...jvm, vj.mainClass, ...game]
  }

  /** Evaluate a rule-based argument entry for this environment. */
  private resolveArg(entry: ArgEntry): string[] | null {
    if (typeof entry === 'string') return [entry]
    if (entry.rules?.length) {
      let allowed = false
      for (const rule of entry.rules) {
        let ok = true
        if (rule.os) {
          if (rule.os.name && rule.os.name !== targetOs) ok = false
          if (rule.os.arch && !archMatchesCurrent(rule.os.arch)) ok = false
        }
        if (rule.features && Object.keys(rule.features).length > 0) ok = false
        if (ok) allowed = rule.action === 'allow'
      }
      if (!allowed) return null
    }
    return Array.isArray(entry.value) ? entry.value : [entry.value]
  }

  private splitArgs(raw: string): string[] {
    return raw.trim().split(/\s+/).filter(Boolean)
  }

  /* ---------------------------------- process ---------------------------------- */

  private spawn(java: JavaRuntime, args: string[], gameDir: string, profile: Profile, session: GameSession): void {
    // v1.0.19: detached on Windows so the game runs in its own process group
    // and is fully independent of the launcher's lifecycle — a launcher
    // update/restart must NEVER take Minecraft down with it. The game's own
    // console window still shows (windowsHide stays false).
    const child = spawn(java.path, args, {
      cwd: gameDir,
      windowsHide: false,
      detached: process.platform === 'win32',
      env: { ...process.env }
    })
    session.child = child
    this.openSessionLog(profile, session)

    const started = `Game launched for "${profile.name}" (pid ${child.pid}, Java ${java.major})`
    logger.info(started)
    this.emitLog('system', started)
    eventBus.emit('launch:status', { profileId: profile.id, running: true, pid: child.pid })
    this.startWindowWatch(session)

    child.stdout?.on('data', (d: Buffer) => this.onOutput('stdout', d, session))
    child.stderr?.on('data', (d: Buffer) => this.onOutput('stderr', d, session))

    child.on('error', (err) => {
      // A spawn-level failure (bad Java path, missing DLL…) means the launch
      // is over before any window appears. Always reset the UI state for THIS
      // profile — the renderer must never stay stuck on "Launching…".
      logger.exception('Game process error', err)
      this.emitLog('stderr', `Process error: ${err.message}`)
      this.stopWindowWatch(session)
      this.sessions.delete(profile.id)
      eventBus.emit('launch:status', { profileId: profile.id, running: false, error: `Game process error: ${err.message}` })
    })

    child.on('close', (code, signal) => void this.onExit(code, signal, session))
  }

  private onOutput(stream: 'stdout' | 'stderr', chunk: Buffer, session: GameSession): void {
    const text = chunk.toString('utf-8')
    session.sessionLog?.write(text)
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue
      this.emitLog(stream, line)
    }
  }

  private openSessionLog(profile: Profile, session: GameSession): void {
    const file = path.join(paths.logs, `game-${profile.id}-${dateStamp()}-${Date.now()}.log`)
    try {
      session.sessionLog = fs.createWriteStream(file)
      session.sessionLogPath = file
      this.emitLog('system', `Session log: ${file}`)
    } catch {
      session.sessionLog = null
      session.sessionLogPath = null
    }
  }

  private async onExit(code: number | null, signal: string | null, session: GameSession): Promise<void> {
    const profile = session.profile
    const duration = Math.max(0, (Date.now() - session.startedAt) / 1000)

    session.sessionLog?.end()
    session.sessionLog = null
    this.stopWindowWatch(session)
    session.windowOpenedAt = 0

    logger.info(`Game exited (code ${code ?? 'null'}${signal ? `, signal ${signal}` : ''}) after ${Math.round(duration)}s`)
    this.emitLog('system', `Game exited with code ${code ?? 'n/a'}`)

    // RPE profiler: record this session's real measured performance.
    if (profile) {
      try {
        const { recordSessionFromLog } = await import('../perf/engine')
        await recordSessionFromLog(profile.id, profile.name, session.sessionLogPath)
      } catch {
        /* profiler is best-effort */
      }
      session.sessionLogPath = null
      await profileManager.recordLaunch(profile.id, duration, true)
      if (settingsManager.get().closeOnLaunch) {
        // Only restore focus when NO other instance is still running — the
        // launcher is the only window to show otherwise.
        if (!this.isRunning()) {
          const { showMainWindow } = await import('../window')
          showMainWindow()
        }
      }
    }

    eventBus.emit('launch:status', { profileId: profile?.id ?? '', running: false, code, signal })
    eventBus.emit('launch:exit', { code, signal, duration, profileId: profile?.id })

    // Crash Assistant: a non-zero exit may mean the game crashed — if a fresh
    // crash report exists, surface it with analysis and suggestions.
    if (profile && code !== 0) {
      try {
        const { detectCrashReport } = await import('../game/crash-assistant')
        const report = await detectCrashReport(profile)
        if (report) {
          logger.warn(`Crash detected for "${profile.name}": ${report.cause}`)
          // v1.0.13: persist the FULL crash report content (truncated) so any
          // later instability — e.g. a "render frame" failure — can be debugged
          // from real data, never from guesswork.
          logger.info(`Crash report (${report.file}) content for debugging:\n${report.snippet.slice(0, 4000)}`)
          eventBus.emit('crash:detected', report)
          // Shader Guard: a crash on a shader-armed session is recorded so the
          // next launch auto-disables shaders (no endless crash loop).
          if (profileUsesShaders(profile)) {
            const { recordShaderCrash } = await import('../anti-crash/shader-guard')
            await recordShaderCrash({
              profileId: profile.id,
              profileName: profile.name,
              cause: report.cause,
              at: new Date().toISOString()
            })
            logger.warn(`Shader Guard: session for "${profile.name}" crashed with shaders enabled (${report.cause.slice(0, 120)}) — auto-recovery armed for next launch.`)
          }
        }
      } catch {
        /* Crash Assistant is strictly best-effort — never breaks the exit flow */
      }
    }

    // Shader Guard exit bookkeeping (per profile):
    //  - A CLEAN exit (code 0) clears the crash flag so recovery never
    //    triggers after a successful session; the render distance cap applied
    //    for the shader session is restored.
    //  - A USER-INITIATED STOP (taskkill → non-zero/null code) also clears the
    //    crash flag — pressing Stop is not a shader crash and must not arm
    //    recovery for the next launch.
    //  - A real crash (code !== 0, no intentional-stop marker) leaves the flag
    //    armed — that is the signal the next launch uses to disable shaders.
    if (profile) {
      try {
        const guard = await import('../anti-crash/shader-guard')
        const intentional = guard.intentionalStopPending(profile)
        if (code === 0 || intentional) {
          guard.clearShaderCrashFlag(profile)
          guard.restoreRenderDistance(profile)
          guard.clearIntentionalStop(profile)
        }
      } catch {
        /* best-effort */
      }
    }

    this.sessions.delete(profile?.id ?? '')
  }

  /**
   * Poll the spawned game process's main window handle (Windows). A non-zero
   * handle is the real "the game window is up" signal — the chronometer uses
   * the measured elapsed seconds between Play and this moment. Per session.
   */
  private startWindowWatch(session: GameSession): void {
    if (process.platform !== 'win32' || !session.child.pid) return
    this.stopWindowWatch(session)
    const child = session.child
    const pid = child.pid
    const started = Date.now()
    session.windowPoller = setInterval(() => {
      if (this.sessions.get(session.profile.id) !== session || child.exitCode !== null) {
        this.stopWindowWatch(session)
        return
      }
      execFile(
        'powershell',
        ['-NoProfile', '-Command', `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).MainWindowHandle`],
        { windowsHide: true, timeout: 4000 },
        (err, stdout) => {
          if (session.windowPoller === null) return
          const handle = Number(String(stdout ?? '').trim())
          if (Number.isFinite(handle) && handle > 0) {
            const elapsedSec = Math.max(0, Math.round((Date.now() - started) / 1000))
            session.windowOpenedAt = Date.now()
            logger.info(`Minecraft window opened after ${elapsedSec}s (pid ${pid})`)
            eventBus.emit('launch:window-open', { elapsedSec })
            this.stopWindowWatch(session)
          } else if (Date.now() - started > 180_000) {
            // Give up after 3 minutes — some configs never expose a handle.
            this.stopWindowWatch(session)
          }
        }
      )
    }, 1000)
  }

  private stopWindowWatch(session: GameSession): void {
    if (session.windowPoller) {
      clearInterval(session.windowPoller)
      session.windowPoller = null
    }
    // v1.0.25 — stop the reattach log tail the moment the session ends.
    this.stopLogTail(session)
  }

  /**
   * v1.0.25 — console survival across a launcher self-update.
   *
   * Minecraft writes its OWN log4j file (logs/latest.log) in the instance
   * dir, completely independent of the launcher process. When we reattach to
   * a game that survived a launcher restart, the old stdout pipe is gone (the
   * previous launcher process owned it), so we tail that file instead: replay
   * the last 150 lines for context, then poll for appended bytes every second
   * and emit them as normal launch log lines. The console view is therefore
   * restored with the real output the game kept producing while the launcher
   * was closed/updating — no gaps, no fake lines.
   */
  private startLogTail(session: GameSession): void {
    try {
      const file = path.join(paths.games, session.profile.gameDir, 'logs', 'latest.log')
      if (!fs.existsSync(file)) return
      const size = fs.statSync(file).size
      // Replay the last 150 lines for context (real game output).
      try {
        const readSize = Math.min(size, 48 * 1024)
        const buf = Buffer.alloc(readSize)
        const fd = fs.openSync(file, 'r')
        fs.readSync(fd, buf, 0, readSize, Math.max(0, size - readSize))
        fs.closeSync(fd)
        const lines = buf.toString('utf-8').split(/\r?\n/).filter((l) => l.trim())
        for (const line of lines.slice(-150)) this.emitLog('stdout', line)
      } catch {
        /* replay is best-effort */
      }
      session.logTailFile = file
      session.logTailOffset = size
      this.emitLog('system', `Console reconnected — tailing ${file}`)
      session.logTailTimer = setInterval(() => {
        if (this.sessions.get(session.profile.id) !== session) {
          this.stopLogTail(session)
          return
        }
        try {
          if (!fs.existsSync(file)) return
          const st = fs.statSync(file)
          let offset = session.logTailOffset ?? 0
          // File rotated/truncated (size shrank): restart from the top so the
          // tail never goes permanently silent on a stale offset.
          if (st.size < offset) {
            offset = 0
            session.logTailOffset = 0
          }
          if (st.size <= offset) return
          const buf = Buffer.alloc(st.size - offset)
          const fd = fs.openSync(file, 'r')
          fs.readSync(fd, buf, 0, buf.length, offset)
          fs.closeSync(fd)
          session.logTailOffset = st.size
          for (const line of buf.toString('utf-8').split(/\r?\n/)) {
            if (!line.trim()) continue
            this.emitLog('stdout', line)
          }
        } catch {
          /* file may be locked/rotated — skip this tick */
        }
      }, 1000)
    } catch {
      /* best-effort */
    }
  }

  private stopLogTail(session: GameSession): void {
    if (session.logTailTimer) {
      clearInterval(session.logTailTimer)
      session.logTailTimer = null
    }
    session.logTailFile = null
  }

  /**
   * Kill the process tree of ONE profile's session (Minecraft spawns many
   * threads + subprocesses). Without a profileId, stops EVERY running
   * instance (used on app shutdown / clean release reset).
   */
  /**
   * Stop a game — an EMERGENCY EXIT that must close the process no matter
   * what (v1.0.26): graceful close request first (lets the game save the
   * world), then escalating OS-level force-kill with real exit verification
   * and a retry. Works even if the game is frozen, and regardless of any
   * other launcher state (update in progress, etc.).
   */
  async stop(profileId?: string): Promise<void> {
    const targets: GameSession[] = profileId
      ? this.sessions.has(profileId)
        ? [this.sessions.get(profileId)!]
        : []
      : [...this.sessions.values()]

    for (const session of targets) {
      const child = session.child
      if (!child || child.exitCode !== null) continue
      // A user-initiated stop must never look like a shader crash — mark it so
      // onExit can tell a forced kill apart from a real crash.
      const profile = session.profile
      if (profile) {
        try {
          const { markIntentionalStop } = await import('../anti-crash/shader-guard')
          markIntentionalStop(profile)
        } catch {
          /* best-effort */
        }
      }
      const pid = child.pid ?? 0
      if (pid <= 0) continue
      logger.info(`Stopping game process for "${profile?.name ?? profileId ?? '?'}" (pid ${pid})`)
      this.emitLog('system', 'Stopping game…')

      // 1) GRACEFUL FIRST — a clean close request (WM_CLOSE on Windows; the
      // game saves the world and exits on its own). Short window only.
      let path: 'graceful' | 'force' | 'force-retry' = 'graceful'
      if (process.platform === 'win32') {
        await taskkillPid(pid, false)
      } else {
        try {
          child.kill('SIGTERM')
        } catch {
          /* process may already be gone */
        }
      }
      if (!(await waitForPidExit(pid, 4000))) {
        // 2) FORCE — OS-level kill of the whole process tree.
        path = 'force'
        this.emitLog('system', 'Game did not close on its own — force-stopping…')
        if (process.platform === 'win32') {
          await taskkillPid(pid, true)
        } else {
          try {
            child.kill('SIGKILL')
          } catch {
            /* ignore */
          }
        }
        if (!(await waitForPidExit(pid, 3000))) {
          // 3) RETRY the force-kill once — the game may be mid-crash-loop.
          path = 'force-retry'
          if (process.platform === 'win32') {
            await taskkillPid(pid, true)
          } else {
            try {
              child.kill('SIGKILL')
            } catch {
              /* ignore */
            }
          }
          await waitForPidExit(pid, 2000)
        }
      }
      const gone = !pidAlive(pid)
      logger.info(`Stop for "${profile?.name ?? profileId ?? '?'}": ${path} path, pid ${pid} ${gone ? 'confirmed exited' : 'STILL ALIVE'}`)

      // 4) VERIFY + CLEAR UI STATE IMMEDIATELY. Spawned sessions get their
      // 'close' event -> onExit which clears everything; reattached sessions
      // (survived a launcher restart) have no 'close' event, so clear their
      // state right now instead of waiting up to 3 s for the watch poll.
      if (gone && session.reattached && this.sessions.get(session.profile.id) === session) {
        this.stopWindowWatch(session)
        this.sessions.delete(session.profile.id)
        eventBus.emit('launch:status', { profileId: session.profile.id, running: false })
        const duration = Math.max(0, (Date.now() - session.startedAt) / 1000)
        eventBus.emit('launch:exit', { code: null, signal: null, duration, profileId: session.profile.id })
        void profileManager.recordLaunch(session.profile.id, duration, false).catch(() => {})
      }
    }
  }

  /** Stop every running instance (shutdown / reset). */
  async stopAll(): Promise<void> {
    await this.stop()
  }

  /* --------------------------- reattach (v1.0.19) --------------------------- */

  /**
   * Reconnect monitoring to a game process that survived a launcher restart
   * (Minecraft must survive launcher updates). The caller has already
   * validated the PID is alive; here we register a lightweight session that
   * watches the PID and reports exit + playtime without reattaching stdout.
   */
  async reattach(profileId: string, pid: number, startedAt: number): Promise<boolean> {
    const profile = await profileManager.get(profileId)
    if (!profile || this.sessions.has(profileId) || !Number.isFinite(pid) || pid <= 0) return false
    const session: GameSession = {
      profile,
      child: { pid, exitCode: null } as unknown as ChildProcess,
      startedAt: startedAt || Date.now(),
      sessionLog: null,
      sessionLogPath: null,
      windowPoller: null,
      windowOpenedAt: 0,
      logTailFile: null,
      logTailOffset: 0,
      logTailTimer: null,
      reattached: true
    }
    this.sessions.set(profileId, session)
    logger.info(`Reconnected to running Minecraft for "${profile.name}" (pid ${pid}) after a launcher restart`)
    eventBus.emit('launch:status', { profileId, running: true, pid })
    this.startReattachWatch(session)
    // v1.0.25 — restore the console view by tailing the game's own log file.
    this.startLogTail(session)
    return true
  }

  /** Poll a reattached PID; when it disappears, close the session like a normal exit. */
  private startReattachWatch(session: GameSession): void {
    const pid = session.child.pid
    const started = session.startedAt
    session.windowPoller = setInterval(() => {
      if (this.sessions.get(session.profile.id) !== session) {
        this.stopWindowWatch(session)
        return
      }
      if (!pid || !pidAlive(pid)) {
        this.stopWindowWatch(session)
        const duration = Math.max(0, (Date.now() - started) / 1000)
        this.sessions.delete(session.profile.id)
        eventBus.emit('launch:status', { profileId: session.profile.id, running: false })
        eventBus.emit('launch:exit', { code: null, signal: null, duration, profileId: session.profile.id })
        void profileManager.recordLaunch(session.profile.id, duration, false).catch(() => {})
        logger.info(`Reconnected game for "${session.profile.name}" exited after ${Math.round(duration)}s`)
      }
    }, 3000)
  }

  /* ---------------------------------- events ---------------------------------- */

  /** Write the Reimagined performance config — RPE tier-tuned values. */
  private async seedFpsBoostConfig(gameDir: string): Promise<void> {
    try {
      const rpe = await import('../perf/engine')
      const hw = await rpe.detectHardware(false)
      const { tier } = rpe.effectiveTier(settingsManager.get(), hw)
      const config = rpe.fpsConfigFor(tier, hw)
      // v1.0.29 — Extended View: the user's Settings choices win over the tier
      // defaults, exactly like unlimitedFps overrides below. Without this the
      // SettingsPage controls would seed nothing (UI-only).
      const s = settingsManager.get()
      config.extendedView = s.extendedView ?? true
      config.extendedViewDistance = s.extendedViewDistance ?? 32
      config.extendedCacheLimitMB = s.extendedCacheLimitMB ?? 512
      // v1.0.30 — async server-chunk decode (user override wins over the tier
      // default, same pattern as Extended View above).
      config.asyncChunkDecode = s.asyncChunkDecode ?? true
      const dir = path.join(gameDir, 'config')
      fs.mkdirSync(dir, { recursive: true })
      // v1.0.13 frame-rate safety: by default the engine applies a safe FPS
      // cap everywhere (options.txt + the in-game watchdog via the JVM flag +
      // the mod config). When the user opted into "unlimited FPS" (warned in
      // Settings), ALL of those mechanisms must be off — including the mod
      // config, or the watchdog would silently re-cap the game anyway.
      if (settingsManager.get().unlimitedFps) {
        fs.writeFileSync(
          path.join(dir, 'reimagined-fps-boost.json'),
          JSON.stringify({ ...config, unlimitedFps: true, maxFps: 0 }, null, 2)
        )
        // v1.0.42 — even in unlimited mode, neutralize any stale cap persisted
        // in options.txt by an older launcher (maxFps:60 etc.) so the game
        // actually runs uncapped.
        rpe.applyFrameCap(gameDir, 260)
        logger.info('RPE: unlimited FPS enabled by the user — no frame cap applied (thermal/power risk warned in Settings).')
      } else {
        fs.writeFileSync(path.join(dir, 'reimagined-fps-boost.json'), JSON.stringify(config, null, 2))
        rpe.applyFrameCap(gameDir, Number(config.maxFps) || 120)
        logger.info(`RPE: seeded FPS Boost config for tier "${tier}" (render cap ${String(config.smartRdCap)}, fps cap ${String(config.maxFps)})`)
      }
    } catch (err) {
      logger.warn(`Could not write FPS Boost config: ${(err as Error).message}`)
    }
  }

  private emitProgress(stage: LaunchStage, message: string, percent?: number | null, detail?: string): void {
    const p: LaunchProgress = { stage, message, percent: percent ?? null, detail }
    eventBus.emit('launch:progress', p)
  }

  private emitLog(stream: LaunchLogLine['stream'], text: string): void {
    const line: LaunchLogLine = { at: new Date().toISOString(), stream, text }
    eventBus.emit('launch:log', line)
  }
}

/** True when a process exists right now (Windows-safe: ESRCH = gone, EPERM = alive). */
export function pidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

/**
 * v1.0.26 — run taskkill for one PID. `force` false = graceful close request
 * (WM_CLOSE), `force` true = /T /F kill of the whole process tree.
 */
function taskkillPid(pid: number, force: boolean): Promise<void> {
  const args = ['/pid', String(pid), ...(force ? ['/T', '/F'] : [])]
  return new Promise<void>((resolve) => {
    const killer = spawn('taskkill', args, { windowsHide: true })
    killer.on('close', () => resolve())
    killer.on('error', () => resolve())
  })
}

/** Poll pidAlive until the process is gone or the timeout elapses. */
async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return !pidAlive(pid)
}

export const launcher = new Launcher()
