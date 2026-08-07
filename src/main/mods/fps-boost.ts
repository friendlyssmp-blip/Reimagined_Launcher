/**
 * Reimagined FPS Boost auto-install.
 *
 * The bundled `Reimagined FPS Boost` mod is a pure client-side performance
 * mod shipped with the launcher. When a profile uses the Fabric loader, this
 * module copies the bundled jar into the profile's mods folder and tracks it
 * in the profile JSON — mirroring how Fabric API is auto-installed, so a
 * brand-new Fabric profile is immediately boosted without manual setup.
 */
import path from 'node:path'
import fs from 'node:fs'
import { paths } from '../paths'
import { logger } from '../logs/logger'
import { profileManager } from '../profiles/profile-manager'
import type { Profile, ProfileMod } from '@shared/types'

const FPS_BOOST_ID = 'reimagined-fps-boost'
const FPS_BOOST_VERSION = '1.0.3'
const FPS_BOOST_FILENAME = 'Reimagined FPS Boost-1.0.3.jar'

/**
 * The bundled mod targets Minecraft 26.2.x ONLY (its fabric.mod.json declares
 * `>=26.2 <26.3`). v1.0.15: never inject a 26.2-specific jar into another
 * Minecraft version — that would fail to load and could crash the game.
 * Per-version adapters for 1.8/1.21/26.1/26.3 are a future build; until then
 * the launcher simply skips the mod on incompatible versions instead of
 * breaking them.
 */
export function fpsBoostCompatible(mcVersion: string): boolean {
  return /^26\.2/.test(mcVersion)
}

/** Path of the mod jar bundled with the launcher.
 * Dev: project `data/bundled`. Packaged: shipped inside the installer via
 * electron-builder extraResources → process.resourcesPath/bundled. */
function bundledJar(): string {
  const devPath = path.join(paths.data, 'bundled', 'fps-boost', FPS_BOOST_FILENAME)
  if (fs.existsSync(devPath)) return devPath
  return path.join(process.resourcesPath, 'bundled', 'fps-boost', FPS_BOOST_FILENAME)
}

/**
 * Ensure the bundled FPS Boost mod is present in a profile's mods folder.
 * Never throws — failures are logged so profile operations never break.
 */
export async function ensureFpsBoost(profile: Profile): Promise<void> {
  if (profile.loader.type !== 'fabric') return
  // v1.0.15 version gating: the bundled jar is 26.2-only. Other versions skip
  // it (the vanilla engine still applies JVM flags + the frame cap launcher-
  // side, just without the in-game mod).
  if (!fpsBoostCompatible(profile.minecraftVersion)) {
    logger.info(`Reimagined FPS Boost skipped for "${profile.name}" — bundled mod targets Minecraft 26.2.x (profile is ${profile.minecraftVersion}).`)
    return
  }

  const source = bundledJar()
  if (!fs.existsSync(source)) {
    logger.warn(`FPS Boost bundle missing at ${source} — skipping auto-install.`)
    return
  }

  const modsDir = path.join(paths.games, profile.gameDir, 'mods')
  const dest = path.join(modsDir, FPS_BOOST_FILENAME)

  try {
    // Re-read the store so concurrent writers (e.g. ensureFabricApi) never
    // clobber each other's mods list.
    const fresh = await profileManager.get(profile.id)
    const mods = fresh?.mods ?? profile.mods
    const existing = mods.find((m) => m.id === FPS_BOOST_ID)
    // Already on the current bundled version — nothing to do.
    if (existing && existing.versionNumber === FPS_BOOST_VERSION) return

    const { mkdirp } = await import('../utils/fs')
    mkdirp(modsDir)
    // 1.0.2 adds the frame-rate watchdog + SafetyGate auto-fallback (v1.0.13
    // release). Drop any previous bundled jar so no stale copy stays behind.
    if (existing && existing.filename && existing.filename !== FPS_BOOST_FILENAME) {
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
      filename: FPS_BOOST_FILENAME,
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
    logger.info(`Reimagined FPS Boost ${FPS_BOOST_VERSION} ready for "${profile.name}"`)
  } catch (err) {
    logger.warn(`FPS Boost install failed for "${profile.name}": ${(err as Error).message}`)
  }
}
