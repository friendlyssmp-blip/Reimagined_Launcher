/**
 * Typed API layer for the renderer.
 *
 * Wraps the preload bridge, unwraps the `{ ok, data | error }` envelope and
 * rethrows failures as ApiError so pages can show friendly messages.
 */
import type {
  AppInfo,
  LauncherSettings,
  AccountPublic,
  Profile,
  ProfileMod,
  ModrinthSearchResult,
  SearchPage,
  UpdateInfo,
  LaunchHandle,
  LoaderType,
  MinecraftVersionSummary,
  ShareSnapshot,
  ProjectDetail,
  ProjectVersionInfo,
  InstallDepInfo,
  InstallWithDepsResult,
  PerfStatus,
  PerfRecommendation,
  PerfModOption,
  ShaderSupport,
  AuthorProfile,
  AuthorProject
} from '@shared/types'
import type { AppEvent } from '@shared/ipc'

export interface IpcErrorShape {
  code: string
  message: string
  hint?: string
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: IpcErrorShape }

export class ApiError extends Error {
  code: string
  hint?: string
  constructor(message: string, code: string, hint?: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.hint = hint
  }
}

async function unwrap<T>(promise: Promise<unknown>): Promise<T> {
  const res = (await promise) as Envelope<T>
  if (!res || !res.ok) {
    throw new ApiError(res?.error?.message ?? 'The launcher could not complete this request.', res?.error?.code ?? 'ERROR', res?.error?.hint)
  }
  return res.data
}

export interface LoadersForResult {
  fabric: string[]
  forge: string[]
  recommendedFabric: string | null
  recommendedForge: string | null
}

export const api = {
  getInfo: () => unwrap<AppInfo>(window.reimagined.getInfo()),
  window: {
    minimize: () => void window.reimagined.window.minimize(),
    toggleMaximize: () => void window.reimagined.window.toggleMaximize(),
    close: () => void window.reimagined.window.close()
  },
  settings: {
    get: () => unwrap<LauncherSettings>(window.reimagined.settings.get()),
    set: (patch: Partial<LauncherSettings>) => unwrap<LauncherSettings>(window.reimagined.settings.set(patch as Record<string, unknown>))
  },
  dialog: {
    pickJava: () => unwrap<string | null>(window.reimagined.dialog.pickJava()),
    pickFolder: () => unwrap<string | null>(window.reimagined.dialog.pickFolder())
  },
  logs: {
    openFolder: () => unwrap<void>(window.reimagined.logs.openFolder()),
    clear: () => unwrap<number>(window.reimagined.logs.clear()),
    read: () => unwrap<{ recent: { at: string; level: string; text: string }[]; fileTail: { at: string; level: string; text: string }[] }>(window.reimagined.logs.read()),
    listFiles: () => unwrap<string[]>(window.reimagined.logs.listFiles()),
    write: (level: 'info' | 'warn' | 'error', message: string) => unwrap<boolean>(window.reimagined.logs.write(level, message))
  },
  content: {
    worlds: (profileId: string) => unwrap<{ name: string; folder: string; sizeBytes: number; lastModified: string | null }[]>(window.reimagined.content.worlds(profileId)),
    packs: (profileId: string, kind: 'resourcepacks' | 'shaders') => unwrap<{ name: string; kind: 'folder' | 'zip'; sizeBytes: number }[]>(window.reimagined.content.packs(profileId, kind)),
    downloads: () => unwrap<{ id: string; label: string; kind: string; status: 'downloading' | 'done' | 'failed'; percent: number; downloadedBytes: number; totalBytes: number; at: string; iconUrl?: string }[]>(window.reimagined.content.downloads()),
    cancelDownload: (id: string) => unwrap<boolean>(window.reimagined.content.cancelDownload(id)),
    openFolder: (profileId: string, sub?: string) => unwrap<void>(window.reimagined.content.openFolder(profileId, sub)),
    backupWorld: (profileId: string, world: string) => unwrap<{ destination: string }>(window.reimagined.content.backupWorld(profileId, world)),
    detail: (payload: { provider: 'modrinth' | 'curseforge'; projectId: string; projectType?: string }) =>
      unwrap<ProjectDetail>(window.reimagined.content.detail(payload)),
    image: (url: string) => unwrap<{ dataUrl: string | null }>(window.reimagined.content.image(url)),
    versions: (payload: { provider: 'modrinth' | 'curseforge'; projectId: string; projectType?: string }) =>
      unwrap<ProjectVersionInfo[]>(window.reimagined.content.versions(payload)),
    changelog: (projectId: string, versionId: string) =>
      unwrap<string>(window.reimagined.content.changelog(projectId, versionId)),
    modpackContents: (versionId: string) =>
      unwrap<{ path: string; size: number; source: 'modrinth' | 'curseforge' | 'bundled' }[]>(window.reimagined.content.modpackContents(versionId))
  },
  auth: {
    getAccount: () => unwrap<AccountPublic>(window.reimagined.auth.getAccount()),
    start: () =>
      unwrap<{ userCode: string; verificationUri: string; message: string }>(window.reimagined.auth.start()),
    cancel: () => unwrap<void>(window.reimagined.auth.cancel()),
    logout: () => unwrap<void>(window.reimagined.auth.logout())
  },
  versions: {
    list: () => unwrap<string[]>(window.reimagined.versions.list()),
    loadersFor: (mcVersion: string) => unwrap<LoadersForResult>(window.reimagined.versions.loadersFor(mcVersion))
  },
  profiles: {
    list: () => unwrap<Profile[]>(window.reimagined.profiles.list()),
    create: (input: {
      name: string
      minecraftVersion: string
      loader: { type: LoaderType; version: string | null }
      memory: number
      resolution: { width: number; height: number; fullscreen: boolean }
      extraJvmArgs?: string
      extraGameArgs?: string
      icon?: string | null
      favorite?: boolean
    }) => unwrap<Profile>(window.reimagined.profiles.create(input)),
    update: (id: string, patch: Partial<Profile>) => unwrap<Profile>(window.reimagined.profiles.update(id, patch)),
    delete: (id: string, deleteFiles?: boolean) => unwrap<void>(window.reimagined.profiles.delete(id, deleteFiles)),
    duplicate: (id: string, opts?: { name?: string; copyWorlds?: boolean }) =>
      unwrap<Profile>(window.reimagined.profiles.duplicate(id, opts)),
    prepare: (id: string) => unwrap<void>(window.reimagined.profiles.prepare(id)),
    /** v1.0.79 — repair a profile's Fabric environment (loader re-pin,
     *  incompatible-mod quarantine, remap-cache clear). Never touches user
     *  data. Returns what was fixed/moved. */
    repair: (id: string) =>
      unwrap<{ fixed: string[]; moved: string[] }>(window.reimagined.profiles.repair(id))
  },
  mods: {
    list: (profileId: string) => unwrap<ProfileMod[]>(window.reimagined.mods.list(profileId)),
    search: (profileId: string, query: string, index?: string, opts?: { mcVersion?: string; loader?: string; category?: string; projectType?: string; offset?: number; limit?: number }) =>
      unwrap<SearchPage<ModrinthSearchResult>>(window.reimagined.mods.search(profileId, query, index, opts)),
    categories: (projectType?: string) => unwrap<string[]>(window.reimagined.mods.categories(projectType)),
    install: (profileId: string, projectId: string, projectType?: string) => unwrap<ProfileMod>(window.reimagined.mods.install(profileId, projectId, projectType)),
    remove: (profileId: string, slug: string) => unwrap<void>(window.reimagined.mods.remove(profileId, slug)),
    checkUpdates: (profileId: string) => unwrap<ProfileMod[]>(window.reimagined.mods.checkUpdates(profileId)),
    update: (profileId: string, slug: string) => unwrap<ProfileMod>(window.reimagined.mods.update(profileId, slug)),
    localFiles: (profileId: string, projectType?: string) => unwrap<string[]>(window.reimagined.mods.localFiles(profileId, projectType ?? 'mod')),
    identifyManual: (profileId: string) => unwrap<{ identified: number; matched: number }>(window.reimagined.mods.identifyManual(profileId)),
    enrichManual: (profileId: string) => unwrap<{ enriched: number; matched: number }>(window.reimagined.mods.enrichManual(profileId)),
    ensureIcons: (profileId: string) => unwrap<void>(window.reimagined.mods.ensureIcons(profileId)),
    categoriesCurseforge: (projectType?: string) => unwrap<{ id: number; name: string }[]>(window.reimagined.mods.categoriesCurseforge(projectType)),
    removeLocalFile: (profileId: string, filename: string, projectType?: string) =>
      unwrap<void>(window.reimagined.mods.removeLocalFile(profileId, filename, projectType ?? 'mod')),
    searchCurseforge: (profileId: string, query: string, sort?: 'downloads' | 'newest' | 'recent' | 'name', projectType?: string, category?: string, opts?: { offset?: number; limit?: number }) =>
      unwrap<ModrinthSearchResult[]>(window.reimagined.mods.searchCurseforge(profileId, query, sort, projectType, category, opts)),
    installCurseforge: (profileId: string, projectId: string, meta?: { title?: string; iconUrl?: string; downloads?: number }, projectType?: string) =>
      unwrap<ProfileMod>(window.reimagined.mods.installCurseforge(profileId, projectId, meta, projectType)),
    changeVersion: (profileId: string, slug: string, versionId: string) =>
      unwrap<ProfileMod>(window.reimagined.mods.changeVersion(profileId, slug, versionId)),
    setEnabled: (profileId: string, slug: string, enabled: boolean) =>
      unwrap<ProfileMod>(window.reimagined.mods.setEnabled(profileId, slug, enabled)),
    availableVersions: (profileId: string, slug: string) =>
      unwrap<ProjectVersionInfo[]>(window.reimagined.mods.availableVersions(profileId, slug)),
    installVersion: (profileId: string, provider: 'modrinth' | 'curseforge', projectId: string, versionId: string, projectType?: string, title?: string) =>
      unwrap<ProfileMod>(window.reimagined.mods.installVersion(profileId, provider, projectId, versionId, projectType, title)),
    dependencies: (profileId: string, projectId: string, versionId: string, projectType?: string) =>
      unwrap<InstallDepInfo[]>(window.reimagined.mods.dependencies(profileId, projectId, versionId, projectType)),
    installWithDeps: (profileId: string, projectId: string, versionId?: string, projectType?: string) =>
      unwrap<InstallWithDepsResult>(window.reimagined.mods.installWithDeps(profileId, projectId, versionId ?? '', projectType)),
    /** v1.0.82 — global browse (Games → Mods), any MC version + loader. */
    searchAny: (query: string, index?: string, opts?: { mcVersion?: string; loader?: string; projectType?: string; offset?: number; limit?: number }) =>
      unwrap<SearchPage<ModrinthSearchResult>>(window.reimagined.mods.searchAny(query, index, opts)),
    searchCurseforgeAny: (query: string, sort?: 'downloads' | 'newest' | 'recent' | 'name', projectType?: string, category?: string, opts?: { mcVersion?: string; loader?: string; offset?: number; limit?: number }) =>
      unwrap<ModrinthSearchResult[]>(window.reimagined.mods.searchCurseforgeAny(query, sort, projectType, category, opts)),
    /** v1.0.82 — the exact version a given instance would install (no download). */
    previewVersion: (profileId: string, provider: 'modrinth' | 'curseforge', projectId: string, projectType?: string) =>
      unwrap<{ versionId: string; versionNumber: string; filename: string }>(window.reimagined.mods.previewVersion(profileId, provider, projectId, projectType)),
    installWorld: (profileId: string, projectId: string) =>
      unwrap<{ folder: string; title: string }>(window.reimagined.mods.installWorld(profileId, projectId))
  },
  launch: {
    start: (profileId: string) => unwrap<LaunchHandle>(window.reimagined.launch.start(profileId)),
    stop: (profileId?: string) => unwrap<void>(window.reimagined.launch.stop(profileId)),
    get: () => unwrap<LaunchHandle>(window.reimagined.launch.get()),
    list: () => unwrap<LaunchHandle[]>(window.reimagined.launch.list())
  },
  modpacks: {
    search: (opts: { query?: string; mcVersion?: string; loader?: 'fabric' | 'forge' | 'any'; offset?: number; limit?: number }) =>
      unwrap<SearchPage<ModrinthSearchResult>>(window.reimagined.modpacks.search(opts)),
    install: (projectId: string, versionId: string, name?: string) =>
      unwrap<{ profileId: string; name: string; installed: number; skipped: string[] }>(
        window.reimagined.modpacks.install(projectId, versionId, name)
      ),
    searchCurseforge: (opts: { query?: string; mcVersion?: string; offset?: number; limit?: number }) =>
      unwrap<SearchPage<ModrinthSearchResult>>(window.reimagined.modpacks.searchCurseforge(opts)),
    installCurseforge: (projectId: string, fileId: string, name?: string) =>
      unwrap<{ profileId: string; name: string; installed: number; skipped: string[] }>(
        window.reimagined.modpacks.installCurseforge(projectId, fileId, name)
      )
  },

  /** Detached game console window (separate, draggable, minimizable). */
  console: {
    open: () => unwrap<void>(window.reimagined.console.open()),
    close: () => unwrap<void>(window.reimagined.console.close()),
    minimize: () => unwrap<void>(window.reimagined.console.minimize()),
    toggleMaximize: () => unwrap<void>(window.reimagined.console.toggleMaximize()),
    getState: () => unwrap<ConsoleState>(window.reimagined.console.getState())
  },

  system: {
    getMemory: () => unwrap<number>(window.reimagined.system.getMemory()),
    cleanReset: () => unwrap<void>(window.reimagined.system.cleanReset())
  },
  

  skin: {
    /* Only the account face icon remains: loading a skin texture as a data URL. */
    texture: (url: string) => unwrap<{ dataUrl: string; width: number; height: number }>(window.reimagined.skin.texture(url))
  },
  
  update: {
    check: (force = false) => unwrap<UpdateInfo>(window.reimagined.update.check(force)),
    getInfo: () => unwrap<UpdateInfo>(window.reimagined.update.getInfo()),
    download: () => unwrap<{ progress: number; path: string }>(window.reimagined.update.download()),
    install: () => unwrap<void>(window.reimagined.update.install())
  },


  /** Reimagined Performance Engine (RPE). */
  perf: {
    status: () => unwrap<PerfStatus>(window.reimagined.perf.status()),
    recommendations: (profileId?: string) =>
      unwrap<PerfRecommendation[]>(window.reimagined.perf.recommendations(profileId)),
    apply: (payload: { id: string; profileId?: string }) =>
      unwrap<{ ok: boolean; message: string }>(window.reimagined.perf.apply(payload)),
    mods: (profileId: string) =>
      unwrap<{ profileId: string; mods: PerfModOption[] }>(window.reimagined.perf.mods(profileId)),
    installMod: (profileId: string, slug: string) =>
      unwrap<boolean>(window.reimagined.perf.installMod(profileId, slug)),
    removeMod: (profileId: string, slug: string) =>
      unwrap<boolean>(window.reimagined.perf.removeMod(profileId, slug))
  },

  /** Shader Guard — real GPU/driver assessment + manual disable (anti-crash). */
  shaders: {
    support: (profileId?: string) =>
      unwrap<ShaderSupport & { recentCrashes?: { profileId: string; profileName: string; cause: string; at: string; shaderPack?: string }[] }>(
        window.reimagined.shaders.support(profileId)
      ),
    disable: (profileId: string) => unwrap<boolean>(window.reimagined.shaders.disable(profileId))
  },

  /** Reimagined FPS Boost — manual install/remove (V2), version-gated. */
  fpsboost: {
    status: (profileId: string) =>
      unwrap<{ installed: boolean; compatible: boolean; version: string | null; mcVersion: string }>(
        window.reimagined.fpsboost.status(profileId)
      ),
    install: (profileId: string) =>
      unwrap<{ installed: boolean; version: string; message: string }>(window.reimagined.fpsboost.install(profileId)),
    remove: (profileId: string) =>
      unwrap<{ removed: boolean; message: string }>(window.reimagined.fpsboost.remove(profileId))
  },
  
  future: {
    modpackExport: (profileId: string) => unwrap<never>(window.reimagined.future.modpackExport(profileId)),
    modpackImport: (zipPath: string) => unwrap<never>(window.reimagined.future.modpackImport(zipPath)),
    cloudSync: () => unwrap<never>(window.reimagined.future.cloudSync())
  },

  /** Profile share / import (Part 1/2). */
  share: {
    prepare: (profileId: string) => unwrap<ShareSnapshot>(window.reimagined.share.prepare(profileId)),
    create: (profileId: string) =>
      unwrap<{ code: string; portable: string; expiresAt: string; snapshot: ShareSnapshot; serverPublished?: boolean }>(
        window.reimagined.share.create(profileId)
      ),
    resolve: (code: string) => unwrap<ShareSnapshot>(window.reimagined.share.resolve(code)),
    importCode: (code: string, exclude?: string[]) =>
      unwrap<{ profileId: string; name: string; skipped: string[] }>(window.reimagined.share.importCode(code, exclude)),
    exportZip: (profileId: string, folders?: string[]) =>
      unwrap<{ canceled: true } | { canceled: false; path: string; name: string }>(
        window.reimagined.share.exportZip(profileId, folders)
      ),
    readZip: (zipPath: string) => unwrap<ShareSnapshot>(window.reimagined.share.readZip(zipPath)),
    importZip: (zipPath: string, exclude?: string[]) =>
      unwrap<{ profileId: string; name: string; skipped: string[] }>(window.reimagined.share.importZip(zipPath, exclude)),
    cancelImport: () => unwrap<void>(window.reimagined.share.cancelImport()),
    pendingCode: () => unwrap<string | null>(window.reimagined.share.pendingCode()),
    pickZip: () => unwrap<string | null>(window.reimagined.share.pickZip()),
    folderSizes: (profileId: string) =>
      unwrap<Record<string, number>>(window.reimagined.share.folderSizes(profileId))
  },

  /** v1.0.87 — local background music library. */
  music: {
    list: () => unwrap<{ id: string; name: string; size: number; addedAt: string }[]>(window.reimagined.music.list()),
    add: () => unwrap<{ id: string; name: string; size: number; addedAt: string }[]>(window.reimagined.music.add()),
    remove: (id: string) => unwrap<{ id: string; name: string; size: number; addedAt: string }[]>(window.reimagined.music.remove(id))
  },


  authors: {
    get: (provider: 'modrinth' | 'curseforge', username: string) =>
      unwrap<AuthorProfile>(window.reimagined.authors.get(provider, username)),
    projects: (provider: 'modrinth' | 'curseforge', username: string, projectType?: string) =>
      unwrap<AuthorProject[]>(window.reimagined.authors.projects(provider, username, projectType))
  },
  yt: {
    avatar: (channelUrl: string) => unwrap<string | null>(window.reimagined.yt.avatar(channelUrl))
  },
  onEvent: (cb: (e: AppEvent) => void) => window.reimagined.onEvent(cb),
  onMaximized: (cb: (v: boolean) => void) => window.reimagined.onMaximized(cb)
}

/** Initial state the detached console window asks for when it opens. */
export interface ConsoleState {
  running: boolean
  handle: LaunchHandle
  progress: { stage: string; message: string; percent: number | null } | null
  logs: { at: string; stream: 'stdout' | 'stderr' | 'system'; text: string }[]
  /** Epoch ms of the Play click (for the "Open for …" chronometer). */
  launchStartedAt?: number
  /** Epoch ms the game window was confirmed open (real signal). */
  windowOpenedAt?: number
}

/**
 * v1.0.52 — final guard: a raw HTTP response body (especially the HTML error
 * pages some APIs return on 429/5xx) must NEVER reach the user. Every message
 * is scrubbed here, on top of the clean errors the main process now produces.
 */
function scrubMessage(m: string): string {
  if (!m) return 'Something went wrong — try again.'
  // Raw HTML/XML error pages (doctype/html/body/head tags) → generic message.
  if (/<\s*(!doctype|html|body|head|script)/i.test(m) || (m.includes('<!') && m.length > 140)) {
    return 'The server returned an unexpected response. Try again in a moment.'
  }
  // Rate limiting → a helpful hint instead of a raw dump. Any bare 429
  // counts — the clean http.ts message is "…failed with HTTP 429." which
  // carries no other keyword, so this must not require one.
  if (/HTTP 429|Too Many Requests/i.test(m)) {
    return 'The service is rate-limiting requests right now. Try again in a moment.'
  }
  return m.length > 300 ? `${m.slice(0, 300)}…` : m
}

/** Convenience: turn any error into a friendly message. */
export function friendlyError(err: unknown): string {
  if (err instanceof ApiError) {
    return scrubMessage(err.hint ? `${err.message} ${err.hint}` : err.message)
  }
  return scrubMessage(err instanceof Error ? err.message : String(err))
}
