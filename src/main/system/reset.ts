/**
 * Clean Release Reset.
 *
 * Restores the launcher to a fresh-install state:
 *  1. Stops any running game and cancels active downloads.
 *  2. Logs out every account and wipes saved sessions.
 *  3. Deletes all user data (profiles, logs, games, caches, share codes).
 *  4. Writes a fresh default settings file.
 *  5. Recreates the data folder structure and relaunches the app.
 *
 * Nothing shared with the OS is touched — only Reimagined's own data/ folder.
 */
import path from 'node:path'
import { app } from 'electron'
import { paths } from '../paths'
import { logger } from '../logs/logger'
import { eventBus } from '../core/event-bus'
import { microsoftAuth } from '../auth/microsoft-auth'
import { accountStore } from '../auth/account-store'
import { settingsManager, DEFAULT_SETTINGS } from '../settings/settings-manager'
import { launcher } from '../minecraft/launcher'

export async function cleanReleaseReset(): Promise<void> {
  logger.info('Clean Release Reset started')

  // 1. Never delete files while the game is running or being written to.
  await launcher.stop().catch(() => {})
  const { cancelActiveDownloads } = await import('../game/content')
  cancelActiveDownloads()

  // 2. Log out the Microsoft account and clear the (encrypted) store.
  try {
    await microsoftAuth.logout()
  } catch (err) {
    logger.warn(`Reset: logout failed: ${(err as Error).message}`)
  }
  await accountStore.clear().catch(() => {})

  // 3. Wipe every user-data area — fresh installation state.
  const { remove } = await import('../utils/fs')
  const targets = [
    paths.profiles,
    paths.logs,
    paths.games,
    paths.updates,
    path.join(paths.data, 'skins'),
    path.join(paths.data, 'tmp'), // modpack staging etc.
    paths.accountsFile,
    paths.settingsFile,
    paths.eventsFile,
    path.join(paths.data, 'share-codes.json')
  ]
  for (const t of targets) {
    await remove(t).catch(() => {})
  }

  // 4. Fresh default settings.
  await settingsManager.update({ ...DEFAULT_SETTINGS }).catch(() => {})
  const { writeJson } = await import('../utils/fs')
  await writeJson(paths.settingsFile, DEFAULT_SETTINGS).catch(() => {})

  // 5. Recreate the folder skeleton and relaunch.
  const { ensureDataDirs } = await import('../paths')
  ensureDataDirs()

  logger.info('Clean Release Reset complete — relaunching as a fresh install')
  eventBus.emit('auth:state', { phase: 'reset' })
  setTimeout(() => {
    app.relaunch()
    app.exit(0)
  }, 600)
}
