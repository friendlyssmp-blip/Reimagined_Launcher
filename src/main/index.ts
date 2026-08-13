/**
 * Reimagined — application entry point.
 *
 * Boot order: data dirs → settings → logger → account → window → IPC.
 * Supports `--smoke-test` for CI-style verification without a window.
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, dialog, Menu, net, protocol } from 'electron'
import { paths, ensureDataDirs, appVersion } from './paths'
import { logger, configureLogger, cleanupOldLogs } from './logs/logger'
import { settingsManager } from './settings/settings-manager'
import { accountStore } from './auth/account-store'
import { microsoftAuth } from './auth/microsoft-auth'
import { profileManager } from './profiles/profile-manager'
import { instancePath } from './instances/paths'
import { ensureBenchWorld } from './benchmark/world'
import { shareService } from './share/share'
import { detectJavaRuntimes } from './minecraft/java'
import { registerIpcHandlers } from './ipc'
import { createMainWindow, getMainWindow } from './window'
import { createTray, destroyTray } from './tray'
import { eventBus } from './core/event-bus'
import type { Profile } from '@shared/types'

// Windows + hardware-accelerated Chromium can corrupt the UI surface and draw
// garbage glyphs/ghost text on top of the launcher (a known frameless-window
// compositor issue). Software rendering is visually flawless for a launcher UI
// and fixes it everywhere: main window, splash and the game console window.
// Must run before `app.whenReady()` — see https://electronjs.org/docs/latest/api/app#appdisablehardwareacceleration
// v1.0.85 — privileged protocol for the local music library: the renderer
// streams <audio> from reimagined-music://, which the main process serves
// ONLY from data/music (no arbitrary file reads).
protocol.registerSchemesAsPrivileged([
  { scheme: 'reimagined-music', privileges: { secure: true, supportFetchAPI: true, stream: true } },
  // v1.0.88 — instance screenshots (served only from that instance's folder).
  { scheme: 'reimagined-shot', privileges: { secure: true, supportFetchAPI: true, stream: true } }
])

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

        // v1.0.88 — streaming/recording detection: emits streaming:changed
        // events the renderer + FPS Boost config listen to (honors the
        // streamingAware setting — off means no detection at all).
        void import('./streaming/detect').then((m) => {
          m.startDetection((state) => {
            if (!settingsManager.get().streamingAware) return
            eventBus.emit('streaming:changed', state)
          })
        })

        // Serve the local music library over a locked-down custom protocol.
        const musicRoot = path.resolve(path.join(paths.data, 'music'))
        protocol.handle('reimagined-music', (request) => {
          try {
            const url = new URL(request.url)
            const name = decodeURIComponent(url.pathname.replace(/^\//, ''))
            const p = path.resolve(musicRoot, path.basename(name))
            if (!p.startsWith(musicRoot + path.sep)) return new Response('Forbidden', { status: 403 })
            return net.fetch(pathToFileURL(p).toString())
          } catch {
            return new Response('Not found', { status: 404 })
          }
        })

        // v1.0.88 — instance screenshots: reimagined-shot://shot/<profileId>/<file>
        // serves ONLY from that instance's screenshots folder.
        protocol.handle('reimagined-shot', (request) => {
          const serve = async (): Promise<Response> => {
            const url = new URL(request.url)
            const parts = url.pathname.replace(/^\//, '').split('/').map((s) => decodeURIComponent(s))
            if (parts.length !== 3 || parts[0] !== 'shot' || !parts[1] || !parts[2]) {
              return new Response('Not found', { status: 404 })
            }
            const profile = await profileManager.get(parts[1])
            if (!profile) return new Response('Not found', { status: 404 })
            const root = path.resolve(path.join(instancePath(profile), 'screenshots'))
            const p = path.resolve(root, path.basename(parts[2]))
            if (!p.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 })
            return net.fetch(pathToFileURL(p).toString())
          }
          return serve().catch(() => new Response('Not found', { status: 404 }))
        })

        logger.info('Launcher started successfully')
        logger.info(`Reimagined v${appVersion} — platform ${process.platform}/${process.arch}`)
        logger.info(`Data directory: ${paths.data}`)

        // Silent background token refresh + log cleanup.
        void microsoftAuth.refreshIfNeeded().catch(() => {})
        void cleanupOldLogs(settings.keepLogDays).catch(() => {})

        // v1.0.92: safe instance reorganization — move every instance from
        // data/games/<slug>-<id8> to data/Instances/<Human Name>. Non-
        // destructive: failures keep the original location and the central
        // resolver keeps working. Runs before any profile is used (incl. smoke).
        try {
          const { migrateInstances } = await import('./instances/migrate')
          const migration = await migrateInstances()
          if (migration.migratedSomething) {
            logger.info(`Instance reorganization: moved ${migration.moved.length} instance(s) to data/Instances/`)
          }
          if (migration.failed.length > 0) {
            logger.warn(`Instance reorganization: ${migration.failed.length} instance(s) could not be moved — original data preserved.`)
          }
        } catch (err) {
          logger.warn(`Instance reorganization could not run: ${(err as Error).message} — legacy layout keeps working.`)
        }

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
        createTray()

        // v1.0.85 — if the launcher's renderer ever crashes (e.g. memory
        // pressure while Minecraft is eating RAM), the window dies but the
        // APP must not: recreate the window so the game session, console and
        // tray keep working. This is the "the launcher closed by itself" fix.
        win.webContents.on('render-process-gone', (_e, details) => {
          logger.warn(`Launcher renderer crashed (${details.reason}) — rebuilding the window`)
          setTimeout(() => {
            if (getMainWindow()) return
            try {
              const w2 = createMainWindow()
              registerIpcHandlers(w2)
              createTray()
            } catch (err) {
              logger.exception('Could not rebuild the window after renderer crash', err)
            }
          }, 800)
        })

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
    if (process.platform === 'darwin') return
    // v1.0.85 — NEVER let the launcher die while a game is running: closing
    // the window (even accidentally) only hides it to the tray, keeping the
    // game session and console alive. With no game, quit as before.
    void import('./minecraft/launcher')
      .then(({ launcher }) => {
        if (launcher.isRunning()) {
          logger.info('Window closed while a game is running — keeping the launcher alive in the tray')
          // app stays alive; the user can reopen from the tray
        } else {
          app.quit()
        }
      })
      .catch(() => app.quit())
  })

  // v1.0.19: before a normal quit, remember which Minecraft processes are
  // still running so the next launch reconnects to them (never kill them).
  // The quit is deferred until the snapshot is safely on disk — `before-quit`
  // is not awaited by Electron, so a fire-and-forget write could be lost.
  let quitSessionsSaved = false
  app.on('before-quit', (e) => {
    if (SMOKE || BENCH || quitSessionsSaved) return
    quitSessionsSaved = true
    destroyTray()
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

  // v1.0.81 — .zip exports can bundle REAL instance folders (worlds, configs,
  // mods…). Export → read → import must restore the files into the fresh
  // instance and register bundled content as installed.
  await ok('share zip folders: export with files → import restores worlds/config/mods', async () => {
    const { shareService } = await import('./share/share')
    const { mkdirp } = await import('./utils/fs')
    const { zipCreate } = await import('./utils/zip')
    const fsp = await import('node:fs/promises')
    const pathMod = await import('node:path')

    const source = await profileManager.create({
      name: 'Share Zip Smoke',
      minecraftVersion: '1.21.4',
      loader: { type: 'vanilla', version: null }
    })
    try {
      const dir = instancePath(source)
      // A world, a config file and a manually-placed mod jar.
      mkdirp(pathMod.join(dir, 'saves', 'World1'))
      await fsp.writeFile(pathMod.join(dir, 'saves', 'World1', 'level.dat'), Buffer.from('fake-world-bytes'))
      mkdirp(pathMod.join(dir, 'config'))
      await fsp.writeFile(pathMod.join(dir, 'config', 'example.toml'), 'enabled = true\n')
      mkdirp(pathMod.join(dir, 'mods'))
      const fakeJar = zipCreate([
        { name: 'fabric.mod.json', data: JSON.stringify({ id: 'smoke-mod', name: 'Smoke Mod', version: '1.0.0' }) }
      ])
      await fsp.writeFile(pathMod.join(dir, 'mods', 'smoke-mod.jar'), fakeJar)

      const zipPath = pathMod.join(process.env.TEMP ?? '/tmp', `smoke-share-folders-${Date.now()}.zip`)
      await shareService.exportZip(source.id, zipPath, ['saves', 'config', 'mods'])

      // v1.0.81 — the export must be a UNIVERSAL .mrpack (Modrinth / Lunar…).
      const { zipReadEntry } = await import('./utils/zip')
      const exported = await fsp.readFile(zipPath)
      const idxRaw = zipReadEntry(exported, 'modrinth.index.json')
      if (!idxRaw) throw new Error('export is not a valid .mrpack (missing modrinth.index.json)')
      const idx = JSON.parse(idxRaw.toString('utf-8'))
      if (idx.formatVersion !== 1 || idx.game !== 'minecraft') throw new Error('mrpack index invalid')
      if (!idx.dependencies?.minecraft) throw new Error('mrpack dependencies incomplete')
      if (!zipReadEntry(exported, 'reimagined-manifest.json')) throw new Error('embedded Reimagined manifest missing')

      const snap = await shareService.readZip(zipPath)
      if (!snap.folders || !snap.folders.includes('saves')) throw new Error('folders missing from manifest')

      const imported = await shareService.importZip(zipPath)
      const importedProfile = await profileManager.get(imported.profileId)
      if (!importedProfile) throw new Error('import did not create the profile')
      const idir = instancePath(importedProfile)
      const world = await fsp.readFile(pathMod.join(idir, 'saves', 'World1', 'level.dat'), 'utf-8').catch(() => '')
      if (!world.includes('fake-world-bytes')) throw new Error('world file was not restored')
      const cfg = await fsp.readFile(pathMod.join(idir, 'config', 'example.toml'), 'utf-8').catch(() => '')
      if (!cfg.includes('enabled')) throw new Error('config was not restored')
      const mod = (importedProfile.mods ?? []).find((m) => m.filename === 'smoke-mod.jar')
      if (!mod) throw new Error('bundled mod was not registered as installed')

      await fsp.rm(zipPath, { force: true }).catch(() => {})
      await profileManager.delete(imported.profileId)
      logger.info('Share zip folders OK (worlds + config + mods restored from archive)')
    } finally {
      await profileManager.delete(source.id).catch(() => {})
    }
  })

  // v1.0.81 — import a pure Modrinth .mrpack (the format Modrinth App and
  // Lunar Client produce): files[] client-env filter, overrides/ and real
  // identity registration must all work offline.
  await ok('mrpack import (Modrinth/Lunar format): deps + client files + overrides', async () => {
    const { shareService } = await import('./share/share')
    const { zipCreate } = await import('./utils/zip')
    const fsp = await import('node:fs/promises')
    const pathMod = await import('node:path')
    const index = JSON.stringify(
      {
        formatVersion: 1,
        game: 'minecraft',
        versionId: '1.0.0',
        name: 'Lunar Style Pack',
        summary: 'smoke test',
        files: [
          { path: 'mods/bundled-mod.jar', downloads: [], hashes: {}, env: { client: 'required', server: 'optional' } },
          { path: 'mods/server-only.jar', downloads: [], hashes: {}, env: { client: 'unsupported', server: 'required' } }
        ],
        dependencies: { minecraft: '1.21.4', 'fabric-loader': '0.16.9' }
      },
      null,
      2
    )
    const fakeJar = zipCreate([
      { name: 'fabric.mod.json', data: JSON.stringify({ id: 'bundled-mod', name: 'Bundled Mod', version: '1.0.0' }) }
    ])
    const pack = zipCreate([
      { name: 'modrinth.index.json', data: index },
      { name: 'overrides/mods/bundled-mod.jar', data: fakeJar },
      { name: 'overrides/config/example.toml', data: 'enabled = true\n' }
    ])
    const tmp = await fsp.mkdtemp(pathMod.join(process.env.TEMP ?? '/tmp', 'smoke-mrpack-'))
    const packPath = pathMod.join(tmp, 'pack.mrpack')
    await fsp.writeFile(packPath, pack)
    try {
      const imported = await shareService.importZip(packPath)
      const profile = await profileManager.get(imported.profileId)
      if (!profile) throw new Error('mrpack import created no profile')
      if (profile.minecraftVersion !== '1.21.4' || profile.loader.type !== 'fabric') {
        throw new Error('mrpack dependencies not mapped to the profile')
      }
      const mod = (profile.mods ?? []).find((m) => m.filename === 'bundled-mod.jar')
      if (!mod) throw new Error('bundled client mod was not registered')
      if ((profile.mods ?? []).some((m) => m.filename === 'server-only.jar')) {
        throw new Error('server-only file must not install on a client')
      }
      const cfg = await fsp
        .readFile(pathMod.join(instancePath(profile), 'config', 'example.toml'), 'utf-8')
        .catch(() => '')
      if (!cfg.includes('enabled')) throw new Error('mrpack overrides were not applied')
      await profileManager.delete(imported.profileId)
      logger.info('mrpack import OK (deps mapped + client-only files + overrides applied)')
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {})
    }
  })

  await ok('curseforge zip: manifest parse + overrides extraction', async () => {
    const { shareService } = await import('./share/share')
    const { zipCreate, zipExtractPrefix } = await import('./utils/zip')
    const os = await import('node:os')
    const pathMod = await import('node:path')
    const fsp = await import('node:fs/promises')

    // A real CurseForge-style modpack export: manifest.json + overrides/
    // (config/resource packs) — exactly what CurseForge produces.
    const manifest = JSON.stringify(
      {
        minecraft: {
          version: '1.21.11',
          modLoaders: [{ id: 'fabric-0.14.21', primary: true }]
        },
        manifestType: 'minecraftModpack',
        manifestVersion: 1,
        name: 'CF Smoke Pack',
        version: '1.0.0',
        files: [
          { projectID: 394468, fileID: 8591803, required: true },
          { projectID: 551850, fileID: 8593021, required: false }
        ],
        overrides: 'overrides'
      },
      null,
      2
    )
    const zip = zipCreate([
      { name: 'manifest.json', data: manifest },
      { name: 'overrides/config/example.toml', data: 'enabled = true\n' },
      { name: 'overrides/resourcepacks/readme.txt', data: 'pack\n' }
    ])

    const snapshot = await shareService.readZipBuffer(zip)
    if (snapshot.name !== 'CF Smoke Pack') throw new Error('CF name not parsed')
    if (snapshot.minecraftVersion !== '1.21.11') throw new Error('CF mc version not parsed')
    if (snapshot.loader.type !== 'fabric') throw new Error('CF loader not mapped')
    if (snapshot.items.length !== 2) throw new Error('CF files not mapped')
    const first = snapshot.items[0]
    if (first.source !== 'curseforge' || first.id !== '394468' || first.versionId !== '8591803') {
      throw new Error('CF file ids not mapped correctly')
    }

    // overrides/ must land inside the instance with the prefix stripped.
    const tmp = await fsp.mkdtemp(pathMod.join(os.tmpdir(), 'cf-overrides-'))
    const written = zipExtractPrefix(zip, 'overrides', tmp)
    const cfg = await fsp.readFile(pathMod.join(tmp, 'config', 'example.toml'), 'utf-8').catch(() => '')
    if (!cfg.includes('enabled')) throw new Error('overrides not extracted')
    await fsp.rm(tmp, { recursive: true, force: true })
    if (written.length < 2) throw new Error('overrides returned too few files')

    logger.info('CurseForge zip OK (manifest.json → snapshot + overrides → instance)')

    // Full end-to-end (REIMAGINED_SMOKE_CF=1): import a real CurseForge pack
    // — downloads one real file from CurseForge (network) and verifies the
    // installed mod + applied overrides, then removes the test profile.
    if (process.env.REIMAGINED_SMOKE_CF === '1') {
      const realZip = zipCreate([
        { name: 'manifest.json', data: manifest },
        { name: 'overrides/config/example.toml', data: 'enabled = true\n' }
      ])
      let importedId: string | null = null
      try {
        const imported = await shareService.importZipBuffer(realZip)
        importedId = imported.profileId
        const profile = await profileManager.get(imported.profileId)
        if (!profile) throw new Error('real CF import created no profile')
        const sodium = profile.mods.find((m) => m.id === '394468')
        if (!sodium || sodium.source !== 'curseforge') throw new Error('real CF mod not installed')
        const { exists } = await import('./utils/fs')
        const modFile = pathMod.join(instancePath(profile), 'mods', sodium.filename)
        if (!exists(modFile)) throw new Error('real CF mod file missing')
        const appliedCfg = await fsp
          .readFile(pathMod.join(instancePath(profile), 'config', 'example.toml'), 'utf-8')
          .catch(() => '')
        if (!appliedCfg.includes('enabled')) throw new Error('real CF overrides not applied')
        logger.info(`CurseForge real import OK (${sodium.title}, ${modFile})`)
      } finally {
        // Never leak a test profile, even when the download/import fails.
        if (importedId) await profileManager.delete(importedId).catch(() => {})
      }
    }
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
      const dir = instancePath(p)
      fsMod.mkdirSync(dir, { recursive: true })
      fsMod.writeFileSync(pathMod.join(dir, 'options.txt'), 'maxFps:260\nrenderDistance:12\n')
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

  await ok('manual mod: jar dropped in mods/ → identified with its real name', async () => {
    const { modManager } = await import('./mods/mod-manager')
    const { zipCreate } = await import('./utils/zip')
    const { mkdirp } = await import('./utils/fs')
    const fsp = await import('node:fs/promises')
    const pathMod = await import('node:path')
    const p = await profileManager.create({
      name: 'Manual Smoke',
      minecraftVersion: '1.21.4',
      loader: { type: 'vanilla', version: null }
    })
    try {
      const modsDir = pathMod.join(instancePath(p), 'mods')
      mkdirp(modsDir)
      // A jar whose file name says nothing about the mod — the REAL identity
      // lives inside fabric.mod.json. This is the core v1.0.22 bug fix.
      const fakeJar = zipCreate([
        {
          name: 'fabric.mod.json',
          data: JSON.stringify({ id: 'reimagined-smoke-test-mod', name: 'Smoke Mod', version: '1.0.0' })
        }
      ])
      await fsp.writeFile(pathMod.join(modsDir, 'random-file-name.jar'), fakeJar)
      const res = await modManager.identifyManualMods(p.id)
      if (res.identified !== 1) throw new Error(`expected 1 identified, got ${res.identified}`)
      const profile = await profileManager.get(p.id)
      const mod = (profile?.mods ?? []).find((m) => m.filename === 'random-file-name.jar')
      if (!mod) throw new Error('manual mod was not registered as installed')
      if (mod.title !== 'Smoke Mod') throw new Error(`shown name is the FILE name, not the mod: "${mod.title}"`)
      if (mod.source !== 'local') throw new Error(`wrong source ${mod.source}`)
      logger.info('Manual mod identification OK (file name → real mod name + registered installed)')
    } finally {
      await profileManager.delete(p.id).catch(() => {})
    }
  })

  await ok('manual packs: resource pack + shader identified by their real names', async () => {
    const { modManager } = await import('./mods/mod-manager')
    const { zipCreate } = await import('./utils/zip')
    const { mkdirp } = await import('./utils/fs')
    const fsp = await import('node:fs/promises')
    const pathMod = await import('node:path')
    const p = await profileManager.create({
      name: 'Manual Pack Smoke',
      minecraftVersion: '1.21.4',
      loader: { type: 'vanilla', version: null }
    })
    try {
      // A resource pack named only by its FILE — its real name lives in pack.mcmeta.
      mkdirp(pathMod.join(instancePath(p), 'resourcepacks'))
      const rp = zipCreate([
        { name: 'pack.mcmeta', data: JSON.stringify({ pack: { pack_format: 34, description: 'My Fancy Texture Pack' } }) }
      ])
      await fsp.writeFile(pathMod.join(instancePath(p), 'resourcepacks', 'random-rp-name.zip'), rp)
      // A shader pack whose real name lives in shaders/shaders.json (Iris format).
      mkdirp(pathMod.join(instancePath(p), 'shaderpacks'))
      const sh = zipCreate([
        { name: 'pack.mcmeta', data: JSON.stringify({ pack: { pack_format: 34, description: 'x' } }) },
        { name: 'shaders/shaders.json', data: JSON.stringify({ name: 'My Cinematic Shader' }) }
      ])
      await fsp.writeFile(pathMod.join(instancePath(p), 'shaderpacks', 'random-sh-name.zip'), sh)

      const res = await modManager.identifyManualMods(p.id)
      if (res.identified < 2) throw new Error(`expected 2 identified, got ${res.identified}`)
      const profile = await profileManager.get(p.id)
      const mods = profile?.mods ?? []
      const rpMod = mods.find((m) => m.projectType === 'resourcepack' && m.filename === 'random-rp-name.zip')
      const shMod = mods.find((m) => m.projectType === 'shader' && m.filename === 'random-sh-name.zip')
      if (!rpMod) throw new Error('resource pack was not registered as installed')
      if (!shMod) throw new Error('shader pack was not registered as installed')
      if (rpMod.title !== 'My Fancy Texture Pack') throw new Error(`RP name is the FILE name: "${rpMod.title}"`)
      if (shMod.title !== 'My Cinematic Shader') throw new Error(`shader name is the FILE name: "${shMod.title}"`)
      if (shMod.source !== 'local') throw new Error(`wrong source ${shMod.source}`)
      logger.info('Manual pack identification OK (resource pack + shader → real names, registered installed)')
    } finally {
      await profileManager.delete(p.id).catch(() => {})
    }
  })

  // v1.0.27 — real network validation of the update checker (the bug was the
  // launcher never receiving updates). force=true bypasses the 30-min cache so
  // this actually exercises the proxy-aware fetch + 3-host fallback chain.
  await ok('updater: live GitHub check returns a version (fallback chain works)', async () => {
    const { updater } = await import('./updater/updater')
    // Cap the smoke check at 45s so a truly dead network cannot hang the suite.
    const info = (await Promise.race([
      updater.check(true),
      new Promise<never>((_, reject) => {
        const t = setTimeout(() => reject(new Error('update check timed out after 45s')), 45_000)
        t.unref?.()
      })
    ])) as { hasUpdate: boolean; latestVersion: string }
    if (!info || typeof info.hasUpdate !== 'boolean') throw new Error('check() returned no UpdateInfo')
    if (!info.latestVersion || info.latestVersion.length === 0) throw new Error('latestVersion is empty')
    logger.info(`Updater smoke OK — latest ${info.latestVersion}, hasUpdate=${info.hasUpdate}`)
  })

  // v1.0.28 — real measured launch-path timings (cached profile): the pieces
  // that used to be expensive on every launch. These numbers go to the log on
  // every smoke run so launch regressions are caught from data, not guesswork.
  await ok('launch path timing (cached): hardware + java + libraries + assets', async () => {
    const t = (label: string, ms: number): void => logger.info(`LAUNCH TIMING ${label}: ${ms}ms`)
    let t0 = Date.now()
    const { detectHardware } = await import('./perf/hardware')
    const hw = await detectHardware(false)
    t('hardware-detect', Date.now() - t0)
    t0 = Date.now()
    const { detectJavaRuntimes } = await import('./minecraft/java')
    detectJavaRuntimes(true)
    t('java-detect', Date.now() - t0)

    const { versionManager } = await import('./minecraft/version-manager')
    const installed = await versionManager.installedVersions()
    if (installed.length > 0 && hw) {
      const id = installed[0]
      t0 = Date.now()
      const { classpath } = await versionManager.ensureLibraries(id, () => undefined)
      t('libraries-cached', Date.now() - t0)
      if (classpath.length > 0) {
        const vj = await versionManager.ensureResolvedVersionJson(id)
        if (vj.assetIndex) {
          t0 = Date.now()
          await versionManager.ensureAssets(vj.assetIndex.id, vj.assetIndex as { id: string; url: string })
          t('assets-cached', Date.now() - t0)
        }
      }
    }
    logger.info('Launch-path timing recorded (see LAUNCH TIMING lines above)')
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

    const gameDir = instancePath(profile)
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
