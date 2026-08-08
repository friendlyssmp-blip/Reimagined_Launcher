/**
 * IPC channel contract.
 * Every channel name the renderer can invoke and every event the main
 * process can push is declared here so the preload bridge and the UI stay
 * perfectly in sync (no magic strings scattered around the app).
 */

export const IPC = {
  // App / window
  appGetInfo: 'app:get-info',
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowIsMaximized: 'window:is-maximized',

  // Settings
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  dialogPickJava: 'dialog:pick-java',
  dialogPickFolder: 'dialog:pick-folder',
  logsOpenFolder: 'logs:open-folder',
  logsClear: 'logs:clear',
  logsRead: 'logs:read',
  logsListFiles: 'logs:list-files',
  logsWrite: 'logs:write',

  // Auth
  authGetAccount: 'auth:get-account',
  authStart: 'auth:start',
  authCancel: 'auth:cancel',
  authLogout: 'auth:logout',

  // Minecraft versions
  versionsList: 'versions:list',
  loadersFor: 'versions:loaders-for',

  // Profiles
  profilesList: 'profiles:list',
  profilesCreate: 'profiles:create',
  profilesUpdate: 'profiles:update',
  profilesDelete: 'profiles:delete',
  profilesDuplicate: 'profiles:duplicate',
  profilesPrepare: 'profiles:prepare',

  // Mods
  modsList: 'mods:list',
  modsSearch: 'mods:search',
  modsInstall: 'mods:install',
  modsRemove: 'mods:remove',
  modsCheckUpdates: 'mods:check-updates',
  modsUpdate: 'mods:update',
  modsSearchCurseforge: 'mods:search-curseforge',
  modsInstallCurseforge: 'mods:install-curseforge',
  modsCategories: 'mods:categories',
  modsLocalFiles: 'mods:local-files',
  modsRemoveLocalFile: 'mods:remove-local-file',
  modsIdentifyManual: 'mods:identify-manual',
  modsEnsureIcons: 'mods:ensure-icons',
  modsChangeVersion: 'mods:change-version',
  modsSetEnabled: 'mods:set-enabled',
  modsAvailableVersions: 'mods:available-versions',
  modsInstallVersion: 'mods:install-version',
  // Install confirmation with real dependency resolution (Part 1 of the
  // install-confirmation pass — Modrinth only, CurseForge is removed).
  modsDependencies: 'mods:dependencies',
  modsInstallWithDeps: 'mods:install-with-deps',

  // Content detail page (Part 5)
  contentDetail: 'content:detail',
  contentVersions: 'content:versions',
  contentChangelog: 'content:changelog',
  contentModpackContents: 'content:modpack-contents',

  // Modpacks (Modrinth)
  modpacksSearch: 'modpacks:search',
  modpacksInstall: 'modpacks:install',
  // Modpacks (CurseForge) — v1.0.40
  modpacksSearchCurseforge: 'modpacks:search-curseforge',
  modpacksInstallCurseforge: 'modpacks:install-curseforge',

  // Launch
  launchStart: 'launch:start',
  launchStop: 'launch:stop',
  launchGet: 'launch:get',
  /** All live game sessions (multi-instance support). */
  launchList: 'launch:list',

  // Detached game console window
  consoleOpen: 'console:open',
  consoleClose: 'console:close',
  consoleMinimize: 'console:minimize',
  consoleToggleMaximize: 'console:toggle-maximize',
  consoleGetState: 'console:get-state',

  // Worlds / packs / downloads
  worldsList: 'worlds:list',
  packsList: 'packs:list',
  downloadsList: 'downloads:list',
  downloadsCancel: 'downloads:cancel',
  openInstanceFolder: 'content:open-folder',
  backupWorld: 'content:backup-world',


  // Skins (only the face-icon texture loader remains)

  skinTexture: 'skin:texture',
  
  // Update check
  updateCheck: 'update:check',
  updateGetInfo: 'update:get-info',
  updateDownload: 'update:download',
  updateInstall: 'update:install',

  // System
  systemCleanReset: 'system:clean-reset',
  
  // Future systems (placeholders)
  modpackExport: 'modpack:export',
  modpackImport: 'modpack:import',
  cloudSync: 'cloud:sync',

  // Profile share / import (Part 1/2)
  sharePrepare: 'share:prepare',
  shareCreate: 'share:create',
  shareResolve: 'share:resolve',
  shareImport: 'share:import',
  shareCancel: 'share:cancel',
  sharePendingCode: 'share:pending-code',
  shareExportZip: 'share:export-zip',
  shareReadZip: 'share:read-zip',
  shareImportZip: 'share:import-zip',
  sharePickZip: 'share:pick-zip',

  // Performance Engine (RPE)
  perfStatus: 'perf:status',
  perfRecommendations: 'perf:recommendations',
  perfApply: 'perf:apply',
  perfMods: 'perf:mods',
  perfInstallMod: 'perf:install-mod',
  perfRemoveMod: 'perf:remove-mod',

  // Shader / crash safety (v1.0.12 anti-crash system)
  shadersSupport: 'shaders:support',
  shadersDisable: 'shaders:disable',

  // Reimagined FPS Boost — manual install/remove (V2), per profile
  fpsBoostStatus: 'fpsboost:status',
  fpsBoostInstall: 'fpsboost:install',
  fpsBoostRemove: 'fpsboost:remove',

  // Extended View (v1.0.29) — wipe the per-instance cached chunk snapshots
  extendedViewClearCache: 'extended-view:clear-cache',

  // Reliable image proxy (V2 fix) — main-process fetch → data URL
  contentImage: 'content:image'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

/** Single push channel used by the main process to stream events to the UI. */
export const EVENT_CHANNEL = 'reimagined:event'

export type AppEventType =
  | 'auth:code'
  | 'auth:state'
  | 'auth:error'
  | 'launch:progress'
  | 'launch:log'
  | 'launch:status'
  | 'launch:exit'
  | 'launch:window-open'
  | 'download:progress'
  | 'downloads:changed'
  | 'settings:changed'
  | 'profile:changed'
  | 'profile:progress'
  | 'mods:changed'
  | 'update:progress'
  | 'crash:detected'
  | 'shaders:auto-disabled'
  | 'share:deep-link'
  | 'system:info'

export interface AppEvent {
  type: AppEventType
  payload?: unknown
}
