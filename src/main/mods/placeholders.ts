/**
 * Future systems — prepared for expansion.
 *
 * Most entries keep a stable interface so the UI can wire real buttons today
 * and the implementations can land without touching the front end.
 *
 * Profile share codes now live in `src/main/share/share.ts` (real, 7-day expiry).
 */
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { paths } from '../paths'
import { readJson, writeJson } from '../utils/fs'
import { profileManager } from '../profiles/profile-manager'
import { LauncherError } from '../core/errors'
import { logger } from '../logs/logger'

function comingSoon(name: string): never {
  logger.info(`[future] "${name}" was requested — not implemented in v1`)
  throw new LauncherError(
    'COMING_SOON',
    `${name} is coming soon.`,
    'This system is already prepared for a future Reimagined release.'
  )
}

export const futureSystems = {
  /** CurseForge requires an API key. Interface mirrors the Modrinth client. */
  curseforge: {
    configured: false as boolean,
    search: (): never => comingSoon('CurseForge search'),
    install: (): never => comingSoon('CurseForge install')
  },

  /** Modpack export / import (ZIP). */
  modpack: {
    export: (_profileId: string): never => comingSoon('Modpack export'),
    import: (_zipPath: string): never => comingSoon('Modpack import')
  },



  /** Direct links — launch profiles from reimagined:// URLs. */
  directLinks: {
    open: (_url: string): never => comingSoon('Direct links')
  },

  /** Cloud synchronization of profiles and settings. */
  cloud: {
    sync: (): never => comingSoon('Cloud synchronization')
  },

  /** Automatic crash repair (log analysis + dependency healing). */
  crashRepair: {
    diagnose: (): never => comingSoon('Automatic crash repair')
  }
}

export type FutureSystems = typeof futureSystems
