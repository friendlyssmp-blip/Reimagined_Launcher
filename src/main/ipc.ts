/**
 * IPC layer.
 *
 * Every invoke returns a result envelope: `{ ok: true, data }` or
 * `{ ok: false, error: { code, message, hint } }`. The renderer never sees
 * raw exceptions — just friendly, actionable errors.
 *
 * Push events (auth state, launch output, download progress) stream over
 * the single event channel defined in `src/shared/ipc.ts`.
 */
import path from 'node:path'
import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { IPC, EVENT_CHANNEL, type AppEvent } from '@shared/ipc'
import { paths, appVersion, dataRoot, isPackaged } from './paths'
import { logger, configureLogger, cleanupOldLogs, clearLogs } from './logs/logger'
import { settingsManager } from './settings/settings-manager'
import { accountStore } from './auth/account-store'
import { microsoftAuth } from './auth/microsoft-auth'
import { versionManager } from './minecraft/version-manager'
import { getFabricLoaders, latestFabricLoader } from './minecraft/loaders/fabric'
import { getForgeVersions, recommendedForgeVersion } from './minecraft/loaders/forge'
import { profileManager } from './profiles/profile-manager'
import { modManager } from './mods/mod-manager'
import type { ProjectType } from './mods/modrinth'
import { launcher } from './minecraft/launcher'
import { futureSystems } from './mods/placeholders'
import { shareService } from './share/share'
import {
  openConsoleWindow,
  hideConsoleWindow,
  closeConsoleWindow,
  consoleWindowRef,
  getConsoleState
} from './console-window'
import { eventBus } from './core/event-bus'
import { pickJava, detectJavaRuntimes } from './minecraft/java'
import type { AccountPublic, LauncherSettings } from '@shared/types'

type Handler = (payload: any) => unknown

export function registerIpcHandlers(win: BrowserWindow): void {
  const send = (event: AppEvent): void => {
    if (!win.isDestroyed()) win.webContents.send(EVENT_CHANNEL, event)
  }

  // Forward every app event to the renderer.
  const offAll = eventBus.subscribeAll((event) => { if (!win.isDestroyed()) win.webContents.send(EVENT_CHANNEL, event) })
  win.on('closed', offAll)

  const on = (channel: string, handler: Handler): void => {
    ipcMain.handle(channel, async (_event, payload) => {
      try {
        const data = await handler(payload)
        return { ok: true, data }
      } catch (err) {
        const code = err instanceof Error ? (err as any).code ?? 'ERROR' : 'ERROR'
        const message = err instanceof Error ? err.message : String(err)
        const hint = (err as any).hint
        logger.error(`IPC ${channel} failed [${code}]: ${message}`)
        return { ok: false, error: { code, message, hint } }
      }
    })
  }

  /* ------------------------------- app / window ------------------------------- */

  on(IPC.appGetInfo, () => ({
    version: appVersion,
    platform: process.platform,
    isDev: !isPackaged,
    dataRoot
  }))

  on(IPC.windowMinimize, () => win.minimize())
  on(IPC.windowToggleMaximize, () => (win.isMaximized() ? win.unmaximize() : win.maximize()))
  on(IPC.windowClose, () => win.close())
  on(IPC.windowIsMaximized, () => win.isMaximized())

  /* --------------------------------- settings --------------------------------- */

  on(IPC.settingsGet, () => settingsManager.get())

  on(IPC.settingsSet, async (patch: Partial<LauncherSettings>) => {
    const settings = await settingsManager.update(patch)
    if (patch.logLevel) configureLogger(settings)
    if (patch.keepLogDays !== undefined) void cleanupOldLogs(settings.keepLogDays)
    return settings
  })

  on(IPC.dialogPickJava, async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Select java.exe',
      filters: [{ name: 'Java executable', extensions: ['exe'] }],
      properties: ['openFile']
    })
    return res.canceled ? null : res.filePaths[0]
  })

  on(IPC.dialogPickFolder, async () => {
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    return res.canceled ? null : res.filePaths[0]
  })

  on(IPC.logsOpenFolder, async () => {
    await shell.openPath(paths.logs)
  })

  on(IPC.logsClear, () => clearLogs())

  on(IPC.logsRead, async () => {
    const { logger } = await import('./logs/logger')
    const recent = logger.recent()
    // Tail the on-disk log so the viewer shows persisted lines too.
    const { readFile } = await import('node:fs/promises')
    let fileTail: { at: string; level: string; text: string }[] = []
    try {
      const raw = await readFile(logger.todayPath(), 'utf-8')
      const lines = raw.split('\n').filter(Boolean).slice(-800)
      fileTail = lines.map((line) => {
        const m = line.match(/^\[(\S+ \S+)\] (\w+): (.*)$/)
        return m
          ? { at: m[1], level: m[2].toLowerCase(), text: m[3] }
          : { at: '', level: 'info', text: line }
      })
    } catch {
      /* no file yet */
    }
    return { recent, fileTail }
  })

  on(IPC.logsListFiles, async () => {
    const { listDir } = await import('./utils/fs')
    const files = await listDir(paths.logs)
    return files.filter((f) => f.endsWith('.log')).sort().reverse()
  })

  /** Renderer forwards its own errors/crashes so they reach the on-disk log. */
  on(IPC.logsWrite, async (payload: { level?: string; message?: string }) => {
    const level = payload?.level ?? 'info'
    const message = payload?.message ?? ''
    if (level === 'error') logger.error(`[renderer] ${message}`)
    else if (level === 'warn') logger.warn(`[renderer] ${message}`)
    else logger.info(`[renderer] ${message}`)
    return true
  })

  /* ------------------------------ worlds / packs / downloads ------------------------------ */

  on(IPC.worldsList, (profileId: string) =>
    import('./game/content').then((m) => m.listWorlds(profileId))
  )

  on(IPC.packsList, (payload: { profileId: string; kind: 'resourcepacks' | 'shaders' }) =>
    import('./game/content').then((m) => m.listPacks(payload.profileId, payload.kind))
  )

  on(IPC.downloadsList, () => import('./game/content').then((m) => m.listDownloads()))

  on(IPC.downloadsCancel, async (id: string) => {
    const { cancelDownload } = await import('./game/content')
    return cancelDownload(id)
  })

  // Reliable image proxy (V2 fix): download in MAIN (no CSP) with retries +
  // browser headers → data URL. Null when the image genuinely can't load.
  on(IPC.contentImage, async (url?: string) => {
    if (!url || typeof url !== 'string') return { dataUrl: null }
    const { fetchImageDataUrl } = await import('./utils/image-proxy')
    const dataUrl = await fetchImageDataUrl(url)
    return { dataUrl }
  })

  on(IPC.openInstanceFolder, async (payload: { profileId: string; sub?: string }) => {
    const { instanceSubPath, instanceRoot } = await import('./game/content')
    let target = payload?.sub
      ? await instanceSubPath(payload.profileId, payload.sub)
      : await instanceRoot(payload.profileId)
    if (!target) {
      const root = await instanceRoot(payload.profileId)
      if (!root) throw new Error('The instance folder does not exist yet. Launch the profile once to create it.')
      // Sub-folders (mods/, saves/, …) are created on demand so "Open Folder"
      // always works, even on a brand-new profile that has never launched.
      if (payload?.sub) {
        const { mkdirp } = await import('./utils/fs')
        mkdirp(path.join(root, payload.sub))
        target = path.join(root, payload.sub)
      } else {
        target = root
      }
    }
    await shell.openPath(target)
  })

  on(IPC.backupWorld, async (payload: { profileId: string; world: string }) => {
    const { instanceRoot } = await import('./game/content')
    const root = await instanceRoot(payload.profileId)
    if (!root) throw new Error('Instance folder not found.')
    const { exists, copyDir, mkdirp, remove } = await import('./utils/fs')
    const src = path.join(root, 'saves', payload.world)
    if (!exists(src)) throw new Error(`World "${payload.world}" not found.`)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const dest = path.join(root, 'backups', `${payload.world}-${stamp}`)
    mkdirp(dest)
    await copyDir(src, dest)
    await remove(path.join(dest, 'session.lock'))
    logger.info(`World backup created: ${payload.world}`)
    return { destination: dest }
  })

  /* ----------------------------------- auth ----------------------------------- */

  on(IPC.authGetAccount, async (): Promise<AccountPublic> => {
    let account = accountStore.get()
    if (!account) return { profile: null, status: 'offline', lastRefreshedAt: null }
    // Startup re-validation: try to refresh an expiring session before
    // reporting it as usable — never show a dead session as ready-to-play.
    if (account.tokens.expiresAt - Date.now() < 10 * 60_000) {
      account = (await microsoftAuth.refreshIfNeeded()) ?? account
    }
    const status = account.tokens.expiresAt - Date.now() > 5 * 60_000 ? 'online' : 'expired'
    return { profile: account.profile, status, lastRefreshedAt: account.lastRefreshedAt }
  })

  on(IPC.authStart, () => microsoftAuth.startDeviceCode())
  on(IPC.authCancel, () => microsoftAuth.cancel())
  on(IPC.authLogout, () => microsoftAuth.logout())

  /* ------------------------------ minecraft versions ------------------------------ */

  on(IPC.versionsList, async () => {
    const versions = await versionManager.listVersions()
    const showSnapshots = settingsManager.get().showSnapshots
    return versions
      .filter((v) => showSnapshots ? (v.type === 'release' || v.type === 'snapshot') : v.type === 'release')
      .sort((a, b) => b.releaseTime.localeCompare(a.releaseTime))
      .map((v) => v.id)
  })

  on(IPC.loadersFor, async (payload: { mcVersion: string }) => {
    const mc = payload?.mcVersion
    if (!mc) return { fabric: [], forge: [], recommendedFabric: null, recommendedForge: null }
    const [fabric, forge, recFabric, recForge] = await Promise.allSettled([
      getFabricLoaders(mc),
      getForgeVersions(mc),
      latestFabricLoader(mc),
      recommendedForgeVersion(mc)
    ])
    return {
      fabric: fabric.status === 'fulfilled' ? fabric.value : [],
      forge: forge.status === 'fulfilled' ? forge.value : [],
      recommendedFabric: recFabric.status === 'fulfilled' ? recFabric.value : null,
      recommendedForge: recForge.status === 'fulfilled' ? recForge.value : null
    }
  })

  /* --------------------------------- profiles --------------------------------- */

  on(IPC.profilesList, () => profileManager.list())
  on(IPC.profilesCreate, (input) => profileManager.create(input))
  on(IPC.profilesUpdate, (payload) => profileManager.update(payload.id, payload.patch))
  on(IPC.profilesDelete, async (payload: { id?: string; deleteFiles?: boolean }) => {
    // Never delete files while they are actively being written to.
    const { cancelActiveDownloads } = await import('./game/content')
    cancelActiveDownloads()
    return profileManager.delete(payload?.id ?? '', { deleteFiles: payload?.deleteFiles ?? true })
  })
  on(IPC.profilesDuplicate, (payload: { id: string; opts?: { name?: string; copyWorlds?: boolean } }) =>
    profileManager.duplicate(payload.id, payload.opts ?? {})
  )
  on(IPC.profilesPrepare, (id) => profileManager.prepare(id))

  /* ----------------------------------- mods ----------------------------------- */

  on(IPC.modsList, (profileId) => modManager.list(profileId))
  on(IPC.modsSearch, (payload) =>
    modManager.search(payload.profileId, payload.query ?? '', payload.index ?? undefined, payload.opts ?? undefined)
  )
  on(IPC.modsCategories, () => modManager.categories())
  on(IPC.modsInstall, (payload) =>
    modManager.install(payload.profileId, payload.projectId, payload.projectType ?? 'mod')
  )
  on(IPC.modsRemove, (payload) => modManager.remove(payload.profileId, payload.slug))
  on(IPC.modsCheckUpdates, (profileId) => modManager.checkUpdates(profileId))
  on(IPC.modsUpdate, (payload) => modManager.update(payload.profileId, payload.slug))
  on(IPC.modsLocalFiles, (profileId: string, projectType?: string) => modManager.localModFiles(profileId, (projectType ?? 'mod') as ProjectType))
  on(IPC.modsIdentifyManual, (profileId) => modManager.identifyManualMods(profileId))
  on(IPC.modsRemoveLocalFile, (payload: { profileId: string; filename: string; projectType?: string }) =>
    modManager.removeLocalFile(payload.profileId, payload.filename, (payload.projectType ?? 'mod') as ProjectType))
  on(IPC.modsSearchCurseforge, (payload) =>
    modManager.searchCurseforge(payload.profileId, payload.query ?? '', payload.sort ?? undefined, payload.projectType ?? 'mod')
  )
  on(IPC.modsInstallCurseforge, (payload) =>
    modManager.installCurseforge(
      payload.profileId,
      payload.projectId,
      {
        title: payload.title ?? undefined,
        iconUrl: payload.iconUrl ?? undefined,
        downloads: payload.downloads ?? undefined
      },
      payload.projectType ?? 'mod'
    )
  )
  on(IPC.modsChangeVersion, (payload) =>
    modManager.changeVersion(payload.profileId, payload.slug, payload.versionId)
  )
  on(IPC.modsSetEnabled, (payload) =>
    modManager.setEnabled(payload.profileId, payload.slug, Boolean(payload.enabled))
  )
  on(IPC.modsAvailableVersions, (payload) =>
    modManager.availableVersions(payload.profileId, payload.slug)
  )
  on(IPC.modsInstallVersion, (payload) =>
    modManager.installVersion(
      payload.profileId,
      payload.provider,
      payload.projectId,
      payload.versionId,
      payload.projectType ?? 'mod'
    )
  )
  // Install confirmation — real dependency data + install-with-dependencies.
  on(IPC.modsDependencies, (payload) =>
    modManager.resolveDependencies(
      payload.profileId,
      payload.projectId,
      payload.versionId,
      payload.projectType ?? 'mod'
    )
  )
  on(IPC.modsInstallWithDeps, (payload) =>
    modManager.installWithDeps(
      payload.profileId,
      payload.projectId,
      payload.versionId ?? undefined,
      payload.projectType ?? 'mod'
    )
  )

  /* ----------------------------- modpacks (Modrinth) ----------------------------- */

  on(IPC.modpacksSearch, async (payload: { query?: string; mcVersion?: string; loader?: string; offset?: number; limit?: number }) => {
    const { searchModpacks } = await import('./mods/modpacks')
    return searchModpacks({
      query: payload?.query ?? '',
      mcVersion: payload?.mcVersion || undefined,
      loader: (payload?.loader as 'fabric' | 'forge' | 'any' | undefined) ?? 'any',
      offset: payload?.offset ?? 0,
      limit: payload?.limit ?? 24
    })
  })

  on(IPC.modpacksInstall, async (payload: { projectId?: string; versionId?: string; name?: string }) => {
    const projectId = payload?.projectId
    const versionId = payload?.versionId
    if (!projectId || !versionId) throw new Error('Missing modpack project or version id.')
    const { installModpack } = await import('./mods/modpacks')
    return installModpack(projectId, versionId, payload?.name)
  })

  /* --------------------------- content detail (Part 5) --------------------------- */

  on(IPC.contentDetail, async (payload: { provider?: string; projectId?: string; projectType?: string }) => {
    const projectId = payload?.projectId
    if (!projectId) throw new Error('Missing project id.')
    const projectType = payload?.projectType ?? 'mod'
    if (payload?.provider === 'curseforge') {
      const { curseforge } = await import('./mods/curseforge')
      return curseforge.getProjectFull(projectId, projectType)
    }
    const { modrinth } = await import('./mods/modrinth')
    return modrinth.getProjectFull(projectId, projectType as 'mod' | 'resourcepack' | 'shader' | 'datapack')
  })

  on(IPC.contentVersions, async (payload: { provider?: string; projectId?: string; projectType?: string }) => {
    const projectId = payload?.projectId
    if (!projectId) throw new Error('Missing project id.')
    const projectType = payload?.projectType ?? 'mod'
    if (payload?.provider === 'curseforge') {
      const { curseforge } = await import('./mods/curseforge')
      return curseforge.listVersions(projectId, projectType)
    }
    const { modrinth } = await import('./mods/modrinth')
    return modrinth.listVersions(projectId, projectType as 'mod' | 'resourcepack' | 'shader' | 'datapack')
  })

  on(IPC.contentModpackContents, async (payload: { versionId?: string }) => {
    const { modpackContents } = await import('./mods/modpacks')
    return modpackContents(payload?.versionId ?? '')
  })

  // CurseForge release notes are per-file — fetch one at a time on demand.
  on(IPC.contentChangelog, async (payload: { projectId?: string; versionId?: string }) => {
    const projectId = payload?.projectId
    const versionId = payload?.versionId
    if (!projectId || !versionId) throw new Error('Missing project or version id.')
    const { curseforge } = await import('./mods/curseforge')
    return curseforge.fileChangelog(projectId, versionId)
  })

  /* ---------------------------------- launch ---------------------------------- */

  on(IPC.launchStart, (profileId) => launcher.launch(profileId))
  // v1.0.15 multi-instance: Stop targets ONE profile's session; without a
  // profileId it stops every running instance (backward compatible).
  on(IPC.launchStop, (profileId?: string) => launcher.stop(profileId))
  on(IPC.launchGet, () => launcher.handle)
  on(IPC.launchList, () => launcher.handles)

  /* --------------------------- detached console window --------------------------- */

  on(IPC.consoleOpen, () => {
    openConsoleWindow()
    return true
  })
  on(IPC.consoleClose, () => {
    // Hiding (not destroying) keeps the game running and makes re-opening
    // instant. The window is destroyed lazily with the app.
    hideConsoleWindow()
    return true
  })
  on(IPC.consoleMinimize, () => {
    consoleWindowRef()?.minimize()
    return true
  })
  on(IPC.consoleToggleMaximize, () => {
    const w = consoleWindowRef()
    if (w) (w.isMaximized() ? w.unmaximize() : w.maximize())
    return true
  })
  on(IPC.consoleGetState, () => getConsoleState())

  /* ----------------------------------- skins ----------------------------------- */

  /* Only the face-icon texture loader remains; the skin library/editor is gone. */

  on(IPC.skinTexture, async (payload: { url?: string }) => {
    const url = payload?.url
    if (!url) throw new Error('No texture URL provided.')
    let buf: Buffer
    if (url.startsWith('data:')) {
      const b64 = url.slice(url.indexOf(',') + 1)
      buf = Buffer.from(b64, 'base64')
    } else if (url.startsWith('file://')) {
      const { readFileSync } = await import('node:fs')
      buf = readFileSync(url.slice('file://'.length))
    } else {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 20_000)
      try {
        const res = await fetch(url, { signal: ctrl.signal })
        if (!res.ok) throw new Error(`Could not download the skin texture (HTTP ${res.status}).`)
        buf = Buffer.from(await res.arrayBuffer())
      } finally {
        clearTimeout(timer)
      }
    }
    // PNG IHDR: bytes 16-23 hold width/height (big-endian).
    let width = 64
    let height = 64
    if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
      width = buf.readUInt32BE(16)
      height = buf.readUInt32BE(20)
    }
    return { dataUrl: `data:image/png;base64,${buf.toString('base64')}`, width, height }
  })
  /* ---------------------------------- updates ---------------------------------- */

  /* Real GitHub release updater (Settings → Updates → repo owner/repo). */
  on(IPC.updateCheck, async (force?: boolean) => {
    const { updater } = await import('./updater/updater')
    // force=true bypasses the 30-minute cache so the manual "Check for
    // updates" button (and the startup/periodic checks) always see the
    // truth from GitHub — never a stale "up to date".
    return updater.check(Boolean(force))
  })

  on(IPC.updateGetInfo, async () => {
    const { updater } = await import('./updater/updater')
    return updater.getInfo()
  })

  on(IPC.updateDownload, async () => {
    const { updater } = await import('./updater/updater')
    return updater.download()
  })

  on(IPC.updateInstall, async () => {
    const { updater } = await import('./updater/updater')
    return updater.install()
  })

  /* ------------------------------- performance engine (RPE) ------------------------------- */

  on(IPC.perfStatus, async () => {
    const { engine } = await import('./perf/engine')
    return engine.perfStatus()
  })

  on(IPC.perfRecommendations, async (profileId?: string) => {
    const { engine } = await import('./perf/engine')
    return engine.buildRecommendations(profileId || undefined)
  })

  on(IPC.perfApply, async (payload: { id?: string; profileId?: string }) => {
    const { engine } = await import('./perf/engine')
    return engine.applyRecommendation(payload ?? {})
  })

  on(IPC.perfMods, async (profileId: string) => {
    const { listPerfMods } = await import('./perf/mods')
    return listPerfMods(profileId)
  })

  on(IPC.perfInstallMod, async (payload: { profileId?: string; slug?: string }) => {
    const { installPerfMod } = await import('./perf/mods')
    if (!payload?.profileId || !payload?.slug) throw new Error('Missing profile or mod.')
    await installPerfMod(payload.profileId, payload.slug)
    return true
  })

  on(IPC.perfRemoveMod, async (payload: { profileId?: string; slug?: string }) => {
    const { removePerfMod } = await import('./perf/mods')
    if (!payload?.profileId || !payload?.slug) throw new Error('Missing profile or mod.')
    await removePerfMod(payload.profileId, payload.slug)
    return true
  })

  /* ------------------------------ Reimagined FPS Boost ------------------------------ */

  // Manual install/remove of the bundled FPS Boost (V2) — per profile.
  on(IPC.fpsBoostStatus, async (profileId: string) => {
    const { fpsBoostCompatible, fpsBoostInstalled } = await import('./mods/fps-boost')
    const { profileManager } = await import('./profiles/profile-manager')
    const profile = await profileManager.get(profileId)
    if (!profile) throw new Error('Profile not found.')
    const installed = profile.mods.some((m) => m.id === 'reimagined-fps-boost')
    const compatible = fpsBoostCompatible(profile.minecraftVersion)
    return { installed, compatible, version: installed ? profile.mods.find((m) => m.id === 'reimagined-fps-boost')?.versionNumber ?? null : null, mcVersion: profile.minecraftVersion }
  })

  on(IPC.fpsBoostInstall, async (profileId: string) => {
    const { installFpsBoost } = await import('./mods/fps-boost')
    const res = await installFpsBoost(profileId)
    eventBus.emit('mods:changed', { profileId, action: 'fpsboost-installed' })
    return res
  })

  on(IPC.fpsBoostRemove, async (profileId: string) => {
    const { removeFpsBoost } = await import('./mods/fps-boost')
    const res = await removeFpsBoost(profileId)
    eventBus.emit('mods:changed', { profileId, action: 'fpsboost-removed' })
    return res
  })

  /* ------------------------------ shader / crash safety ------------------------------ */

  // Real GPU/driver assessment for the shader rendering path (anti-crash).
  // recoveryPending reflects the ACTUAL armed crash flag (the signal that
  // really triggers auto-disable on the next launch), not the crash history.
  on(IPC.shadersSupport, async (profileId?: string) => {
    const { assessShaderSupport, recentShaderCrashes, shaderCrashPending } = await import('./anti-crash/shader-guard')
    const { detectHardware } = await import('./perf/hardware')
    const hw = await detectHardware(false)
    const support = assessShaderSupport(hw)
    const crashes = await recentShaderCrashes()
    support.recoveryPending = false
    if (profileId) {
      const { profileManager } = await import('./profiles/profile-manager')
      const profile = await profileManager.get(profileId)
      if (profile) support.recoveryPending = shaderCrashPending(profile)
    }
    return { ...support, recentCrashes: crashes }
  })

  // Manually disable shaders for a profile (Settings → Shader Safety).
  on(IPC.shadersDisable, async (profileId: string) => {
    const { profileManager } = await import('./profiles/profile-manager')
    const { disableShadersForSession } = await import('./anti-crash/shader-guard')
    const profile = await profileManager.get(profileId)
    if (!profile) throw new Error('Profile not found.')
    disableShadersForSession(profile)
    return true
  })

  /* ------------------------------ future systems ------------------------------ */

  on(IPC.modpackExport, (profileId) => futureSystems.modpack.export(profileId))
  on(IPC.modpackImport, (zipPath) => futureSystems.modpack.import(zipPath))
  on(IPC.cloudSync, () => futureSystems.cloud.sync())

  /* ---------------------------- profile share / import ---------------------------- */

  on(IPC.sharePrepare, (profileId) => shareService.prepareSnapshot(profileId))
  on(IPC.shareCreate, (profileId) => shareService.createCode(profileId))
  on(IPC.shareResolve, (code) => shareService.resolveCode(code))
  on(IPC.shareImport, (code) => shareService.importCode(code))
  on(IPC.shareCancel, () => shareService.cancelImport())
  on(IPC.sharePendingCode, () => shareService.takePendingDeepLink())
  on(IPC.shareExportZip, (profileId) => shareService.exportZipWithDialog(profileId))
  on(IPC.shareReadZip, (zipPath) => shareService.readZip(zipPath))
  on(IPC.shareImportZip, (zipPath) => shareService.importZip(zipPath))
  on(IPC.sharePickZip, async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Select a Reimagined profile export (.zip)',
      filters: [{ name: 'Reimagined profile export', extensions: ['zip'] }],
      properties: ['openFile']
    })
    return res.canceled ? null : res.filePaths[0]
  })

  /* -------------------------------- system -------------------------------- */

  on('system:getMemory', async () => {
    const { getRecommendedMemory } = await import('./settings/settings-manager')
    return getRecommendedMemory()
  })

  on(IPC.systemCleanReset, async () => {
    const { cleanReleaseReset } = await import('./system/reset')
    await cleanReleaseReset()
    return true
  })

  /* ----------------------------------- java ----------------------------------- */

  ipcMain.handle('java:runtimes', async () => {
    try {
      return { ok: true, data: detectJavaRuntimes() }
    } catch (err) {
      return { ok: false, error: { code: 'JAVA_SCAN', message: (err as Error).message } }
    }
  })
  ipcMain.handle('java:pick', async (_e, major) => {
    try {
      return { ok: true, data: pickJava(major ?? 8) }
    } catch (err) {
      return { ok: false, error: { code: 'JAVA_PICK', message: (err as Error).message } }
    }
  })
}
