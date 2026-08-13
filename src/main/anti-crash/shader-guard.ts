/**
 * Shader Guard — the Reimagined anti-crash layer for the shader rendering path.
 *
 * v1.0.13 correction: the guard is a SAFETY NET, never a gate. Shaders must
 * launch and play normally in the vast majority of cases — the guard's job is
 * to catch and gracefully recover from an ACTUAL failure if one happens:
 *
 *  1. GPU / driver capability — assessed from the detected GPU, but used ONLY
 *     as a non-blocking warning for borderline hardware. The launch always
 *     proceeds; when in doubt we rely on the runtime fallback instead.
 *  2. VRAM — a warning with the option to proceed (auto-reduce render
 *     distance only when the user enabled that setting). Never a hard block.
 *  3. Compile / runtime failures — a crash WHILE shaders were enabled is
 *     recorded (crash flag written before the shader session); the next
 *     launch auto-disables shaders and tells the user why, breaking the
 *     endless crash loop.
 *
 * Every decision is logged with full detail so crash patterns can be
 * debugged later.
 */
import fs from 'node:fs'
import { instancePath } from '../instances/paths'
import path from 'node:path'
import { paths } from '../paths'
import { logger } from '../logs/logger'
import { readJson, writeJson } from '../utils/fs'
import type { HardwareProfile, ShaderSupport, ShaderCrashRecord, Profile } from '@shared/types'

/** Flag written INSIDE the instance before a shader-enabled launch starts. */
const CRASH_FLAG = 'shaders-enabled.flag'
/** Where detected shader crashes are persisted for auto-recovery. */
const RECOVERY_FILE = () => path.join(paths.data, 'anti-crash', 'shader-crashes.json')

/** Old driver versions (per vendor) that generally fail modern shaders. */
const MIN_DRIVERS: Record<string, string> = {
  NVIDIA: '390.00',
  AMD: '20.10.1',
  Intel: '30.0.100' // Xe/Iris-era; older iGPU driver strings are excluded below
}

function driverAtLeast(current: string | null | undefined, min: string): boolean {
  if (!current) return true // unknown driver — assume OK, let runtime decide
  const parse = (s: string): number[] =>
    s.replace(/[^0-9.]/g, '').split('.').map((n) => parseInt(n, 10) || 0)
  const a = parse(current)
  const b = parse(min)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return true
}

/** The instance folder for a profile (shader packs live in `shaderpacks/`). */
function instanceDir(profile: Profile): string {
  return instancePath(profile)
}

/**
 * Apply a render distance cap to the instance's real `options.txt` BEFORE the
 * game starts, so a low-VRAM shader session never launches at a distance it
 * can't hold. The original line is preserved and restored after a clean exit
 * (`restoreRenderDistance`) — a crash leaves the safer value in place.
 *
 * Minecraft reads options.txt at startup and rewrites it on exit, so writing
 * it here is the real, correct way to influence the session's render distance
 * (the game owns the file the rest of the time).
 */
export function capRenderDistance(profile: Profile, chunks: number): void {
  try {
    const file = path.join(instanceDir(profile), 'options.txt')
    const backup = file + '.reimagined-rd.bak'
    let content = ''
    try {
      content = fs.readFileSync(file, 'utf-8')
      fs.writeFileSync(backup, content, 'utf-8')
    } catch {
      content = ''
    }
    const capped = content.replace(/^renderDistance:.*$/m, `renderDistance:${chunks}`)
    if (capped === content) {
      fs.writeFileSync(file, content + `\nrenderDistance:${chunks}\n`, 'utf-8')
    } else {
      fs.writeFileSync(file, capped, 'utf-8')
    }
    logger.info(`Shader Guard: render distance capped to ${chunks} chunks for the shader session (backup at options.txt.reimagined-rd.bak)`)
  } catch (err) {
    logger.warn('Shader Guard: could not cap render distance: ' + (err as Error).message)
  }
}

/** Restore the pre-session render distance after a clean exit. */
export function restoreRenderDistance(profile: Profile): void {
  try {
    const file = path.join(instanceDir(profile), 'options.txt')
    const backup = file + '.reimagined-rd.bak'
    if (!fs.existsSync(backup)) return
    const original = fs.readFileSync(backup, 'utf-8')
    fs.writeFileSync(file, original, 'utf-8')
    fs.rmSync(backup, { force: true })
    logger.info('Shader Guard: render distance restored after the shader session.')
  } catch (err) {
    logger.warn('Shader Guard: could not restore render distance: ' + (err as Error).message)
  }
}

/** Track a user-initiated stop so a manual Stop never looks like a crash. */
export function markIntentionalStop(profile: Profile): void {
  try {
    fs.writeFileSync(path.join(instanceDir(profile), 'shaders-stop.intent'), new Date().toISOString())
  } catch {
    /* best-effort */
  }
}

export function clearIntentionalStop(profile: Profile): void {
  try {
    fs.rmSync(path.join(instanceDir(profile), 'shaders-stop.intent'), { force: true })
  } catch {
    /* best-effort */
  }
}

/** True when the session ended by a user-initiated stop (not a crash). */
export function intentionalStopPending(profile: Profile): boolean {
  return fs.existsSync(path.join(instanceDir(profile), 'shaders-stop.intent'))
}

/** True when the profile plausibly uses shaders (pack present AND a shader loader). */
export function profileUsesShaders(profile: Profile): boolean {
  const shaderPackDir = path.join(instanceDir(profile), 'shaderpacks')
  let hasPack = false
  try {
    hasPack = fs.existsSync(shaderPackDir) && fs.readdirSync(shaderPackDir).length > 0
  } catch {
    hasPack = false
  }
  const hasLoader =
    profile.loader.type === 'fabric' &&
    profile.mods.some((m) => m.slug === 'iris' || m.id === 'iris' || /iris/i.test(m.title))
  return hasPack && hasLoader
}

/**
 * The shader pack that was ACTIVE when the session ran (folder name from
 * iris.properties; falls back to a lone entry in shaderpacks/). v1.0.63 —
 * used to attribute a crash to a specific pack so the browse badges can flag
 * packs that already crashed on this machine.
 */
export function activeShaderPack(profile: Profile): string | null {
  try {
    const irisCfg = path.join(instanceDir(profile), 'config', 'iris.properties')
    const content = fs.readFileSync(irisCfg, 'utf-8')
    // v1.0.8x — Iris writes "shaderPack" (capital P); older builds used
    // "shaderpack". Match both casings so pack attribution + risk badges work
    // on real iris.properties files. (Iris writes CRLF; `.` does not match
    // `\r`, so the value is captured cleanly without the carriage return.)
    const m = content.match(/^shader[pP]ack=(.+)$/m)
    const pack = m?.[1]?.trim()
    if (pack) return pack
  } catch {
    /* no iris config yet */
  }
  try {
    const dir = path.join(instanceDir(profile), 'shaderpacks')
    const entries = fs.readdirSync(dir).filter((f) => !f.endsWith('.txt') && !f.startsWith('.'))
    if (entries.length === 1) return entries[0]
  } catch {
    /* no shaderpacks dir */
  }
  return null
}

/**
 * Assess whether THIS machine can realistically run shaders. Real hardware
 * data only — vendor, VRAM and driver version from the detected profile.
 *
 * v1.0.14: this is deliberately NON-BLOCKING. Even a sub-1 GB VRAM GPU gets a
 * strong warning and the launch proceeds — VRAM is never a hard block, the
 * user can always choose "launch anyway", and if shaders actually fail the
 * runtime fallback and auto-recovery handle it. (The ShaderSupport type keeps
 * an 'unsupported' level for UI display only; the launcher never refuses.)
 */
export function assessShaderSupport(hw: HardwareProfile | null): ShaderSupport {
  const reasons: string[] = []
  const vramGB = hw?.gpu[0]?.vramGB ?? 0
  const driverVersion = hw?.gpu[0]?.driverVersion ?? null
  const vendor = hw?.gpu[0]?.vendor ?? 'Unknown'
  const gpuName = hw?.gpu[0]?.name ?? 'Unknown GPU'

  let level: ShaderSupport['level'] = 'ok'

  // 1) VRAM — shaders roughly double VRAM pressure. VRAM is NEVER a hard
  //    block (v1.0.14): even sub-1 GB GPUs get a strong warning and the
  //    launch proceeds — the user can always choose "launch anyway" and the
  //    runtime fallback/auto-recovery is the safety net.
  if (vramGB > 0 && vramGB < 1) {
    level = 'limited'
    reasons.push('This GPU has less than 1 GB of VRAM — shaders will very likely exhaust memory and crash the game. Try a lightweight shader pack or skip shaders on this machine.')
  } else if (vramGB > 0 && vramGB < 2) {
    level = 'limited'
    reasons.push('This GPU has ' + vramGB + ' GB of VRAM — shaders may run out of memory at high render distance. Consider lowering render distance if you see stutters.')
  } else if (vramGB > 0 && vramGB < 4) {
    level = 'limited'
    reasons.push('This GPU has ' + vramGB + ' GB of VRAM — shaders can work but may struggle at high render distance.')
  }

  // 2) Older Intel HD iGPUs are a common crash source — warn, don't block.
  const isOldIntel =
    hw?.gpu.some((g) => /intel/i.test(g.vendor) && /hd (graphics )?(2000|3000|4000|2500|4400|4600)/i.test(g.name)) ?? false
  if (isOldIntel) {
    level = 'limited'
    reasons.push('This Intel HD Graphics generation may not fully support the OpenGL features shaders require — if shaders crash, update the driver or use a lighter pack.')
  }

  // 3) Outdated drivers on otherwise-capable GPUs — always just a warning.
  const min = MIN_DRIVERS[vendor]
  if (min && driverVersion && !driverAtLeast(driverVersion, min)) {
    level = 'limited'
    reasons.push('The graphics driver (' + driverVersion + ') is older than the recommended minimum (' + min + ') — shaders may fail. Updating the driver is strongly advised.')
  }

  if (reasons.length === 0) {
    reasons.push(gpuName + ' meets the basic requirements for shader rendering.')
  }

  logger.info('Shader Guard: ' + level + ' — ' + gpuName + ' (' + vendor + ', ' + vramGB + ' GB VRAM, driver ' + (driverVersion ?? 'unknown') + ')')
  return { level, reasons, vramGB, driverVersion, recoveryPending: false }
}

/**
 * VRAM-aware render-distance suggestion when enabling shaders.
 * Returns the render distance to auto-apply (or null = keep current) and a
 * human message. Lower-VRAM GPUs get a conservative cap.
 */
export function shaderRenderDistanceFor(hw: HardwareProfile | null, currentRd: number): { rd: number; message: string | null } {
  const vramGB = hw?.gpu[0]?.vramGB ?? 0
  if (vramGB <= 0) return { rd: currentRd, message: null }
  if (vramGB >= 6) return { rd: currentRd, message: null }
  if (vramGB >= 4) return { rd: Math.min(currentRd, 12), message: null }
  if (vramGB >= 2) return { rd: Math.min(currentRd, 8), message: 'Low VRAM detected — render distance reduced to ' + Math.min(currentRd, 8) + ' chunks so shaders don\'t run out of memory.' }
  return { rd: Math.min(currentRd, 4), message: 'Very low VRAM detected — render distance reduced to ' + Math.min(currentRd, 4) + ' chunks for shader stability.' }
}

/* ------------------------------ crash flag / recovery ------------------------------ */

/**
 * Called right before a shader-enabled launch. Writes the armed flag INSIDE
 * the instance so a crash can be attributed to the shader session.
 */
export function armShaderCrashFlag(profile: Profile): void {
  try {
    fs.writeFileSync(path.join(instanceDir(profile), CRASH_FLAG), JSON.stringify({ at: new Date().toISOString(), profile: profile.name }))
  } catch {
    /* best-effort */
  }
}

/** Called after a clean exit — a clean session must never trigger recovery. */
export function clearShaderCrashFlag(profile: Profile): void {
  try {
    fs.rmSync(path.join(instanceDir(profile), CRASH_FLAG), { force: true })
  } catch {
    /* best-effort */
  }
}

/** True when the previous session died with the shader flag still armed. */
export function shaderCrashPending(profile: Profile): boolean {
  return fs.existsSync(path.join(instanceDir(profile), CRASH_FLAG))
}

/** Persist a detected shader crash for cross-session auto-recovery. */
export async function recordShaderCrash(rec: ShaderCrashRecord): Promise<void> {
  try {
    const list = await readJson<ShaderCrashRecord[] | null>(RECOVERY_FILE(), null)
    const next = [rec, ...(Array.isArray(list) ? list : [])].slice(0, 10)
    await writeJson(RECOVERY_FILE(), next)
    logger.warn('Shader Guard: recorded shader crash — ' + rec.cause.slice(0, 140))
  } catch (err) {
    logger.warn('Shader Guard: could not persist crash record: ' + (err as Error).message)
  }
}

/** Recent shader-crash records (newest first). */
export async function recentShaderCrashes(): Promise<ShaderCrashRecord[]> {
  const list = await readJson<ShaderCrashRecord[] | null>(RECOVERY_FILE(), null)
  return Array.isArray(list) ? list : []
}

/**
 * Auto-recovery: disable shaders for the next session. Writes the Iris
 * config (`shaderpack=` blank disables shaders for real) so the game starts
 * with them off, and clears the armed flag so a normal session doesn't loop.
 */
/**
 * Auto-recovery: disable shaders for the next session. Writes the Iris
 * config (`shaderpack=` blank disables shaders for real) so the game starts
 * with them off, and clears the armed flag so a normal session doesn't loop.
 */
export function disableShadersForSession(profile: Profile): void {
  const dir = instanceDir(profile)
  try {
    const irisCfg = path.join(dir, 'config', 'iris.properties')
    fs.mkdirSync(path.dirname(irisCfg), { recursive: true })
    let content = ''
    try {
      content = fs.readFileSync(irisCfg, 'utf-8')
    } catch {
      content = ''
    }
    // Blank the active pack regardless of key casing (Iris writes
    // "shaderPack", older versions "shaderpack") — shaders will not load.
    // Java Properties keeps the LAST occurrence of a key, so stripping every
    // existing line and appending the authoritative empty values wins.
    // CRLF-safe: Iris writes `\r\n`, so each stripped line must also consume
    // the `\r` (`.` never matches it) or a stray carriage return is left
    // behind on the blanked line.
    content = content
      .replace(/^shader[pP]ack=.*\r?$/m, '')
      .replace(/^enableShaders=.*\r?$/m, '')
    content += '\nshaderPack=\nenableShaders=false\n'
    fs.writeFileSync(irisCfg, content, 'utf-8')
    logger.info('Shader Guard: shaders auto-disabled for "' + profile.name + '" — recovering from the previous shader crash.')
  } catch (err) {
    logger.warn('Shader Guard: could not write iris.properties: ' + (err as Error).message)
  } finally {
    clearShaderCrashFlag(profile)
  }
}

/**
 * Shadow-safe recovery (v1.0.8x) — the surgical fix for the Sodium
 * "Cannot wait on a fence for the current submit" crash family on older
 * Intel iGPUs. The crash fires inside Iris's shadow pass
 * (ShadowRenderer → SodiumWorldRenderer.reload → MappedStagingBuffer.delete).
 * Keeping the shader pack but disabling shadow rendering avoids the crashing
 * code path entirely AND is the single biggest FPS win for a weak GPU
 * (shadows can be half the frame cost). The pack stays fully usable — the
 * user can re-enable shadows from Iris's in-game settings at their own risk.
 */
export function enableShadowSafeMode(profile: Profile): void {
  const dir = instanceDir(profile)
  try {
    const irisCfg = path.join(dir, 'config', 'iris.properties')
    fs.mkdirSync(path.dirname(irisCfg), { recursive: true })
    let content = ''
    try {
      content = fs.readFileSync(irisCfg, 'utf-8')
    } catch {
      content = ''
    }
    content = content.replace(/^enableShadows=.*\r?$/m, '')
    content += '\nenableShadows=false\n'
    fs.writeFileSync(irisCfg, content, 'utf-8')
    logger.info('Shader Guard: shadow-safe mode enabled for "' + profile.name + '" — shadows disabled, shader pack kept active (fence-crash prevention).')
  } catch (err) {
    logger.warn('Shader Guard: could not write shadow-safe iris.properties: ' + (err as Error).message)
  } finally {
    clearShaderCrashFlag(profile)
  }
}

/**
 * Sodium↔Iris fence/staging-buffer crash signature — the deterministic
 * shadow-pass killer on Intel HD iGPUs ("Cannot wait on a fence for the
 * current submit" in GlCommandEncoder.awaitSubmit / MappedStagingBuffer.delete).
 */
const FENCE_SIGNATURE = /fence|awaitsubmit|stagingbuffer|glcommandencoder|glfence/i

/** Classify a crash report snippet: 'fence' (shadow-pass sync bug) or 'other'. */
export function crashSignature(text: string): 'fence' | 'other' {
  return FENCE_SIGNATURE.test(text) ? 'fence' : 'other'
}

/**
 * Which recovery the next launch should apply for this profile, based on the
 * most recent recorded shader crash: a fence crash → shadow-safe (keep the
 * pack, kill only the crashing shadow pass); anything else → full disable.
 * Returns null when there is no record for this profile. The armed crash flag
 * is the freshness gate — this only picks the recovery mode, it never
 * decides WHETHER to recover.
 */
/** A crash record is "fresh" for recovery purposes for 24h — long enough to
 *  break a crash loop, short enough that a stale record after a driver/GPU
 *  change never keeps forcing recovery forever. */
const RECOVERY_FRESH_MS = 24 * 60 * 60 * 1000

/**
 * True when the previous session plausibly crashed with shaders: the armed
 * in-instance flag OR a fresh (<=24h) shader-crash record for this profile.
 * The record check covers the real gap where shaders were enabled IN-GAME
 * (e.g. from the shader pack screen) after the launcher started without them
 * — in that case the launch-time flag was never armed, but the crash report
 * detection still writes the record, and this is what triggers recovery.
 */
export async function shaderRecoveryPending(profile: Profile): Promise<boolean> {
  if (shaderCrashPending(profile)) return true
  const list = await readJson<ShaderCrashRecord[] | null>(RECOVERY_FILE(), null)
  const records = Array.isArray(list) ? list : []
  const rec = records.find((r) => r.profileId === profile.id)
  return !!rec && Date.now() - new Date(rec.at).getTime() < RECOVERY_FRESH_MS
}

/**
 * Which recovery the next launch should apply for this profile, based on the
 * most recent recorded shader crash: a FRESH fence crash → shadow-safe (keep
 * the pack, kill only the crashing shadow pass); anything else (older record,
 * non-fence signature, no record) → full disable (conservative).
 */
export async function recoveryModeFor(profile: Profile): Promise<'shadow-safe' | 'disable' | null> {
  const list = await readJson<ShaderCrashRecord[] | null>(RECOVERY_FILE(), null)
  const records = Array.isArray(list) ? list : []
  const rec = records.find((r) => r.profileId === profile.id)
  if (!rec) return null
  const fresh = Date.now() - new Date(rec.at).getTime() < RECOVERY_FRESH_MS
  return fresh && rec.signature === 'fence' ? 'shadow-safe' : 'disable'
}
