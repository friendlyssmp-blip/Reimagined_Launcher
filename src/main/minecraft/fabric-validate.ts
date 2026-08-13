/**
 * Fabric environment validation (v1.0.79).
 *
 * The infamous "Failed to read classTweaker file from mod X — Namespace
 * (intermediary) does not match current runtime namespace (official)" crash
 * is a RUNTIME-environment symptom, not a single-mod problem: modern Fabric
 * Loader runs Minecraft in the Mojang-mapped `official` namespace and remaps
 * each mod's `intermediary` classTweaker entries at load time using the
 * mappings for THAT Minecraft version. When a jar was built for a DIFFERENT
 * Minecraft version (or a stale loader/environment is in play), the
 * intermediary names don't exist in the current mappings, the remap fails,
 * and the loader hard-crashes with the namespace error.
 *
 * This module validates the whole environment BEFORE launch so the launcher
 * never hands a broken combination to the game: every jar's `fabric.mod.json`
 * is checked against the profile's Minecraft version (and loader), the
 * classTweaker namespace of each jar (and nested jars under META-INF/jars) is
 * inspected, and the loader version the profile pins is verified to exist for
 * that Minecraft version. Anything incompatible is reported so the UI can
 * offer Repair instead of letting the game crash.
 */
import path from 'node:path'
import { instancePath } from '../instances/paths'
import fs from 'node:fs'
import { paths } from '../paths'
import { logger } from '../logs/logger'
import { zipReadEntry, zipListEntries } from '../utils/zip'
import { latestFabricLoader } from './loaders/fabric'
import type { Profile } from '@shared/types'

/* ------------------------- Minecraft version math ------------------------- */

/** Split "1.21.11-alpha.3" → [1, 21, 11]. Non-numeric tails are ignored. */
export function mcSegments(v: string): number[] {
  const m = /^(\d+(?:\.\d+)*)/.exec(v.trim())
  if (!m) return []
  return m[1].split('.').map((s) => Number(s))
}

/** -1 | 0 | 1 comparing two segment arrays. */
function cmp(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/**
 * Fabric Loader's `~` upper bound (SemanticVersionImpl.getFuzzyRange):
 *  - `~1.21`  → [1, 22]  (increment the only/last component)
 *  - `~1.21.4`→ [1, 22]  (increment the SECOND-TO-LAST component, then
 *    truncate to 2 — i.e. the whole 1.21.x line, NOT just 1.21.4→1.21.5)
 *  - `~26.2`  → [26, 3]
 * Getting this wrong marks real compatible mods as incompatible.
 */
function fuzzyUpper(v: number[]): number[] {
  if (v.length >= 3) {
    const out = v.slice(0, 2)
    out[1] = (out[1] ?? 0) + 1
    return out
  }
  const out = [...v]
  out[out.length - 1] = (out[out.length - 1] ?? 0) + 1
  return out
}

/** Fabric's caret upper bound: increment the first NON-ZERO component.
 *  `^1.21.4` → <2.0 ; `^0.16.5` → <0.17 (increment the minor). */
function caretUpper(v: number[]): number[] {
  const out = [...v]
  let i = 0
  while (i < out.length - 1 && out[i] === 0) i++
  out[i] = (out[i] ?? 0) + 1
  return out.slice(0, i + 1)
}

/**
 * True when `version` satisfies a single clause like `>=1.21`, `~26.2-`,
 * `1.21.11`, `1.21` (branch) or `1.21.x`.
 */
function clauseMatches(version: string, rawClause: string): boolean {
  const clause = rawClause.trim()
  if (!clause || clause === '*' || clause === 'latest') return true
  const v = mcSegments(version)
  if (v.length === 0) return false

  const m = /^(>=|<=|>|<|=|~|\^)?(.+)$/.exec(clause)
  if (!m) return false
  const op = m[1] ?? ''
  let target = m[2].trim()
  // "1.21.x" → branch match on 1.21
  if (/\.x$/i.test(target)) {
    target = target.replace(/\.x$/i, '')
    const t = mcSegments(target)
    return t.length > 0 && v.slice(0, t.length).every((s, i) => s === t[i])
  }
  // "1.21" (2 segments, no operator) → branch 1.21.x
  if (!op) {
    const t = mcSegments(target)
    if (t.length <= 2) {
      return v.slice(0, t.length).every((s, i) => s === t[i])
    }
    return cmp(v, t) === 0
  }
  const t = mcSegments(target)
  if (t.length === 0) return false
  switch (op) {
    case '>=':
      return cmp(v, t) >= 0
    case '<=':
      return cmp(v, t) <= 0
    case '>':
      return cmp(v, t) > 0
    case '<':
      return cmp(v, t) < 0
    case '=':
      return cmp(v, t) === 0
    case '~':
      // ~1.21 → >=1.21 <1.22 ; ~1.21.4 → >=1.21.4 <1.22 (whole minor line)
      return cmp(v, t) >= 0 && cmp(v, fuzzyUpper(t)) < 0
    case '^':
      // Fabric's caret: >=target and < caretUpper(target) — e.g. ^0.16.5
      // allows 0.16.9 but NOT 0.19.3 (first non-zero component is the minor).
      return cmp(v, t) >= 0 && cmp(v, caretUpper(t)) < 0
    default:
      return false
  }
}

/**
 * True when a Minecraft version satisfies a fabric.mod.json `depends.minecraft`
 * declaration (string with space-separated clauses, or an array of them).
 */
export function mcInRange(version: string, range: string | string[] | undefined | null): boolean {
  if (!range) return true
  const ranges = Array.isArray(range) ? range : [range]
  if (ranges.length === 0) return true
  // An ARRAY means "any of these" (OR).
  return ranges.some((r) => {
    if (!r) return true
    // Space-separated clauses are ANDed (e.g. ">=1.21 <1.22").
    return r.split(/\s+/).filter(Boolean).every((c) => clauseMatches(version, c))
  })
}

/* ----------------------------- jar scanning ------------------------------ */

export interface FabricModCheck {
  fileName: string
  modId: string | null
  modVersion: string | null
  minecraftDep: string | string[] | null
  loaderDep: string | null
  /** Namespaces declared by *.classTweaker entries found in this jar (or its
   *  nested META-INF/jars modules). */
  classTweakerNamespaces: string[]
  ok: boolean
  reason: string | null
}

export interface FabricEnvReport {
  ok: boolean
  /** True when any jar failed — launch should be blocked. */
  hasFailures: boolean
  checks: FabricModCheck[]
  problems: { fileName: string; reason: string }[]
  warnings: string[]
}

/** Read fabric.mod.json from a jar buffer or null. */
function readFabricModJson(archive: Buffer): Record<string, any> | null {
  const buf = zipReadEntry(archive, 'fabric.mod.json')
  if (!buf) return null
  try {
    const parsed = JSON.parse(buf.toString('utf-8'))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/** All namespaces declared by *.classTweaker files in a jar (top level OR
 *  nested META-INF/jars modules — the fabric-api mega-jar keeps its modules'
 *  classTweaker entries inside nested jars that the loader also remaps). */
function classTweakerNamespaces(archive: Buffer): string[] {
  const out: string[] = []
  const scan = (buf: Buffer): void => {
    for (const name of zipListEntries(buf)) {
      if (!name.endsWith('.classTweaker')) continue
      const b = zipReadEntry(buf, name)
      if (!b) continue
      const head = b.toString('utf-8').split(/\r?\n/, 1)[0] ?? ''
      // Format: "classTweaker <version> <namespace>" (v2) or "classTweaker <version>" (v1)
      const parts = head.trim().split(/\s+/)
      if (parts.length >= 3 && parts[0] === 'classTweaker') out.push(parts[2])
    }
  }
  scan(archive)
  for (const name of zipListEntries(archive)) {
    if (!name.startsWith('META-INF/jars/') || !name.endsWith('.jar')) continue
    const nested = zipReadEntry(archive, name)
    if (nested) scan(nested)
  }
  return out
}

/** The expected runtime namespace for a Minecraft version under modern Fabric
 *  Loader: `official` for 1.20.5+ (and the 26.x line); older versions ran in
 *  `intermediary`. Used only to explain mismatches in the report. */
export function expectedRuntimeNamespace(mcVersion: string): string {
  const [major, minor] = mcSegments(mcVersion)
  if (major === 1 && minor < 20) return 'intermediary'
  if (major === 1 && minor === 20) return 'intermediary' // 1.20.0–1.20.4
  return 'official'
}

/**
 * Validate ONE jar against a profile's environment.
 * Returns the check record; `ok=false` means the jar cannot run on this
 * Minecraft/loader combination and should be removed or the profile repaired.
 */
export function checkFabricJar(profile: Profile, jarPath: string, effectiveLoaderVersion?: string | null): FabricModCheck {
  const fileName = path.basename(jarPath)
  const empty: FabricModCheck = {
    fileName,
    modId: null,
    modVersion: null,
    minecraftDep: null,
    loaderDep: null,
    classTweakerNamespaces: [],
    ok: true,
    reason: null
  }
  let archive: Buffer
  try {
    archive = fs.readFileSync(jarPath)
  } catch {
    return { ...empty, ok: false, reason: 'Jar could not be read.' }
  }
  const mod = readFabricModJson(archive)
  if (!mod) {
    // Not a Fabric mod (resource pack, datapack, or malformed) — not our call.
    return { ...empty, ok: true, reason: 'No fabric.mod.json — not a Fabric mod.' }
  }

  const check: FabricModCheck = {
    ...empty,
    modId: typeof mod.id === 'string' ? mod.id : null,
    modVersion: typeof mod.version === 'string' ? mod.version : null,
    minecraftDep: (mod.depends?.minecraft as string | string[] | undefined) ?? null,
    loaderDep: (mod.depends?.fabricloader as string | undefined) ?? null,
    classTweakerNamespaces: classTweakerNamespaces(archive)
  }

  const mc = profile.minecraftVersion

  // 1) Minecraft version range — the core check.
  if (check.minecraftDep) {
    if (!mcInRange(mc, check.minecraftDep)) {
      check.ok = false
      check.reason = `Built for Minecraft ${JSON.stringify(check.minecraftDep)} — this profile is ${mc}.`
      return check
    }
  }

  // 2) Loader lower bound (e.g. ">=0.15.11"). Judges against the loader the
  //    launch will ACTUALLY use (effectiveLoaderVersion — resolved for this MC
  //    version, falling back to latest when the pin is stale), never the raw
  //    pin, so healthy mods are never flagged against a pin from another MC.
  if (check.loaderDep) {
    const pinned = effectiveLoaderVersion ?? profile.loader.version
    if (pinned && !mcInRange(pinned, check.loaderDep)) {
      check.ok = false
      check.reason = `Requires Fabric Loader ${check.loaderDep} — this profile runs ${pinned}.`
      return check
    }
  }

  // 3) classTweaker namespace sanity: a jar declaring an intermediary
  //    classTweaker on a modern runtime is normal (the loader remaps it) —
  //    BUT if the jar ALSO failed the MC range above we already blocked it.
  //    Here we only warn when a namespace is neither intermediary nor official.
  const expected = expectedRuntimeNamespace(mc)
  for (const ns of check.classTweakerNamespaces) {
    if (ns !== 'intermediary' && ns !== 'official' && ns !== 'named') {
      check.ok = false
      check.reason = `classTweaker namespace "${ns}" is not compatible with this runtime (expected ${expected}).`
      return check
    }
  }

  return check
}

/* --------------------------- environment report --------------------------- */

/**
 * Scan every jar in a Fabric profile's mods folder and validate each against
 * the profile's Minecraft version + pinned loader. Also verifies the pinned
 * loader version still exists for this Minecraft version (reported as a
 * warning when it doesn't — the launch path re-resolves it).
 */
export async function validateFabricEnvironment(profile: Profile): Promise<FabricEnvReport> {
  const warnings: string[] = []
  const checks: FabricModCheck[] = []
  const problems: { fileName: string; reason: string }[] = []

  if (profile.loader.type !== 'fabric') {
    return { ok: true, hasFailures: false, checks, problems, warnings }
  }

  const modsDir = path.join(instancePath(profile), 'mods')
  if (!fs.existsSync(modsDir)) {
    return { ok: true, hasFailures: false, checks, problems, warnings }
  }
  const jars = fs.readdirSync(modsDir).filter((f) => f.endsWith('.jar') && !f.endsWith('.jar.disabled')).sort()

  // v1.0.79 — validation cache: reading ~100 jars synchronously on EVERY
  // launch is the kind of work this launcher should never do twice. Keyed by
  // mc version + loader pin + each jar's name/size/mtime, so the common
  // launch (nothing changed) is a cheap stat-per-jar instead of a full
  // re-scan (and skips the meta network call entirely on the cached path).
  const sig = [`mc=${profile.minecraftVersion}`, `pin=${profile.loader.version ?? ''}`]
  for (const f of jars) {
    try {
      const st = fs.statSync(path.join(modsDir, f))
      sig.push(`${f}:${st.size}:${Math.floor(st.mtimeMs)}`)
    } catch {
      sig.push(`${f}:missing`)
    }
  }
  const sigStr = sig.join('|')
  const cacheFile = path.join(paths.data, 'validation', `${profile.gameDir.replace(/[^a-zA-Z0-9-_]/g, '_')}.json`)
  const cached = (() => {
    try {
      const raw = fs.readFileSync(cacheFile, 'utf-8')
      const parsed = JSON.parse(raw) as {
        sig?: string
        ok?: boolean
        problems?: { fileName: string; reason: string }[]
        warnings?: string[]
      }
      if (parsed && parsed.sig === sigStr && Array.isArray(parsed.problems) && Array.isArray(parsed.warnings)) return parsed
    } catch {
      /* no cache */
    }
    return null
  })()
  if (cached) {
    const cachedProblems = cached.problems ?? []
    return {
      ok: cached.ok !== false && cachedProblems.length === 0,
      hasFailures: cachedProblems.length > 0,
      checks: [],
      problems: cachedProblems,
      warnings: cached.warnings ?? []
    }
  }

  // Loader version validity for THIS Minecraft version, and the loader the
  // launch will ACTUALLY use (never blindly use a pinned loader that doesn't
  // exist for the MC version — a stale pin falls back to the latest valid).
  let effectiveLoader: string | null = profile.loader.version ?? null
  try {
    const { getFabricLoaders, latestFabricLoader } = await import('./loaders/fabric')
    const loaders = await getFabricLoaders(profile.minecraftVersion).catch(() => [] as string[])
    if (!profile.loader.version) {
      effectiveLoader = loaders[0] ?? null
    } else if (!loaders.includes(profile.loader.version)) {
      const latest = await latestFabricLoader(profile.minecraftVersion).catch(() => null)
      effectiveLoader = latest ?? profile.loader.version
      if (latest) {
        warnings.push(
          `Profile pins Fabric Loader ${profile.loader.version}, which does not exist for Minecraft ${profile.minecraftVersion} — the launcher will use ${latest} instead.`
        )
      }
    }
  } catch {
    /* meta unreachable — keep the pin as-is */
  }

  for (const f of jars) {
    const check = checkFabricJar(profile, path.join(modsDir, f), effectiveLoader)
    checks.push(check)
    if (!check.ok) {
      problems.push({ fileName: f, reason: check.reason ?? 'Incompatible with this profile.' })
    }
  }

  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true })
    fs.writeFileSync(
      cacheFile,
      JSON.stringify({ sig: sigStr, ok: problems.length === 0, problems, warnings, checkedAt: new Date().toISOString() }, null, 2),
      'utf-8'
    )
  } catch {
    /* best-effort cache */
  }

  const hasFailures = problems.length > 0
  if (hasFailures) {
    logger.warn(`Fabric env validation failed for "${profile.name}": ${problems.map((p) => `${p.fileName} (${p.reason})`).join('; ')}`)
  }
  return { ok: !hasFailures, hasFailures, checks, problems, warnings }
}

/**
 * Repair a Fabric profile's environment without touching user data:
 *  - validates/re-pins the loader for the profile's Minecraft version,
 *  - moves incompatible jars OUT of mods/ into `mods.incompatible/` (never
 *    deleted — recoverable),
 *  - clears the stale `.fabric/processedMods` remap cache (regenerated by the
 *    loader on next launch),
 *  - leaves saves/, screenshots/, resourcepacks/, shaderpacks/ and config/
 *    completely untouched.
 * Returns a summary of what was fixed.
 */
export async function repairFabricEnvironment(profile: Profile): Promise<{ fixed: string[]; moved: string[] }> {
  const fixed: string[] = []
  const moved: string[] = []
  const modsDir = path.join(instancePath(profile), 'mods')

  // 1) Re-resolve the loader for this Minecraft version (drop a stale pin so
  //    the quarantine below judges jars against the loader that will ACTUALLY
  //    launch — never a pin from another Minecraft version).
  let effectiveLoader: string | null = profile.loader.version ?? null
  try {
    const { getFabricLoaders, latestFabricLoader } = await import('./loaders/fabric')
    const loaders = await getFabricLoaders(profile.minecraftVersion).catch(() => [] as string[])
    const pin = profile.loader.version
    if (pin && !loaders.includes(pin)) {
      const latest = await latestFabricLoader(profile.minecraftVersion)
      const { profileManager } = await import('../profiles/profile-manager')
      await profileManager.update(profile.id, { loader: { type: 'fabric', version: latest } })
      fixed.push(`Fabric Loader re-pinned ${pin} → ${latest} for Minecraft ${profile.minecraftVersion}.`)
      effectiveLoader = latest
    } else if (!pin && loaders.length > 0) {
      effectiveLoader = loaders[0]
    }
  } catch {
    /* meta unreachable — leave the pin alone */
  }

  // 2) Quarantine incompatible jars (recoverable — never deleted).
  if (fs.existsSync(modsDir)) {
    const quarantine = path.join(instancePath(profile), 'mods.incompatible')
    fs.mkdirSync(quarantine, { recursive: true })
    for (const f of fs.readdirSync(modsDir)) {
      if (!f.endsWith('.jar') || f.endsWith('.jar.disabled')) continue
      const jarPath = path.join(modsDir, f)
      const check = checkFabricJar(profile, jarPath, effectiveLoader)
      if (check.ok) continue
      try {
        fs.renameSync(jarPath, path.join(quarantine, f))
        moved.push(f)
      } catch {
        /* locked file — leave it and let the launch-time guard report it */
      }
    }
  }

  // 3) Clear the stale remap cache (safe — regenerated by the loader).
  try {
    const processed = path.join(instancePath(profile), '.fabric', 'processedMods')
    if (fs.existsSync(processed)) {
      fs.rmSync(processed, { recursive: true, force: true })
      fixed.push('Cleared the stale Fabric remap cache (.fabric/processedMods).')
    }
  } catch {
    /* best-effort */
  }

  return { fixed, moved }
}
