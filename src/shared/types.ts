/**
 * Shared domain types used across main, preload and renderer.
 * Keeping these in one place guarantees the IPC contract stays in sync.
 */

/* ---------------------------------- Settings --------------------------------- */

export type ThemeId = 'night' | 'amethyst' | 'obsidian'

export interface LauncherSettings {
  /** Default RAM allocation in MB applied to new profiles. */
  memory: number
  /** Absolute path to java.exe. Empty = auto-detect. */
  javaPath: string
  /** UI theme identifier. */
  theme: ThemeId
  /** Minimum log level persisted to disk. */
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  /** Number of days log files are kept before cleanup. */
  keepLogDays: number
  /** Microsoft Entra application (client) ID used for device-code auth. */
  microsoftClientId: string
  /** Close the launcher window when a game starts. */
  closeOnLaunch: boolean
  /** Open the console view automatically when launching. */
  showConsoleOnLaunch: boolean
  /** Show snapshots and beta versions in version picker. */
  showSnapshots: boolean
  /** Low-cost rendering: static 2D previews instead of animated 3D. */
  performanceMode: boolean
  /** Hardware-aware preset: how aggressively native optimizations apply. */
  preset: 'potato' | 'balanced' | 'high'
  /** RPE: auto-tune the preset to the detected hardware. */
  perfAutoTune: boolean
  /** RPE: 'auto' = engine-chosen tier, otherwise a manual override. */
  perfTier: 'auto' | 'potato' | 'balanced' | 'high'
  /** Recently performed activities shown on the Home page. */
  recentActivity: RecentActivity[]

  /* ------------------------------- Audio ------------------------------- */

  /** Master toggle for all UI sounds. */
  audioEnabled: boolean
  /** Master UI sound volume, 0..1. */
  audioVolume: number
  audioHover: boolean
  audioClick: boolean
  audioNotify: boolean
  audioDownload: boolean
  audioSuccess: boolean
  audioError: boolean
  /** Menu music — OFF by default; enabled from Settings. */
  audioMusic: boolean
  /** Which sound pack the premium library uses. */
  audioPack: 'aurora' | 'crystal' | 'zen'

  /* ------------------------------ Updates ------------------------------ */

  /** Check for new releases automatically on startup (official repo only). */
  autoCheckUpdates: boolean
}

export interface RecentActivity {
  type: 'auth' | 'profile_created' | 'profile_deleted' | 'launch' | 'mods' | 'system'
  label: string
  at: string // ISO timestamp
}

/** Live progress pushed while a profile is being created or deleted. */
export interface ProfileOpProgress {
  action: 'create' | 'delete' | 'duplicate' | 'prepare' | 'import'
  profileId: string
  name: string
  phase: string
  /** 0-100 when measurable, null while indeterminate. */
  percent: number | null
  done: boolean
}

/* ---------------------------------- Account ---------------------------------- */

export interface MicrosoftTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number // epoch ms
}

export interface AccountProfile {
  id: string // Minecraft UUID (dashed)
  name: string
  skins?: { id: string; state: string; url: string }[]
}

export interface Account {
  tokens: MicrosoftTokens
  profile: AccountProfile | null // null while Mojang profile is pending
  xboxUhs: string
  lastRefreshedAt: string
}

export type AccountStatus = 'offline' | 'online' | 'expired'

/** Account shape safe to expose to the renderer (no tokens). */
export interface AccountPublic {
  profile: AccountProfile | null
  status: AccountStatus
  lastRefreshedAt: string | null
}


/* ---------------------------------- Minecraft --------------------------------- */

export interface MinecraftVersionSummary {
  id: string
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha'
  releaseTime: string
  url: string
}

export type LoaderType = 'vanilla' | 'fabric' | 'forge'

export interface LoaderVersionInfo {
  type: LoaderType
  mcVersion: string
  version: string
  /** Human readable label, e.g. "Fabric 0.16.9" or "Forge 52.0.25". */
  label: string
}

export interface InstalledVersion {
  id: string // folder/version identifier
  mcVersion: string
  loader: LoaderType
  loaderVersion?: string
  installedAt: string
}

export type DownloadKind =
  | 'manifest'
  | 'version'
  | 'client'
  | 'libraries'
  | 'assets'
  | 'log4j'
  | 'loader'
  | 'installer'
  | 'mods'

/* ---------------------------------- Profiles --------------------------------- */

export interface ProfileMod {
  id: string // project id or slug from provider
  slug: string
  title: string
  filename: string
  versionId: string
  versionNumber: string
  downloads: number
  iconUrl?: string
  source: 'modrinth' | 'curseforge' | 'local'
  /** Project kind — mods install to mods/, packs to resourcepacks/ etc. */
  projectType?: 'mod' | 'resourcepack' | 'shader' | 'datapack' | 'modpack'
  installedAt: string
  /** Set when a newer version is available from the provider. */
  updateAvailable?: { versionId: string; versionNumber: string } | null
  /** True when the installed file was renamed to `<file>.disabled` (Part 4). */
  disabled?: boolean
}

export interface Profile {
  id: string
  name: string
  minecraftVersion: string
  loader: { type: LoaderType; version: string | null }
  memory: number
  resolution: { width: number; height: number; fullscreen: boolean }
  extraJvmArgs: string
  extraGameArgs: string
  /** Instance directory (mods, saves, config) — relative to the games root. */
  gameDir: string
  mods: ProfileMod[]
  favorite: boolean
  createdAt: string
  lastLaunched: string | null
  playtimeSeconds: number
  icon: string | null
}

/* ------------------------------ Profile share / import ------------------------------ */

/** One resolvable item in a shared profile (mod, resource pack, shader…). */
export interface ShareItem {
  id: string
  title: string
  source: 'modrinth' | 'curseforge' | 'local'
  projectType?: 'mod' | 'resourcepack' | 'shader' | 'datapack' | 'modpack'
  versionId?: string
  versionNumber?: string
  disabled?: boolean
}

/** Portable, immutable description of a profile's setup (Part 1/2). */
export interface ShareSnapshot {
  /** Manifest schema marker — validates genuine Reimagined exports. */
  schema: 'reimagined-profile'
  formatVersion: number
  name: string
  minecraftVersion: string
  loader: { type: LoaderType; version: string | null }
  memory: number
  resolution: { width: number; height: number; fullscreen: boolean }
  items: ShareItem[]
  createdAt: string
  /** Present only for online codes. */
  code?: string
  expiresAt?: string
  profileId?: string
}

/* ------------------------------ Project detail page ------------------------------ */

export interface ProjectVersionInfo {
  id: string
  versionNumber: string
  datePublished: string
  gameVersions: string[]
  loaders: string[]
  filename?: string
  size?: number
  changelog?: string
  /** Direct download URL for this version when the source exposes one. */
  fileUrl?: string
}

/** Whether a side (client/server) is required, optional or unsupported. */
export type ProjectSide = 'required' | 'optional' | 'unsupported'

/** Full project data for the shared detail page (Part 5). */
export interface ProjectDetail {
  provider: 'modrinth' | 'curseforge'
  projectId: string
  slug: string
  title: string
  author: string
  iconUrl?: string
  /** Full body — markdown for Modrinth, HTML for CurseForge. */
  description: string
  descriptionFormat: 'markdown' | 'html' | 'text'
  downloads: number
  followers: number
  categories: string[]
  updatedAt: string
  gallery: { url: string; title?: string }[]
  versions: ProjectVersionInfo[]
  url: string
  /** Client/server compatibility (Modrinth only — CurseForge has no equivalent). */
  clientSide?: ProjectSide
  serverSide?: ProjectSide
}

/* ---------------------------------- Mods (Modrinth) --------------------------------- */

export interface ModrinthSearchResult {
  projectId: string
  slug: string
  title: string
  description: string
  iconUrl?: string
  downloads: number
  followCount: number
  categories: string[]
  versions: string[] // supported MC versions
  latestVersion: string
  /** Uploader / author name when the source provides it. */
  author?: string
}

/** One page of search results (Modrinth search pagination). */
export interface SearchPage<T> {
  items: T[]
  totalHits: number
}

/* ------------------------------ Updates ------------------------------ */

/** Result of a GitHub release check. */
export interface UpdateInfo {
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string
  /** Release notes / body (may be markdown). */
  notes?: string
  /** GitHub release page URL. */
  url?: string
  /** Direct asset download URL (prefers a .zip). */
  assetUrl?: string
  assetName?: string
  /** Publish date of the latest release. */
  publishedAt?: string
}

export interface ModrinthFile {
  filename: string
  url: string
  size: number
}

export interface ModrinthVersion {
  id: string
  versionNumber: string
  gameVersions: string[]
  loaders: string[]
  files: ModrinthFile[]
  datePublished: string
}


/* ---------------------------------- Launch --------------------------------- */

export type LaunchStage =
  | 'preparing'
  | 'resolving'
  | 'downloading'
  | 'installing-loader'
  | 'launching'
  | 'running'
  | 'stopped'

export interface LaunchProgress {
  stage: LaunchStage
  message: string
  /** 0-100 overall progress when downloading, else null. */
  percent?: number | null
  detail?: string
}

export interface LaunchLogLine {
  at: string
  stream: 'stdout' | 'stderr' | 'system'
  text: string
}

export interface LaunchHandle {
  profileId: string
  running: boolean
  pid?: number
  startedAt?: string
}

/* ---------------------------------- Java --------------------------------- */

export interface JavaRuntime {
  path: string // path to java.exe
  major: number
  vendor?: string
  version: string
}

/* ------------------------------ Performance Engine (RPE) ------------------------------ */

export type PerfTier = 'potato' | 'balanced' | 'high'

/** Full snapshot of the user's machine, detected by the RPE. */
export interface HardwareProfile {
  detectedAt: string
  cpu: { model: string; cores: number; threads: number; speedGHz: number; cache: string }
  gpu: { name: string; vendor: string; vramGB: number; integrated: boolean }[]
  memory: { totalGB: number; speedMHz: number | null }
  storage: { type: string; totalGB: number }
  os: string
  display: { resolution: string; refreshHz: number | null }
  java: { major: number; version: string } | null
  laptop: boolean
}

/** One measured play session recorded by the profiler. */
export interface PerfSessionMetrics {
  at: string
  profileId: string
  profileName: string
  avgFps: number
  lowFps: number
  heapMB: number
  frames: number
  durationSec: number
}

/** A user-facing, actionable suggestion from the RPE. */
export interface PerfRecommendation {
  id: string
  title: string
  detail: string
  category: 'graphics' | 'memory' | 'java' | 'mods' | 'system'
  applyLabel: string
  /** Optional context the apply handler needs (e.g. which profile). */
  profileId?: string
  projectId?: string
}

/** A trusted performance mod offered for one-click install (user chooses). */
export interface PerfModOption {
  slug: string
  projectId: string
  title: string
  iconUrl?: string
  downloads: number
  note: string
  installed: boolean
  versionNumber: string | null
  compatible: boolean
}

/** Everything the UI needs about the engine's state. */
export interface PerfStatus {
  hardware: HardwareProfile | null
  tier: PerfTier
  tierSource: 'auto' | 'manual'
  tierReasons: string[]
  recommendedMemoryMB: number
  sessions: PerfSessionMetrics[]
  /** Learned per-machine tuning values (self-learning). */
  tuning: Record<string, number>
  /** The FPS Boost config the engine seeds for the current tier. */
  fpsConfig: Record<string, unknown>
}

/* ---------------------------------- Misc --------------------------------- */

export interface AppInfo {
  version: string
  platform: NodeJS.Platform
  isDev: boolean
  dataRoot: string
}
