/**
 * Modrinth API v2 client.
 *
 * The Modrinth API is open and free — no key required — so the mod search,
 * install and update pipeline is fully functional in this foundation.
 * CurseForge (which needs an API key) lives in `placeholders.ts`.
 */
import { getJson } from '../utils/http'
import { logger } from '../logs/logger'
import type { ModrinthSearchResult, ModrinthVersion, LoaderType, ProjectDetail, ProjectVersionInfo } from '@shared/types'

const API = 'https://api.modrinth.com/v2'
const USER_AGENT = 'ReimaginedLauncher/1.0.0 (Minecraft launcher)'

function headers(): Record<string, string> {
  return { 'User-Agent': USER_AGENT }
}

/* v1.0.52 — global request pacing for the Modrinth API. The public API
 * throttles bursts (HTTP 429), and the launcher naturally fires many
 * lookups at once (per-row version checks on the Installed tab, the enrich
 * pass, browse pages). A small semaphore + a minimum gap between requests
 * keeps normal use comfortably under the limit, so the user never sees a
 * rate-limit error. This is a hard cap for ALL Modrinth traffic. */
const RATE_MAX_INFLIGHT = 2
const RATE_GAP_MS = 40
let rateInflight = 0
let rateWaiters: (() => void)[] = []
let rateLastStart = 0

async function acquireRateSlot(): Promise<void> {
  if (rateInflight >= RATE_MAX_INFLIGHT) {
    await new Promise<void>((resolve) => rateWaiters.push(resolve))
  }
  rateInflight++
  const wait = Math.max(0, rateLastStart + RATE_GAP_MS - Date.now())
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  rateLastStart = Date.now()
}

function releaseRateSlot(): void {
  rateInflight--
  rateWaiters.shift()?.()
}

/** Run a Modrinth request through the global pace limiter. */
function apiGet<T>(url: string, opts: { headers?: Record<string, string>; timeoutMs?: number } = {}): Promise<T> {
  return (async () => {
    await acquireRateSlot()
    try {
      // NOTE: this must call getJson directly — a blanket getJson< → apiGet<
      // replace once turned this into infinite recursion (the v1.0.52 deadlock
      // that froze every Modrinth request in the smoke test).
      return await getJson<T>(url, opts)
    } finally {
      releaseRateSlot()
    }
  })()
}

export type ProjectType = 'mod' | 'resourcepack' | 'shader' | 'datapack' | 'modpack'

export interface SearchOptions {
  query: string
  mcVersion?: string
  loader?: LoaderType
  projectType?: ProjectType
  /** Server-side category facet (e.g. "performance", "utility"). */
  category?: string
  limit?: number
  /** Offset for pagination (infinite scroll). */
  offset?: number
  /** Sort index: relevance | downloads | follows | newest | updated */
  index?: string
}

interface SearchResponse {
  total_hits: number
  hits: {
    project_id: string
    slug: string
    title: string
    description: string
    icon_url?: string
    downloads: number
    follows: number
    categories: string[]
    versions: string[]
    latest_version: string
    author?: string
  }[]
}

/** One search page: the hits plus the server's total hit count (pagination). */
export async function searchMods(opts: SearchOptions): Promise<{ items: ModrinthSearchResult[]; totalHits: number }> {
  const projectType = opts.projectType ?? 'mod'
  const facets: string[][] = [[`project_type:${projectType}`]]
  if (opts.mcVersion) facets.push([`versions:${opts.mcVersion}`])
  // Loader filters apply to mods AND modpacks (both are loader-scoped);
  // resource packs/shaders use vanilla or renderer loaders and would be
  // wrongly excluded otherwise.
  if ((projectType === 'mod' || projectType === 'modpack') && opts.loader && opts.loader !== 'vanilla') {
    facets.push([`categories:${opts.loader}`])
  }
  if (opts.category) facets.push([`categories:${opts.category}`])

  const params = new URLSearchParams({
    query: opts.query || '',
    facets: JSON.stringify(facets),
    limit: String(opts.limit ?? 24),
    index: opts.index ?? 'relevance'
  })
  if (opts.offset) params.set('offset', String(opts.offset))

  try {
    const res = await apiGet<SearchResponse>(`${API}/search?${params.toString()}`, {
      headers: headers(),
      timeoutMs: 15_000
    })
    return {
      items: res.hits.map((h) => ({
        projectId: h.project_id,
        slug: h.slug,
        title: h.title,
        description: h.description,
        iconUrl: h.icon_url,
        downloads: h.downloads,
        followCount: h.follows,
        categories: h.categories,
        versions: h.versions,
        latestVersion: h.latest_version,
        author: h.author
      })),
      totalHits: res.total_hits ?? 0
    }
  } catch (err) {
    logger.warn(`Modrinth search failed: ${(err as Error).message}`)
    throw err
  }
}

interface ProjectResponse {
  id: string
  slug: string
  title: string
  icon_url?: string
  downloads: number
}

export async function getProject(projectId: string): Promise<ProjectResponse> {
  return apiGet<ProjectResponse>(`${API}/project/${projectId}`, { headers: headers(), timeoutMs: 15_000 })
}

/**
 * v1.0.26 — identify an unknown local file by its exact SHA1 hash.
 *
 * Modrinth's /version_file/{hash}?algorithm=sha1 endpoint returns the exact
 * version that ships that file — the same approach real launchers use to
 * recognize manually-dropped mods. Returns null when no version carries that
 * hash (404 or any failure): a private/uncommon mod is simply not on Modrinth.
 */
export async function lookupVersionByHash(sha1: string): Promise<{ projectId: string; version: ModrinthVersion } | null> {
  if (!/^[0-9a-f]{40}$/i.test(sha1)) return null
  try {
    const version = await apiGet<RawModrinthVersion>(
      `${API}/version_file/${encodeURIComponent(sha1)}?algorithm=sha1`,
      { headers: headers(), timeoutMs: 15_000 }
    )
    const projectId = version.project_id
    if (!projectId) return null
    return { projectId, version: toModrinthVersion(version) }
  } catch {
    return null
  }
}

interface TagResponse {
  name: string
  header: string
  icon?: string
}

/** Real category list from the Modrinth tags API (mods only). */
export async function getCategories(projectType: ProjectType = 'mod'): Promise<string[]> {
  const tags = await apiGet<TagResponse[]>(`${API}/tag/category?project_type=${projectType}`, {
    headers: headers(),
    timeoutMs: 15_000
  })
  return tags.map((t) => t.name).filter(Boolean)
}


/** Raw Modrinth version payload (snake_case) before normalization. */
interface RawModrinthVersion {
  id: string
  version_number: string
  game_versions: string[]
  loaders: string[]
  files?: { filename: string; url: string; size: number }[]
  date_published: string
  project_id?: string
}

/** Normalize a raw API version into the camelCase ModrinthVersion shape. The
 *  raw payload uses snake_case (version_number), so callers can rely on
 *  version.versionNumber instead of silently getting undefined. */
function toModrinthVersion(v: RawModrinthVersion): ModrinthVersion {
  return {
    id: v.id,
    versionNumber: v.version_number ?? '',
    gameVersions: v.game_versions ?? [],
    loaders: v.loaders ?? [],
    files: (v.files ?? []).map((f) => ({ filename: f.filename, url: f.url, size: f.size ?? 0 })),
    datePublished: v.date_published ?? '',
    projectId: v.project_id
  }
}

/**
 * Latest version of a project matching a Minecraft version + loader.
 * Returns null when no compatible version exists.
 *
 * For non-mod project types (resource packs, shaders, datapacks) the loader
 * facet is relaxed so vanilla/iris/optifine-hosted packs are found.
 */
export async function latestVersionFor(
  projectId: string,
  mcVersion: string,
  loader: LoaderType,
  projectType: ProjectType = 'mod'
): Promise<ModrinthVersion | null> {
  const loaders =
    projectType === 'mod'
      ? [loader === 'vanilla' ? 'minecraft' : loader]
      : ['minecraft', 'vanilla', loader === 'vanilla' ? 'minecraft' : loader]

  const params = new URLSearchParams({
    game_versions: JSON.stringify([mcVersion]),
    loaders: JSON.stringify(loaders)
  })
  const versions = await apiGet<RawModrinthVersion[]>(`${API}/project/${projectId}/version?${params.toString()}`, {
    headers: headers(),
    timeoutMs: 15_000
  })
  if (versions.length > 0) return toModrinthVersion(versions[0])
  // Fallback: any version matching the MC version regardless of loader.
  const relaxed = await apiGet<RawModrinthVersion[]>(
    `${API}/project/${projectId}/version?game_versions=${encodeURIComponent(JSON.stringify([mcVersion]))}`,
    { headers: headers(), timeoutMs: 15_000 }
  )
  return relaxed[0] ? toModrinthVersion(relaxed[0]) : null
}

interface FullProjectResponse {
  id: string
  slug: string
  title: string
  description: string
  body?: string
  icon_url?: string
  downloads: number
  followers: number
  categories: string[]
  gallery?: { url: string; raw?: string; title?: string; description?: string }[]
  date_modified?: string
  project_type?: string
  client_side?: 'required' | 'optional' | 'unsupported'
  server_side?: 'required' | 'optional' | 'unsupported'
}

/** Full project info for the shared detail page (body, gallery, stats). */
/* v1.0.82 — 15-min in-memory detail/version caches. The detail page (and the
 * per-instance version resolution) re-opens the same project repeatedly in a
 * session; Modrinth throttles bursts (HTTP 429), so caching keeps previews
 * instant and the API quiet. */
const fullProjectCache = new Map<string, { at: number; data: FullProjectResponse }>()
const versionsListCache = new Map<string, { at: number; data: ProjectVersionInfo[] }>()
const CACHE_TTL = 15 * 60_000

export async function getProjectFull(projectId: string, projectType: ProjectType = 'mod'): Promise<ProjectDetail> {
  const cached = fullProjectCache.get(projectId)
  let project: FullProjectResponse
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    project = cached.data
  } else {
    project = await apiGet<FullProjectResponse>(`${API}/project/${projectId}`, {
      headers: headers(),
      timeoutMs: 15_000
    })
    fullProjectCache.set(projectId, { at: Date.now(), data: project })
  }

  // Author names come from the project's members endpoint.
  let author = 'Unknown'
  try {
    const members = await apiGet<{ user?: { username?: string } }[]>(`${API}/project/${projectId}/members`, {
      headers: headers(),
      timeoutMs: 10_000
    })
    const lead = members.find((m) => m?.user?.username) ?? members[0]
    if (lead?.user?.username) author = lead.user.username
  } catch {
    /* author stays Unknown */
  }

  const body = project.body || project.description || ''
  return {
    provider: 'modrinth',
    projectId: project.id,
    slug: project.slug,
    title: project.title,
    author,
    iconUrl: project.icon_url,
    description: body,
    descriptionFormat: 'markdown',
    downloads: project.downloads ?? 0,
    followers: project.followers ?? 0,
    categories: project.categories ?? [],
    updatedAt: project.date_modified ?? '',
    gallery: (project.gallery ?? [])
      .filter((g) => g?.url)
      /* v1.0.54 — keep the raw original alongside the optimised url so the
       * detail hero / lightbox can show the sharpest available source. */
      .map((g) => ({ url: g.url, raw: g.raw ?? undefined, title: g.title ?? g.description ?? undefined })),
    versions: await listVersions(projectId, projectType),
    url: `https://modrinth.com/${project.project_type ?? projectType === 'mod' ? 'mod' : projectType}/${project.slug}`,
    clientSide: project.client_side,
    serverSide: project.server_side
  }
}

/** Every version of a project, newest first, with compatibility info. */
export async function listVersions(projectId: string, _projectType: ProjectType = 'mod'): Promise<ProjectVersionInfo[]> {
  const cached = versionsListCache.get(projectId)
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.data
  const versions = await apiGet<
    {
      id: string
      version_number: string
      date_published: string
      game_versions: string[]
      loaders: string[]
      changelog?: string
      files?: { filename: string; url: string; size: number }[]
      dependencies?: {
        project_id: string
        version_id?: string | null
        dependency_type: string
        file_name?: string
      }[]
    }[]
  >(`${API}/project/${projectId}/version`, { headers: headers(), timeoutMs: 15_000 })
  const mapped = (versions ?? []).map((v) => ({
    id: v.id,
    versionNumber: v.version_number,
    datePublished: v.date_published ?? '',
    gameVersions: v.game_versions ?? [],
    loaders: v.loaders ?? [],
    filename: v.files?.[0]?.filename,
    size: v.files?.[0]?.size,
    changelog: v.changelog,
    fileUrl: v.files?.[0]?.url,
    dependencies: (v.dependencies ?? [])
      .filter((d) => d.project_id)
      .map((d) => ({
        projectId: d.project_id,
        versionId: d.version_id ?? undefined,
        dependencyType: (d.dependency_type === 'required' || d.dependency_type === 'optional' || d.dependency_type === 'incompatible'
          ? d.dependency_type
          : 'optional') as 'required' | 'optional' | 'incompatible',
        fileName: d.file_name
      }))
  }))
  versionsListCache.set(projectId, { at: Date.now(), data: mapped })
  return mapped
}

export const modrinth = { searchMods, getProject, getCategories, latestVersionFor, getProjectFull, listVersions, lookupVersionByHash }
