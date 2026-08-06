import { useEffect, useState } from 'react'
import { useApp } from '../state/AppContext'
import { Button, Badge, TextInput, Spinner, EmptyState, ProfileGlyph } from '../components/ui'
import { api, friendlyError } from '../lib/api'
import { IconArchive, IconShare, IconDownload, IconPuzzle, IconX } from '../components/icons'
import type { ModrinthSearchResult } from '@shared/types'

function fmtDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

const PAGE_SIZE = 24

export function ModpacksPage() {
  const { profiles, setModals, notify, runGuarded, refreshProfiles, setActiveProfile } = useApp()
  const [tab, setTab] = useState<'browse' | 'share'>('browse')
  const [query, setQuery] = useState('')
  const [mcFilter, setMcFilter] = useState('any')
  const [loaderFilter, setLoaderFilter] = useState<'any' | 'fabric' | 'forge'>('any')
  const [mcVersions, setMcVersions] = useState<string[]>([])
  const [results, setResults] = useState<ModrinthSearchResult[]>([])
  const [totalHits, setTotalHits] = useState(0)
  const [offset, setOffset] = useState(0)
  const [searching, setSearching] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [installingId, setInstallingId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<{ projectId: string; title: string; description: string; downloads: number; gallery: { url: string }[] } | null>(null)
  const [detailBusy, setDetailBusy] = useState(false)

  useEffect(() => {
    api.versions
      .list()
      .then((v) => setMcVersions(v.slice(0, 30)))
      .catch(() => {})
  }, [])

  const doSearch = async (startOffset = 0, append = false) => {
    if (append) setLoadingMore(true)
    else setSearching(true)
    try {
      const r = await api.modpacks.search({
        query,
        mcVersion: mcFilter === 'any' ? undefined : mcFilter,
        loader: loaderFilter,
        offset: startOffset,
        limit: PAGE_SIZE
      })
      setTotalHits(r.totalHits)
      setResults((prev) => (append ? [...prev, ...r.items] : r.items))
      setOffset(startOffset + r.items.length)
    } catch (err) {
      notify('error', 'Search failed', friendlyError(err))
    } finally {
      setSearching(false)
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    if (tab === 'browse') void doSearch(0, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, mcFilter, loaderFilter])

  const openDetail = async (r: ModrinthSearchResult) => {
    if (expanded?.projectId === r.projectId) {
      setExpanded(null)
      return
    }
    setDetailBusy(true)
    try {
      const d = await api.content.detail({ provider: 'modrinth', projectId: r.projectId, projectType: 'modpack' })
      setExpanded({
        projectId: r.projectId,
        title: d.title || r.title,
        description: d.description || r.description,
        downloads: d.downloads || r.downloads,
        gallery: d.gallery ?? []
      })
    } catch {
      setExpanded({ projectId: r.projectId, title: r.title, description: r.description, downloads: r.downloads, gallery: [] })
    } finally {
      setDetailBusy(false)
    }
  }

  const installPack = async (r: ModrinthSearchResult) => {
    setInstallingId(r.projectId)
    try {
      const versions = await api.content.versions({ provider: 'modrinth', projectId: r.projectId, projectType: 'modpack' })
      const compatible = versions.filter(
        (v) =>
          (mcFilter === 'any' || v.gameVersions.includes(mcFilter)) &&
          (loaderFilter === 'any' || v.loaders.some((l) => l.toLowerCase().includes(loaderFilter)))
      )
      const pick = compatible[0] ?? versions[0]
      if (!pick) {
        notify('error', 'No compatible version', 'This modpack has no version matching the current filters.')
        return
      }
      const res = await api.modpacks.install(r.projectId, pick.id, r.title)
      await refreshProfiles()
      setActiveProfile(res.profileId)
      notify(
        'success',
        'Modpack installed',
        `"${res.name}" is ready with ${res.installed} mods${res.skipped.length > 0 ? ` — ${res.skipped.length} could not be restored` : ''}.`
      )
    } catch (err) {
      notify('error', 'Modpack install failed', friendlyError(err))
    } finally {
      setInstallingId(null)
    }
  }

  const exportZip = (p: { id: string }) =>
    void runGuarded('Export modpack', async () => {
      const res = await api.share.exportZip(p.id)
      if ('canceled' in res && res.canceled) return
      notify('success', 'Modpack exported', `"${res.name}" saved to ${res.path}`)
    })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="section-head">
        <div>
          <h2 className="page-title">Modpacks</h2>
          <p className="page-sub">Browse and install Modrinth modpacks with one click, or share your own setup.</p>
        </div>
      </div>

      <div className="tabs">
        <button className={'tab' + (tab === 'browse' ? ' active' : '')} onClick={() => setTab('browse')}>
          Browse Modrinth
        </button>
        <button className={'tab' + (tab === 'share' ? ' active' : '')} onClick={() => setTab('share')}>
          Share & Import
        </button>
      </div>

      {tab === 'browse' && (
        <div className="browse-layout">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minWidth: 0 }}>
            <div className="mod-search sticky-search">
              <TextInput
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search Modrinth modpacks…"
                onKeyDown={(e) => e.key === 'Enter' && doSearch(0, false)}
                autoFocus
              />
              <Button onClick={() => doSearch(0, false)} disabled={searching}>
                {searching ? <Spinner /> : 'Search'}
              </Button>
            </div>

            <div className="mod-toolbar">
              <select className="select sort-select" value={mcFilter} onChange={(e) => setMcFilter(e.target.value)} title="Minecraft version">
                <option value="any">Any Minecraft version</option>
                {mcVersions.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
              <select className="select sort-select" value={loaderFilter} onChange={(e) => setLoaderFilter(e.target.value as typeof loaderFilter)} title="Loader">
                <option value="any">Any loader</option>
                <option value="fabric">Fabric</option>
                <option value="forge">Forge</option>
              </select>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                {results.length}{totalHits > 0 ? ` of ${totalHits}` : ''} packs
              </span>
            </div>

            {expanded && (
              <div className="panel" style={{ position: 'relative' }}>
                <button
                  className="nav-btn"
                  style={{ position: 'absolute', top: 12, right: 12 }}
                  onClick={() => setExpanded(null)}
                  title="Close details"
                >
                  <IconX style={{ width: 14, height: 14 }} />
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                  <div className="mod-icon" style={{ width: 48, height: 48 }}>
                    {results.find((r) => r.projectId === expanded.projectId)?.iconUrl ? (
                      <img src={results.find((r) => r.projectId === expanded.projectId)?.iconUrl} alt="" />
                    ) : (
                      <IconPuzzle style={{ width: 20, height: 20 }} />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{expanded.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                      <IconDownload style={{ width: 11, height: 11 }} /> {fmtDownloads(expanded.downloads)} downloads
                    </div>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={installingId !== null}
                    onClick={() => {
                      const r = results.find((x) => x.projectId === expanded.projectId)
                      if (r) void installPack(r)
                    }}
                  >
                    {installingId === expanded.projectId ? <><Spinner /> Installing…</> : 'Install'}
                  </Button>
                </div>
                {expanded.gallery.length > 0 && (
                  <div className="detail-hero" style={{ marginBottom: 10 }}>
                    <img src={expanded.gallery[0].url} alt="" />
                  </div>
                )}
                <div className="panel-title" style={{ fontSize: 12 }}>Description</div>
                <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto' }}>
                  {expanded.description || 'No description provided.'}
                </p>
              </div>
            )}
            {detailBusy && <div className="row" style={{ justifyContent: 'center', padding: 10 }}><Spinner /></div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {results.map((r) => (
                <div key={r.projectId} className="mod-row card" onClick={() => void openDetail(r)} role="button" tabIndex={0}>
                  <div className="mod-icon">
                    {r.iconUrl ? <img src={r.iconUrl} alt="" /> : <IconPuzzle style={{ width: 20, height: 20 }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span className="mod-title link">{r.title}</span>
                      {r.author && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>by {r.author}</span>}
                      <Badge variant="accent">Modpack</Badge>
                    </div>
                    <div className="mod-desc">{r.description}</div>
                    <div className="mod-tags">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <IconDownload style={{ width: 12, height: 12 }} /> {fmtDownloads(r.downloads)}
                      </span>
                      {(r.categories ?? []).slice(0, 5).map((c) => (
                        <span key={c} className="badge">{c}</span>
                      ))}
                      {(r.versions ?? []).slice(0, 3).map((v) => (
                        <span key={v} className="badge">MC {v}</span>
                      ))}
                    </div>
                  </div>
                  <div className="mod-actions" onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="sm"
                      variant={expanded?.projectId === r.projectId ? 'ghost' : 'primary'}
                      disabled={installingId !== null}
                      onClick={() => (expanded?.projectId === r.projectId ? setExpanded(null) : void installPack(r))}
                    >
                      {installingId === r.projectId ? <Spinner /> : expanded?.projectId === r.projectId ? 'Installed ✓' : 'Install'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {loadingMore && (
              <div className="row" style={{ justifyContent: 'center', padding: '14px 0' }}>
                <Spinner />
              </div>
            )}
            {!loadingMore && totalHits > 0 && results.length < totalHits && (
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <Button variant="ghost" onClick={() => doSearch(offset, true)}>Load more packs</Button>
              </div>
            )}
            {results.length === 0 && !searching && (
              <EmptyState
                title="No modpacks found"
                sub="Try a different search term, version or loader filter."
              />
            )}
          </div>

          <aside className="browse-side">
            <div className="panel-title">How it works</div>
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6, lineHeight: 1.5 }}>
              Installing a modpack creates a new independent profile with the pack's Minecraft version and
              loader, installs every mod dependency from Modrinth, and applies the pack's config and resource
              packs. You can launch it right away and manage it like any other profile.
            </p>
          </aside>
        </div>
      )}

      {tab === 'share' && (
        <>
          <div className="panel">
            <div className="panel-title">Import</div>
            <p className="panel-sub">Receive a modpack from a friend or from a file on your PC.</p>
            <div className="share-actions" style={{ marginTop: 14 }}>
              <button className="share-action" onClick={() => setModals({ importShare: true })}>
                <span className="share-action-icon"><IconDownload /></span>
                <span style={{ flex: 1 }}>
                  <span className="share-action-title">Import from .zip <Badge variant="accent">file</Badge></span>
                  <span className="share-action-sub">Pick a Reimagined profile export and install it</span>
                </span>
              </button>
              <button className="share-action" onClick={() => setModals({ importShare: true })}>
                <span className="share-action-icon"><IconShare /></span>
                <span style={{ flex: 1 }}>
                  <span className="share-action-title">Import with Code</span>
                  <span className="share-action-sub">Paste a share code (valid 7 days)</span>
                </span>
              </button>
            </div>
          </div>

          <div className="panel">
            <div className="panel-title">Your modpacks</div>
            <p className="panel-sub">Each instance can be exported as a portable package. Worlds are never included — only the setup.</p>
            <div className="share-list">
              {profiles.length === 0 && (
                <span className="muted" style={{ fontSize: 12, padding: '8px 0' }}>No instances yet — create one to start sharing.</span>
              )}
              {profiles.map((p) => (
                <div key={p.id} className="card share-card" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                  <div className="profile-avatar" style={{ width: 40, height: 40, fontSize: 16 }}>
                    <ProfileGlyph icon={p.icon} name={p.name} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      {p.minecraftVersion} · {p.loader.type} · {p.mods.length} mods
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => exportZip(p)}>
                    <IconArchive style={{ width: 13, height: 13 }} /> Export .zip
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setModals({ share: { profile: p } })}>
                    <IconShare style={{ width: 13, height: 13 }} /> Share
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
