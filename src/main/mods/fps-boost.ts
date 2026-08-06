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
const FPS_BOOST_VERSION = '1.0.0'
const FPS_BOOST_FILENAME = 'Reimagined FPS Boost-1.0.0.jar'

/** Path of the mod jar bundled with the launcher (dev: project data dir). */
function bundledJar(): string {
  return path.join(paths.data, 'bundled', 'fps-boost', FPS_BOOST_FILENAME)
}

/**
 * Ensure the bundled FPS Boost mod is present in a profile's mods folder.
 * Never throws — failures are logged so profile operations never break.
 */
export async function ensureFpsBoost(profile: Profile): Promise<void> {
  if (profile.loader.type !== 'fabric') return

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
    if (mods.some((m) => m.id === FPS_BOOST_ID)) return

    const { mkdirp } = await import('../utils/fs')
    mkdirp(modsDir)
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

    await profileManager.update(profile.id, { mods: [...mods, mod] })
    logger.info(`Reimagined FPS Boost ${FPS_BOOST_VERSION} ready for "${profile.name}"`)
  } catch (err) {
    logger.warn(`FPS Boost install failed for "${profile.name}": ${(err as Error).message}`)
  }
}
