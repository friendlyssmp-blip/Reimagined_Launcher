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

/** Patterns that indicate a shader-pipeline crash (Iris / shader compile / GL). */
const SHADER_PATTERNS =
  /iris|shader|glsl|spirv|glCompileShader|glLinkProgram|shadercompile|shader.*compile|shader.*error|glslang|opengl.*version|pixelformat|no.*pixel|glfw.*error/i

/** Sodium/Iris GPU-synchronization crash ("Cannot wait on a fence…") — the
 *  fence is being awaited while its submission is still the current one; a
 *  known Sodium ↔ Iris renderer lifecycle conflict (V2 investigation). */
const FENCE_PATTERNS =
  /fence|awaitsubmit|stagingbuffer|rendermay|regionmanager|sodium.*render|iris.*shadow|shadowrenderer|glcommandencoder/i

/** True when a crash report looks like a shader-pipeline failure. */
export function isShaderCrash(text: string): boolean {
  return SHADER_PATTERNS.test(text)
}

/* ------------------------------ V2 structured analysis ------------------------------ */

/** The exception type + first message from the head of the report. */
function extractException(raw: string): string | undefined {
  // Vanilla head: "java.lang.NullPointerException: message" or
  // "Exception: ..." — take the first line that names an exception type.
  const m = raw.match(/^([a-zA-Z_][\w$.]*(?:Exception|Error|Throwable)):\s*(.*)$/m)
  if (!m) return undefined
  const msg = (m[2] ?? '').trim()
  return msg ? `${m[1]}: ${msg.slice(0, 220)}` : m[1]
}

/** The "Caused by:" chain line (root of the cause), if present. */
function extractCausedBy(raw: string): string | undefined {
  const m = raw.match(/Caused by:\s*([^\n]+)/)
  return m ? m[1].trim().slice(0, 220) : undefined
}

/** Top of the stack trace — the first 4 "at …" frames. */
function extractStackTop(raw: string): string[] {
  const frames: string[] = []
  const re = /^\s*at ([\w$.]+)\.([\w$<>]+)\([^)]*\)$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) && frames.length < 4) {
    frames.push(`${m[1]}.${m[2]}`)
  }
  return frames
}

/** Non-vanilla classes in the stack → short mod-ish names (evidence-based). */
function extractResponsibleMods(raw: string): string[] {
  const vanilla = /^(net\.minecraft|com\.mojang|java\.|javax\.|sun\.|jdk\.|org\.lwjgl|org\.apache|com\.google|org\.slf4j|com\.ibm|it\.unimi|org\.objectweb|com\.fasterxml|org\.apache\.logging|net\.fabricmc|net\.fabric|net\.neoforged|net\.minecraftforge|cpw\.mods|com\.kikugj|net\.caffeinemc\.mixin)/
  const seen = new Map<string, number>()
  const re = /^\s*at (([a-z][\w]*)(?:\.[a-z][\w]*)?(?:\.(?:[A-Z][\w$]*))*)\.[\w$<>]+\(/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    const cls = m[1]
    if (vanilla.test(cls)) continue
    const parts = cls.split('.')
    // Short name = first two non-generic segments, e.g. me.jellysquid → me.jellysquid
    const name = parts.length >= 2 ? parts.slice(0, 2).join('.') : cls
    seen.set(name, (seen.get(name) ?? 0) + 1)
  }
  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name)
}

/** Tail of the instance's latest.log — what happened right before the crash. */
async function extractLogTail(profile: Profile): Promise<string[]> {
  try {
    const logPath = path.join(paths.games, profile.gameDir, 'logs', 'latest.log')
    if (!fs.existsSync(logPath)) return []
    const st = await fsp.stat(logPath)
    // Only fresh logs (written around the crash) — never stale context.
    if (Date.now() - st.mtimeMs > 60 * 60_000) return []
    const raw = await fsp.readFile(logPath, 'utf-8')
    return raw.split('\n').filter(Boolean).slice(-30)
  } catch {
    return []
  }
}

/** Evidence-based confidence: real exception + non-vanilla frames = high. */
function confidenceFor(exception: string | undefined, mods: string[], shader: boolean): 'high' | 'medium' | 'low' {
  if (exception && (mods.length > 0 || shader)) return 'high'
  if (exception) return 'medium'
  return 'low'
}

/** Human suggestions derived from the report's content. */
function suggestFor(text: string): string[] {
  const lower = text.toLowerCase()
  const out: string[] = []
  // Shader crashes — the specific, user-facing problem this assistant exists for.
  if (SHADER_PATTERNS.test(lower)) {
    out.push('This looks like a shader crash. The launcher will start the next session with shaders disabled so the game can run — re-enable them from the in-game shader menu when you\'re ready.')
    out.push('If shaders keep crashing, update your GPU drivers or try a different shader pack. Older/low-VRAM GPUs often need render distance lowered.')
  }
  // Sodium ↔ Iris fence/staging-buffer conflict (V2): the renderer destroys
  // GPU resources while their submission is still current, usually during a
  // reload/dimension change with shadow rendering active.
  if (FENCE_PATTERNS.test(lower) && /sodium|iris/.test(lower)) {
    out.push('This is a GPU synchronization conflict between Sodium and Iris (a GPU fence was awaited while its submission was still current — usually during a reload or dimension change with shadow rendering active).')
    out.push('Update Sodium and Iris to their latest versions for this Minecraft version, and try lowering or disabling Iris shadows (shadow resolution). If it persists, disable shaders for this profile in Settings → Performance → Shader Guard.')
  }
  // Render-frame failures — an exception escaped during the per-frame render
  // call (vanilla Description: "Failed to render frame", stack in the Render
  // thread). Newly diagnosed: the FPS Boost in-game watchdog now logs the full
  // stack so this can be debugged from real data.
  // Narrow on purpose: "render thread" appears in the head of nearly every
  // crash report, so only specific per-frame render failures should match.
  if (/render frame|failed to render|framebuffer|renderer.*error|exception.*render|at net\.minecraft\.client\.renderer/i.test(lower)) {
    out.push('The game crashed while rendering a frame — usually a GPU/driver issue or an aggressive render optimization. The Reimagined engine auto-lowers its render tweaks after this kind of crash; updating your GPU driver is the most common fix.')
    out.push('Try lowering Render Distance and disabling shaders to isolate it, then re-enable one at a time. Reimagined FPS Boost settings can also be reduced in the in-game menu (K).')
  }
  if (/outofmemoryerror|out of memory|memoryerror|unable to allocate/i.test(lower)) {
    out.push('The game ran out of memory. Increase this profile RAM (Play → Memory) to 4–8 GB, or close other apps while playing.')
  }
  if (/resourcepack|texturepack|pack format|model engine|missing texture/i.test(lower)) {
    out.push('A resource pack may be incompatible. Try disabling recently added resource packs, then re-enable them one by one.')
  }
  if (/world|level|chunk|region|dimension|saving|loading.*world/i.test(lower)) {
    out.push('The game crashed while processing world data. Try a backup world, or launch with mods disabled to isolate the cause.')
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

  // V2 structured analysis — real evidence, never invented.
  const exception = extractException(raw)
  const causedBy = extractCausedBy(raw)
  const stackTop = extractStackTop(raw)
  const responsibleMods = extractResponsibleMods(raw)
  const shader = isShaderCrash(raw)
  const logTail = await extractLogTail(profile)
  const confidence = confidenceFor(exception, responsibleMods, shader)

  return {
    profileId: profile.id,
    profileName: profile.name,
    file,
    cause,
    snippet: raw.slice(0, 6000),
    suggestions: suggestFor(raw),
    at: new Date().toISOString(),
    exception,
    causedBy,
    stackTop,
    responsibleMods,
    confidence,
    logTail
  }
}

/** Convenience wrapper used by the launch pipeline (profile by id). */
export async function detectCrashForProfile(profileId: string): Promise<CrashReport | null> {
  const profile = await profileManager.get(profileId)
  if (!profile) return null
  return detectCrashReport(profile)
}
