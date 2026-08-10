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
// v1.0.12 fixes the critical mixin crash: ClientChunkCacheMixin.accessOk() was a
// non-private static method without @Unique, which Mixin rejects at apply time
// (InvalidMixinException during ClientboundLoginPacket handling -> "Network
// Protocol Error" on world/server join). accessOk() and applyDecodedChunk are now
// @Unique, mixins.json is required:false so a version-drift mixin failure only
// disables that module (never crashes login), and startup diagnostics log the
// MC/FabricLoader versions + Sodium/C2ME/Iris presence. v1.0.11 adds CaptureCompat (OBS/Game-Capture hook compatibility: no anti-hook
// hardening, borderless-fullscreen preference enforcement, standard present path
// audit) and LoadingBoost (resource-pack/shader reloads keep the game window's
// message pump responsive — no Windows "Not Responding", work stays off the
// render thread). v1.0.10 — Extended View write-path fix (chunk captured at the REAL eviction
// point via a Storage.drop HEAD mixin, BEFORE vanilla tears the chunk down —
// the old hook left the persistent cache nearly empty, "ED 4/120"), the
// visibleGhostChunks sweep now iterates the real cache index instead of
// Files.exists() per cell (was 66k+ syscalls/s — a periodic tick stall), the
// renderer has a 4 ms/tick budget, and PerfProfiler correlates spike frames
// with the periodic systems active that tick (spkTasks=...) so recurring
// stutters are identified from real data. v1.0.9 adds the async server-chunk
// decode pipeline; v1.0.8 adds Extended View. ensureFpsBoost upgrades existing
// profiles to the new bundle automatically.
// v1.0.17 — sustained particle-burst tier: fast block breaking / creeper
// blasts / combat hold a steady 200-400 particle adds per 750 ms — under
// the old 400 burst threshold, so they rendered full density. Beyond 240
// the particle governor now keeps 3/8 until the scene settles (protects the
// render thread on iGPUs); TNT chains > 400 still hold 2/8.
const FPS_BOOST_VERSION = '1.0.21'
const FPS_BOOST_FILENAME = 'Reimagined FPS Boost-1.0.21.jar'

/**
 * The bundled mod targets Minecraft 26.2.x ONLY (its fabric.mod.json declares
 * `>=26.2 <26.3`). v1.0.15: never inject a 26.2-specific jar into another
 * Minecraft version — that would fail to load and could crash the game.
 * Per-version adapters for 1.8/1.21/26.1/26.3 are a future build; until then
 * the launcher simply skips the mod on incompatible versions instead of
 * breaking them.
 */
export function fpsBoostCompatible(mcVersion: string): boolean {
  // The bundled mod targets Minecraft 26.2.x ONLY today. Per-version adapters
  // for 1.8.x / 1.21.11.x / 26.1.x / 26.3.x are a future build — the button
  // and auto-install simply skip versions we don't have a build for yet.
  return /^26\.2/.test(mcVersion)
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
  if (!fpsBoostCompatible(profile.minecraftVersion)) {
    throw new Error(`Reimagined FPS Boost is not available for Minecraft ${profile.minecraftVersion} yet (the bundled build targets 26.2.x).`)
  }
  const source = bundledJar()
  if (!fs.existsSync(source)) {
    throw new Error('The FPS Boost bundle is missing from this installation — reinstall the launcher to restore it.')
  }
  if (fpsBoostInstalled(profile)) {
    return { installed: true, version: FPS_BOOST_VERSION, message: 'Already installed.' }
  }

  const modsDir = path.join(paths.games, profile.gameDir, 'mods')
  const dest = path.join(modsDir, FPS_BOOST_FILENAME)
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
    const dir = path.join(paths.games, profile.gameDir, 'mods')
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
  // V2: the user explicitly removed it — never auto-reinstall behind their
  // back. The button "Install FPS Booster" brings it back on purpose.
  if (profile.fpsBoostOptOut) {
    logger.info(`Reimagined FPS Boost skipped for "${profile.name}" — the user removed it manually.`)
    return
  }
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
    // v1.0.43 — sweep stale bundled jars (older versions left on disk by
    // previous launcher versions or lost profile entries) so instances never
    // accumulate dead FPS Boost copies.
    try {
      if (fs.existsSync(modsDir)) {
        for (const f of fs.readdirSync(modsDir)) {
          const stale =
            f.startsWith('Reimagined FPS Boost-') &&
            (f.endsWith('.jar') || f.endsWith('.jar.disabled')) &&
            f !== FPS_BOOST_FILENAME &&
            f !== FPS_BOOST_FILENAME + '.disabled'
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
