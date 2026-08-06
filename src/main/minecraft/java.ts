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
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { settingsManager } from '../settings/settings-manager'
import { logger } from '../logs/logger'
import type { JavaRuntime } from '@shared/types'

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

/** Probe every candidate and return runtimes sorted by major version (desc). */
export function detectJavaRuntimes(): JavaRuntime[] {
  const found: JavaRuntime[] = []
  for (const exe of candidatePaths()) {
    const rt = probeJava(exe)
    if (rt && !found.some((f) => f.path === rt.path)) found.push(rt)
  }
  found.sort((a, b) => b.major - a.major)
  if (found.length > 0) {
    logger.info(`Java detection: ${found.map((r) => `${r.major}@${r.path}`).join(', ')}`)
  } else {
    logger.warn('Java detection: no runtimes found')
  }
  return found
}

/**
 * Pick the best Java for a required major version.
 * Returns null when nothing suitable exists.
 */
export function pickJava(requiredMajor: number): JavaRuntime | null {
  const runtimes = detectJavaRuntimes()
  if (runtimes.length === 0) {
    logger.warn('No Java runtime found on this system')
    return null
  }
  const best = runtimes.find((r) => r.major >= requiredMajor)
  const chosen = best ?? runtimes[0]
  if (!best) {
    logger.warn(`No Java >= ${requiredMajor} found; falling back to Java ${chosen.major}`)
  } else {
    logger.info(`Using Java ${chosen.major} at ${chosen.path}`)
  }
  return chosen
}
