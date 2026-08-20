/**
 * Shared domain types used across main, preload and renderer.
 * Keeping these in one place guarantees the IPC contract stays in sync.
 */

/* ---------------------------------- Settings --------------------------------- */

export type ThemeId = 'night' | 'amethyst' | 'obsidian'

export type AppLanguage = 'en' | 'es' | 'fr'

/** A saved Minecraft server favorite (v1.0.88). */
export interface ServerFavorite {
  id: string
  name: string
  address: string
  addedAt: string
}

/** Server directory category (v1.0.89). */
export type ServerCategory =
  | 'Minigames'
  | 'Survival'
  | 'Skyblock'
  | 'Anarchy'
  | 'MMORPG'
  | 'Creative'
  | 'Prison'

/** A server in the curated directory (v1.0.89). */
export interface DirectoryServer {
  id: string
  name: string
  address: string
  category: ServerCategory
  description: string
  tags: string[]
}

/** Result of installing a server into an instance's servers.dat (v1.0.89). */
export interface InstallServerResult {
  installed: number
  total: number
  gameDir: string
}

/** A server the user joined recently (v1.0.88). */
export interface RecentServer {
  address: string
  name: string
  at: string
}

/** A keybinding read from an instance's options.txt (v2.1.0). */
export interface KeybindEntry {
  /** Content after the `key_` prefix — e.g. `key.forward` or `xaero_minimap.open_map`. */
  key: string
  /** Human-readable name (from the game/mod lang files, fallback prettified). */
  label: string
  /** Category label (Movement / Gameplay / … or the mod's own category). */
  category: string
  /** Raw bound value from options.txt — e.g. `key.keyboard.w` or `key.keyboard.unknown`. */
  raw: string
  /** Human-readable bound key label — e.g. `W`, `Left Shift`, `Unbound`. */
  bound: string
}

/** Live status of a server (v1.0.88) — from the modern server-list protocol. */
export interface ServerStatus {
  address: string
  online: boolean
  latencyMs: number | null
  motd?: string
  players?: { online: number; max: number }
  version?: string
  /** v2.0.0 — real server icon (data:image/png;base64 favicon), when the server provides one. */
  icon?: string
}

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
  preset: 'potato' | 'balanced' | 'high' | 'turbo'
  /** RPE: auto-tune the preset to the detected hardware. */
  perfAutoTune: boolean
  /** RPE: 'auto' = engine-chosen tier, otherwise a manual override. */
  perfTier: 'auto' | 'potato' | 'balanced' | 'high' | 'turbo'

  /* --------------------------- Shader / crash safety --------------------------- */

  /** Automatically lower render distance when shaders are enabled on low VRAM. */
  shaderAutoReduceRd: boolean
  /** After a shader crash, launch the next session with shaders disabled. */
  autoDisableShadersOnCrash: boolean
  /**
   * Opt-in unlimited frame rate (v1.0.13 safety: OFF by default). When ON the
   * engine's safe default FPS cap is removed — drives the GPU harder and can
   * trigger thermal/power shutdown on some hardware; clearly warned in UI.
   */
  unlimitedFps: boolean
  /** v1.0.43 — force VSync off in options.txt on launch (uncaps 60 Hz panels). */
  forceVsyncOff: boolean
  /** Recently performed activities shown on the Home page. */
  recentActivity: RecentActivity[]

  /* --------------------------- Extended View (v1.0.29) --------------------------- */

  /** v1.0.36 — startup experience toggles (Change 3a). */
  startupAnimation: boolean
  startupSound: boolean
  /** v1.0.36 — CurseForge is served by the user's own backend proxy (Change 5).
   *  The API key never lives in the launcher; paste the proxy base URL here. */
  curseforgeProxyUrl: string

  /* --------------------------- Async chunk decode (v1.0.30) --------------------------- */

  /** Decode incoming server chunk packets off the game thread (bounded,
   *  relevance-ordered, applied nearest-first — never blocks the tick). */
  asyncChunkDecode: boolean

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

  /* --------------------- Music library (v1.0.85) --------------------- */

  /** Track file names (relative ids) in the local music library. */
  audioMusicFiles: string[]
  /** Background music volume, 0..1 (defaults quiet). */
  audioMusicVolume: number
  /** Shuffle the local playlist. */
  audioMusicShuffle: boolean
  /** Repeat mode for the local playlist. */
  audioMusicRepeat: 'off' | 'all' | 'one'
  /** App language (v1.0.88) — English default, Spanish / French available. */
  language: AppLanguage
  /** Discord Rich Presence toggle (v1.0.88) — default ON. */
  discordPresence: boolean
  /** Discord Application client id used for Rich Presence (empty = no status). */
  discordClientId: string
  /**
   * v1.0.92 — storage analyzer: whether the cleanup pass re-verifies every
   * selected file (hash + still-present + not-referenced) immediately
   * before deleting. Default ON — only OFF for expert users.
   */
  cleanupSafetyRecheck: boolean
  /** Accessibility: UI font scale factor (1 | 1.15 | 1.3). */
  accessFontScale: number
  /** Accessibility: high-contrast mode (v1.0.88). */
  accessHighContrast: boolean
  /** Accessibility: colorblind-friendly mode — statuses pair color + shape. */
  accessColorblind: boolean
  /** Streaming/recording awareness (v1.0.88) — default ON. */
  streamingAware: boolean
  /** Stutter Guard (v1.0.98) — caps FPS at 120 on weak tiers to stop GC/thermal freezes. */
  stutterGuard: boolean
  /** Saved server favorites (v1.0.88). */
  servers: ServerFavorite[]
  /** Recently played servers (v1.0.88), newest first. */
  recentServers: RecentServer[]

  /* ------------------------------ Updates ------------------------------ */

  /** Check for new releases automatically on startup (official repo only). */
  autoCheckUpdates: boolean
  /** How often (seconds) the launcher re-checks GitHub while it is open. */
  updateCheckIntervalSec: number

  /* ------------------------------ Downloads ------------------------------ */

  /**
   * How many install/download operations may run AT THE SAME TIME (V2
   * queue). 1 (default) = strict queue, one install at a time; 3 and 5 allow
   * parallel installs for fast connections. Real installs queue behind this.
   */
  downloadConcurrency: 1 | 3 | 5
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
  /**
   * v1.0.92 — human-readable instance folder name (e.g. "My Survival"),
   * sanitized for Windows. The physical instance lives at
   * data/Instances/<folder>. Absent for legacy profiles until the safe
   * startup migration moves them from data/games/<gameDir>.
   */
  folder?: string
  mods: ProfileMod[]
  favorite: boolean
  createdAt: string
  lastLaunched: string | null
  playtimeSeconds: number
  icon: string | null
  /** User explicitly removed the bundled FPS Boost (V2) — auto-ensure skips it
   * until they click "Install FPS Booster" again. */
  fpsBoostOptOut?: boolean
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
  /** Optional artwork for the import preview (http(s) or data: only). */
  iconUrl?: string
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
  /**
   * v1.0.81 — instance folders bundled as REAL FILES in a .zip export
   * (mods, resourcepacks, shaderpacks, datapacks, saves, config, …). Codes
   * never set this — they re-resolve from source. Import restores these
   * folders from the archive instead of re-downloading.
   */
  folders?: string[]
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
  /** Real dependency declarations for this version (Modrinth exposes these). */
  dependencies?: ProjectDependency[]
}

/** One dependency a version declares on its provider (Modrinth). */
export interface ProjectDependency {
  /** Provider project id of the dependency. */
  projectId: string
  /** Exact version id when the parent pins one, else resolve the newest compatible. */
  versionId?: string
  dependencyType: 'required' | 'optional' | 'incompatible'
  fileName?: string
}

/** Resolved dependency info shown in the install confirmation dialog. */
export interface InstallDepInfo {
  projectId: string
  title: string
  slug: string
  iconUrl?: string
  dependencyType: 'required' | 'optional' | 'incompatible'
  /** Version resolved for this profile (null when no compatible version exists). */
  versionId: string | null
  versionNumber: string | null
  /** True when already present in this profile (never reinstalled). */
  installed: boolean
  /** Nested dependencies of this dependency (resolved recursively, deduped). */
  children?: InstallDepInfo[]
}

/** Result of an "install with dependencies" operation. */
export interface InstallWithDepsResult {
  /** The main item's installed profile entry. */
  mod: ProfileMod
  /** Titles of everything installed (item + dependencies). */
  installed: string[]
  /** Titles of dependencies that could not be restored (with reason). */
  skipped: string[]
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
  /* v1.0.54 — `raw` is the provider's highest-resolution source when one
   * exists (Modrinth original), used for the hero and lightbox so zooming
   * reveals real detail instead of stretching an optimised image. */
  gallery: { url: string; raw?: string; title?: string }[]
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
  /** SHA-256 of the asset file, when the manifest declares one. */
  sha256?: string
  /** Publish date of the latest release. */
  publishedAt?: string
}

/* ---------------------------- Crash Assistant ---------------------------- */

/** A game crash report detected after a launch (Crash Assistant). */
export interface CrashReport {
  profileId: string
  profileName: string
  /** Crash report file name inside the instance's crash-reports folder. */
  file: string
  /** Short human headline of the cause. */
  cause: string
  /** Raw crash report excerpt (trimmed, safe to display). */
  snippet: string
  /** Concrete, actionable suggestions. */
  suggestions: string[]
  at: string
  /* ---- V2 structured analysis (evidence-based, never invented) ---- */
  /** The actual exception type + first message (e.g. "NullPointerException: …"). */
  exception?: string
  /** The "Caused by:" chain line if the report has one. */
  causedBy?: string
  /** Top of the stack trace (first 4 frames) — what was running when it died. */
  stackTop?: string[]
  /** Non-vanilla classes in the stack, mapped to short mod-ish names. */
  responsibleMods?: string[]
  /** How sure the analysis is: high = clear exception + mod frames, low = generic. */
  confidence?: 'high' | 'medium' | 'low'
  /** Tail of the game's latest.log before the crash (context). */
  logTail?: string[]
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
  /** Populated by the /version_file/{hash} lookup (v1.0.26). */
  projectId?: string
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

export type PerfTier = 'potato' | 'balanced' | 'high' | 'turbo'

/** Full snapshot of the user's machine, detected by the RPE. */
export interface HardwareProfile {
  detectedAt: string
  cpu: { model: string; cores: number; threads: number; speedGHz: number; cache: string }
  gpu: { name: string; vendor: string; vramGB: number; integrated: boolean; driverVersion?: string }[]
  memory: { totalGB: number; speedMHz: number | null }
  storage: { type: string; totalGB: number; freeGB?: number; usedGB?: number; drive?: string }
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
  /** v1.0.15 in-game profiler (PROF lines) — real frame-time statistics. */
  p1Fps?: number
  p01Fps?: number
  maxFrameMs?: number
  avgTickMs?: number
  gcMs?: number
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

/* ---------------------------- Shader / crash safety ---------------------------- */

/** Real GPU/driver assessment for the shader rendering path. */
export interface ShaderSupport {
  /** ok = safe to enable, limited = works but risky (low VRAM / old driver), unsupported = do not enable. */
  level: 'ok' | 'limited' | 'unsupported'
  /** Human-readable reasons for the verdict (shown to the user). */
  reasons: string[]
  vramGB: number
  driverVersion: string | null
  /** True when a shader crash was detected on the previous session. */
  recoveryPending: boolean
}

/** A shader-related crash recorded by the crash assistant (auto-recovery input). */
export interface ShaderCrashRecord {
  profileId: string
  profileName: string
  cause: string
  /** The shader pack that was ACTIVE at crash time (folder name) — v1.0.63. */
  shaderPack?: string
  /** Crash-classification: 'fence' = Sodium shadow-pass sync bug (shadow-safe recovery), 'other' = full disable. */
  signature?: 'fence' | 'other'
  at: string
}

/* ---------------------------- Storage cleanup (v1.0.92) ---------------------------- */

export type StorageCategory = 'cache' | 'temporary' | 'duplicates' | 'updates' | 'orphaned' | 'backups'

/** One item the Clear Up Space scanner classified as potentially removable. */
export interface StorageItem {
  id: string
  path: string
  sizeBytes: number
  category: StorageCategory
  /** 0-100. >=90 = auto-selected. */
  confidence: number
  label: string
  detail: string
  autoSelected: boolean
}

export interface StorageBreakdown {
  label: string
  bytes: number
}

export interface StorageScanResult {
  items: StorageItem[]
  recoverableBytes: number
  breakdown: StorageBreakdown[]
  scannedFiles: number
  ranAt: string
}

export interface StorageCleanResult {
  freedBytes: number
  removed: number
  skipped: { path: string; reason: string }[]
}

/** v1.0.92 — Run a FPS Test: live status of the benchmark run. */
export interface FpsTestStatus {
  profileId: string
  profileName: string
  startedAt: number
  stage: 'world' | 'launching' | 'running' | 'finished' | 'failed'
  message: string
  currentTest: string
  progress: number
  lowestFps: number | null
  resultPath: string | null
  error: string | null
}

/* ---------------------------------- Misc --------------------------------- */

export interface AppInfo {
  version: string
  platform: NodeJS.Platform
  isDev: boolean
  dataRoot: string
}

/* ---------------------------------- Authors (v1.0.86) --------------------------------- */

export interface AuthorProfile {
  provider: 'modrinth' | 'curseforge'
  id: string
  username: string
  name: string
  avatarUrl: string | null
  bio: string | null
  role: string | null
  createdAt: string | null
  /** CurseForge v1 exposes no author profile — the page shows what we have. */
  limited?: boolean
}

export interface AuthorProject {
  provider: 'modrinth' | 'curseforge'
  projectId: string
  slug: string
  title: string
  author: string
  iconUrl: string | null
  description: string
  downloads: number
  followers: number
  categories: string[]
  gameVersions: string[]
  projectType: string
  updatedAt: string
}
