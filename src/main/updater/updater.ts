/**
 * GitHub folder-based updater.
 *
 * The launcher watches the `update/` folder in the official repository: a
 * small `update/latest.json` file there declares the newest available version
 * and (for packaged installs) the path of the new installer .exe inside the
 * repo.
 *
 * Two install paths:
 *
 * 1. SOURCE RUN (dev / zip installs with a Node toolchain):
 *    Download the repository as a .zip directly from GitHub's public codeload
 *    endpoint, extract it over the project directory (user data and
 *    dependencies are preserved), rebuild the app and relaunch.
 *
 * 2. PACKAGED (installed via the NSIS installer — Program Files / per-user
 *    dir, read-only asar, no Node toolchain):
 *    Download the new installer .exe from the repository and run it silently
 *    (`/S --updated`). The installer replaces the application — no write
 *    access to the install directory or npm/tsc is required. The downloaded
 *    file is unblocked first so Windows SmartScreen does not silently block
 *    the silent install.
 *
 * Flow: push changes to the repo → bump update/latest.json → every launcher
 * sees "Update available" → one click downloads and applies the new version.
 */
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { app, net } from 'electron'
import { paths, appVersion } from '../paths'
import { logger } from '../logs/logger'
import { eventBus } from '../core/event-bus'
import { mkdirp, remove, readJson, writeJson, exists } from '../utils/fs'
import { zipExtractAll } from '../utils/zip'
import type { UpdateInfo } from '@shared/types'

const CACHE_MAX_AGE = 30 * 60_000 // re-check GitHub at most every 30 min

/**
 * THE official Reimagined Launcher repository — hardcoded. The launcher only
 * ever checks updates from here; there is no user-facing repo setting.
 */
const OFFICIAL_REPO = 'friendlyssmp-blip/Reimagined_Launcher'
/** The trigger file inside the repo's `update/` folder: {"version":"1.0.2","installer":"dist/..."}. */
const LATEST_JSON = `https://raw.githubusercontent.com/${OFFICIAL_REPO}/main/update/latest.json`
/**
 * v1.0.27 — fallback sources for `update/latest.json`. raw.githubusercontent.com
 * is slow or blocked on some networks (and Node's global fetch ignores the
 * system proxy); these are tried in order until one answers:
 *   1. raw.githubusercontent.com (fast, no rate limit)
 *   2. github.com/…/raw/… (different host, same file)
 *   3. api.github.com contents API (base64 — last resort, rate-limited)
 */
const LATEST_JSON_FALLBACKS = [
  LATEST_JSON,
  `https://github.com/${OFFICIAL_REPO}/raw/main/update/latest.json`,
  `https://api.github.com/repos/${OFFICIAL_REPO}/contents/update/latest.json`
]

/**
 * v1.0.27 — fetch that honors the system proxy. Electron's `net.fetch` uses
 * Chromium's network stack (proxy-aware) while Node's global `fetch` (undici)
 * ignores the OS proxy entirely — the exact reason update checks could fail on
 * networks that need a proxy to reach GitHub. Falls back to Node fetch.
 */
async function ghFetch(url: string, init?: RequestInit): Promise<Response> {
  const netFetch = (net as unknown as { fetch?: (u: string, i?: RequestInit) => Promise<Response> }).fetch
  if (netFetch) {
    try {
      return await netFetch(url, init)
    } catch {
      /* fall through to Node fetch */
    }
  }
  return fetch(url, init)
}
/** Whole-repository archive — always the latest committed state of `main`. */
const CODELOAD_ZIP = `https://codeload.github.com/${OFFICIAL_REPO}/zip/refs/heads/main`
/** Raw file base — used to fetch the installer exe in packaged builds. */
const RAW_BASE = `https://raw.githubusercontent.com/${OFFICIAL_REPO}/main`

/** AbortController-based timeout (works on every supported Node/Electron). */
function timeoutSignal(ms: number): AbortSignal {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  timer.unref?.() // never let a pending abort timer delay app exit
  return ctrl.signal
}

/**
 * v1.0.27 — tolerate malformed update metadata. A `latest.json` with literal
 * control characters inside its strings (e.g. generated on Windows with
 * `printf` which embeds real CR/LF into the JSON string values) makes
 * `JSON.parse` throw and the whole check report "unreachable". This repair
 * pass walks the text with a string-literal state machine and escapes raw
 * control characters ONLY inside "..." values (structural whitespace outside
 * strings is legal JSON and is left untouched), then retries the parse.
 */
function parseLenientJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    /* fall through to the repair pass */
  }
  let out = ''
  let inString = false
  let escaped = false
  for (const ch of text) {
    if (inString) {
      if (escaped) {
        out += ch
        escaped = false
        continue
      }
      if (ch === '\\') {
        out += ch
        escaped = true
        continue
      }
      if (ch === '"') {
        inString = false
        out += ch
        continue
      }
      const code = ch.codePointAt(0) ?? 0
      if (code < 0x20) {
        // Raw control char inside a string value: escape it (or drop bare CR).
        if (ch === '\t') out += '\\t'
        else if (ch === '\n') out += '\\n'
        else if (ch !== '\r') out += ' '
        continue
      }
      out += ch
      continue
    }
    if (ch === '"') inString = true
    out += ch
  }
  try {
    return JSON.parse(out) as Record<string, unknown>
  } catch {
    return null
  }
}

function cacheFile(): string {
  return path.join(paths.updates, 'check.json')
}
function stagingDir(): string {
  return path.join(paths.updates, 'staging')
}

/** The file the last download produced (zip in source runs, .exe in packaged). */
function downloadFile(info: UpdateInfo): string {
  const name = info.assetName && /\.(exe|zip)$/i.test(info.assetName) ? info.assetName : 'reimagined-update.zip'
  return path.join(paths.updates, name)
}

/** `1.2.3` vs `1.2.10` numeric comparison (leading `v` tolerated). */
function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x - y
  }
  return 0
}

/**
 * The version currently applied to this installation.
 *
 * v1.0.19: this is ALWAYS the real installed version (`appVersion`, read from
 * the running package/exe — it is replaced by the update itself). Using a
 * separate marker here was the source of two failure modes: a stale marker
 * could re-offer an already-applied update, or a marker written before a
 * failed install could hide the update forever. With the real version, a
 * failed update simply leaves the old version in place and the update is
 * re-offered — no loops, no stuck state.
 */
async function readInstalledVersion(): Promise<string> {
  return appVersion || '0.0.0'
}

export const updater = {
  isEnabled(): boolean {
    return true
  },

  /** Fetch `update/latest.json` from GitHub (cached for 30 min). */
  async check(force = false): Promise<UpdateInfo> {
    const base: UpdateInfo = { hasUpdate: false, currentVersion: appVersion, latestVersion: appVersion }
    try {
      if (!force) {
        const cached = await readJson<{ at: number; info: UpdateInfo } | null>(cacheFile(), null)
        if (cached && cached.info && Date.now() - cached.at < CACHE_MAX_AGE) return cached.info
      }
      // v1.0.27 — try every source until one answers (proxy-aware fetch + the
      // raw / web-raw / api.github.com fallback chain).
      let data: { version?: string; notes?: string; installer?: string; url?: string; sha256?: string } | null = null
      let saw404 = false
      for (const url of LATEST_JSON_FALLBACKS) {
        try {
          const r = await ghFetch(url, {
            headers: { 'User-Agent': 'ReimaginedLauncher/1.0.0', Accept: 'application/json' },
            signal: timeoutSignal(12_000)
          })
          if (r.status === 404) {
            saw404 = true
            continue
          }
          if (!r.ok) {
            logger.debug(`Update check: ${url} answered ${r.status} ${r.statusText}`)
            continue
          }
          if (url.includes('api.github.com')) {
            // Contents API returns the file base64-encoded.
            const payload = (await r.json()) as { content?: string; encoding?: string }
            if (!payload.content) continue
            const rawText =
              payload.encoding === 'base64' ? Buffer.from(payload.content, 'base64').toString('utf-8') : payload.content
            data = parseLenientJson(rawText) as { version?: string; notes?: string; installer?: string; url?: string; sha256?: string } | null
          } else {
            data = parseLenientJson(await r.text()) as { version?: string; notes?: string; installer?: string; url?: string; sha256?: string } | null
          }
          if (!data) {
            logger.debug(`Update check: ${url} served unparseable JSON`)
            continue
          }
          break
        } catch (err) {
          logger.debug(`Update check: ${url} unreachable — ${err instanceof Error ? err.message : String(err)}`)
          /* try the next source */
        }
      }
      // The repo genuinely has no update/latest.json yet.
      if (!data && saw404) {
        logger.warn('Update check: no update/latest.json in the repository yet — nothing to update.')
        const info: UpdateInfo = { ...base }
        try {
          await writeJson(cacheFile(), { at: Date.now(), info })
        } catch {
          /* cache is best-effort */
        }
        return info
      }
      if (!data) throw new Error('Update check: could not reach the update server (all sources failed).')
      const latestVersion = String(data.version ?? '').replace(/^v/i, '')
      const currentVersion = await readInstalledVersion()
      const hasUpdate = latestVersion !== '' && compareVersions(latestVersion, currentVersion) > 0

      // v1.0.31 — the update asset can be declared two ways: the original
      // `installer` field (a repo-relative path, e.g. "dist/Reimagined-Setup-x.exe")
      // or a direct download URL in `url`. v1.0.30 shipped a manifest that
      // dropped `installer` and only had `url` — the packaged fallback then
      // silently pointed the Update button at the whole-repository codeload
      // zip (wrong artifact, slow/blocked host), so the download never
      // completed and install() rejected it (not an .exe). Support both
      // shapes, and NEVER silently fall back to the repo zip for packaged
      // installs: if no asset is declared, leave assetUrl unset so the UI
      // shows the honest "No installer asset" state instead of a download
      // that can never install.
      const directUrl = String(data.url ?? '').trim()
      const directAsset = app.isPackaged && /\.(exe|zip)(\?|#|$)/i.test(directUrl) ? directUrl : ''
      // The `installer` path is only honored on packaged installs — SOURCE
      // (dev / zip) runs must ALWAYS update via the whole-repository codeload
      // zip, never a direct .exe link from the manifest `url` field.
      const installer = app.isPackaged && data.installer ? String(data.installer).replace(/^\/+/, '') : ''
      const assetUrl = installer
        ? `${RAW_BASE}/${installer}`
        : app.isPackaged
          ? directAsset
          : CODELOAD_ZIP
      const assetName = installer
        ? path.basename(installer)
        : app.isPackaged && directAsset
          ? (directAsset.split('/').pop()?.split(/[?#]/)[0] || 'reimagined-update')
          : 'Reimagined_Launcher-main.zip'
      if (app.isPackaged && !installer && !directAsset) {
        logger.warn(
          `Update check: latest.json for ${latestVersion} declares no installer asset (missing "installer" and no direct "url") — the Update button will be disabled.`
        )
      }

      const info: UpdateInfo = {
        hasUpdate,
        currentVersion,
        latestVersion: latestVersion || currentVersion,
        notes: data.notes ?? '',
        url: `https://github.com/${OFFICIAL_REPO}`,
        assetUrl,
        assetName,
        sha256: data.sha256 ?? '',
        publishedAt: new Date().toISOString()
      }
      if (app.isPackaged) {
        logger.info(`Update check: current ${currentVersion}, latest ${latestVersion}, installer ${assetName}${hasUpdate ? ' — UPDATE AVAILABLE' : ''}`)
      }
      try {
        await writeJson(cacheFile(), { at: Date.now(), info })
      } catch {
        /* cache is best-effort */
      }
      return info
    } catch (err) {
      logger.warn(`Update check failed: ${(err as Error).message}`)
      throw err
    }
  },

  /** Last known check result (no network). */
  async getInfo(): Promise<UpdateInfo> {
    const cached = await readJson<{ at: number; info: UpdateInfo } | null>(cacheFile(), null)
    if (cached && cached.info) return cached.info
    return { hasUpdate: false, currentVersion: appVersion, latestVersion: appVersion }
  },

  /** Download the update payload (repo zip in source runs, installer .exe in packaged). */
  async download(): Promise<{ progress: number; path: string }> {
    mkdirp(paths.updates)
    const info = await this.getInfo()
    const dest = downloadFile(info)
    if (exists(dest)) fs.rmSync(dest, { force: true })

    const url = info.assetUrl || CODELOAD_ZIP
    // v1.0.31 — never silently download the wrong artifact: a packaged
    // launcher with no declared asset must fail loudly instead of pulling the
    // whole-repository zip that can never be installed.
    if (app.isPackaged && !info.assetUrl) {
      throw new Error('This update declares no installer asset — open the release page to download the new version manually.')
    }
    logger.info(`Downloading update from ${url}…`)
    let res = await ghFetch(url, {
      headers: { 'User-Agent': 'ReimaginedLauncher/1.0.0' },
      signal: timeoutSignal(600_000)
    })
    // v1.0.27 — if the raw host is unreachable, retry the same file via the
    // github.com web-raw host (different host, same content).
    if (!res.ok && url.startsWith('https://raw.githubusercontent.com/')) {
      const alt = url
        .replace('https://raw.githubusercontent.com/', 'https://github.com/')
        .replace('/main/', '/raw/main/')
      res = await ghFetch(alt, {
        headers: { 'User-Agent': 'ReimaginedLauncher/1.0.0' },
        signal: timeoutSignal(600_000)
      })
    }
    if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}).`)
    const total = Number(res.headers.get('content-length')) || 0
    let received = 0
    let lastEmit = 0
    let lastPct = -1
    const file = fs.createWriteStream(dest)
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        if (!file.write(Buffer.from(value))) {
          await new Promise<void>((resolve) => file.once('drain', resolve))
        }
        received += value.byteLength
      }
      // Throttle IPC progress events — never flood the renderer bridge.
      const now = Date.now()
      const pct = total > 0 ? Math.min(99, Math.round((received / total) * 100)) : 0
      if (pct !== lastPct && now - lastEmit > 120) {
        lastPct = pct
        lastEmit = now
        eventBus.emit('update:progress', { phase: 'download', percent: pct, downloadedBytes: received, totalBytes: total })
      }
    }
    await new Promise<void>((resolve, reject) =>
      file.end((err: Error | null | undefined) => (err ? reject(err) : resolve()))
    )
    // v1.0.31 — verify the SHA-256 of the downloaded installer against the
    // manifest when one is declared. A corrupt/partial/tampered file must
    // never be offered for install; on mismatch the file is deleted so a
    // retry re-downloads from scratch instead of silently keeping a bad copy.
    if (info.sha256 && /\.exe$/i.test(dest)) {
      logger.info('Verifying SHA-256 of the downloaded update…')
      const { createHash } = await import('node:crypto')
      const hash = createHash('sha256')
      await new Promise<void>((resolve, reject) => {
        const stream = fs.createReadStream(dest)
        stream.on('data', (c) => hash.update(c))
        stream.on('end', () => resolve())
        stream.on('error', reject)
      })
      const actual = hash.digest('hex')
      if (actual.toLowerCase() !== info.sha256.toLowerCase()) {
        fs.rmSync(dest, { force: true })
        logger.error(
          `Update checksum mismatch — expected ${info.sha256.slice(0, 12)}…, got ${actual.slice(0, 12)}… — file deleted, update cancelled.`
        )
        throw new Error('The downloaded update failed its checksum verification and was cancelled. Try the update again in a moment.')
      }
      logger.info('Update checksum OK — the package is genuine.')
    }
    logger.info(`Update package downloaded (${Math.round(received / 1024 / 1024)} MB) — ${dest}`)
    return { progress: 100, path: dest }
  },

  /**
   * Apply the downloaded update.
   * - Packaged: run the new installer .exe silently, then exit.
   * - Source: extract → copy over the project root (preserving data/,
   *   node_modules/, .git/, out/) → rebuild → relaunch.
   */
  async install(): Promise<void> {
    if (app.isPackaged) return this.installPackaged()
    return installSource()
  },

  /** Packaged installs: silently run the freshly downloaded installer .exe. */
  async installPackaged(): Promise<void> {
    const info = await this.getInfo()
    const dest = downloadFile(info)
    if (!exists(dest)) throw new Error('No update downloaded yet — click "Download" first.')
    if (!/\.exe$/i.test(dest)) throw new Error('This launcher was installed with the installer — the update file is not an installer (.exe).')

    logger.info(`Installing update ${info.latestVersion} via the new installer…`)
    eventBus.emit('update:progress', { phase: 'installer', percent: 90, message: 'Preparing the new installer…' })

    // Remove the Windows "downloaded from the internet" mark (Zone.Identifier)
    // so SmartScreen does not silently block the silent install.
    const { execFile } = await import('node:child_process')
    try {
      await new Promise<void>((resolve) => {
        execFile(
          'powershell',
          ['-NoProfile', '-NonInteractive', '-Command', `Unblock-File -LiteralPath '${dest}'`],
          { timeout: 30_000, windowsHide: true },
          () => resolve()
        )
      })
    } catch {
      /* best-effort — the installer may still prompt, which is acceptable */
    }

    try {
      await remove(cacheFile())
    } catch {
      /* best-effort */
    }

    // v1.0.19: Minecraft must survive the launcher update. Record every
    // running game session so the restarted launcher reconnects to them
    // instead of showing them as stopped.
    try {
      const { saveRunningSessions } = await import('../minecraft/session-state')
      await saveRunningSessions()
    } catch {
      /* best-effort */
    }

    eventBus.emit('update:progress', { phase: 'done', percent: 100, message: 'Launching the new installer…' })
    logger.info('Launching the new installer — the launcher will close while it replaces itself.')

    // NSIS: /S = fully silent, --updated = replace the existing install
    // without prompting. Detached so it survives this process exiting.
    let installer: ReturnType<typeof spawn> | null = null
    try {
      installer = spawn(dest, ['/S', '--updated'], { detached: true, stdio: 'ignore', windowsHide: false })
      installer.unref()
    } catch (err) {
      logger.error(`Could not start the installer: ${(err as Error).message}`)
      throw new Error('The installer could not be started. Open the launcher folder and run the downloaded setup manually.')
    }

    // The NSIS silent installer never shows its Finish page, so it will NOT
    // relaunch the app by itself. Arm a detached helper that waits for the
    // installer to finish replacing the files and then starts the NEW
    // launcher exe automatically — the update reopens the launcher on its
    // own, no manual restart needed.
    armRelaunchAfterInstaller(installer?.pid ?? null)

    // Give the child a moment to spawn, then close this instance.
    setTimeout(() => app.exit(0), 1500)
  }
}

/**
 * Arm a detached helper that reopens the launcher once the update installer
 * finishes.
 *
 * Why this is needed: the NSIS installer is run fully silent (`/S
 * --updated`), and in silent mode every installer page — including the
 * Finish page that would normally relaunch the app — is skipped. So after
 * the installer replaces the files and exits, nothing would reopen the
 * launcher. This helper process is spawned detached (it survives this
 * process exiting), waits for the installer process to finish, gives the
 * file replacement a moment to settle (antivirus scans can briefly lock the
 * new exe), and then launches `process.execPath` — which is the SAME path
 * the installer just wrote the new version to. The user lands back in the
 * updated launcher automatically.
 */
function armRelaunchAfterInstaller(installerPid: number | null): void {
  try {
    const exe = process.execPath
    if (!exe || !/\.exe$/i.test(exe)) {
      logger.warn('Relaunch helper skipped: not running from a packaged .exe.')
      return
    }
    // v1.0.19: wait for BOTH the installer and the OLD launcher process to
    // fully exit, then wait ~3 s so Windows releases every file handle and
    // finishes the replacement before the updated exe is started.
    const waitCmd = installerPid
      ? `Wait-Process -Id ${installerPid} -ErrorAction SilentlyContinue; Wait-Process -Id ${process.pid} -ErrorAction SilentlyContinue`
      : 'Start-Sleep -Seconds 5'
    const cmd = [
      waitCmd,
      // Release file handles / finish process termination (spec: ~3 seconds).
      'Start-Sleep -Seconds 3',
      `$exe = '${exe.replace(/'/g, "''")}'`,
      // Launch the NEW launcher; retry briefly if the file is still locked.
      '$ok = $false',
      'for ($i = 0; $i -lt 40 -and -not $ok; $i++) {',
      '  try { Start-Process -FilePath $exe -ErrorAction Stop; $ok = $true }',
      '  catch { Start-Sleep -Milliseconds 750 }',
      '}',
      'if (-not $ok) { Start-Process -FilePath $exe }'
    ].join('; ')
    const helper = spawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', cmd],
      { detached: true, stdio: 'ignore', windowsHide: true }
    )
    helper.unref()
    logger.info(`Relaunch helper armed — the launcher will reopen automatically after the installer (pid ${String(installerPid)}) finishes.`)
  } catch (err) {
    // Never fail the update because the relaunch could not be armed — the
    // user can still open the launcher from the Start menu / desktop.
    logger.warn(`Could not arm the relaunch helper: ${(err as Error).message}`)
  }
}

/** Source runs: overlay the repository zip, npm install, rebuild, relaunch. */
async function installSource(): Promise<void> {
  const info = await updater.getInfo()
    const dest = downloadFile(info)
    if (!exists(dest)) throw new Error('No update downloaded yet — click "Download" first.')

    logger.info(`Installing update ${info.latestVersion}…`)
    eventBus.emit('update:progress', { phase: 'extract', percent: 5 })

    const staging = stagingDir()
    if (exists(staging)) await remove(staging)
    mkdirp(staging)
    const buf = await fsp.readFile(dest)
    const files = zipExtractAll(buf, staging)
    if (files.length === 0) throw new Error('The update archive could not be read — is it a valid .zip of the project?')

    // GitHub codeload zips wrap everything in a single `<repo>-<branch>/`
    // folder — extract its contents as the source root.
    const srcRoot = await findSourceRoot(staging)
    eventBus.emit('update:progress', { phase: 'apply', percent: 40 })

    const root = app.getAppPath()
    const skip = new Set(['data', 'node_modules', '.git', '.fpsboost-build', 'out'])
    await copyTree(srcRoot, root, skip)

    // New package.json may pull in new dependencies — install them so the
    // rebuild can never fail with "module not found".
    eventBus.emit('update:progress', { phase: 'build', percent: 72 })
    logger.info('Installing dependencies for the update…')
    await installDeps()

    eventBus.emit('update:progress', { phase: 'build', percent: 80 })
    logger.info('Update applied — rebuilding the app…')
    await rebuild()

    // Only after a successful install: invalidate the check cache so the next
    // startup reports the truth (the installed version is read from the app
    // itself, so no separate marker is needed — a failed update simply leaves
    // the old version in place and the update is offered again).
    try {
      await remove(cacheFile())
    } catch {
      /* best-effort */
    }

    // v1.0.19: record running game sessions so they survive the relaunch and
    // the updated launcher reconnects to them.
    try {
      const { saveRunningSessions } = await import('../minecraft/session-state')
      await saveRunningSessions()
    } catch {
      /* best-effort */
    }

    logger.info(`Update ${info.latestVersion} installed. Relaunching…`)
    eventBus.emit('update:progress', { phase: 'done', percent: 100 })
    setTimeout(() => {
      app.relaunch()
      app.exit(0)
    }, 700)
}

/** If the staging dir contains a single top-level folder, use it as the root. */
async function findSourceRoot(staging: string): Promise<string> {
  const entries = await fsp.readdir(staging, { withFileTypes: true })
  if (entries.length === 1 && entries[0].isDirectory()) {
    return path.join(staging, entries[0].name)
  }
  return staging
}

/** Install dependencies with the project's package manager (npm). */
async function installDeps(): Promise<void> {
  const { execFile } = await import('node:child_process')
  const root = app.getAppPath()
  const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  await new Promise<void>((resolve, reject) => {
    execFile(
      cmd,
      ['install', '--no-audit', '--no-fund', '--loglevel=error'],
      { cwd: root, shell: true, timeout: 900_000 },
      (err, _stdout, stderr) => {
        if (err) {
          logger.error(`npm install failed: ${stderr || (err as Error).message}`)
          reject(new Error('The update could not install its dependencies. Run "npm install" manually in the launcher folder, then restart.'))
        } else {
          resolve()
        }
      }
    )
  })
}

/** Recursively copy a tree, skipping protected directories. */
async function copyTree(src: string, dest: string, skip: Set<string>): Promise<void> {
  const entries = await fsp.readdir(src, { withFileTypes: true })
  for (const ent of entries) {
    if (skip.has(ent.name)) continue
    const s = path.join(src, ent.name)
    const d = path.join(dest, ent.name)
    if (ent.isDirectory()) {
      await copyTree(s, d, skip)
    } else {
      try {
        await fsp.mkdir(path.dirname(d), { recursive: true })
        await fsp.copyFile(s, d)
      } catch (err) {
        // A locked file (e.g. the running .exe) must never abort the update.
        logger.warn(`Update: could not copy ${ent.name}: ${(err as Error).message}`)
      }
    }
  }
}

/** Rebuild the renderer/main bundles from the updated source. */
async function rebuild(): Promise<void> {
  const { execFile } = await import('node:child_process')
  const root = app.getAppPath()
  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  await new Promise<void>((resolve, reject) => {
    execFile(
      cmd,
      ['electron-vite', 'build'],
      { cwd: root, shell: true, timeout: 600_000 },
      (err, _stdout, stderr) => {
        if (err) {
          logger.error(`Update build failed: ${stderr || (err as Error).message}`)
          reject(new Error('The update was downloaded but could not be compiled. The launcher stays on the current version — check the logs.'))
        } else {
          resolve()
        }
      }
    )
  })
}
