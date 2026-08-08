/**
 * CurseForge API v3 client.
 *
 * CurseForge requires an API key (`x-api-key` header). The launcher stays
 * fully functional without it — the Mods section just shows the setup card.
 * Once the key is configured in Settings, browsing/installing runs against
 * the real API (gameId 432 = Minecraft, classId 6 = Mods).
 *
 * Results are mapped onto the same `ModrinthSearchResult` shape the UI
 * already knows how to render, so both providers share one row component.
 */
import { settingsManager } from '../settings/settings-manager'
import { LauncherError } from '../core/errors'
import type { ModrinthSearchResult, LoaderType, ProjectDetail, ProjectVersionInfo } from '@shared/types'

const GAME_ID = 432 // Minecraft
const USER_AGENT = 'ReimaginedLauncher/1.0.0 (Minecraft launcher)'

/** CurseForge class IDs for Minecraft content types. */
const CLASS_IDS: Record<string, number> = {
  mod: 6, // Mods
  resourcepack: 12, // Resource Packs
  shader: 6552, // Shader Packs
  datapack: 6, // Data packs are filed under Mods on CurseForge
  modpack: 4471 // Modpacks
}
const MOD_CLASS_ID = CLASS_IDS.mod

/** CurseForge modLoaderType enum (subset we support). */
const MOD_LOADER: Record<string, number> = { forge: 1, fabric: 4 }

interface CfFile {
  id: number
  displayName: string
  fileName: string
  fileLength: number
  downloadUrl?: string
  fileDate?: string
  gameVersions: string[]
  modLoader?: number[]
  releaseType?: number
}

interface CfSearchHit {
  id: number
  slug: string
  name: string
  summary: string
  logo?: { url?: string }
  downloadsCount: number
  categories?: { name: string }[]
  latestFilesIndexes?: { gameVersion?: string; modLoader?: number }[]
}

interface CfProject {
  id: number
  slug: string
  name: string
  summary: string
  downloadCount: number
  logo?: { url?: string }
  screenshots?: { url: string; title?: string; description?: string }[]
  authors?: { name: string }[]
  categories?: { name: string; iconUrl?: string }[]
  dateModified?: string
  links?: { websiteUrl?: string }
}

/** Map a CurseForge modLoaderType enum back to a loader name. */
const LOADER_BY_ID: Record<number, string> = { 0: 'any', 1: 'forge', 2: 'cauldron', 3: 'liteloader', 4: 'fabric', 5: 'quilt', 6: 'neoforge' }

/** v1.0.36 — the CurseForge key lives ONLY on the user's backend proxy
 * (backend/cf-proxy). This function returns the proxy base URL, or throws a
 * clear setup error. The launcher never holds, stores, or logs an API key. */
function proxyBaseUrl(): string {
  const proxy = settingsManager.get().curseforgeProxyUrl?.trim()
  if (!proxy) {
    throw new LauncherError(
      'CF_NO_PROXY',
      'CurseForge browsing is not connected yet.',
      'Deploy the included backend proxy (backend/cf-proxy) with your CurseForge API key, then paste its URL in Settings → Advanced → CurseForge proxy URL.'
    )
  }
  return proxy.replace(/\/+$/, '')
}

async function cfGet<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
  const proxy = proxyBaseUrl()
  const qs = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') qs.set(k, String(v))
  })
  const target = `${proxy}/api/cf${path}${qs.toString() ? `?${qs.toString()}` : ''}`
  const res = await fetch(target, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(25_000)
  })
  if (!res.ok) {
    if (res.status === 502 || res.status === 504) {
      throw new LauncherError('CF_PROXY_DOWN', 'The CurseForge proxy is unreachable.', 'Check that the proxy URL in Settings → Advanced is correct and the proxy is running.')
    }
    throw new LauncherError('CF_ERROR', `CurseForge request failed (HTTP ${res.status}).`, 'Try again in a moment — if it persists, check the proxy logs.')
  }
  const body = (await res.json()) as { data?: T }
  return body.data as T
}

interface CfCategory {
  id: number
  name: string
}

/** Cached Minecraft category tree from CurseForge (10 min TTL). */
let categoriesCache: { at: number; list: CfCategory[] } | null = null

class CurseForgeClient {
  /**
   * v1.0.50 — real CurseForge category list (gameId 432 = Minecraft) for the
   * Browse sidebar. Cached 10 minutes; the proxy must expose
   * /api/cf/categories (added in the same release) — when the deployed proxy
   * is older it degrades to an empty list and the sidebar hides gracefully.
   */
  async getCategories(): Promise<{ id: number; name: string }[]> {
    if (categoriesCache && Date.now() - categoriesCache.at < 10 * 60_000) {
      return categoriesCache.list
    }
    try {
      const list = await cfGet<CfCategory[]>('/categories', { gameId: GAME_ID })
      const clean = (list ?? [])
        .filter((c) => c && typeof c.name === 'string' && c.name.trim())
        .map((c) => ({ id: c.id, name: c.name.trim() }))
      categoriesCache = { at: Date.now(), list: clean }
      return clean
    } catch {
      return []
    }
  }

  /** Best-effort name → id for the category filter (falls back to a text
   *  search filter when the categories endpoint is unavailable). */
  private async categoryIdFor(name?: string): Promise<{ id?: number; fallback?: string }> {
    if (!name) return {}
    const cats = await this.getCategories()
    const hit = cats.find((c) => c.name.toLowerCase() === name.toLowerCase())
    if (hit) return { id: hit.id }
    return { fallback: name }
  }

  /** Search the platform for a content type (mods by default). */
  async searchMods(opts: {
    query: string
    mcVersion?: string
    limit?: number
    sort?: 'downloads' | 'newest' | 'recent' | 'name'
    projectType?: string
    category?: string
    loader?: LoaderType
  }): Promise<ModrinthSearchResult[]> {
    const params: Record<string, string | number> = {
      gameId: GAME_ID,
      classId: CLASS_IDS[opts.projectType ?? 'mod'] ?? MOD_CLASS_ID,
      index: 0,
      sortField: opts.sort === 'newest' ? 1 : opts.sort === 'recent' ? 3 : opts.sort === 'name' ? 5 : 2,
      sortOrder: 'desc',
      pageSize: opts.limit ?? 24
    }
    if (opts.query.trim()) params.searchFilter = opts.query.trim()
    if (opts.mcVersion) params.gameVersion = opts.mcVersion
    // v1.0.50 — real category + loader filtering for CurseForge (same
    // semantics as Modrinth's facets): categoryId when known, else the name
    // as a text filter; modLoaderType only for mods (packs aren't loader-scoped).
    if (opts.category) {
      const c = await this.categoryIdFor(opts.category)
      if (c.id !== undefined) params.categoryId = c.id
      else if (c.fallback) params.searchFilter = `${params.searchFilter ? params.searchFilter + ' ' : ''}${c.fallback}`
    }
    if (opts.loader === 'fabric') params.modLoaderType = MOD_LOADER.fabric
    else if (opts.loader === 'forge') params.modLoaderType = MOD_LOADER.forge

    const hits = await cfGet<CfSearchHit[]>('/mods/search', params)
    return hits.map((h) => ({
      projectId: String(h.id),
      slug: h.slug,
      title: h.name,
      description: h.summary,
      iconUrl: h.logo?.url,
      downloads: h.downloadsCount,
      followCount: 0, // not exposed on search hits
      categories: (h.categories ?? []).map((c) => c.name),
      versions: (h.latestFilesIndexes ?? []).map((l) => l.gameVersion ?? '').filter(Boolean).slice(0, 12),
      latestVersion: h.latestFilesIndexes?.find((l) => l.gameVersion)?.gameVersion ?? ''
    }))
  }

  /** Full project info for the shared detail page (Part 5). */
  async getProjectFull(projectId: string, projectType?: string): Promise<ProjectDetail> {
    const p = await cfGet<CfProject>(`/mods/${projectId}`, {})
    const versionList = await this.listVersions(projectId, projectType)
    const mcPath =
      projectType === 'resourcepack'
        ? 'texture-packs'
        : projectType === 'shader'
          ? 'shaders'
          : 'mc-mods'
    return {
      provider: 'curseforge',
      projectId: String(p.id),
      slug: p.slug,
      title: p.name,
      author: p.authors?.[0]?.name ?? 'Unknown',
      iconUrl: p.logo?.url,
      // The v1 API exposes no full body — the summary is the best we have.
      description: p.summary || '',
      descriptionFormat: 'text',
      downloads: p.downloadCount ?? 0,
      followers: 0, // not exposed by the CurseForge API
      categories: (p.categories ?? []).map((c) => c.name),
      updatedAt: p.dateModified ?? '',
      gallery: (p.screenshots ?? [])
        .filter((s) => s?.url)
        .map((s) => ({ url: s.url, title: s.title ?? s.description ?? undefined })),
      versions: versionList,
      url: p.links?.websiteUrl ?? `https://www.curseforge.com/minecraft/${mcPath}/${p.slug}`
    }
  }

  /** Every version of a project, newest first, with compatibility info. */
  async listVersions(projectId: string, _projectType?: string): Promise<ProjectVersionInfo[]> {
    const files = await cfGet<CfFile[]>(
      `/mods/${projectId}/files`,
      { pageSize: 50, sortField: 1, sortOrder: 'desc' }
    )
    return (files ?? []).map((f) => ({
      id: String(f.id),
      versionNumber: f.displayName,
      datePublished: f.fileDate ?? '',
      gameVersions: f.gameVersions ?? [],
      loaders: (f.modLoader ?? [])
        .map((l) => LOADER_BY_ID[l])
        .filter((l): l is string => Boolean(l) && (l === 'forge' || l === 'fabric')),
      filename: f.fileName,
      size: f.fileLength,
      fileUrl: f.downloadUrl
    }))
  }

  /**
   * Release notes for a single file (used by the detail page's Changelog tab).
   * CurseForge exposes no bulk endpoint, so changelogs are fetched per file.
   */
  async fileChangelog(projectId: string, fileId: string): Promise<string> {
    const id = Number(fileId)
    if (!Number.isFinite(id)) return ''
    // cfGet already unwraps body.data, which is the changelog string itself.
    return (await cfGet<string>(`/mods/${projectId}/files/${id}/changelog`, {})).trim()
  }

  /** A specific file by id (used by Change Version on installed content). */
  async fileById(
    projectId: string,
    fileId: string
  ): Promise<{
    fileId: number
    filename: string
    url: string
    size: number
    version: string
    gameVersions: string[]
    loaders: string[]
  } | null> {
    const id = Number(fileId)
    if (!Number.isFinite(id)) return null
    const pick = await cfGet<CfFile>(`/mods/${projectId}/files/${id}`, {})
    let url = pick.downloadUrl ?? ''
    if (!url) {
      try {
        const dl = await cfGet<{ downloadUrl: string }>(`/mods/${projectId}/files/${id}/download-url`, {})
        url = dl.downloadUrl
      } catch {
        url = ''
      }
    }
    if (!url) return null
    return {
      fileId: id,
      filename: pick.fileName,
      url,
      size: pick.fileLength,
      version: pick.gameVersions?.[0] ?? '',
      gameVersions: pick.gameVersions ?? [],
      loaders: (pick.modLoader ?? [])
        .map((l) => LOADER_BY_ID[l])
        .filter((l): l is string => Boolean(l) && (l === 'forge' || l === 'fabric'))
    }
  }

  /** Latest file for a mod matching the profile's MC version + loader. */
  async latestFile(
    projectId: string,
    mcVersion: string,
    loader: LoaderType
  ): Promise<{ fileId: number; filename: string; url: string; size: number; version: string } | null> {
    const params: Record<string, string | number> = {
      pageSize: 20,
      sortField: 1, // date created
      sortOrder: 'desc'
    }
    if (mcVersion) params.gameVersion = mcVersion
    if (loader !== 'vanilla') params.modLoaderType = MOD_LOADER[loader]

    const files = await cfGet<CfFile[]>(`/mods/${projectId}/files`, params)
    if (!files || files.length === 0) return null

    // Prefer the newest *release* file, fall back to any.
    const pick = files.find((f) => (f.releaseType ?? 1) === 1) ?? files[0]
    let url = pick.downloadUrl ?? ''
    if (!url) {
      // Some responses omit downloadUrl — resolve it through the API.
      try {
        const dl = await cfGet<{ downloadUrl: string }>(`/mods/${projectId}/files/${pick.id}/download-url`, {})
        url = dl.downloadUrl
      } catch {
        url = ''
      }
    }
    if (!url) throw new LauncherError('CF_NO_URL', 'CurseForge did not provide a download link for this file.')
    return {
      fileId: pick.id,
      filename: pick.fileName,
      url,
      size: pick.fileLength,
      version: pick.gameVersions?.find((v) => v === mcVersion) ?? pick.gameVersions?.[0] ?? ''
    }
  }

  /**
   * v1.0.40 — identify a manually-dropped file by its EXACT normalized title.
   *
   * CurseForge has no public SHA1 lookup (its /fingerprints endpoint uses a
   * proprietary algorithm), so manual identification falls back to a precise
   * name match: search the provider for the mod/pack's real name and accept a
   * hit only when the normalized title is an exact match — never the first
   * search hit blindly (same discipline as matchPackByName on Modrinth).
   * Returns null when nothing matches exactly.
   */
  async matchByExactName(
    name: string,
    projectType: string = 'mod',
    mcVersion?: string
  ): Promise<{ id: string; slug: string; title: string; iconUrl?: string } | null> {
    const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const target = norm(name)
    if (!target) return null
    try {
      const hits = await this.searchMods({ query: name, mcVersion, projectType, limit: 24 })
      const hit = hits.find((h) => norm(h.title) === target)
      if (!hit) return null
      return { id: hit.projectId, slug: hit.slug, title: hit.title, iconUrl: hit.iconUrl }
    } catch {
      return null
    }
  }
}

export const curseforge = new CurseForgeClient()

/** True when the user has connected their own backend proxy (Change 5). */
export function curseforgeConfigured(): boolean {
  return Boolean(settingsManager.get().curseforgeProxyUrl?.trim())
}
