/**
 * The launch pipeline.
 *
 * resolve → prepare (client/libraries/assets/log4j) → build JVM+game args →
 * spawn java → stream output → track session → record playtime.
 *
 * Fabric and Forge versions are prepared transparently by the loaders and
 * produce installer-grade version JSONs that flow through the same path as
 * vanilla.
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

class Launcher {
  private child: ChildProcess | null = null
  private profile: Profile | null = null
  private startedAt = 0
  private sessionLog: fs.WriteStream | null = null
  private sessionLogPath: string | null = null
  /** Poller that detects when the game's actual window appears (real signal). */
  private windowPoller: ReturnType<typeof setInterval> | null = null
  /** Epoch ms when the game window was confirmed open (0 = not yet). */
  private windowOpenedAt = 0

  isRunning(): boolean {
    return !!this.child && this.child.exitCode === null
  }

  get handle(): LaunchHandle {
    return {
      profileId: this.profile?.id ?? '',
      running: this.isRunning(),
      pid: this.child?.pid,
      startedAt: this.startedAt ? new Date(this.startedAt).toISOString() : undefined
    }
  }

  /** Launch-timing info for the game console's chronometer. */
  getLaunchTimes(): { startedAt: number; windowOpenedAt: number } {
    return { startedAt: this.startedAt, windowOpenedAt: this.windowOpenedAt }
  }

  async launch(profileId: string): Promise<LaunchHandle> {
    const profile = await profileManager.get(profileId)
    if (!profile) throw Errors.launchFailed('The selected profile no longer exists.')
    if (this.isRunning()) {
      throw new LauncherError('ALREADY_RUNNING', 'A game is already running.', 'Stop it first from the console.')
    }

    const account = accountStore.get()
    if (!account) throw Errors.notLoggedIn()
    const refreshed = await microsoftAuth.refreshIfNeeded()
    const acc = refreshed ?? account
    if (!acc.profile) throw Errors.launchFailed('Your Microsoft account has no Minecraft profile.')

    this.profile = profile
    this.startedAt = Date.now()
    this.windowOpenedAt = 0
    this.stopWindowWatch()

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
        // Seed the bundled Reimagined FPS Boost mod the same way.
        if (!profile.mods.some((m) => m.id === 'reimagined-fps-boost')) {
          const { ensureFpsBoost } = await import('../mods/fps-boost')
          await ensureFpsBoost(profile)
        }
        this.emitProgress('installing-loader', `Resolving Fabric for ${mc}…`)
        const loaderVersion = profile.loader.version ?? (await latestFabricLoader(mc))
        const fabric = await installFabric(mc, loaderVersion)
        versionId = fabric.versionId
        loaderLabel = `fabric ${fabric.loaderVersion}`
      } else if (profile.loader.type === 'forge') {
        this.emitProgress('installing-loader', `Resolving Forge for ${mc}…`)
        const loaderVersion = profile.loader.version ?? (await recommendedForgeVersion(mc))
        if (!loaderVersion) {
          throw new LauncherError('FORGE_MISSING', `No Forge build was found for Minecraft ${mc}.`, 'Choose another version or loader.')
        }
        const forge = await installForge(mc, loaderVersion)
        versionId = forge.versionId
        loaderLabel = `forge ${forge.forgeVersion}`
      }

      this.emitProgress('downloading', `Preparing ${mc} (${loaderLabel})…`, 0)
      // Resolve `inheritsFrom` chains (Forge installer JSONs inherit the base
      // version's client jar / asset index / base libraries).
      const vj = (await versionManager.ensureResolvedVersionJson(versionId)) as VersionJson
      const { classpath, nativesDir } = await versionManager.ensureLibraries(versionId, (kind) => this.emitProgress('downloading', `Preparing ${kind}...`, 0))
      const clientJar = await versionManager.ensureClient(versionId)
      if (!vj.assetIndex) throw Errors.launchFailed(`Version ${versionId} has no asset index.`)
      const assetsDir = await versionManager.ensureAssets(
        vj.assetIndex.id,
        vj.assetIndex as { id: string; url: string }
      )
      const log4jConfig = await versionManager.ensureLog4jConfig(versionId)

      const requiredMajor = vj.javaVersion?.majorVersion ?? 8
      const java = await pickJava(requiredMajor)
      if (!java) throw Errors.missingJava(requiredMajor)

      const gameDir = path.join(paths.games, profile.gameDir)
      fs.mkdirSync(path.join(gameDir, 'mods'), { recursive: true })
      // FPS Boost is ON by default for EVERY profile, Vanilla included — the
      // Reimagined performance layer reads this config (the Fabric mod only
      // carries the in-game knobs; the JVM flags apply regardless). The
      // values come from the RPE for the current hardware tier.
      await this.seedFpsBoostConfig(gameDir)

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

      this.emitProgress('launching', `Launching ${profile.name}…`, 100)
      this.spawn(java, args, gameDir, profile)
    } catch (err) {
      logger.exception('Launch pipeline failed', err)
      const message = err instanceof Error ? err.message : String(err)
      this.emitLog('system', `Launch failed: ${message}`)
      eventBus.emit('launch:status', { profileId, running: false, error: message })
      this.profile = null
      this.startedAt = 0
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

  private spawn(java: JavaRuntime, args: string[], gameDir: string, profile: Profile): void {
    const child = spawn(java.path, args, {
      cwd: gameDir,
      windowsHide: false,
      env: { ...process.env }
    })
    this.child = child
    this.openSessionLog(profile)

    const started = `Game launched for "${profile.name}" (pid ${child.pid}, Java ${java.major})`
    logger.info(started)
    this.emitLog('system', started)
    eventBus.emit('launch:status', { profileId: profile.id, running: true, pid: child.pid })
    this.startWindowWatch(child)

    child.stdout?.on('data', (d: Buffer) => this.onOutput('stdout', d))
    child.stderr?.on('data', (d: Buffer) => this.onOutput('stderr', d))

    child.on('error', (err) => {
      // A spawn-level failure (bad Java path, missing DLL…) means the launch
      // is over before any window appears. Always reset the UI state — the
      // renderer must never stay stuck on "Launching…".
      logger.exception('Game process error', err)
      this.emitLog('stderr', `Process error: ${err.message}`)
      this.stopWindowWatch()
      this.child = null
      this.profile = null
      this.startedAt = 0
      this.windowOpenedAt = 0
      eventBus.emit('launch:status', { profileId: profile.id, running: false, error: `Game process error: ${err.message}` })
    })

    child.on('close', (code, signal) => void this.onExit(code, signal))
  }

  private onOutput(stream: 'stdout' | 'stderr', chunk: Buffer): void {
    const text = chunk.toString('utf-8')
    this.sessionLog?.write(text)
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue
      this.emitLog(stream, line)
    }
  }

  private openSessionLog(profile: Profile): void {
    const file = path.join(paths.logs, `game-${profile.id}-${dateStamp()}-${Date.now()}.log`)
    try {
      this.sessionLog = fs.createWriteStream(file)
      this.sessionLogPath = file
      this.emitLog('system', `Session log: ${file}`)
    } catch {
      this.sessionLog = null
      this.sessionLogPath = null
    }
  }

  private async onExit(code: number | null, signal: string | null): Promise<void> {
    const profile = this.profile
    const duration = Math.max(0, (Date.now() - this.startedAt) / 1000)

    this.sessionLog?.end()
    this.sessionLog = null
    this.child = null
    this.stopWindowWatch()
    this.windowOpenedAt = 0

    logger.info(`Game exited (code ${code ?? 'null'}${signal ? `, signal ${signal}` : ''}) after ${Math.round(duration)}s`)
    this.emitLog('system', `Game exited with code ${code ?? 'n/a'}`)

    // RPE profiler: record this session's real measured performance.
    if (profile) {
      try {
        const { recordSessionFromLog } = await import('../perf/engine')
        await recordSessionFromLog(profile.id, profile.name, this.sessionLogPath)
      } catch {
        /* profiler is best-effort */
      }
      this.sessionLogPath = null
      await profileManager.recordLaunch(profile.id, duration, true)
      if (settingsManager.get().closeOnLaunch) {
        const { showMainWindow } = await import('../window')
        showMainWindow()
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
          eventBus.emit('crash:detected', report)
        }
      } catch {
        /* Crash Assistant is strictly best-effort — never breaks the exit flow */
      }
    }

    this.profile = null
    this.startedAt = 0
  }

  /**
   * Poll the spawned game process's main window handle (Windows). A non-zero
   * handle is the real "the game window is up" signal — the chronometer uses
   * the measured elapsed seconds between Play and this moment.
   */
  private startWindowWatch(child: ChildProcess): void {
    if (process.platform !== 'win32' || !child.pid) return
    this.stopWindowWatch()
    const pid = child.pid
    const started = Date.now()
    this.windowPoller = setInterval(() => {
      if (this.child !== child || child.exitCode !== null) {
        this.stopWindowWatch()
        return
      }
      execFile(
        'powershell',
        ['-NoProfile', '-Command', `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).MainWindowHandle`],
        { windowsHide: true, timeout: 4000 },
        (err, stdout) => {
          if (this.windowPoller === null) return
          const handle = Number(String(stdout ?? '').trim())
          if (Number.isFinite(handle) && handle > 0) {
            const elapsedSec = Math.max(0, Math.round((Date.now() - started) / 1000))
            this.windowOpenedAt = Date.now()
            logger.info(`Minecraft window opened after ${elapsedSec}s (pid ${pid})`)
            eventBus.emit('launch:window-open', { elapsedSec })
            this.stopWindowWatch()
          } else if (Date.now() - started > 180_000) {
            // Give up after 3 minutes — some configs never expose a handle.
            this.stopWindowWatch()
          }
        }
      )
    }, 1000)
  }

  private stopWindowWatch(): void {
    if (this.windowPoller) {
      clearInterval(this.windowPoller)
      this.windowPoller = null
    }
  }

  /** Kill the process tree (Minecraft spawns many threads + subprocesses). */
  async stop(): Promise<void> {
    const child = this.child
    if (!child || child.exitCode !== null) return
    logger.info('Stopping game process')
    this.emitLog('system', 'Stopping game…')
    if (process.platform === 'win32') {
      await new Promise<void>((resolve) => {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
        killer.on('close', () => resolve())
        killer.on('error', () => {
          child.kill('SIGTERM')
          resolve()
        })
      })
    } else {
      child.kill('SIGTERM')
    }
  }

  /* ---------------------------------- events ---------------------------------- */

  /** Write the Reimagined performance config — RPE tier-tuned values. */
  private async seedFpsBoostConfig(gameDir: string): Promise<void> {
    try {
      const rpe = await import('../perf/engine')
      const hw = await rpe.detectHardware(false)
      const { tier } = rpe.effectiveTier(settingsManager.get(), hw)
      const config = rpe.fpsConfigFor(tier, hw)
      const dir = path.join(gameDir, 'config')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'reimagined-fps-boost.json'), JSON.stringify(config, null, 2))
      logger.info(`RPE: seeded FPS Boost config for tier "${tier}" (render cap ${String(config.smartRdCap)})`)
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

export const launcher = new Launcher()
