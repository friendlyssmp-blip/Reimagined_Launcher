/**
 * RPE - trusted performance mods.
 *
 * The launcher NEVER bundles third-party mods. It only offers a short list of
 * well-known performance mods (resolved live from Modrinth, scoped to the
 * profile's Minecraft version + loader) that the user may install with one
 * click - explicit user choice, compatible versions only, no silent installs.
 */
import { modrinth } from '../mods/modrinth'
import { modManager } from '../mods/mod-manager'
import { profileManager } from '../profiles/profile-manager'
import { logger } from '../logs/logger'
import type { PerfModOption } from '@shared/types'

const TRUSTED_PERF_MODS: { slug: string; note: string }[] = [
  { slug: 'sodium', note: 'Rendering - dramatically faster chunk and entity rendering.' },
  { slug: 'lithium', note: 'Game logic - faster ticks with zero visual change.' },
  { slug: 'ferrite-core', note: 'Memory - lower RAM usage for the same world.' },
  { slug: 'modernfix', note: 'Memory & startup - fixes allocation bottlenecks.' },
  { slug: 'entityculling', note: 'Rendering - skips drawing entities hidden behind walls.' },
  { slug: 'iris', note: 'Shaders - high-performance shader support.' }
]

/**
 * Resolve the trusted list against Modrinth for a profile's version/loader.
 * Incompatible mods are reported with `compatible: false`, never installed.
 */
export async function listPerfMods(profileId: string): Promise<{ profileId: string; mods: PerfModOption[] }> {
  const profile = await profileManager.get(profileId)
  if (!profile || profile.loader.type === 'vanilla') {
    return { profileId, mods: [] }
  }

  const options: PerfModOption[] = []
  for (const t of TRUSTED_PERF_MODS) {
    try {
      const project = await modrinth.getProject(t.slug)
      const version = await modrinth.latestVersionFor(project.id, profile.minecraftVersion, profile.loader.type, 'mod')
      if (!version) {
        options.push({ slug: t.slug, projectId: project.id, title: project.title, iconUrl: project.icon_url, downloads: project.downloads, note: t.note, installed: false, versionNumber: null, compatible: false })
        continue
      }
      const installed = profile.mods.some((m) => m.id === project.id)
      options.push({
        slug: t.slug,
        projectId: project.id,
        title: project.title,
        iconUrl: project.icon_url,
        downloads: project.downloads,
        note: t.note,
        installed,
        versionNumber: version.versionNumber,
        compatible: true
      })
    } catch {
      /* a mod may not exist or be unreachable - skip it silently */
    }
  }
  return { profileId, mods: options }
}

/** Install a compatible perf mod through the normal mod install pipeline. */
export async function installPerfMod(profileId: string, slug: string): Promise<void> {
  const result = await listPerfMods(profileId)
  const option = result.mods.find((mo) => mo.slug === slug)
  if (!option) throw new Error('That performance mod is not available.')
  if (!option.compatible) {
    throw new Error(option.title + ' has no version compatible with this profile\'s Minecraft version and loader.')
  }
  if (option.installed) throw new Error(option.title + ' is already installed.')
  await modManager.install(profileId, option.projectId, 'mod')
  logger.info('RPE: ' + option.title + ' installed into profile ' + profileId)
}

/** Remove a perf mod (no-op when it is not installed). */
export async function removePerfMod(profileId: string, slug: string): Promise<void> {
  await modManager.remove(profileId, slug)
  logger.info('RPE: removed perf mod ' + slug + ' from profile ' + profileId)
}
