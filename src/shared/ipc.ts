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
  profilesRepair: 'profiles:repair',

  // Mods
  modsList: 'mods:list',
  modsSearch: 'mods:search',
  modsInstall: 'mods:install',
  modsRemove: 'mods:remove',
  modsCheckUpdates: 'mods:check-updates',
  modsUpdate: 'mods:update',
  modsSearchCurseforge: 'mods:search-curseforge',
  modsInstallCurseforge: 'mods:install-curseforge',
  /** v1.0.82 — global browse (Games → Mods): any MC version + loader. */
  modsSearchAny: 'mods:search-any',
  modsSearchCurseforgeAny: 'mods:search-curseforge-any',
  /** v1.0.82 — resolve the exact version a given instance would install. */
  modsPreviewVersion: 'mods:preview-version',
  worldsInstall: 'worlds:install',
  modsCategories: 'mods:categories',
  modsLocalFiles: 'mods:local-files',
  modsRemoveLocalFile: 'mods:remove-local-file',
  modsIdentifyManual: 'mods:identify-manual',
  modsEnrichManual: 'mods:enrich-manual',
  modsEnsureIcons: 'mods:ensure-icons',
  modsCategoriesCurseforge: 'mods:categories-curseforge',
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
  // v1.0.92 — Copy PC Specs (Settings → Performance → Your Hardware)
  systemCopySpecs: 'system:copy-specs',
  // v1.0.92 — Clear Up Space (Settings → Storage)
  storageScan: 'storage:scan',
  storageClean: 'storage:clean',
  
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
  shareFolderSizes: 'share:folder-sizes',

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
  authorGet: 'author:get',
  authorProjects: 'author:projects',
  ytAvatar: 'yt:avatar',

  // Reliable image proxy (V2 fix) — main-process fetch → data URL
  contentImage: 'content:image',

  // Music (v1.0.87) — local background library (Spotify removed)
  musicList: 'music:list',
  musicAdd: 'music:add',
  musicRemove: 'music:remove',
  // v1.0.99 — drag-and-drop import + open the library folder
  musicImport: 'music:import',
  musicOpenFolder: 'music:open-folder',
  // v1.0.88 — Discord Rich Presence
  presenceSet: 'presence:set',
  presenceClear: 'presence:clear',
  // v1.0.88 — Servers
  serverPing: 'servers:ping',
  serverJoin: 'servers:join',
  serverAddFavorite: 'servers:add',
  serverRemoveFavorite: 'servers:remove',
  // v1.0.89 — server directory + install into instances
  serverDiscover: 'servers:discover',
  serverRecommended: 'servers:recommended',
  serverInstall: 'servers:install',
  // v1.0.88 — instance screenshots
  screenshotList: 'screenshots:list',
  screenshotExport: 'screenshots:export',
  screenshotDelete: 'screenshots:delete',
  // v1.0.92 — Run a FPS Test (Account)
  fpsTestList: 'fpstest:list',
  fpsTestStart: 'fpstest:start',
  fpsTestStatus: 'fpstest:status',
  fpsTestCancel: 'fpstest:cancel',
  fpsTestResults: 'fpstest:results',
  fpsTestReportPath: 'fpstest:report-path',
  fpsTestOpenReport: 'fpstest:open-report',
  // v2.1.0 — Keybinds (System section)
  keybindList: 'keybinds:list',
  keybindSet: 'keybinds:set',
  keybindApplyAll: 'keybinds:apply-all',
  keybindSaveTemplate: 'keybinds:save-template',
  keybindOpenFolder: 'keybinds:open-folder',
  // v2.1.1 — Credits → About: open the launcher's data directory
  systemOpenDataFolder: 'system:open-data-folder'
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
  | 'launch:fabric-mismatch'
  | 'share:deep-link'
  | 'system:info'
  | 'streaming:changed'

export interface AppEvent {
  type: AppEventType
  payload?: unknown
}
