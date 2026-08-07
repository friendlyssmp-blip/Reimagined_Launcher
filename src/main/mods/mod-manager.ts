/**
 * Mod manager.
 *
 * Mods belong to a profile (its instance `mods/` folder). This module
 * wires the UI to Modrinth: search → install → list → remove → update.
 * `checkUpdates` compares the installed version id against the newest
 * available version for the profile's MC version + loader.
 */
import path from 'node:path'
import { paths } from '../paths'
import { exists, remove, rename } from '../utils/fs'
import { logger } from '../logs/logger'
import { eventBus } from '../core/event-bus'
import { LauncherError, Errors } from '../core/errors'
import { runDownloadBatch } from '../minecraft/downloader'
import { modrinth, type ProjectType } from './modrinth'
import { curseforge } from './curseforge'
import { profileManager } from '../profiles/profile-manager'
import { iso } from '../utils/format'
import type { Profile, ProfileMod, ModrinthSearchResult, LoaderType, ProjectVersionInfo } from '@shared/types'

/** Map a project type to its folder inside the instance. */
function folderFor(projectType: ProjectType): string {
  switch (projectType) {
    case 'resourcepack': return 'resourcepacks'
    case 'shader': return 'shaderpacks'
    case 'datapack': return 'datapacks'
    case 'modpack': return 'modpacks'
    default: return 'mods'
  }
}

/**
 * Reduce a provider-supplied file name to a safe single component so it can
 * never escape the instance folder via `..` or absolute paths.
 */
function safeBaseName(name: string): string {
  const base = path.basename(name || '').replace(/[\x00-\x1f]/g, '_')
  return base || 'download.jar'
}

class ModManager {
  private modsDir(profile: Profile, projectType: ProjectType = 'mod'): string {
    return path.join(paths.games, profile.gameDir, folderFor(projectType))
  }

  async list(profileId: string): Promise<ProfileMod[]> {
    const profile = await profileManager.get(profileId)
    return profile?.mods ?? []
  }

  /**
   * Modrinth search — the Mods section only browses mods (never packs).
   * Filter overrides let the UI relax the profile's version/loader facets
   * (dismissible chips) and add a server-side category filter.
   */
  async search(
    profileId: string,
    query: string,
    index?: string,
    opts?: { mcVersion?: string; loader?: string; category?: string; projectType?: ProjectType; offset?: number; limit?: number }
  ): Promise<{ items: ModrinthSearchResult[]; totalHits: number }> {
    const profile = await this.requireProfile(profileId)
    const projectType = opts?.projectType ?? 'mod'
    return modrinth.searchMods({
      query,
      mcVersion: opts?.mcVersion ?? profile.minecraftVersion,
      loader: (opts?.loader as LoaderType | undefined) ?? profile.loader.type,
      projectType,
      index,
      category: opts?.category,
      offset: opts?.offset,
      limit: opts?.limit
    })
  }

  /** Real category list for the filter sidebar (Modrinth tags API). */
  async categories(): Promise<string[]> {
    return modrinth.getCategories('mod')
  }

  /** CurseForge search — requires an API key configured in Settings. */
  async searchCurseforge(
    profileId: string,
    query: string,
    sort?: 'downloads' | 'newest' | 'recent' | 'name',
    projectType?: ProjectType
  ): Promise<ModrinthSearchResult[]> {
    const profile = await this.requireProfile(profileId)
    return curseforge.searchMods({ query, mcVersion: profile.minecraftVersion, sort, projectType: projectType ?? 'mod' })
  }

  async install(profileId: string, projectId: string, projectType: ProjectType = 'mod'): Promise<ProfileMod> {
    const profile = await this.requireProfile(profileId)
    const mc = profile.minecraftVersion
    const loader: LoaderType = profile.loader.type

    // Already-installed check matches by real project id OR slug — so the
    // Fabric API (stored under 'fabric-api' on older profiles) can never be
    // installed twice from a Modrinth search result.
    const project = await modrinth.getProject(projectId)
    if (profile.mods.some((m) => m.id === projectId || m.slug === project.slug)) {
      throw new LauncherError('MOD_INSTALLED', 'This is already installed in the profile.')
    }

    const version = await modrinth.latestVersionFor(projectId, mc, loader, projectType)
    if (!version || version.files.length === 0) {
      const label = projectType === 'mod' ? (loader === 'vanilla' ? 'Minecraft' : loader) : 'Minecraft'
      throw new LauncherError(
        'MOD_VERSION_MISSING',
        `No ${label} version of this project supports Minecraft ${mc}.`,
        'Try a different project or Minecraft version.'
      )
    }

    const file = version.files[0]
    const destDir = this.modsDir(profile, projectType)
    const dest = path.join(destDir, file.filename)

    // Ensure the target folder exists (mods/ exists, but packs/ may not on fresh instances).
    const { mkdirp } = await import('../utils/fs')
    mkdirp(destDir)

    // Guard against name collisions.
    if (exists(dest)) await remove(dest)

    logger.info(`Installing mod ${projectId} → ${file.filename}`)
    await runDownloadBatch([{ url: file.url, dest, expectedSize: file.size }], {
      kind: 'mods',
      label: file.filename
    })

    const mod: ProfileMod = {
      id: projectId,
      slug: project.slug,
      title: project.title,
      filename: file.filename,
      versionId: version.id,
      versionNumber: version.versionNumber,
      downloads: project.downloads,
      iconUrl: project.icon_url,
      source: 'modrinth',
      projectType,
      installedAt: iso(),
      updateAvailable: null
    }

    await profileManager.update(profileId, { mods: [...profile.mods, mod] })
    eventBus.emit('mods:changed', { profileId, action: 'installed', mod })
    return mod
  }

  /**
   * Install a SPECIFIC version of a project (detail page “Install this
   * version”). The version's compatibility with the profile's MC version +
   * loader is enforced before anything is downloaded.
   */
  async installVersion(
    profileId: string,
    provider: 'modrinth' | 'curseforge',
    projectId: string,
    versionId: string,
    projectType: ProjectType = 'mod'
  ): Promise<ProfileMod> {
    const profile = await this.requireProfile(profileId)
    const mc = profile.minecraftVersion
    const loader: LoaderType = profile.loader.type
    const isMod = projectType === 'mod'

    // Already-installed guard — matches by real project id AND by resolved
    // slug, so the Fabric API (keyed by 'fabric-api' on older profiles) can
    // never be installed twice from a detail page either.
    let projectSlug: string | null = null
    if (provider === 'modrinth') {
      try {
        const p = await modrinth.getProject(projectId)
        projectSlug = p.slug
      } catch {
        /* best-effort — the id check below still applies */
      }
    }
    if (profile.mods.some((m) => m.id === projectId || (projectSlug && m.slug === projectSlug))) {
      throw new LauncherError('MOD_INSTALLED', 'This is already installed in the profile.')
    }

    let file: { filename: string; url: string; size: number; version: string }
    let title = projectId
    let slug = projectId

    if (provider === 'curseforge') {
      const cf = await curseforge.fileById(projectId, versionId)
      if (!cf) {
        throw new LauncherError('MOD_VERSION_MISSING', 'That version is no longer available on CurseForge.')
      }
      if (cf.gameVersions.length > 0 && !cf.gameVersions.includes(mc)) {
        throw new LauncherError('MOD_INCOMPATIBLE', `This version does not support Minecraft ${mc}.`)
      }
      if (isMod && cf.loaders.length > 0 && !cf.loaders.includes(loader) && !cf.loaders.includes('any')) {
        throw new LauncherError('MOD_INCOMPATIBLE', `This version does not support the ${loader} loader.`)
      }
      file = { filename: cf.filename, url: cf.url, size: cf.size, version: cf.version }
    } else {
      const versions = await modrinth.listVersions(projectId, projectType)
      const target = versions.find((v) => v.id === versionId)
      if (!target || !target.fileUrl) {
        throw new LauncherError('MOD_VERSION_MISSING', 'That version is no longer available on Modrinth.')
      }
      if (target.gameVersions.length > 0 && !target.gameVersions.includes(mc)) {
        throw new LauncherError('MOD_INCOMPATIBLE', `This version does not support Minecraft ${mc}.`)
      }
      if (isMod && target.loaders.length > 0 && !target.loaders.includes(loader)) {
        throw new LauncherError('MOD_INCOMPATIBLE', `This version does not support the ${loader} loader.`)
      }
      file = {
        filename: target.filename ?? `${target.versionNumber.replace(/[^a-zA-Z0-9._-]/g, '-')}.jar`,
        url: target.fileUrl,
        size: target.size ?? 0,
        version: target.versionNumber
      }
      try {
        const p = await modrinth.getProject(projectId)
        title = p.title
        slug = p.slug
      } catch {
        /* keep ids */
      }
    }

    const destDir = this.modsDir(profile, projectType)
    const dest = path.join(destDir, safeBaseName(file.filename))
    file = { ...file, filename: safeBaseName(file.filename) }
    const { mkdirp } = await import('../utils/fs')
    mkdirp(destDir)
    if (exists(dest)) await remove(dest)

    logger.info(`Installing ${provider} ${projectId} @ ${versionId} → ${file.filename}`)
    await runDownloadBatch([{ url: file.url, dest, expectedSize: file.size }], {
      kind: 'mods',
      label: file.filename
    })

    const mod: ProfileMod = {
      id: projectId,
      slug,
      title,
      filename: file.filename,
      versionId,
      versionNumber: file.version,
      downloads: 0,
      source: provider,
      projectType,
      installedAt: iso(),
      updateAvailable: null
    }
    await profileManager.update(profileId, { mods: [...profile.mods, mod] })
    eventBus.emit('mods:changed', { profileId, action: 'installed', mod })
    return mod
  }

  /** Install a CurseForge mod (projectId is the numeric CurseForge id). */
  async installCurseforge(
    profileId: string,
    projectId: string,
    meta?: { title?: string; iconUrl?: string; downloads?: number },
    projectType: ProjectType = 'mod'
  ): Promise<ProfileMod> {
    const profile = await this.requireProfile(profileId)
    const mc = profile.minecraftVersion
    const loader: LoaderType = profile.loader.type

    if (profile.mods.some((m) => m.id === projectId && m.source === 'curseforge')) {
      throw new LauncherError('MOD_INSTALLED', 'This is already installed in the profile.')
    }

    // Loader filtering only applies to mods — packs aren't loader-specific.
    const file = await curseforge.latestFile(projectId, mc, projectType === 'mod' ? loader : 'vanilla')
    if (!file) {
      const label = projectType === 'mod' ? (loader === 'vanilla' ? 'Minecraft' : loader) : 'Minecraft'
      throw new LauncherError(
        'MOD_VERSION_MISSING',
        `No ${label} version of this project supports Minecraft ${mc}.`,
        'Try a different project or Minecraft version.'
      )
    }

    const destDir = this.modsDir(profile, projectType)
    const dest = path.join(destDir, file.filename)
    const { mkdirp } = await import('../utils/fs')
    mkdirp(destDir)
    if (exists(dest)) await remove(dest)

    logger.info(`Installing CurseForge mod ${projectId} → ${file.filename}`)
    await runDownloadBatch([{ url: file.url, dest, expectedSize: file.size }], {
      kind: 'mods',
      label: file.filename
    })

    const mod: ProfileMod = {
      id: projectId,
      slug: projectId,
      title: meta?.title ?? projectId,
      filename: file.filename,
      versionId: String(file.fileId),
      versionNumber: file.version || 'latest',
      downloads: meta?.downloads ?? 0,
      iconUrl: meta?.iconUrl,
      source: 'curseforge',
      projectType,
      installedAt: iso(),
      updateAvailable: null
    }

    await profileManager.update(profileId, { mods: [...profile.mods, mod] })
    eventBus.emit('mods:changed', { profileId, action: 'installed', mod })
    return mod
  }

  async remove(profileId: string, slug: string): Promise<void> {
    const profile = await this.requireProfile(profileId)
    const mod = profile.mods.find((m) => m.slug === slug)
    if (!mod) return
    // Route through the mod's own project type so packs are removed from the right folder.
    await remove(path.join(this.modsDir(profile, mod.projectType ?? 'mod'), mod.filename)).catch(() => {})
    await profileManager.update(profileId, { mods: profile.mods.filter((m) => m.slug !== slug) })
    logger.info(`Mod removed: ${mod.title}`)
    eventBus.emit('mods:changed', { profileId, action: 'removed', slug })
  }

  /** Compare installed mods against the newest available versions. */
  async checkUpdates(profileId: string): Promise<ProfileMod[]> {
    const profile = await this.requireProfile(profileId)
    let changed = false
    const updatedMods = await Promise.all(
      profile.mods.map(async (mod) => {
        if (mod.source !== 'modrinth') return mod
        try {
          const latest = await modrinth.latestVersionFor(mod.id, profile.minecraftVersion, profile.loader.type, mod.projectType ?? 'mod')
          if (latest && latest.id !== mod.versionId) {
            changed = true
            return { ...mod, updateAvailable: { versionId: latest.id, versionNumber: latest.versionNumber } }
          }
          if (mod.updateAvailable) {
            changed = true
            return { ...mod, updateAvailable: null }
          }
          return mod
        } catch {
          return mod
        }
      })
    )

    if (changed) {
      await profileManager.update(profileId, { mods: updatedMods })
      eventBus.emit('mods:changed', { profileId, action: 'updates-checked' })
    }
    return updatedMods
  }

  /** Update a mod to its latest compatible version (Modrinth or CurseForge). */
  async update(profileId: string, slug: string): Promise<ProfileMod> {
    const profile = await this.requireProfile(profileId)
    const mod = profile.mods.find((m) => m.slug === slug)
    if (!mod) throw new LauncherError('MOD_MISSING', 'Mod not found in this profile.')
    const projectType = mod.projectType ?? 'mod'
    await this.remove(profileId, slug)
    const fresh =
      mod.source === 'curseforge'
        ? await this.installCurseforge(
            profileId,
            mod.id,
            { title: mod.title, iconUrl: mod.iconUrl ?? undefined, downloads: mod.downloads },
            projectType
          )
        : await this.install(profileId, mod.id, projectType)
    logger.info(`Mod updated: ${mod.title} → ${fresh.versionNumber}`)
    return fresh
  }

  /** Local-only mods (dropped in the mods folder manually) not tracked in JSON. */
  async localModFiles(profileId: string): Promise<string[]> {
    const profile = await this.requireProfile(profileId)
    const dir = this.modsDir(profile)
    if (!exists(dir)) return []
    const { listDir } = await import('../utils/fs')
    const files = await listDir(dir)
    const tracked = new Set(profile.mods.map((m) => m.filename))
    return files.filter((f) => f.endsWith('.jar') && !tracked.has(f))
  }

  /** Delete a manually-dropped jar from the profile's mods folder. */
  async removeLocalFile(profileId: string, filename: string): Promise<void> {
    const profile = await this.requireProfile(profileId)
    const dir = this.modsDir(profile)
    const dest = path.join(dir, filename)
    if (!filename.endsWith('.jar') || path.dirname(dest) !== path.resolve(dir)) {
      throw new LauncherError('INVALID_FILE', 'Invalid file name.')
    }
    if (!exists(dest)) throw new LauncherError('MOD_MISSING', 'File not found in the mods folder.')
    await remove(dest)
    logger.info(`Local mod file removed: ${filename}`)
  }

  /**
   * Swap the installed file of a tracked item to a different version of the
   * same project (Part 4). The old file is removed first, the new one is
   * downloaded with real progress, and the profile entry is replaced — never
   * leaving both versions installed or a half-swapped state.
   */
  async changeVersion(profileId: string, slug: string, versionId: string): Promise<ProfileMod> {
    const profile = await this.requireProfile(profileId)
    const mod = profile.mods.find((m) => m.slug === slug)
    if (!mod) throw new LauncherError('MOD_MISSING', 'Mod not found in this profile.')
    const projectType = mod.projectType ?? 'mod'
    const disabled = Boolean(mod.disabled)

    let file: { filename: string; url: string; size: number; version: string } | null = null
    let newVersionId = versionId
    let newVersionNumber = ''

    if (mod.source === 'curseforge') {
      const cfFile = await curseforge.fileById(mod.id, versionId)
      if (!cfFile) {
        throw new LauncherError('MOD_VERSION_MISSING', 'That version is no longer available on CurseForge.')
      }
      file = cfFile
      newVersionNumber = cfFile.version || 'latest'
    } else if (mod.source === 'modrinth') {
      const versions = await modrinth.listVersions(mod.id, projectType)
      const target = versions.find((v) => v.id === versionId)
      if (!target || !target.fileUrl) {
        throw new LauncherError(
          'MOD_VERSION_MISSING',
          'That version is no longer available on Modrinth.'
        )
      }
      file = {
        filename: target.filename ?? `${mod.slug}-${target.versionNumber}.jar`,
        url: target.fileUrl,
        size: target.size ?? 0,
        version: target.versionNumber
      }
      newVersionNumber = target.versionNumber
    } else {
      throw new LauncherError('MOD_LOCAL', 'This item was added manually and has no remote versions.')
    }

    const destDir = this.modsDir(profile, projectType)
    const { mkdirp } = await import('../utils/fs')
    mkdirp(destDir)

    // Never trust a provider-supplied filename for the destination path.
    file = { ...file, filename: safeBaseName(file.filename) }

    // Remove the currently installed file (including its .disabled twin) before swapping.
    const activeName = mod.filename.endsWith('.disabled')
      ? mod.filename.slice(0, -'.disabled'.length)
      : mod.filename
    await remove(path.join(destDir, activeName)).catch(() => {})
    await remove(path.join(destDir, `${activeName}.disabled`)).catch(() => {})

    let finalName = file.filename
    const dest = path.join(destDir, finalName)
    if (exists(dest)) await remove(dest)
    logger.info(`Changing version of ${mod.title} → ${file.filename}`)
    await runDownloadBatch([{ url: file.url, dest, expectedSize: file.size }], {
      kind: 'mods',
      label: file.filename
    })

    // A disabled mod stays disabled after a version swap.
    if (disabled && !finalName.endsWith('.disabled')) {
      await rename(dest, path.join(destDir, `${finalName}.disabled`))
      finalName = `${finalName}.disabled`
    }

    const updated: ProfileMod = {
      ...mod,
      filename: finalName,
      versionId: newVersionId,
      versionNumber: newVersionNumber,
      updateAvailable: null,
      installedAt: iso()
    }
    await profileManager.update(profileId, {
      mods: profile.mods.map((m) => (m.slug === slug ? updated : m))
    })
    eventBus.emit('mods:changed', { profileId, action: 'version-changed', mod: updated })
    logger.info(`Version changed: ${mod.title} ${mod.versionNumber} → ${newVersionNumber}`)
    return updated
  }

  /**
   * Enable/disable an installed item without uninstalling it — the standard
   * loader mechanism: the file is renamed to `<name>.disabled` (or back).
   * Disabled items stay visible in the UI with a muted state.
   */
  async setEnabled(profileId: string, slug: string, enabled: boolean): Promise<ProfileMod> {
    const profile = await this.requireProfile(profileId)
    const mod = profile.mods.find((m) => m.slug === slug)
    if (!mod) throw new LauncherError('MOD_MISSING', 'Mod not found in this profile.')
    const projectType = mod.projectType ?? 'mod'
    const dir = this.modsDir(profile, projectType)

    const activeName = mod.filename.endsWith('.disabled')
      ? mod.filename.slice(0, -'.disabled'.length)
      : mod.filename
    const activePath = path.join(dir, activeName)
    const disabledPath = path.join(dir, `${activeName}.disabled`)

    if (enabled) {
      if (exists(disabledPath)) {
        await rename(disabledPath, activePath)
        logger.info(`Item enabled: ${mod.title}`)
      }
    } else {
      if (exists(activePath)) {
        await rename(activePath, disabledPath)
        logger.info(`Item disabled: ${mod.title}`)
      } else if (!exists(disabledPath)) {
        // Nothing on disk to toggle — create the marker so state matches.
        const { mkdirp } = await import('../utils/fs')
        mkdirp(dir)
        await rename(activePath, disabledPath).catch(() => {})
      }
    }

    const updated: ProfileMod = {
      ...mod,
      filename: enabled ? activeName : `${activeName}.disabled`,
      disabled: !enabled
    }
    await profileManager.update(profileId, {
      mods: profile.mods.map((m) => (m.slug === slug ? updated : m))
    })
    eventBus.emit('mods:changed', { profileId, action: enabled ? 'enabled' : 'disabled', mod: updated })
    return updated
  }

  /** Available versions of an installed item, filtered to the profile's MC + loader. */
  async availableVersions(profileId: string, slug: string): Promise<ProjectVersionInfo[]> {
    const profile = await this.requireProfile(profileId)
    const mod = profile.mods.find((m) => m.slug === slug)
    if (!mod) throw new LauncherError('MOD_MISSING', 'Mod not found in this profile.')
    const projectType = mod.projectType ?? 'mod'

    let versions: ProjectVersionInfo[]
    if (mod.source === 'curseforge') {
      versions = await curseforge.listVersions(mod.id, projectType)
    } else if (mod.source === 'modrinth') {
      versions = await modrinth.listVersions(mod.id, projectType)
    } else {
      return []
    }

    const isMod = projectType === 'mod'
    const wantedLoader = profile.loader.type
    return versions.filter((v) => {
      const mcOk = v.gameVersions.length === 0 || v.gameVersions.includes(profile.minecraftVersion)
      if (!mcOk) return false
      if (!isMod) return true // packs aren't loader-specific
      if (v.loaders.length === 0) return true
      return v.loaders.includes(wantedLoader) || v.loaders.includes('any')
    })
  }

  private async requireProfile(profileId: string): Promise<Profile> {
    const profile = await profileManager.get(profileId)
    if (!profile) throw new LauncherError('PROFILE_MISSING', 'Profile not found.')
    return profile
  }
}

export const modManager = new ModManager()
