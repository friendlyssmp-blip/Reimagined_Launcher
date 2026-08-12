import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../state/AppContext'
import { api, friendlyError } from '../lib/api'
import { Button, Spinner, EmptyState, Badge } from './ui'
import { ModIcon } from './ModIcon'
import { IconArrowLeft, IconSearch, IconDownload, IconUser, IconGrid } from './icons'
import type { AuthorProfile as AuthorProfileT, AuthorProject } from '@shared/types'

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

function fmtCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(n)
}

const PAGE = 24

/** Author profile — a premium native creator page (v1.0.86).
 *  Renders inside the content stack; pushing a project from here keeps
 *  this page mounted underneath (state preserved). */
export function AuthorProfileView({
  provider,
  username,
  displayName
}: {
  provider: 'modrinth' | 'curseforge'
  username: string
  displayName?: string
}) {
  const { popContent, pushContent } = useApp()
  const [profile, setProfile] = useState<AuthorProfileT | null>(null)
  const [projects, setProjects] = useState<AuthorProject[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [type, setType] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [visible, setVisible] = useState(PAGE)
  const [refreshKey, setRefreshKey] = useState(0)

  const load = useCallback(async () => {
    setError(null)
    setProfile(null)
    setProjects(null)
    setVisible(PAGE)
    try {
      const [p, list] = await Promise.all([
        api.authors.get(provider, username),
        api.authors.projects(provider, username)
      ])
      setProfile(p)
      setProjects(list)
    } catch (err) {
      setError(friendlyError(err))
    }
  }, [provider, username, refreshKey])

  useEffect(() => {
    void load()
  }, [load])

  /* Dynamic category tabs — only the types this creator actually has. */
  const types = useMemo(() => {
    if (!projects) return []
    const seen = new Set<string>()
    for (const p of projects) if (p.projectType) seen.add(p.projectType)
    return Array.from(seen)
  }, [projects])

  const filtered = useMemo(() => {
    if (!projects) return []
    const q = query.trim().toLowerCase()
    return projects.filter((p) => {
      if (type !== 'all' && p.projectType !== type) return false
      if (!q) return true
      return (
        p.title.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        (p.categories ?? []).some((c) => c.toLowerCase().includes(q))
      )
    })
  }, [projects, type, query])

  const stats = useMemo(() => {
    if (!projects) return { total: 0, downloads: 0, followers: 0 }
    return {
      total: projects.length,
      downloads: projects.reduce((a, p) => a + (p.downloads ?? 0), 0),
      followers: projects.reduce((a, p) => a + (p.followers ?? 0), 0)
    }
  }, [projects])

  const openProject = (p: AuthorProject) => {
    pushContent({
      kind: 'project',
      provider: p.provider,
      projectId: p.projectId,
      projectType: p.projectType
    })
  }

  /* ---- loading skeleton ---- */
  if (!profile && !error) {
    return (
      <div className="author-page">
        <div className="author-top">
          <button className="btn-icon author-back" onClick={popContent} title="Back" aria-label="Back">
            <IconArrowLeft style={{ width: 16, height: 16 }} />
          </button>
        </div>
        <div className="author-hero">
          <div className="skeleton author-avatar-sk" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="skeleton" style={{ width: 180, height: 22 }} />
            <div className="skeleton" style={{ width: 120, height: 13 }} />
            <div className="skeleton" style={{ width: 320, height: 12 }} />
          </div>
        </div>
        <div className="skeleton" style={{ height: 40, marginBottom: 18 }} />
        <div className="author-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 120, borderRadius: 12 }} />
          ))}
        </div>
      </div>
    )
  }

  /* ---- error state ---- */
  if (error || !profile) {
    return (
      <div className="author-page">
        <div className="author-top">
          <button className="btn-icon author-back" onClick={popContent} title="Back" aria-label="Back">
            <IconArrowLeft style={{ width: 16, height: 16 }} />
          </button>
        </div>
        <div className="panel" style={{ textAlign: 'center', padding: 44, maxWidth: 460, margin: '40px auto' }}>
          <div className="empty-illustration" style={{ margin: '0 auto 18px', width: 72, height: 72 }}>
            <IconUser style={{ width: 32, height: 32 }} />
          </div>
          <h3 style={{ fontSize: 16, marginBottom: 8 }}>Couldn&apos;t load creator</h3>
          <p className="panel-sub" style={{ marginBottom: 20 }}>
            We couldn&apos;t retrieve this public profile right now.
          </p>
          <Button variant="primary" onClick={() => setRefreshKey((k) => k + 1)}>Retry</Button>
        </div>
      </div>
    )
  }

  const p = profile
  const initial = (p.name || p.username || '?').slice(0, 1).toUpperCase()

  return (
    <div className="author-page">
      <div className="author-top">
        <button className="btn-icon author-back" onClick={popContent} title="Back" aria-label="Back">
          <IconArrowLeft style={{ width: 16, height: 16 }} />
        </button>
        <span className="author-breadcrumb">Creator profile</span>
        {provider === 'modrinth' && (
          <button className="author-refresh" onClick={() => setRefreshKey((k) => k + 1)} title="Refresh profile">
            <IconGrid style={{ width: 13, height: 13 }} /> Refresh
          </button>
        )}
      </div>

      <div className="author-hero">
        <div className="author-avatar">
          {p.avatarUrl ? (
            <img src={p.avatarUrl} alt="" decoding="async" draggable={false} />
          ) : (
            <span>{initial}</span>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="author-name">{p.name || p.username}</h2>
          <div className="author-handle">@{p.username}</div>
          <div className="author-role">
            {p.role ? typeLabel(p.role) : provider === 'modrinth' ? 'Creator' : 'Creator'}
            {p.limited && ' · limited profile (CurseForge)'}
          </div>
          {p.bio && <p className="author-bio">{p.bio}</p>}
        </div>
        <div className="author-stats">
          <div className="author-stat"><b>{fmtCount(stats.total)}</b><span>Projects</span></div>
          <div className="author-stat"><b>{fmtCount(stats.downloads)}</b><span>Downloads</span></div>
          <div className="author-stat"><b>{fmtCount(stats.followers)}</b><span>Followers</span></div>
        </div>
      </div>

      {p.limited ? (
        <div className="panel" style={{ padding: 20 }}>
          <p style={{ color: 'var(--text-3)', fontSize: 13, lineHeight: 1.6 }}>
            CurseForge doesn&apos;t expose creator project lists publicly, so this profile can only show
            the creator&apos;s name. Open any of their projects from the content lists to see their work.
          </p>
        </div>
      ) : (
        <>
          <div className="author-toolbar">
            <div className="author-tabs">
              <button className={`chip ${type === 'all' ? 'active' : ''}`} onClick={() => setType('all')}>
                All ({projects?.length ?? 0})
              </button>
              {types.map((t) => (
                <button
                  key={t}
                  className={`chip ${type === t ? 'active' : ''}`}
                  onClick={() => setType(t)}
                >
                  {typeLabel(t)} ({projects?.filter((x) => x.projectType === t).length ?? 0})
                </button>
              ))}
            </div>
            <div className="author-search">
              <IconSearch style={{ width: 14, height: 14 }} />
              <input
                className="input author-search-input"
                placeholder="Search projects..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="panel">
              <EmptyState
                title={query ? 'No matching projects' : 'No projects here'}
                sub={query ? 'Try a different search term.' : 'This creator has no public projects in this category.'}
              />
            </div>
          ) : (
            <>
              <div className="author-grid">
                {filtered.slice(0, visible).map((proj) => (
                  <div key={proj.projectId} className="author-card" onClick={() => openProject(proj)} role="button" tabIndex={0}>
                    <div className="author-card-icon">
                      {proj.iconUrl ? (
                        <ModIcon src={proj.iconUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <IconGrid style={{ width: 18, height: 18 }} />
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="author-card-title">{proj.title}</div>
                      <div className="author-card-desc">{proj.description.slice(0, 90)}</div>
                      <div className="author-card-meta">
                        <Badge variant="accent">{typeLabel(proj.projectType)}</Badge>
                        {proj.gameVersions?.slice(-1)[0] && <Badge>MC {proj.gameVersions[proj.gameVersions.length - 1]}</Badge>}
                        <span className="author-card-dl">
                          <IconDownload style={{ width: 11, height: 11 }} /> {fmtCount(proj.downloads ?? 0)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {visible < filtered.length && (
                <div style={{ textAlign: 'center', marginTop: 18 }}>
                  <Button variant="ghost" onClick={() => setVisible((v) => v + PAGE)}>
                    Load more ({filtered.length - visible})
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
