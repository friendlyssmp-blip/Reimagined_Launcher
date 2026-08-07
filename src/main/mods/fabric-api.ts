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
 * Resolve the Fabric API project's real Modrinth identity (project id +
 * icon). The stored entry uses the real Modrinth project id so search results
 * match it exactly ("Installed") and the logo shows up in the UI.
 */
async function fabricApiProject(): Promise<FabricApiProject | null> {
  try {
    return await getJson<FabricApiProject>(`${MODRINTH}/project/${FABRIC_API}`, { timeoutMs: 15_000 })
  } catch {
    return null
  }
}

/** Latest Fabric API version matching a Minecraft version (newest first). */
async function latestForMc(mcVersion: string): Promise<FabricApiVersion | null> {
  const params = new URLSearchParams({
    game_versions: JSON.stringify([mcVersion]),
    loaders: JSON.stringify(['fabric'])
  })
  const versions = await getJson<FabricApiVersion[]>(
    `${MODRINTH}/project/${FABRIC_API}/version?${params.toString()}`,
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
  let latest: FabricApiVersion | null = null
  try {
    latest = await latestForMc(mc)
  } catch (err) {
    logger.warn(`Fabric API lookup failed for ${mc}: ${(err as Error).message}`)
    return
  }
  if (!latest || latest.files.length === 0) {
    logger.warn(`No Fabric API version found for Minecraft ${mc}`)
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
  const project = await fabricApiProject()
  const realId = project?.id || FABRIC_API

  try {
    const { mkdirp } = await import('../utils/fs')
    mkdirp(modsDir)

    // Replace any older Fabric API jar.
    if (existing && existing.filename && existing.filename !== file.filename) {
      await remove(path.join(modsDir, existing.filename)).catch(() => {})
    }
    if (exists(dest)) await remove(dest)

    logger.info(`Installing Fabric API ${latest.version_number} for Minecraft ${mc}`)
    await runDownloadBatch([{ url: file.url, dest, expectedSize: file.size }], {
      kind: 'mods',
      label: `Fabric API (${latest.version_number})`
    })

    const mod: ProfileMod = {
      id: realId,
      slug: FABRIC_API,
      title: project?.title || 'Fabric API',
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
    logger.info(`Fabric API ${latest.version_number} ready for "${profile.name}" (${mc})`)
  } catch (err) {
    logger.warn(`Fabric API install failed for "${profile.name}": ${(err as Error).message}`)
  }
}

/** True when the profile is Fabric but has no tracked Fabric API yet.
 *  Matches by slug so older profiles (keyed by 'fabric-api') count too. */
export function needsFabricApi(profile: Profile): boolean {
  return profile.loader.type === 'fabric' && !profile.mods.some((m) => m.id === FABRIC_API || m.slug === FABRIC_API)
}
