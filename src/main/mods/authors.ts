/**
 * Universal author profiles (v1.0.86).
 *
 * Normalized creator data across providers. Only PUBLIC information is used:
 * Modrinth exposes full public profiles + project lists; CurseForge's v1 API
 * exposes only author names on projects, so CurseForge profiles are marked
 * "limited" and show what the provider actually gives us.
 */
import { logger } from '../logs/logger'
import type { AuthorProfile, AuthorProject } from '../../shared/types'

const MODRINTH_API = 'https://api.modrinth.com/v2'
const UA = 'Reimagined-Launcher/1.0.86 (author-profiles)'

/* In-memory caches with a short TTL — public data reused while fresh. */
const profileCache = new Map<string, { at: number; data: AuthorProfile }>()
const projectsCache = new Map<string, { at: number; data: AuthorProject[] }>()
const TTL = 10 * 60 * 1000

async function mGet<T>(path: string): Promise<T> {
  const res = await fetch(`${MODRINTH_API}${path}`, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(12_000)
  })
  if (res.status === 429) {
    /* Respect Retry-After (seconds) when Modrinth rate-limits us. */
    const ra = Number(res.headers.get('retry-after')) || 2
    await new Promise((r) => setTimeout(r, Math.min(ra, 8) * 1000))
    const res2 = await fetch(`${MODRINTH_API}${path}`, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(12_000)
    })
    if (!res2.ok) throw new Error(`Modrinth ${res2.status}`)
    return (await res2.json()) as T
  }
  if (!res.ok) throw new Error(`Modrinth ${res.status}`)
  return (await res.json()) as T
}

interface MUser {
  id: string
  username: string
  name?: string | null
  avatar_url?: string | null
  bio?: string | null
  role?: string | null
  created?: string
}

interface MProject {
  id: string
  slug: string
  title: string
  description: string
  icon_url?: string | null
  downloads: number
  followers: number
  categories: string[]
  versions: string[]
  project_type: string
  updated?: string
}

const TYPE_LABEL: Record<string, string> = {
  mod: 'Mod',
  modpack: 'Modpack',
  resourcepack: 'Resource Pack',
  datapack: 'Data Pack',
  shader: 'Shader',
  plugin: 'Plugin',
  world: 'World',
  'mod-progression': 'Progression'
}

export function typeLabel(t: string): string {
  return TYPE_LABEL[t] ?? (t ? t[0].toUpperCase() + t.slice(1) : 'Project')
}

/** Public creator profile. CurseForge v1 has no author endpoint → limited. */
export async function getAuthor(provider: 'modrinth' | 'curseforge', username: string): Promise<AuthorProfile> {
  const key = `${provider}:${username.toLowerCase()}`
  const hit = profileCache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.data

  if (provider === 'curseforge') {
    const data: AuthorProfile = {
      provider,
      id: username,
      username,
      name: username,
      avatarUrl: null,
      bio: null,
      role: null,
      createdAt: null,
      limited: true
    }
    profileCache.set(key, { at: Date.now(), data })
    return data
  }

  try {
    const u = await mGet<MUser>(`/user/${encodeURIComponent(username)}`)
    const data: AuthorProfile = {
      provider,
      id: u.id,
      username: u.username,
      name: u.name || u.username,
      avatarUrl: u.avatar_url || null,
      bio: u.bio || null,
      role: u.role || null,
      createdAt: u.created || null
    }
    profileCache.set(key, { at: Date.now(), data })
    return data
  } catch (err) {
    /* 404 = the handle exists in a project's metadata but has no Modrinth
     * account (authors listed under a team or an external handle). Instead
     * of failing the whole page, show a limited profile — the same shape
     * CurseForge uses — so navigation never dead-ends. */
    logger.warn(`author profile failed (${username}): ${(err as Error).message}`)
    const data: AuthorProfile = {
      provider,
      id: username,
      username,
      name: username,
      avatarUrl: null,
      bio: 'This creator has no public Modrinth profile.',
      role: null,
      createdAt: null,
      limited: true
    }
    profileCache.set(key, { at: Date.now(), data })
    return data
  }
}

/** A creator's projects, normalized. projectType filters client-side. */
export async function getAuthorProjects(
  provider: 'modrinth' | 'curseforge',
  username: string,
  projectType?: string
): Promise<AuthorProject[]> {
  const cacheKey = `${provider}:${username.toLowerCase()}:${projectType ?? 'all'}`
  const hit = projectsCache.get(cacheKey)
  if (hit && Date.now() - hit.at < TTL) return hit.data

  if (provider === 'curseforge') {
    projectsCache.set(cacheKey, { at: Date.now(), data: [] })
    return []
  }

  try {
    const list = await mGet<MProject[]>(`/user/${encodeURIComponent(username)}/projects?limit=200`)
    let items = list.map<AuthorProject>((p) => ({
      provider,
      projectId: p.id,
      slug: p.slug,
      title: p.title,
      author: username,
      iconUrl: p.icon_url || null,
      description: p.description,
      downloads: p.downloads,
      followers: p.followers,
      categories: p.categories ?? [],
      gameVersions: p.versions ?? [],
      projectType: p.project_type,
      updatedAt: p.updated || ''
    }))
    if (projectType) items = items.filter((p) => p.projectType === projectType)
    /* Newest first — creators iterate fast. */
    items.sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))
    projectsCache.set(cacheKey, { at: Date.now(), data: items })
    return items
  } catch (err) {
    /* Same graceful fallback as the profile: a limited creator has no
     * project list, so the page renders an empty state instead of a dead
     * error. Network hiccups also degrade to a clean empty list rather than
     * freezing navigation. */
    logger.warn(`author projects failed (${username}): ${(err as Error).message}`)
    projectsCache.set(cacheKey, { at: Date.now(), data: [] })
    return []
  }
}

/** Distinct project types a creator actually has (dynamic category tabs). */
export async function getAuthorTypes(provider: 'modrinth' | 'curseforge', username: string): Promise<string[]> {
  const all = await getAuthorProjects(provider, username)
  const seen = new Set<string>()
  for (const p of all) if (p.projectType) seen.add(p.projectType)
  return Array.from(seen)
}
