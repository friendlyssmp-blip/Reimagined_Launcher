/**
 * Crash Assistant.
 *
 * After a game exits with a non-zero code, the launcher looks for a fresh
 * crash report in the instance's `crash-reports/` folder and turns it into a
 * clear, actionable diagnosis: a headline cause, a short snippet and concrete
 * suggestions. It is strictly read-only and never fails a launch.
 */
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { paths } from '../paths'
import { profileManager } from '../profiles/profile-manager'
import type { CrashReport, Profile } from '@shared/types'

/** Only reports written in the last 10 minutes count — prevents a stale
 *  report from a previous session being attributed to today's exit. */
const MAX_AGE_MS = 10 * 60_000

/** Human suggestions derived from the report's content. */
function suggestFor(text: string): string[] {
  const lower = text.toLowerCase()
  const out: string[] = []
  if (/outofmemoryerror|out of memory|memoryerror|unable to allocate/i.test(lower)) {
    out.push('The game ran out of memory. Increase this profile RAM (Play → Memory) to 4–8 GB, or close other apps while playing.')
  }
  if (/\.mod\.|fabric|forge|loader|classnotfound|nosuchmethod|noclassdeffound|mixins?/i.test(lower)) {
    out.push('A mod or loader conflict is likely. Disable recently added mods (Installed → toggle Off) or remove them, then try again.')
    out.push('Update all mods first — outdated mods are one of the most common crash causes (Installed → Update All).')
  }
  if (/driver|opengl|glfw|pixelformat|gpu|display/i.test(lower)) {
    out.push('This looks like a graphics or driver crash. Update your GPU drivers and lower Render Distance in the game video settings.')
  }
  if (/ticking|tick thread|rendering in|integratedserver/i.test(lower)) {
    out.push('The game crashed while processing world data. Try a backup world, or launch with mods disabled to isolate the cause.')
  }
  if (out.length === 0) {
    out.push('Try updating all mods, increasing RAM, or disabling recently installed mods to isolate the crash.')
    out.push('If it keeps happening, share the crash report with the mod authors or the Reimagined community.')
  }
  return out.slice(0, 4)
}

/**
 * Find and analyze the newest fresh crash report for a profile.
 * Returns null when there is no report (or none recent) — callers treat
 * that as a normal non-zero exit, not a crash.
 */
export async function detectCrashReport(profile: Profile): Promise<CrashReport | null> {
  const crashDir = path.join(paths.games, profile.gameDir, 'crash-reports')
  if (!fs.existsSync(crashDir)) return null
  let entries: string[]
  try {
    entries = await fsp.readdir(crashDir)
  } catch {
    return null
  }
  const crashFiles = entries.filter((f) => f.startsWith('crash-') && f.endsWith('.txt'))
  if (crashFiles.length === 0) return null

  // Newest crash report first.
  const withTime = await Promise.all(
    crashFiles.map(async (f) => {
      try {
        const st = await fsp.stat(path.join(crashDir, f))
        return { f, t: st.mtimeMs }
      } catch {
        return { f, t: 0 }
      }
    })
  )
  withTime.sort((a, b) => b.t - a.t)
  if (Date.now() - withTime[0].t > MAX_AGE_MS) return null

  const file = withTime[0].f
  const raw = await fsp.readFile(path.join(crashDir, file), 'utf-8').catch(() => '')
  if (!raw.trim()) return null

  // Headline cause: vanilla crash reports name it on the Description line
  // ("Description: ..."); some old versions / mod packs use an
  // "ACTUAL CAUSE OF FATAL ERROR" section — that is a bonus, not primary.
  let cause = 'The game crashed unexpectedly.'
  const desc = raw.match(/^Description:\s*(.+)$/m)
  if (desc?.[1]) {
    cause = desc[1].slice(0, 240)
  } else {
    const actualCause = raw.match(/--->\s*ACTUAL CAUSE OF FATAL ERROR\s*([\s\S]{0,400}?)(?=\n\n|\t|$)/)
    if (actualCause?.[1]) cause = actualCause[1].trim().split('\n')[0].slice(0, 240) || cause
  }

  return {
    profileId: profile.id,
    profileName: profile.name,
    file,
    cause,
    snippet: raw.slice(0, 6000),
    suggestions: suggestFor(raw),
    at: new Date().toISOString()
  }
}

/** Convenience wrapper used by the launch pipeline (profile by id). */
export async function detectCrashForProfile(profileId: string): Promise<CrashReport | null> {
  const profile = await profileManager.get(profileId)
  if (!profile) return null
  return detectCrashReport(profile)
}
