/**
 * GitHub release updater.
 *
 * Checks the configured GitHub repository (`owner/repo` in Settings → Updates)
 * for the latest release, downloads its .zip asset with live progress, applies
 * it over the project directory (user data and dependencies are preserved),
 * rebuilds the app and relaunches.
 *
 * The flow is renderer-driven: the UI checks on startup (silently) and shows
 * an "Update available" notification in the sidebar below Account; the user
 * then downloads and installs from the Update dialog.
 */
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { app } from 'electron'
import { paths, appVersion } from '../paths'
import { logger } from '../logs/logger'
import { eventBus } from '../core/event-bus'
import { mkdirp, remove, readJson, writeJson, exists } from '../utils/fs'
import { zipExtractAll } from '../utils/zip'
import type { UpdateInfo } from '@shared/types'

const CACHE_MAX_AGE = 30 * 60_000 // re-check GitHub at most every 30 min

/**
 * THE official Reimagined Launcher repository — hardcoded. The launcher only
 * ever checks releases from here; there is no user-facing repo setting.
 */
const OFFICIAL_REPO = 'friendlyssmp-blip/Reimagined_Launcher'

/** AbortController-based timeout (works on every supported Node/Electron). */
function timeoutSignal(ms: number): AbortSignal {
  const ctrl = new AbortController()
  setTimeout(() => ctrl.abort(), ms)
  return ctrl.signal
}

function cacheFile(): string {
  return path.join(paths.updates, 'check.json')
}
function downloadFile(): string {
  return path.join(paths.updates, 'reimagined-update.zip')
}
function stagingDir(): string {
  return path.join(paths.updates, 'staging')
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

export const updater = {
  isEnabled(): boolean {
    return true
  },

  /** Fetch the latest release info from GitHub (cached for 30 min). */
  async check(force = false): Promise<UpdateInfo> {
    const r = OFFICIAL_REPO
    const base: UpdateInfo = { hasUpdate: false, currentVersion: appVersion, latestVersion: appVersion }
    try {
      if (!force) {
        const cached = await readJson<{ at: number; info: UpdateInfo } | null>(cacheFile(), null)
        if (cached && cached.info && Date.now() - cached.at < CACHE_MAX_AGE) return cached.info
      }
      const res = await fetch(`https://api.github.com/repos/${r}/releases/latest`, {
        headers: { 'User-Agent': 'ReimaginedLauncher/1.0.0', Accept: 'application/vnd.github+json' },
        signal: timeoutSignal(12_000)
      })
      if (!res.ok) {
        if (res.status === 404) throw new Error(`No releases found for "${r}". Publish a release first.`)
        throw new Error(`GitHub returned HTTP ${res.status}.`)
      }
      const data = (await res.json()) as {
        tag_name?: string
        name?: string
        body?: string
        html_url: string
        published_at?: string
        assets?: { name: string; browser_download_url: string; size: number }[]
      }
      const latestVersion = (data.tag_name ?? data.name ?? '').replace(/^v/i, '')
      const hasUpdate = latestVersion !== '' && compareVersions(latestVersion, appVersion) > 0
      const assets = data.assets ?? []
      const zipAsset = assets.find((a) => a.name.toLowerCase().endsWith('.zip')) ?? assets[0]
      const info: UpdateInfo = {
        hasUpdate,
        currentVersion: appVersion,
        latestVersion: latestVersion || appVersion,
        notes: data.body ?? '',
        url: data.html_url,
        assetUrl: zipAsset?.browser_download_url,
        assetName: zipAsset?.name,
        publishedAt: data.published_at
      }
      try {
        await writeJson(cacheFile(), { at: Date.now(), info })
      } catch {
        /* cache is best-effort */
      }
      return info
    } catch (err) {
      logger.warn(`Update check failed for "${r}": ${(err as Error).message}`)
      throw err
    }
  },

  /** Last known check result (no network). */
  async getInfo(): Promise<UpdateInfo> {
    const cached = await readJson<{ at: number; info: UpdateInfo } | null>(cacheFile(), null)
    if (cached && cached.info) return cached.info
    return { hasUpdate: false, currentVersion: appVersion, latestVersion: appVersion }
  },

  /** Download the release asset to data/updates/ with live progress events. */
  async download(): Promise<{ progress: number; path: string }> {
    const info = await this.getInfo()
    if (!info.assetUrl) throw new Error('This release has no downloadable asset to install.')
    mkdirp(paths.updates)
    const dest = downloadFile()
    if (exists(dest)) fs.rmSync(dest, { force: true })

    const res = await fetch(info.assetUrl, {
      headers: { 'User-Agent': 'ReimaginedLauncher/1.0.0' },
      signal: timeoutSignal(600_000)
    })
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
    logger.info(`Update downloaded: ${info.assetName ?? info.latestVersion} (${Math.round(received / 1024 / 1024)} MB)`)
    return { progress: 100, path: dest }
  },

  /**
   * Apply the downloaded update: extract → copy over the project root
   * (preserving data/, node_modules/, .git/, out/) → rebuild → relaunch.
   */
  async install(): Promise<void> {
    const dest = downloadFile()
    if (!exists(dest)) throw new Error('No update downloaded yet — click "Download" first.')

    const info = await this.getInfo()
    logger.info(`Installing update ${info.latestVersion}…`)
    eventBus.emit('update:progress', { phase: 'extract', percent: 5 })

    const staging = stagingDir()
    if (exists(staging)) await remove(staging)
    mkdirp(staging)
    const buf = await fsp.readFile(dest)
    const files = zipExtractAll(buf, staging)
    if (files.length === 0) throw new Error('The update archive could not be read — is it a valid .zip of the project?')
    eventBus.emit('update:progress', { phase: 'apply', percent: 40 })

    const root = app.getAppPath()
    const skip = new Set(['data', 'node_modules', '.git', '.fpsboost-build', 'out'])
    await copyTree(staging, root, skip)

    // New package.json may pull in new dependencies — install them so the
    // rebuild can never fail with "module not found".
    eventBus.emit('update:progress', { phase: 'build', percent: 72 })
    logger.info('Installing dependencies for the update…')
    await installDeps()

    eventBus.emit('update:progress', { phase: 'build', percent: 80 })
    logger.info('Update applied — rebuilding the app…')
    await rebuild()

    // Invalidate the check cache so the next startup/check reports the truth.
    try {
      await remove(cacheFile())
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
