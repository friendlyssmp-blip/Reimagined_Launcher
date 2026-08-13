/**
 * Profile manager.
 *
 * Profiles are independent Minecraft instances stored as JSON in
 * `data/profiles/<id>.json`. Each profile owns a game directory under
 * `data/games/<gameDir>/` holding its mods, saves and config.
 */
import path from 'node:path'
import fs from 'node:fs'
import { paths } from '../paths'
import { exists, readJson, writeJson, remove, mkdirp } from '../utils/fs'
import { uuid, slugify, iso } from '../utils/format'
import { instancePath, instancePathFromFolder, sanitizeInstanceName } from '../instances/paths'
import { logger } from '../logs/logger'
import { eventBus } from '../core/event-bus'
import { LauncherError } from '../core/errors'
import { settingsManager } from '../settings/settings-manager'
import type { Profile, LoaderType } from '@shared/types'

export interface ProfileInput {
  name: string
  minecraftVersion: string
  loader: { type: LoaderType; version: string | null }
  memory?: number
  resolution?: { width: number; height: number; fullscreen: boolean }
  extraJvmArgs?: string
  extraGameArgs?: string
  icon?: string | null
  favorite?: boolean
}

class ProfileManager {
  private cache = new Map<string, Profile>()

  private file(id: string): string {
    return path.join(paths.profiles, `${id}.json`)
  }

  /** Canonical instance location — always through the central resolver. */
  private instanceDir(profile: Profile): string {
    return instancePath(profile)
  }

  async list(): Promise<Profile[]> {
    const { listDir } = await import('../utils/fs')
    const files = await listDir(paths.profiles)
    const profiles: Profile[] = []
    for (const f of files) {
      if (!f.endsWith('.json')) continue
      const id = f.slice(0, -'.json'.length)
      const p = await this.get(id)
      if (p) profiles.push(p)
    }
    return profiles.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async get(id: string): Promise<Profile | null> {
    if (this.cache.has(id)) return this.cache.get(id)!
    const profile = await readJson<Profile | null>(this.file(id), null)
    if (profile) this.cache.set(id, profile)
    return profile
  }

  async create(input: ProfileInput): Promise<Profile> {
    const name = input.name.trim()
    if (!name) throw new LauncherError('INVALID_PROFILE', 'Profile name cannot be empty.')
    if (!input.minecraftVersion) {
      throw new LauncherError('INVALID_PROFILE', 'Choose a Minecraft version for the profile.')
    }

    const id = uuid()
    const gameDir = `${slugify(name)}-${id.slice(0, 8)}`
    // v1.0.92 — the human-readable folder name (collision-safe).
    const { uniqueFolderName } = await import('../instances/migrate')
    const folder = await uniqueFolderName(name, await this.list())
    const instanceRoot = instancePathFromFolder(folder)

    const progress = (phase: string, percent: number | null) =>
      eventBus.emit('profile:progress', { action: 'create', profileId: id, name, phase, percent, done: false })
    const finish = () =>
      eventBus.emit('profile:progress', { action: 'create', profileId: id, name, phase: 'Done', percent: 100, done: true })

    try {
      progress('Setting up folders…', 5)
      const dirs = ['mods', 'saves', 'logs', 'resourcepacks', 'shaderpacks', 'datapacks']
      for (let i = 0; i < dirs.length; i++) {
        mkdirp(path.join(instanceRoot, dirs[i]))
        progress('Setting up folders…', 5 + Math.round(((i + 1) / dirs.length) * 30))
      }

      const profile: Profile = {
        id,
        name,
        minecraftVersion: input.minecraftVersion,
        loader: { type: input.loader.type, version: input.loader.version ?? null },
        memory: input.memory ?? 4096,
        resolution: input.resolution ?? { width: 1280, height: 720, fullscreen: false },
        extraJvmArgs: input.extraJvmArgs ?? '',
        extraGameArgs: input.extraGameArgs ?? '',
        gameDir,
        folder,
        mods: [],
        favorite: input.favorite ?? false,
        icon: input.icon ?? null,
        createdAt: iso(),
        lastLaunched: null,
        playtimeSeconds: 0
      }

      progress('Saving profile…', 75)
      await writeJson(this.file(id), profile)
      this.cache.set(id, profile)

      // Fabric profiles get the Fabric API mod automatically so they are
      // immediately playable — this also gives the create progress bar real
      // work to show (download step).
      if (profile.loader.type === 'fabric') {
        progress('Installing Fabric API…', 82)
        const { ensureFabricApi } = await import('../mods/fabric-api')
        await ensureFabricApi(profile)
        const { ensureFpsBoost } = await import('../mods/fps-boost')
        const afterApi = await this.get(id)
        if (afterApi) await ensureFpsBoost(afterApi)
        const fresh = await this.get(id)
        if (fresh) profile.mods = fresh.mods
        progress('Finalizing…', 94)
      }

      progress('Finalizing…', 95)
      logger.info(`Profile created: "${name}" (${profile.minecraftVersion} / ${input.loader.type})`)
      await settingsManager.addRecent('profile_created', `Created profile "${name}"`)
      finish()
      eventBus.emit('profile:changed', { action: 'created', profile })
      return profile
    } catch (err) {
      finish()
      throw err
    }
  }

  async update(id: string, patch: Partial<Profile>): Promise<Profile> {
    const current = await this.get(id)
    if (!current) throw new LauncherError('PROFILE_MISSING', 'Profile not found.')

    // v1.0.92 — when the display name changes, safely rename the physical
    // instance folder too (never delete/recreate). The internal gameDir id
    // stays untouched. If the rename fails, the folder keeps its old name
    // and everything keeps working through the central resolver.
    let folder = current.folder
    if (patch.name && patch.name.trim() !== current.name) {
      const { uniqueFolderName } = await import('../instances/migrate')
      folder = await uniqueFolderName(patch.name.trim(), await this.list(), id)
      if (folder !== current.folder) {
        const src = current.folder ? instancePathFromFolder(current.folder) : path.join(paths.games, current.gameDir)
        const dst = instancePathFromFolder(folder)
        if (exists(src)) {
          try {
            const { rename, copyDir, remove, countEntries } = await import('../utils/fs')
            try {
              await rename(src, dst)
            } catch {
              await copyDir(src, dst)
              const [a, b] = await Promise.all([countEntries(src), countEntries(dst)])
              if (b < a) throw new Error('folder copy verification failed')
              await remove(src)
            }
            logger.info(`Profile renamed: "${current.name}" → "${patch.name.trim()}" — instance folder moved to Instances/${folder}`)
          } catch (err) {
            logger.warn(`Profile renamed but the instance folder could not be renamed (${(err as Error).message}) — the profile keeps its existing folder.`)
            folder = current.folder
          }
        }
      }
    }

    const updated: Profile = { ...current, ...patch, id: current.id, gameDir: current.gameDir, ...(folder ? { folder } : {}) }
    await writeJson(this.file(id), updated)
    this.cache.set(id, updated)

    // Log what actually changed (old → new) for the edit action.
    const changed: string[] = []
    if (patch.name && patch.name !== current.name) changed.push(`name "${current.name}" → "${patch.name}"`)
    if (patch.minecraftVersion && patch.minecraftVersion !== current.minecraftVersion) {
      changed.push(`version ${current.minecraftVersion} → ${patch.minecraftVersion}`)
      // v1.0.19 settings persistence: snapshot the instance config BEFORE the
      // version switch — the instance folder is kept, but the backup is the
      // rollback safety net if any operation around the change ever touches it.
      void import('../minecraft/config-guard')
        .then((m) => m.configGuard.backupInstanceConfig(current))
        .catch(() => {})
    }
    if (patch.loader && (patch.loader.type !== current.loader.type || patch.loader.version !== current.loader.version)) {
      changed.push(`loader ${current.loader.type} → ${patch.loader.type}`)
    }
    if (patch.memory && patch.memory !== current.memory) changed.push(`ram ${current.memory}MB → ${patch.memory}MB`)
    if (patch.extraJvmArgs !== undefined && patch.extraJvmArgs !== current.extraJvmArgs) changed.push('jvm args')
    if (patch.icon !== undefined && patch.icon !== current.icon) changed.push('icon')
    if (changed.length > 0) logger.info(`Profile edited: "${current.name}" — ${changed.join(', ')}`)

    // Keep the Fabric API in sync when a profile becomes Fabric or changes
    // its Minecraft version. Fire-and-forget: never blocks the edit.
    if (updated.loader.type === 'fabric' && (patch.minecraftVersion || patch.loader)) {
      void import('../mods/fabric-api').then((m) =>
        m.ensureFabricApi(updated).catch((err) =>
          logger.warn(`Fabric API sync failed: ${(err as Error).message}`)
        )
      )
      void import('../mods/fps-boost').then((m) =>
        m.ensureFpsBoost(updated).catch((err) =>
          logger.warn(`FPS Boost sync failed: ${(err as Error).message}`)
        )
      )
      // v1.0.79 — when a Fabric profile's Minecraft version changes, mods
      // built for the OLD version would crash the loader at runtime with the
      // classTweaker namespace error. Isolate them into mods.incompatible/
      // (recoverable — never deleted) and clear the stale remap cache.
      if (patch.minecraftVersion) {
        void import('../minecraft/fabric-validate')
          .then((m) => m.repairFabricEnvironment(updated))
          .then((res) => {
            if (res.moved.length > 0) {
              logger.warn(`Profile "${updated.name}": isolated ${res.moved.length} incompatible mod(s) after the version change -> mods.incompatible/`)
            }
          })
          .catch(() => {})
      }
    }

    eventBus.emit('profile:changed', { action: 'updated', profile: updated })
    return updated
  }

  async delete(id: string, opts: { deleteFiles?: boolean } = {}): Promise<void> {
    const profile = await this.get(id)
    if (!profile) return
    const deleteFiles = opts.deleteFiles ?? true

    const progress = (phase: string, percent: number | null) =>
      eventBus.emit('profile:progress', { action: 'delete', profileId: id, name: profile.name, phase, percent, done: false })
    const finish = () =>
      eventBus.emit('profile:progress', { action: 'delete', profileId: id, name: profile.name, phase: 'Done', percent: 100, done: true })

    try {
      progress('Removing profile record…', 10)
      await remove(this.file(id))
      this.cache.delete(id)

      if (deleteFiles) {
        progress('Counting game files…', 25)
        const { countEntries, removeWithProgress } = await import('../utils/fs')
        const instance = this.instanceDir(profile)
        const total = await countEntries(instance)
        if (total > 0) {
          progress('Deleting game files…', 35)
          await removeWithProgress(instance, (done, all) => {
            progress('Deleting game files…', 35 + Math.round((done / Math.max(1, all)) * 60))
          })
        } else {
          await remove(instance).catch(() => {})
        }
      }

      progress('Finalizing…', 97)
      logger.info(`Profile deleted: "${profile.name}"${deleteFiles ? ' (with game files)' : ' (game files kept)'}`)
      await settingsManager.addRecent('profile_deleted', `Deleted profile "${profile.name}"`)
      finish()
      eventBus.emit('profile:changed', { action: 'deleted', id })
    } catch (err) {
      finish()
      throw err
    }
  }

  async duplicate(id: string, opts: { name?: string; copyWorlds?: boolean } = {}): Promise<Profile> {
    const source = await this.get(id)
    if (!source) throw new LauncherError('PROFILE_MISSING', 'Profile not found.')

    const newId = uuid()
    const copyName = (opts.name ?? `${source.name} (Copy)`).trim()
    const newGameDir = `${slugify(copyName)}-${newId.slice(0, 8)}`
    // v1.0.92 — duplicate gets its own human-readable folder (collision-safe).
    const { uniqueFolderName } = await import('../instances/migrate')
    const newFolder = await uniqueFolderName(copyName, await this.list())
    const copy: Profile = {
      ...source,
      id: newId,
      name: copyName || `${source.name} (Copy)`,
      gameDir: newGameDir,
      folder: newFolder,
      favorite: false,
      createdAt: iso(),
      lastLaunched: null,
      playtimeSeconds: 0
    }

    const progress = (phase: string, percent: number | null) =>
      eventBus.emit('profile:progress', { action: 'duplicate', profileId: newId, name: copy.name, phase, percent, done: false })
    const finish = () =>
      eventBus.emit('profile:progress', { action: 'duplicate', profileId: newId, name: copy.name, phase: 'Done', percent: 100, done: true })

    try {
      // Copy the instance so mods/resource packs/config come along. Saves
      // (worlds) are NOT copied by default — a duplicate is a variant to
      // experiment with, not a backup. copyWorlds opts in to include them.
      const srcDir = this.instanceDir(source)
      const dstDir = this.instanceDir(copy)
      const { copyDirExcluding } = await import('../utils/fs')
      if (exists(srcDir)) {
        progress('Copying setup files…', 20)
        await copyDirExcluding(srcDir, dstDir, opts.copyWorlds ? [] : ['saves'], (done, all) => {
          progress('Copying setup files…', 20 + Math.round((done / Math.max(1, all)) * 70))
        })
      } else {
        mkdirp(path.join(dstDir, 'mods'))
      }

      progress('Saving new profile…', 93)
      await writeJson(this.file(newId), copy)
      this.cache.set(newId, copy)
      progress('Finalizing…', 98)
      logger.info(`Profile duplicated: "${source.name}" → "${copy.name}" (${id} → ${newId}${opts.copyWorlds ? ', worlds included' : ''})`)
      await settingsManager.addRecent('profile_created', `Duplicated profile "${copy.name}"`)
      finish()
      eventBus.emit('profile:changed', { action: 'created', profile: copy })
      return copy
    } catch (err) {
      finish()
      throw err
    }
  }

  async setFavorite(id: string, favorite: boolean): Promise<Profile> {
    return this.update(id, { favorite })
  }

  /**
   * Run the loader/version install pipeline for a profile's CURRENT
   * configuration — used when editing a profile's version or loader, so the
   * new config is downloaded before the next Play click. Same step-by-step
   * progress as a launch, without spawning the game.
   */
  async prepare(id: string): Promise<void> {
    const profile = await this.get(id)
    if (!profile) throw new LauncherError('PROFILE_MISSING', 'Profile not found.')
    const mc = profile.minecraftVersion

    const progress = (phase: string, percent: number | null) =>
      eventBus.emit('profile:progress', { action: 'prepare', profileId: id, name: profile.name, phase, percent, done: false })
    const finish = () =>
      eventBus.emit('profile:progress', { action: 'prepare', profileId: id, name: profile.name, phase: 'Ready', percent: 100, done: true })

    try {
      let versionId = mc
      if (profile.loader.type === 'fabric') {
        progress('Installing Fabric loader…', 10)
        const { installFabric, resolveFabricLoader } = await import('../minecraft/loaders/fabric')
        // v1.0.79 — validate the pinned loader against THIS Minecraft version
        // (never blindly reuse a loader cached for another MC version).
        const loaderVersion = await resolveFabricLoader(mc, profile.loader.version)
        // v1.0.79 — persist a corrected loader pin back to the profile so the
        // stored record always matches what the launch path will resolve.
        if (profile.loader.version !== loaderVersion) {
          try {
            await this.update(id, { loader: { type: 'fabric', version: loaderVersion } })
          } catch {
            /* non-fatal — the resolved loader still gets used below */
          }
        }
        versionId = (await installFabric(mc, loaderVersion)).versionId
        // v1.0.79 — clear a stale remap cache when the environment changed.
        void import('../minecraft/fabric-validate')
          .then((m) => m.repairFabricEnvironment(profile))
          .catch(() => {})
      } else if (profile.loader.type === 'forge') {
        progress('Installing Forge…', 10)
        const { installForge, recommendedForgeVersion } = await import('../minecraft/loaders/forge')
        const loaderVersion = profile.loader.version ?? (await recommendedForgeVersion(mc))
        if (!loaderVersion) throw new LauncherError('FORGE_MISSING', `No Forge build was found for Minecraft ${mc}.`)
        versionId = (await installForge(mc, loaderVersion)).versionId
      }

      const { versionManager } = await import('../minecraft/version-manager')
      const { ensureFabricApi } = await import('../mods/fabric-api')
      if (profile.loader.type === 'fabric' && !profile.mods.some((m) => m.id === 'fabric-api')) {
        progress('Installing Fabric API…', 30)
        await ensureFabricApi(profile)
      }

      progress('Downloading Minecraft files…', 40)
      await versionManager.prepareVersion(versionId, () => progress('Downloading Minecraft files…', 55))
      progress('Ready to launch', 100)
      logger.info(`Profile prepared: "${profile.name}" (${versionId})`)
      finish()
    } catch (err) {
      finish()
      throw err
    }
  }

  /** Called after a game session ends. */
  async recordLaunch(id: string, playtimeSeconds: number, launcherStarted: boolean): Promise<Profile> {
    const profile = await this.get(id)
    if (!profile) throw new LauncherError('PROFILE_MISSING', 'Profile not found.')
    const updated: Profile = {
      ...profile,
      lastLaunched: iso(),
      playtimeSeconds: profile.playtimeSeconds + Math.max(0, playtimeSeconds)
    }
    await writeJson(this.file(id), updated)
    this.cache.set(id, updated)
    if (launcherStarted) {
      await settingsManager.addRecent('launch', `Played "${profile.name}"`)
    }
    eventBus.emit('profile:changed', { action: 'updated', profile: updated })
    return updated
  }

  /** Favorite profile for the Home page (first one wins). */
  async favoriteProfile(): Promise<Profile | null> {
    const profiles = await this.list()
    return profiles.find((p) => p.favorite) ?? profiles[0] ?? null
  }
}

export const profileManager = new ProfileManager()
