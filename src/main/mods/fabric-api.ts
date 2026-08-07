/**
 * Fabric API auto-install.
 *
 * When a profile uses the Fabric loader, the Fabric API mod is required for
 * virtually every Fabric mod to work. This module ensures the correct
 * Fabric API version for the profile's Minecraft version is downloaded into
 * the profile's mods folder and tracked in the profile JSON — so a brand-new
 * Fabric profile is immediately playable without manual setup.
 */
import path from 'node:path'
import { paths } from '../paths'
import { getJson } from '../utils/http'
import { runDownloadBatch } from '../minecraft/downloader'
import { logger } from '../logs/logger'
import { exists, remove } from '../utils/fs'
import { profileManager } from '../profiles/profile-manager'
import type { Profile, ProfileMod } from '@shared/types'

const MODRINTH = 'https://api.modrinth.com/v2'
const FABRIC_API = 'fabric-api'
/** Legacy Fabric API (Modrinth project) — the modern Fabric API only exists
 *  for Minecraft 1.14+. Older versions (1.8–1.13) use the Legacy Fabric
 *  ecosystem, a separate project with its own version line. */
const LEGACY_FABRIC_API = 'legacy-fabric-api'

interface FabricApiVersion {
  id: string
  version_number: string
  game_versions: string[]
  files: { url: string; filename: string; size?: number }[]
}

/** The Modrinth project record — gives us the REAL project id + logo. */
interface FabricApiProject {
  id: string
  slug: string
  icon_url?: string | null
  title: string
}

/**
 * v1.0.15: old Minecraft versions must NEVER get the newest standard Fabric
 * API — that would be incompatible by definition. 1.14+ uses the standard
 * `fabric-api` project; anything older (1.8.x–1.13.x, e.g. 1.13.2) resolves
 * against the Legacy Fabric ecosystem's `legacy-fabric-api` project instead.
 * The stored entry keeps the display slug `fabric-api` so existing detection
 * (and the auto-install safety net) keeps matching.
 */
export function fabricProjectFor(mcVersion: string): { project: string; slug: string; label: string } {
  const isLegacy = /^1\.(\d+)/.test(mcVersion) && Number(mcVersion.match(/^1\.(\d+)/)![1]) < 14
  if (isLegacy) {
    return { project: LEGACY_FABRIC_API, slug: FABRIC_API, label: 'Legacy Fabric API' }
  }
  return { project: FABRIC_API, slug: FABRIC_API, label: 'Fabric API' }
}

/**
 * Resolve the Fabric API project's real Modrinth identity (project id +
 * icon). The stored entry uses the real Modrinth project id so search results
 * match it exactly ("Installed") and the logo shows up in the UI.
 */
async function fabricApiProject(project: string): Promise<FabricApiProject | null> {
  try {
    return await getJson<FabricApiProject>(`${MODRINTH}/project/${project}`, { timeoutMs: 15_000 })
  } catch {
    return null
  }
}

/** Latest Fabric API version matching a Minecraft version (newest first). */
async function latestForMc(project: string, mcVersion: string): Promise<FabricApiVersion | null> {
  const params = new URLSearchParams({
    game_versions: JSON.stringify([mcVersion]),
    loaders: JSON.stringify(['fabric'])
  })
  const versions = await getJson<FabricApiVersion[]>(
    `${MODRINTH}/project/${project}/version?${params.toString()}`,
    { timeoutMs: 15_000 }
  )
  return versions[0] ?? null
}

/**
 * Ensure the Fabric API mod is present and current for a profile.
 * Never throws — failures are logged so profile operations never break.
 */
export async function ensureFabricApi(profile: Profile): Promise<void> {
  if (profile.loader.type !== 'fabric') return

  const mc = profile.minecraftVersion
  const target = fabricProjectFor(mc)
  let latest: FabricApiVersion | null = null
  try {
    latest = await latestForMc(target.project, mc)
  } catch (err) {
    logger.warn(`${target.label} lookup failed for ${mc}: ${(err as Error).message}`)
    return
  }
  if (!latest || latest.files.length === 0) {
    logger.warn(`No ${target.label} version found for Minecraft ${mc}`)
    return
  }

  const existing = profile.mods.find((m) => m.id === FABRIC_API || m.slug === FABRIC_API)
  if (existing && existing.versionId === latest.id) {
    // Already up to date — nothing to do.
    return
  }

  const file = latest.files[0]
  const modsDir = path.join(paths.games, profile.gameDir, 'mods')
  const dest = path.join(modsDir, file.filename)

  // Real Modrinth identity — the entry is keyed by the REAL project id so
  // Modrinth search shows it as installed (no double installs) and the
  // official Fabric API logo displays everywhere.
  const project = await fabricApiProject(target.project)
  const realId = project?.id || target.project

  try {
    const { mkdirp } = await import('../utils/fs')
    mkdirp(modsDir)

    // Replace any older Fabric API jar (including a previous standard API
    // when switching to the legacy project for an old MC version).
    if (existing && existing.filename && existing.filename !== file.filename) {
      await remove(path.join(modsDir, existing.filename)).catch(() => {})
    }
    if (exists(dest)) await remove(dest)

    logger.info(`Installing ${target.label} ${latest.version_number} for Minecraft ${mc}`)
    await runDownloadBatch([{ url: file.url, dest, expectedSize: file.size }], {
      kind: 'mods',
      label: `${target.label} (${latest.version_number})`
    })

    const mod: ProfileMod = {
      id: realId,
      slug: FABRIC_API,
      title: project?.title || target.label,
      filename: file.filename,
      versionId: latest.id,
      versionNumber: latest.version_number,
      downloads: 0,
      iconUrl: project?.icon_url ?? undefined,
      source: 'modrinth',
      projectType: 'mod',
      installedAt: new Date().toISOString(),
      updateAvailable: null
    }

    const mods = existing
      ? profile.mods.map((m) => (m.id === FABRIC_API ? mod : m))
      : [...profile.mods, mod]
    await profileManager.update(profile.id, { mods })
    logger.info(`${target.label} ${latest.version_number} ready for "${profile.name}" (${mc})`)
  } catch (err) {
    logger.warn(`${target.label} install failed for "${profile.name}": ${(err as Error).message}`)
  }
}

/** True when the profile is Fabric but has no tracked Fabric API yet.
 *  Matches by slug so older profiles (keyed by 'fabric-api') count too. */
export function needsFabricApi(profile: Profile): boolean {
  return profile.loader.type === 'fabric' && !profile.mods.some((m) => m.id === FABRIC_API || m.slug === FABRIC_API)
}
