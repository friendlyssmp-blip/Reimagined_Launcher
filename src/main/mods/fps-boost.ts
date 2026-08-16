/**
 * Reimagined FPS Boost auto-install.
 *
 * The bundled `Reimagined FPS Boost` mod is a pure client-side performance
 * mod shipped with the launcher. When a profile uses the Fabric loader, this
 * module copies the bundled jar into the profile's mods folder and tracks it
 * in the profile JSON — mirroring how Fabric API is auto-installed, so a
 * brand-new Fabric profile is immediately boosted without manual setup.
 *
 * v1.0.31: multi-version support. The mod source is compiled per Minecraft
 * target (see FpsBoost-source/targets/*.properties and build-all.sh) and the
 * launcher ships one jar per supported Minecraft branch, mapping the profile's
 * Minecraft version to the correct jar. Supported today: 26.1.x, 26.2.x.
 * 1.8.x (Legacy Fabric) and 1.21.x ports are deep ports documented in
 * FpsBoost-source/README — they ship as soon as their build target is added.
 */
import path from 'node:path'
import { instancePath } from '../instances/paths'
import fs from 'node:fs'
import { paths } from '../paths'
import { logger } from '../logs/logger'
import { profileManager } from '../profiles/profile-manager'
import type { Profile, ProfileMod } from '@shared/types'

const FPS_BOOST_ID = 'reimagined-fps-boost'
const FPS_BOOST_VERSION = '1.0.34'

/**
 * Minecraft branch → bundled jar filename. A profile pins one Minecraft
 * version, so exactly one jar applies per profile. Keep this map in sync with
 * the jars produced by FpsBoost-source build-all.sh.
 */
const FPS_BOOST_JARS: Record<string, string> = {
  '26.1': 'Reimagined FPS Boost-1.0.34-mc26.1.jar',
  '26.2': 'Reimagined FPS Boost-1.0.34-mc26.2.jar'
}

/** Resolve the bundled jar filename for a Minecraft version, or null. */
function fpsBoostJarFor(mcVersion: string): string | null {
  const major = /^(\d+\.\d+)/.exec(mcVersion)?.[1]
  return major ? FPS_BOOST_JARS[major] ?? null : null
}

/**
 * True when the launcher ships a FPS Boost build for this Minecraft version.
 * v1.0.15: never inject a version-specific jar into another Minecraft version
 * — that would fail to load and could crash the game. Unsupported versions
 * simply skip the mod instead of breaking.
 */
export function fpsBoostCompatible(mcVersion: string): boolean {
  return fpsBoostJarFor(mcVersion) !== null
}

/** True when the FPS Boost mod is present in the profile's mods list. */
export function fpsBoostInstalled(profile: Profile): boolean {
  return profile.mods.some((m) => m.id === FPS_BOOST_ID)
}

/**
 * Install the bundled FPS Boost into a profile (user-clicked — V2).
 * Throws a friendly error when the version isn't supported or the bundle is
 * missing, so the UI can surface the real reason.
 */
export async function installFpsBoost(profileId: string): Promise<{ installed: boolean; version: string; message: string }> {
  const profile = await profileManager.get(profileId)
  if (!profile) {
    throw new Error('Profile not found.')
  }
  if (profile.loader.type !== 'fabric') {
    throw new Error('Reimagined FPS Boost needs a Fabric profile.')
  }
  const filename = fpsBoostJarFor(profile.minecraftVersion)
  if (!filename) {
    throw new Error(`Reimagined FPS Boost is not available for Minecraft ${profile.minecraftVersion} yet (supported: 26.1.x, 26.2.x).`)
  }
  const source = bundledJar(filename)
  if (!fs.existsSync(source)) {
    throw new Error('The FPS Boost bundle is missing from this installation — reinstall the launcher to restore it.')
  }
  if (fpsBoostInstalled(profile)) {
    return { installed: true, version: FPS_BOOST_VERSION, message: 'Already installed.' }
  }

  const modsDir = path.join(instancePath(profile), 'mods')
  const dest = path.join(modsDir, filename)
  const { mkdirp } = await import('../utils/fs')
  mkdirp(modsDir)
  fs.copyFileSync(source, dest)

  const mod: ProfileMod = {
    id: FPS_BOOST_ID,
    slug: FPS_BOOST_ID,
    title: 'Reimagined FPS Boost',
    filename,
    versionId: FPS_BOOST_VERSION,
    versionNumber: FPS_BOOST_VERSION,
    downloads: 0,
    source: 'local',
    projectType: 'mod',
    installedAt: new Date().toISOString(),
    updateAvailable: null
  }
  // Clear the opt-out flag — the user asked for it back.
  await profileManager.update(profileId, { mods: [...(profile.mods ?? []), mod], fpsBoostOptOut: false })
  logger.info(`Reimagined FPS Boost ${FPS_BOOST_VERSION} installed for "${profile.name}" (manual)`)
  return { installed: true, version: FPS_BOOST_VERSION, message: 'Installed.' }
}

/**
 * Remove the FPS Boost from a profile (user-clicked — V2). Deleting the jar
 * never removes the ability to reinstall: the bundle stays in the launcher
 * and the "Install FPS Booster" button comes back.
 */
export async function removeFpsBoost(profileId: string): Promise<{ removed: boolean; message: string }> {
  const profile = await profileManager.get(profileId)
  if (!profile) {
    throw new Error('Profile not found.')
  }
  const mod = profile.mods.find((m) => m.id === FPS_BOOST_ID)
  if (mod) {
    const dir = path.join(instancePath(profile), 'mods')
    await fs.promises.rm(path.join(dir, mod.filename), { force: true }).catch(() => {})
    if (mod.filename.endsWith('.jar')) {
      await fs.promises.rm(path.join(dir, `${mod.filename}.disabled`), { force: true }).catch(() => {})
    }
    // Opt-out flag: ensureFpsBoost will NOT re-add it on the next launch.
    await profileManager.update(profileId, { mods: profile.mods.filter((m) => m.id !== FPS_BOOST_ID), fpsBoostOptOut: true })
    logger.info(`Reimagined FPS Boost removed from "${profile.name}" (manual)`)
    return { removed: true, message: 'Removed.' }
  }
  return { removed: false, message: 'Not installed.' }
}

/** Path of a bundled mod jar.
 * Dev: project `data/bundled`. Packaged: shipped inside the installer via
 * electron-builder extraResources → process.resourcesPath/bundled. */
function bundledJar(filename: string): string {
  const devPath = path.join(paths.data, 'bundled', 'fps-boost', filename)
  if (fs.existsSync(devPath)) return devPath
  return path.join(process.resourcesPath, 'bundled', 'fps-boost', filename)
}

/**
 * Ensure the bundled FPS Boost mod is present in a profile's mods folder.
 * Never throws — failures are logged so profile operations never break.
 */
export async function ensureFpsBoost(profile: Profile): Promise<void> {
  if (profile.loader.type !== 'fabric') return
  // V2: the user explicitly removed it — never auto-reinstall behind their
  // back. The button "Install FPS Booster" brings it back on purpose.
  if (profile.fpsBoostOptOut) {
    logger.info(`Reimagined FPS Boost skipped for "${profile.name}" — the user removed it manually.`)
    return
  }
  // v1.0.15 version gating: only inject a jar whose fabric.mod.json matches
  // this Minecraft version (v1.0.31 supports 26.1.x and 26.2.x). Unsupported
  // versions skip it (the vanilla engine still applies JVM flags + the frame
  // cap launcher-side, just without the in-game mod).
  const filename = fpsBoostJarFor(profile.minecraftVersion)
  if (!filename) {
    logger.info(`Reimagined FPS Boost skipped for "${profile.name}" — no bundled build for Minecraft ${profile.minecraftVersion} (supported: 26.1.x, 26.2.x).`)
    return
  }

  const source = bundledJar(filename)
  if (!fs.existsSync(source)) {
    logger.warn(`FPS Boost bundle missing at ${source} — skipping auto-install.`)
    return
  }

  const modsDir = path.join(instancePath(profile), 'mods')
  const dest = path.join(modsDir, filename)

  try {
    // v1.0.43 — sweep stale bundled jars (older versions left on disk by
    // previous launcher versions or lost profile entries) so instances never
    // accumulate dead FPS Boost copies.
    try {
      if (fs.existsSync(modsDir)) {
        for (const f of fs.readdirSync(modsDir)) {
          const stale =
            f.startsWith('Reimagined FPS Boost-') &&
            (f.endsWith('.jar') || f.endsWith('.jar.disabled')) &&
            f !== filename &&
            f !== filename + '.disabled'
          if (stale) {
            fs.rmSync(path.join(modsDir, f), { force: true })
            logger.info(`Reimagined FPS Boost: removed stale ${f}`)
          }
        }
      }
    } catch {
      /* best-effort: a locked or missing mods dir is not an error */
    }
    // Re-read the store so concurrent writers (e.g. ensureFabricApi) never
    // clobber each other's mods list.
    const fresh = await profileManager.get(profile.id)
    const mods = fresh?.mods ?? profile.mods
    const existing = mods.find((m) => m.id === FPS_BOOST_ID)
    // v1.0.78 — already on the current bundled version AND the branch-appropriate
    // jar (filenames encode the Minecraft branch: -mc26.1 / -mc26.2). A version
    // match alone is not enough: if the profile's Minecraft version changed
    // between branches the old jar must be swapped for this branch's jar.
    // v1.0.92 — also compare the actual file: the bundled jar can be rebuilt
    // (same version number) to add new capabilities (e.g. the FPS Test
    // BenchmarkDriver). A stale copy on disk would silently miss them, so a
    // hash mismatch re-copies the up-to-date bundle.
    if (existing && existing.versionNumber === FPS_BOOST_VERSION && existing.filename === filename) {
      let identical = true
      try {
        if (fs.existsSync(dest) && fs.existsSync(source)) {
          const a = fs.readFileSync(dest)
          const b = fs.readFileSync(source)
          identical = a.length === b.length && a.equals(b)
        } else {
          identical = false
        }
      } catch {
        identical = false
      }
      if (identical) return
    }

    const { mkdirp } = await import('../utils/fs')
    mkdirp(modsDir)
    // 1.0.2 adds the frame-rate watchdog + SafetyGate auto-fallback (v1.0.13
    // release). Drop any previous bundled jar so no stale copy stays behind.
    if (existing && existing.filename && existing.filename !== filename) {
      try {
        fs.rmSync(path.join(modsDir, existing.filename), { force: true })
      } catch {
        /* best-effort: a missing old file is not an error */
      }
    }
    fs.copyFileSync(source, dest)

    const mod: ProfileMod = {
      id: FPS_BOOST_ID,
      slug: FPS_BOOST_ID,
      title: 'Reimagined FPS Boost',
      filename,
      versionId: FPS_BOOST_VERSION,
      versionNumber: FPS_BOOST_VERSION,
      downloads: 0,
      source: 'local',
      projectType: 'mod',
      installedAt: new Date().toISOString(),
      updateAvailable: null
    }

    await profileManager.update(profile.id, {
      mods: existing ? mods.map((m) => (m.id === FPS_BOOST_ID ? mod : m)) : [...mods, mod]
    })
    logger.info(`Reimagined FPS Boost ${FPS_BOOST_VERSION} ready for "${profile.name}" (${profile.minecraftVersion})`)
  } catch (err) {
    logger.warn(`FPS Boost install failed for "${profile.name}": ${(err as Error).message}`)
  }
}
