/**
 * Java discovery.
 *
 * Candidate sources, in order of preference:
 *   1. The path configured in Settings → Java path
 *   2. $JAVA_HOME/bin/java.exe
 *   3. JDK folders under the user's home (java21, java25, …)
 *   4. Standard Windows install locations (Program Files, LocalAppData)
 *   5. `java` found on PATH
 *
 * IMPORTANT: `java -version` prints its output to **stderr** (not stdout),
 * so detection must combine both streams — `execFileSync` discards stderr
 * when the exit code is 0, which silently broke detection before.
 */
import { spawnSync, execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { settingsManager } from '../settings/settings-manager'
import { paths } from '../paths'
import { logger } from '../logs/logger'
import { eventBus } from '../core/event-bus'
import type { JavaRuntime, LaunchProgress } from '@shared/types'

export type { JavaRuntime }

function parseMajor(versionText: string): number {
  const m = versionText.match(/version "([^"]+)"|(?:openjdk|java) (\d+)[.\s]/)
  if (!m) return 0
  const raw = m[1] ?? m[2]
  if (!raw) return 0
  const nums = raw.split('.')
  if (nums[0] === '1') return parseInt(nums[1] ?? '8', 10)
  return parseInt(nums[0], 10)
}

function probeJava(exe: string): JavaRuntime | null {
  try {
    const res = spawnSync(exe, ['-version'], {
      encoding: 'utf-8',
      timeout: 12_000,
      windowsHide: true
    })
    if (res.error || res.status !== 0) {
      logger.debug(`Java probe failed for ${exe}: ${res.error?.message ?? `exit ${res.status}`}`)
      return null
    }
    // Combine stdout AND stderr — java -version writes to stderr.
    const versionText = `${res.stdout ?? ''}\n${res.stderr ?? ''}`
    const major = parseMajor(versionText)
    if (major <= 0) return null
    const vendor = versionText.includes('OpenJDK') ? 'OpenJDK' : versionText.includes('Temurin') ? 'Temurin' : undefined
    return { path: exe, major, vendor, version: versionText.split('\n')[0].trim() }
  } catch (err) {
    logger.debug(`Java probe failed for ${exe}: ${(err as Error).message}`)
    return null
  }
}

function existsFile(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/** Look for a bin/java.exe inside a JDK-style folder (handles nested jdk-* layouts). */
function javaExeIn(root: string): string | null {
  try {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return null
    const direct = path.join(root, 'bin', 'java.exe')
    if (existsFile(direct)) return direct
    // Nested layout: java25/jdk-25.0.3+9/bin/java.exe
    for (const entry of fs.readdirSync(root)) {
      if (!/^jdk/i.test(entry)) continue
      const nested = path.join(root, entry, 'bin', 'java.exe')
      if (existsFile(nested)) return nested
    }
  } catch {
    /* unreadable */
  }
  return null
}

function candidatePaths(): string[] {
  const settings = settingsManager.get()
  const candidates: string[] = []
  const home = os.homedir()

  if (settings.javaPath) candidates.push(settings.javaPath)
  if (process.env.JAVA_HOME) candidates.push(path.join(process.env.JAVA_HOME, 'bin', 'java.exe'))

  const roots: string[] = []
  // JDK folders in the user's home (java21, java25, java17, java8…)
  try {
    for (const entry of fs.readdirSync(home)) {
      if (/^java/i.test(entry)) roots.push(path.join(home, entry))
    }
  } catch {
    /* home unreadable */
  }
  // Standard Windows install locations
  const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files'
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const lad = process.env['LOCALAPPDATA'] ? path.join(process.env['LOCALAPPDATA'], 'Programs') : ''
  roots.push(
    path.join(pf, 'Java'),
    path.join(pf, 'Eclipse Adoptium'),
    path.join(pf, 'Eclipse Foundation'),
    path.join(pf, 'Microsoft'),
    path.join(pf, 'Amazon Corretto'),
    path.join(pf86, 'Java'),
    path.join(pf86, 'Eclipse Adoptium'),
    lad
  )

  for (const root of roots) {
    try {
      if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) continue
      const exe = javaExeIn(root)
      if (exe) candidates.push(exe)
      // Some roots (e.g. Eclipse Adoptium) contain a jdk-*/ subfolder directly.
      for (const entry of fs.readdirSync(root)) {
        if (/^jdk|^jre|^temurin|^zulu|^corretto/i.test(entry)) {
          const exe2 = javaExeIn(path.join(root, entry))
          if (exe2) candidates.push(exe2)
        }
      }
    } catch {
      /* unreadable */
    }
  }

  candidates.push('java') // PATH fallback
  return [...new Set(candidates)]
}

/* ----------------------------- runtime detection cache ----------------------------- */

// v1.0.28 — launch-time regression fix. Every launch ran `java -version`
// (a spawned process, up to 12 s each) for EVERY candidate JDK on the system
// before the game could start. Runtimes barely change, so the probe result is
// cached: 10 min in memory, 24 h on disk (survives cold starts). `force`
// re-probes — used by the Settings Java panel (on-demand, never the launch
// path).
let runtimeCache: { at: number; runtimes: JavaRuntime[] } | null = null
const RUNTIME_MEM_TTL_MS = 10 * 60_000
const RUNTIME_DISK_TTL_MS = 24 * 60 * 60_000

function runtimeCacheFile(): string {
  return path.join(paths.data, 'perf', 'java.json')
}

function readRuntimeCacheDisk(): JavaRuntime[] | null {
  try {
    const c = JSON.parse(fs.readFileSync(runtimeCacheFile(), 'utf-8')) as { at?: number; runtimes?: JavaRuntime[] }
    if (c.at && Array.isArray(c.runtimes) && Date.now() - c.at < RUNTIME_DISK_TTL_MS && c.runtimes.length > 0) {
      // A cached path can go stale (Java uninstalled) — never serve a dead
      // binary: a missing executable would fail the launch with a confusing
      // error instead of a clean re-probe.
      return aliveRuntimes(c.runtimes)
    }
  } catch {
    /* no cache yet */
  }
  return null
}

/** Drop cached runtimes whose java.exe no longer exists on disk. */
function aliveRuntimes(runtimes: JavaRuntime[]): JavaRuntime[] {
  return runtimes.filter((r) => {
    try {
      return r.path === 'java' || (fs.existsSync(r.path) && fs.statSync(r.path).isFile())
    } catch {
      return false
    }
  })
}

function writeRuntimeCacheDisk(runtimes: JavaRuntime[]): void {
  try {
    fs.mkdirSync(path.dirname(runtimeCacheFile()), { recursive: true })
    fs.writeFileSync(runtimeCacheFile(), JSON.stringify({ at: Date.now(), runtimes }, null, 2), 'utf-8')
  } catch {
    /* cache is best-effort */
  }
}

/** Invalidate both caches (after the launcher installs a runtime, etc.). */
export function invalidateRuntimeCache(): void {
  runtimeCache = null
  try {
    fs.rmSync(runtimeCacheFile(), { force: true })
  } catch {
    /* best-effort */
  }
}

/** Probe every candidate and return runtimes sorted by major version (desc). */
export function detectJavaRuntimes(force = false): JavaRuntime[] {
  if (!force && runtimeCache && Date.now() - runtimeCache.at < RUNTIME_MEM_TTL_MS) {
    return aliveRuntimes(runtimeCache.runtimes)
  }
  if (!force && !runtimeCache) {
    const fromDisk = readRuntimeCacheDisk()
    if (fromDisk) {
      runtimeCache = { at: Date.now(), runtimes: fromDisk }
      return fromDisk
    }
  }

  const found: JavaRuntime[] = []
  for (const exe of candidatePaths()) {
    const rt = probeJava(exe)
    if (rt && !found.some((f) => f.path === rt.path)) found.push(rt)
  }
  found.sort((a, b) => b.major - a.major)
  runtimeCache = { at: Date.now(), runtimes: found }
  if (found.length > 0) {
    logger.info(`Java detection: ${found.map((r) => `${r.major}@${r.path}`).join(', ')}`)
    writeRuntimeCacheDisk(found)
  } else {
    logger.warn('Java detection: no runtimes found')
  }
  return found
}

function timeoutSignal(ms: number): AbortSignal {
  const ctrl = new AbortController()
  setTimeout(() => ctrl.abort(), ms)
  return ctrl.signal
}

/** Look for a bin/java.exe under a runtime dir (handles a single nested folder). */
function findJavaUnder(root: string): string | null {
  try {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return null
    const direct = path.join(root, 'bin', 'java.exe')
    if (existsFile(direct)) return direct
    for (const entry of fs.readdirSync(root)) {
      const nested = path.join(root, entry, 'bin', 'java.exe')
      if (existsFile(nested)) return nested
    }
  } catch {
    /* unreadable */
  }
  return null
}

/**
 * Download a JRE for a required major version into data/games/runtime so a
 * fresh install with NO system Java can still launch — the .exe installer is
 * fully self-contained. Uses the official Adoptium API. Never throws;
 * returns null when the download fails so the caller can fall back.
 */
async function ensureRuntimeJava(requiredMajor: number): Promise<JavaRuntime | null> {
  const dir = path.join(paths.runtime, `jre-${requiredMajor}`)
  const existing = findJavaUnder(dir)
  if (existing) {
    const rt = probeJava(existing)
    if (rt) return rt
  }

  const progress: LaunchProgress = {
    stage: 'downloading',
    message: `No compatible Java found — downloading Java ${requiredMajor} runtime…`,
    percent: null
  }
  eventBus.emit('launch:progress', progress)
  logger.info(`Downloading Java ${requiredMajor} runtime (Adoptium)…`)

  try {
    fs.mkdirSync(paths.runtime, { recursive: true })
    const zipPath = path.join(paths.runtime, `adoptium-${requiredMajor}.zip`)
    const url = `https://api.adoptium.net/v3/binary/latest/${requiredMajor}/ga/windows/x64/jre/hotspot/normal/eclipse?project=jdk`

    const res = await fetch(url, { redirect: 'follow', signal: timeoutSignal(600_000) })
    if (!res.ok || !res.body) throw new Error(`Adoptium returned HTTP ${res.status}`)
    const file = fs.createWriteStream(zipPath)
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        if (!file.write(Buffer.from(value))) {
          await new Promise<void>((resolve) => file.once('drain', resolve))
        }
      }
    }
    await new Promise<void>((resolve, reject) => file.end((err?: Error | null) => (err ? reject(err) : resolve())))

    // Windows ships bsdtar which handles .zip archives natively.
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    await new Promise<void>((resolve, reject) => {
      execFile('tar', ['-xf', zipPath, '-C', dir], { timeout: 180_000, windowsHide: true }, (err) => (err ? reject(err) : resolve()))
    })

    const exe = findJavaUnder(dir)
    if (!exe) throw new Error('The extracted runtime has no java.exe')
    const rt = probeJava(exe)
    if (!rt) throw new Error('The downloaded runtime failed its version probe')
    // A new runtime exists on disk now — never serve a stale detection.
    invalidateRuntimeCache()
    logger.info(`Java ${requiredMajor} runtime ready at ${exe}`)
    return rt
  } catch (err) {
    logger.warn(`Java runtime download failed: ${(err as Error).message}`)
    return null
  }
}

/**
 * Pick the best Java for a required major version.
 * When no suitable system runtime exists, downloads one (self-contained
 * installs). Returns null only when both system detection and the download
 * fallback fail.
 */
export async function pickJava(requiredMajor: number): Promise<JavaRuntime | null> {
  const runtimes = detectJavaRuntimes()
  const best = runtimes.find((r) => r.major >= requiredMajor)
  if (best) {
    logger.info(`Using Java ${best.major} at ${best.path}`)
    return best
  }

  // No runtime at/above the required major — download one before degrading.
  const downloaded = await ensureRuntimeJava(requiredMajor)
  if (downloaded) return downloaded

  const chosen = runtimes[0]
  if (chosen) {
    logger.warn(`No Java >= ${requiredMajor} found; falling back to Java ${chosen.major}`)
    return chosen
  }
  logger.warn('No Java runtime found on this system')
  return null
}
