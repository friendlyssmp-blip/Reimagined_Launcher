/**
 * Preload bridge.
 *
 * Exposes a typed, whitelisted API on `window.reimagined` via contextBridge.
 * The renderer has no direct Node or Electron access (contextIsolation on).
 */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC, EVENT_CHANNEL, type AppEvent } from '@shared/ipc'

const api = {
  getInfo: (): Promise<unknown> => ipcRenderer.invoke(IPC.appGetInfo),

  window: {
    minimize: (): Promise<unknown> => ipcRenderer.invoke(IPC.windowMinimize),
    toggleMaximize: (): Promise<unknown> => ipcRenderer.invoke(IPC.windowToggleMaximize),
    close: (): Promise<unknown> => ipcRenderer.invoke(IPC.windowClose),
    isMaximized: (): Promise<unknown> => ipcRenderer.invoke(IPC.windowIsMaximized)
  },

  settings: {
    get: (): Promise<unknown> => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch: Record<string, unknown>): Promise<unknown> => ipcRenderer.invoke(IPC.settingsSet, patch)
  },

  dialog: {
    pickJava: (): Promise<unknown> => ipcRenderer.invoke(IPC.dialogPickJava),
    pickFolder: (): Promise<unknown> => ipcRenderer.invoke(IPC.dialogPickFolder)
  },

  logs: {
    openFolder: (): Promise<unknown> => ipcRenderer.invoke(IPC.logsOpenFolder),
    clear: (): Promise<unknown> => ipcRenderer.invoke(IPC.logsClear),
    read: (): Promise<unknown> => ipcRenderer.invoke(IPC.logsRead),
    listFiles: (): Promise<unknown> => ipcRenderer.invoke(IPC.logsListFiles),
    write: (level: string, message: string): Promise<unknown> => ipcRenderer.invoke(IPC.logsWrite, { level, message })
  },

  content: {
    worlds: (profileId: string): Promise<unknown> => ipcRenderer.invoke(IPC.worldsList, profileId),
    packs: (profileId: string, kind: string): Promise<unknown> => ipcRenderer.invoke(IPC.packsList, { profileId, kind }),
    downloads: (): Promise<unknown> => ipcRenderer.invoke(IPC.downloadsList),
    openFolder: (profileId: string, sub?: string): Promise<unknown> => ipcRenderer.invoke(IPC.openInstanceFolder, { profileId, sub }),
    backupWorld: (profileId: string, world: string): Promise<unknown> => ipcRenderer.invoke(IPC.backupWorld, { profileId, world }),
    detail: (payload: { provider: string; projectId: string; projectType?: string }): Promise<unknown> =>
      ipcRenderer.invoke(IPC.contentDetail, payload),
    versions: (payload: { provider: string; projectId: string; projectType?: string }): Promise<unknown> =>
      ipcRenderer.invoke(IPC.contentVersions, payload),
    changelog: (projectId: string, versionId: string): Promise<unknown> =>
      ipcRenderer.invoke(IPC.contentChangelog, { projectId, versionId })
  },

  auth: {
    getAccount: (): Promise<unknown> => ipcRenderer.invoke(IPC.authGetAccount),
    start: (): Promise<unknown> => ipcRenderer.invoke(IPC.authStart),
    cancel: (): Promise<unknown> => ipcRenderer.invoke(IPC.authCancel),
    logout: (): Promise<unknown> => ipcRenderer.invoke(IPC.authLogout)
  },

  versions: {
    list: (): Promise<unknown> => ipcRenderer.invoke(IPC.versionsList),
    loadersFor: (mcVersion: string): Promise<unknown> => ipcRenderer.invoke(IPC.loadersFor, { mcVersion })
  },  profiles: {
    list: (): Promise<unknown> => ipcRenderer.invoke(IPC.profilesList),
    create: (input: unknown): Promise<unknown> => ipcRenderer.invoke(IPC.profilesCreate, input),
    update: (id: string, patch: unknown): Promise<unknown> => ipcRenderer.invoke(IPC.profilesUpdate, { id, patch }),
    delete: (id: string, deleteFiles?: boolean): Promise<unknown> =>
      ipcRenderer.invoke(IPC.profilesDelete, { id, deleteFiles }),
    duplicate: (id: string, opts?: { name?: string; copyWorlds?: boolean }): Promise<unknown> =>
      ipcRenderer.invoke(IPC.profilesDuplicate, { id, opts }),
    prepare: (id: string): Promise<unknown> => ipcRenderer.invoke(IPC.profilesPrepare, id)
  },

  mods: {
    list: (profileId: string): Promise<unknown> => ipcRenderer.invoke(IPC.modsList, profileId),
    search: (profileId: string, query: string, index?: string, opts?: Record<string, unknown>): Promise<unknown> =>
      ipcRenderer.invoke(IPC.modsSearch, { profileId, query, index, opts }),
    categories: (): Promise<unknown> => ipcRenderer.invoke(IPC.modsCategories),
    install: (profileId: string, projectId: string, projectType?: string): Promise<unknown> =>
      ipcRenderer.invoke(IPC.modsInstall, { profileId, projectId, projectType }),
    remove: (profileId: string, slug: string): Promise<unknown> =>
      ipcRenderer.invoke(IPC.modsRemove, { profileId, slug }),
    checkUpdates: (profileId: string): Promise<unknown> => ipcRenderer.invoke(IPC.modsCheckUpdates, profileId),
    update: (profileId: string, slug: string): Promise<unknown> => ipcRenderer.invoke(IPC.modsUpdate, { profileId, slug }),
    localFiles: (profileId: string): Promise<unknown> => ipcRenderer.invoke(IPC.modsLocalFiles, profileId),
    removeLocalFile: (profileId: string, filename: string): Promise<unknown> =>
      ipcRenderer.invoke(IPC.modsRemoveLocalFile, { profileId, filename }),
    searchCurseforge: (profileId: string, query: string, sort?: string, projectType?: string): Promise<unknown> =>
      ipcRenderer.invoke(IPC.modsSearchCurseforge, { profileId, query, sort, projectType }),
    installCurseforge: (profileId: string, projectId: string, meta?: unknown, projectType?: string): Promise<unknown> =>
      ipcRenderer.invoke(IPC.modsInstallCurseforge, { profileId, projectId, projectType, ...(meta as Record<string, unknown> | undefined) }),
    changeVersion: (profileId: string, slug: string, versionId: string): Promise<unknown> =>
      ipcRenderer.invoke(IPC.modsChangeVersion, { profileId, slug, versionId }),
    setEnabled: (profileId: string, slug: string, enabled: boolean): Promise<unknown> =>
      ipcRenderer.invoke(IPC.modsSetEnabled, { profileId, slug, enabled }),
    availableVersions: (profileId: string, slug: string): Promise<unknown> =>
      ipcRenderer.invoke(IPC.modsAvailableVersions, { profileId, slug }),
    installVersion: (profileId: string, provider: string, projectId: string, versionId: string, projectType?: string): Promise<unknown> =>
      ipcRenderer.invoke(IPC.modsInstallVersion, { profileId, provider, projectId, versionId, projectType })
  },

  launch: {
    start: (profileId: string): Promise<unknown> => ipcRenderer.invoke(IPC.launchStart, profileId),
    stop: (): Promise<unknown> => ipcRenderer.invoke(IPC.launchStop),
    get: (): Promise<unknown> => ipcRenderer.invoke(IPC.launchGet)
  },

  modpacks: {
    search: (opts: Record<string, unknown>): Promise<unknown> => ipcRenderer.invoke(IPC.modpacksSearch, opts),
    install: (projectId: string, versionId: string, name?: string): Promise<unknown> =>
      ipcRenderer.invoke(IPC.modpacksInstall, { projectId, versionId, name })
  },

  /** Detached game console window controls (used by its own renderer). */
  console: {
    open: (): Promise<unknown> => ipcRenderer.invoke(IPC.consoleOpen),
    close: (): Promise<unknown> => ipcRenderer.invoke(IPC.consoleClose),
    minimize: (): Promise<unknown> => ipcRenderer.invoke(IPC.consoleMinimize),
    toggleMaximize: (): Promise<unknown> => ipcRenderer.invoke(IPC.consoleToggleMaximize),
    getState: (): Promise<unknown> => ipcRenderer.invoke(IPC.consoleGetState)
  },

  future: {
    modpackExport: (profileId: string): Promise<unknown> => ipcRenderer.invoke(IPC.modpackExport, profileId),
    modpackImport: (zipPath: string): Promise<unknown> => ipcRenderer.invoke(IPC.modpackImport, zipPath),
    cloudSync: (): Promise<unknown> => ipcRenderer.invoke(IPC.cloudSync)
  },

  share: {
    prepare: (profileId: string): Promise<unknown> => ipcRenderer.invoke(IPC.sharePrepare, profileId),
    create: (profileId: string): Promise<unknown> => ipcRenderer.invoke(IPC.shareCreate, profileId),
    resolve: (code: string): Promise<unknown> => ipcRenderer.invoke(IPC.shareResolve, code),
    importCode: (code: string): Promise<unknown> => ipcRenderer.invoke(IPC.shareImport, code),
    exportZip: (profileId: string): Promise<unknown> => ipcRenderer.invoke(IPC.shareExportZip, profileId),
    readZip: (zipPath: string): Promise<unknown> => ipcRenderer.invoke(IPC.shareReadZip, zipPath),
    importZip: (zipPath: string): Promise<unknown> => ipcRenderer.invoke(IPC.shareImportZip, zipPath),
    pickZip: (): Promise<unknown> => ipcRenderer.invoke(IPC.sharePickZip)
  },


  system: {
    getMemory: (): Promise<unknown> => ipcRenderer.invoke('system:getMemory'),
    cleanReset: (): Promise<unknown> => ipcRenderer.invoke(IPC.systemCleanReset)
  },
  

  skin: {
    texture: (url: string): Promise<unknown> => ipcRenderer.invoke(IPC.skinTexture, { url })
  },
  
  update: {
    check: (): Promise<unknown> => ipcRenderer.invoke(IPC.updateCheck),
    getInfo: (): Promise<unknown> => ipcRenderer.invoke(IPC.updateGetInfo),
    download: (): Promise<unknown> => ipcRenderer.invoke(IPC.updateDownload),
    install: (): Promise<unknown> => ipcRenderer.invoke(IPC.updateInstall)
  },
  
  /** Reimagined Performance Engine (RPE). */
  perf: {
    status: (): Promise<unknown> => ipcRenderer.invoke(IPC.perfStatus),
    recommendations: (profileId?: string): Promise<unknown> => ipcRenderer.invoke(IPC.perfRecommendations, profileId),
    apply: (payload: { id: string; profileId?: string }): Promise<unknown> => ipcRenderer.invoke(IPC.perfApply, payload),
    mods: (profileId: string): Promise<unknown> => ipcRenderer.invoke(IPC.perfMods, profileId),
    installMod: (profileId: string, slug: string): Promise<unknown> => ipcRenderer.invoke(IPC.perfInstallMod, { profileId, slug }),
    removeMod: (profileId: string, slug: string): Promise<unknown> => ipcRenderer.invoke(IPC.perfRemoveMod, { profileId, slug })
  },
  
  /** Subscribe to main-process push events. Returns an unsubscribe fn. */
  onEvent: (cb: (event: AppEvent) => void): (() => void) => {
    const listener = (_e: unknown, event: AppEvent): void => cb(event)
    ipcRenderer.on(EVENT_CHANNEL, listener)
    return () => ipcRenderer.removeListener(EVENT_CHANNEL, listener)
  },

  /** Window maximize state changes (frameless custom title bar). */
  onMaximized: (cb: (maximized: boolean) => void): (() => void) => {
    const listener = (_e: unknown, v: boolean): void => cb(v)
    ipcRenderer.on('reimagined:maximized', listener)
    return () => ipcRenderer.removeListener('reimagined:maximized', listener)
  }
}

export type ReimaginedApi = typeof api

contextBridge.exposeInMainWorld('reimagined', api)
