import { useEffect, useRef, useState } from 'react'
import { useApp } from '../state/AppContext'
import { Button, Badge, TextInput, Spinner, EmptyState, ProfileGlyph, TabBar } from '../components/ui'
import { SearchableSelect } from '../components/SearchableSelect'
import { api, friendlyError } from '../lib/api'
import { ModIcon } from '../components/ModIcon'
import { ProjectDetail } from '../components/ProjectDetail'
import { IconArchive, IconShare, IconDownload, IconPuzzle } from '../components/icons'
import type { ModrinthSearchResult, ProjectVersionInfo } from '@shared/types'
import { useT } from '../lib/i18n'

function fmtDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

const PAGE_SIZE = 24

export function ModpacksPage() {
  const t = useT()
  const { profiles, setModals, notify, refreshProfiles, setActiveProfile } = useApp()
  const [tab, setTab] = useState<'browse-modrinth' | 'browse-curseforge' | 'share'>('browse-modrinth')
  const provider: 'modrinth' | 'curseforge' = tab === 'browse-curseforge' ? 'curseforge' : 'modrinth'
  const [cfSetup, setCfSetup] = useState(false)
  const [cfError, setCfError] = useState<string | null>(null)
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
  /* Part 1 (V2) — full-screen modpack preview (replaces the whole page), with
   * browser-style back/forward history just like the Mods page: opening a
   * pack pushes it, the back arrow returns to the previous pack or to the
   * list, and the forward arrow re-enters. */
  const [detailPack, setDetailPack] = useState<{ projectId: string; title: string; provider: 'modrinth' | 'curseforge' } | null>(null)
  const [packHistory, setPackHistory] = useState<{ projectId: string; title: string; provider: 'modrinth' | 'curseforge' }[]>([])
  const [packIndex, setPackIndex] = useState(-1)

  useEffect(() => {
    api.versions
      .list()
      .then((v) => setMcVersions(v.slice(0, 30)))
      .catch(() => {})
  }, [])

  /* Stale-response guard for the automatic search — only the newest
   * first-page search may render; append loads keep the current sequence. */
  const searchSeq = useRef(0)

  const doSearch = async (startOffset = 0, append = false) => {
    const mySeq = append ? searchSeq.current : ++searchSeq.current
    if (append) setLoadingMore(true)
    else setSearching(true)
    setCfError(null)
    try {
      const r =
        provider === 'curseforge'
          ? await api.modpacks.searchCurseforge({
              query,
              mcVersion: mcFilter === 'any' ? undefined : mcFilter,
              offset: startOffset,
              limit: PAGE_SIZE
            })
          : await api.modpacks.search({
              query,
              mcVersion: mcFilter === 'any' ? undefined : mcFilter,
              loader: loaderFilter,
              offset: startOffset,
              limit: PAGE_SIZE
            })
      if (!append && mySeq !== searchSeq.current) return // stale response
      setTotalHits(r.totalHits)
      // v1.0.51 — default ordering is A–Z by name (per the spec), sorted on
      // the fetched page; the server default (downloads/relevance) is not used.
      const sorted = [...r.items].sort((a, b) => a.title.localeCompare(b.title))
      setResults((prev) => (append ? [...prev, ...sorted] : sorted))
      setOffset(startOffset + r.items.length)
    } catch (err) {
      const code = (err as { code?: string }).code
      setCfSetup(code === 'CF_NO_PROXY')
      setCfError(friendlyError(err))
      setResults([])
      if (!cfSetup) notify('error', 'Search failed', friendlyError(err))
    } finally {
      setSearching(false)
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    if (tab.startsWith('browse')) void doSearch(0, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, mcFilter, loaderFilter])

  /* AUTO-SEARCH: results update as soon as typing pauses (350 ms) — no Enter
   * needed. Debounced on QUERY only (tab/filter changes search via the effect
   * above) so switching tabs never triggers a duplicate search. */
  useEffect(() => {
    if (!tab.startsWith('browse')) return
    const t = setTimeout(() => void doSearch(0, false), 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  /* Part 1 (V2) — the preview replaces the screen; start at the top so the
   * header is visible from the first frame. */
  useEffect(() => {
    if (!detailPack) return
    const el = document.querySelector<HTMLElement>('.content')
    el?.scrollTo({ top: 0 })
  }, [detailPack, packIndex])

  /** Open a pack from the list (pushes onto the history stack). */
  const openPack = (r: ModrinthSearchResult) => {
    const target = { projectId: r.projectId, title: r.title, provider }
    const next = packIndex + 1
    setPackHistory((h) => [...h.slice(0, next), target])
    setPackIndex(next)
    setDetailPack(target)
  }

  const packGoBack = () => {
    if (packIndex <= 0) return
    const i = packIndex - 1
    setPackIndex(i)
    setDetailPack(packHistory[i])
  }

  const packGoForward = () => {
    if (packIndex >= packHistory.length - 1) return
    const i = packIndex + 1
    setPackIndex(i)
    setDetailPack(packHistory[i])
  }

  const closePack = () => {
    setDetailPack(null)
    setPackHistory([])
    setPackIndex(-1)
  }

  /* Part 1 (V2) — a version is compatible when it matches the page's current
   * Minecraft-version and loader filters (mirrors the old quick-install pick). */
  const compatibleCheck = (v: ProjectVersionInfo): boolean =>
    (mcFilter === 'any' || v.gameVersions.includes(mcFilter)) &&
    (loaderFilter === 'any' || v.loaders.some((l) => l.toLowerCase().includes(loaderFilter)))

  /* Part 1 (V2) — fetch what a modpack actually contains (from the .mrpack
   * index) for the Includes tab: mods, resource packs, data packs, shaders. */
  const fetchPackIncludes = async (versionId: string) => {
    const files = await api.content.modpackContents(versionId)
    return files.map((f) => ({ path: f.path, size: f.size, source: f.source }))
  }

  /* Part 1 (V2) — install the EXACT version chosen inside the preview page.
   * Creates a new independent profile and switches to it on success. */
  const installPackVersion = async (versionId: string) => {
    if (!detailPack) return
    setInstallingId(detailPack.projectId)
    try {
      const res =
        detailPack.provider === 'curseforge'
          ? await api.modpacks.installCurseforge(detailPack.projectId, versionId, detailPack.title)
          : await api.modpacks.install(detailPack.projectId, versionId, detailPack.title)
      await refreshProfiles()
      setActiveProfile(res.profileId)
      notify(
        'success',
        'Modpack installed',
        `"${res.name}" is ready with ${res.installed} mods${res.skipped.length > 0 ? ` — ${res.skipped.length} could not be restored` : ''}.`
      )
      setDetailPack(null)
    } catch (err) {
      notify('error', 'Modpack install failed', friendlyError(err))
    } finally {
      setInstallingId(null)
    }
  }

  const installPack = async (r: ModrinthSearchResult) => {
    setInstallingId(r.projectId)
    try {
      const versions = await api.content.versions({ provider, projectId: r.projectId, projectType: 'modpack' })
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
      const res =
        provider === 'curseforge'
          ? await api.modpacks.installCurseforge(r.projectId, pick.id, r.title)
          : await api.modpacks.install(r.projectId, pick.id, r.title)
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

  // v1.0.81 — exporting goes through the folder picker (worlds/mods/config…).

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Part 1 (V2) — clicking a modpack's name opens a REAL full-screen
          preview page (Overview / Changelog / Gallery / Versions with real
          Modrinth data). It replaces the whole screen while open. */}
      {detailPack ? (
        <ProjectDetail
          provider={detailPack.provider}
          projectId={detailPack.projectId}
          projectType="modpack"
          installed={null}
          onBack={packGoBack}
          onForward={packGoForward}
          canBack={packIndex > 0}
          canForward={packIndex < packHistory.length - 1}
          onClose={closePack}
          onInstalledChange={() => {}}
          onInstallVersion={installPackVersion}
          compatibleCheck={compatibleCheck}
          contextLabel="Modpacks"
          modpackIncludes={fetchPackIncludes}
        />
      ) : (
        <>
      <div className="section-head">
        <div>
          <h2 className="page-title">{t('page.modpacks')}</h2>
          <p className="page-sub">Browse and install Modrinth or CurseForge modpacks with one click, or share your own setup.</p>
        </div>
      </div>

      <TabBar
        tabs={[
          { id: 'browse-modrinth', label: 'Browse Modrinth' },
          { id: 'browse-curseforge', label: 'Browse CurseForge' },
          { id: 'share', label: 'Share & Import' }
        ]}
        active={tab}
        onChange={(id) => setTab(id as 'browse-modrinth' | 'browse-curseforge' | 'share')}
      />

      {(tab === 'browse-modrinth' || tab === 'browse-curseforge') && (
        <div className="browse-layout">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minWidth: 0 }}>
            <div className="mod-search sticky-search">
              <TextInput
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${provider === 'curseforge' ? 'CurseForge' : 'Modrinth'} modpacks… (results update as you type)`}
                onKeyDown={(e) => e.key === 'Enter' && doSearch(0, false)}
                autoFocus
              />
              <Button size="sm" variant="ghost" onClick={() => doSearch(0, false)} disabled={searching}>
                {searching ? <Spinner /> : 'Search'}
              </Button>
            </div>

            <div className="mod-toolbar">
              <SearchableSelect
                options={mcVersions}
                value={mcFilter}
                onChange={setMcFilter}
                firstOption="Any Minecraft version"
                firstValue="any"
                placeholder="Search versions…"
                className="sort-select"
              />
              <select className="select sort-select" value={loaderFilter} onChange={(e) => setLoaderFilter(e.target.value as typeof loaderFilter)} title="Loader">
                <option value="any">Any loader</option>
                <option value="fabric">Fabric</option>
                <option value="forge">Forge</option>
              </select>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                {results.length}{totalHits > 0 ? ` of ${totalHits}` : ''} packs
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {results.map((r) => (
                <div key={r.projectId} className="mod-row card" onClick={() => openPack(r)} role="button" tabIndex={0} title="Open full preview">
                  <div className="mod-icon">
                    {r.iconUrl ? <ModIcon src={r.iconUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <IconPuzzle style={{ width: 20, height: 20 }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span className="mod-title link">{r.title}</span>
                      {r.author && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>by {r.author}</span>}
                      <Badge variant="accent">{provider === 'curseforge' ? 'CurseForge' : 'Modpack'}</Badge>
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
                      variant="primary"
                      disabled={installingId !== null}
                      onClick={(e) => {
                        e.stopPropagation()
                        void installPack(r)
                      }}
                      title="Install the newest compatible version"
                    >
                      {installingId === r.projectId ? <Spinner /> : 'Install'}
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
            {tab === 'browse-curseforge' && cfSetup && results.length === 0 && (
              <EmptyState
                title="CurseForge is not connected"
                sub="Deploy the included backend proxy (backend/cf-proxy) with your CurseForge API key, then paste its URL in Settings → Advanced → CurseForge proxy URL."
              />
            )}
            {results.length === 0 && !searching && !cfSetup && (
              <EmptyState
                title={provider === 'curseforge' ? 'No CurseForge modpacks found' : 'No modpacks found'}
                sub="Try a different search term, version or loader filter."
              />
            )}
          </div>

          <aside className="browse-side">
            <div className="panel-title">How it works</div>
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6, lineHeight: 1.5 }}>
              {provider === 'curseforge'
                ? 'Installing a CurseForge modpack downloads its archive, reads the manifest, creates a new independent profile with the pack’s Minecraft version and loader, installs every listed file through the CurseForge API and applies the pack’s config and resource packs. You can launch it right away and manage it like any other profile.'
                : 'Installing a modpack creates a new independent profile with the pack’s Minecraft version and loader, installs every mod dependency from Modrinth, and applies the pack’s config and resource packs. You can launch it right away and manage it like any other profile.'}
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
                  <span className="share-action-title">Import modpack <Badge variant="accent">.mrpack / .zip</Badge></span>
                  <span className="share-action-sub">Auto-detects Modrinth, CurseForge, Lunar Client and Reimagined exports</span>
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
            <p className="panel-sub">Each instance can be exported as a portable package. Choose which folders to include — worlds, mods, configs — or just the setup.</p>
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
                  <Button size="sm" variant="ghost" onClick={() => setModals({ exportZip: { profile: p } })}>
                    <IconArchive style={{ width: 13, height: 13 }} /> Export .mrpack
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
        </>
      )}
    </div>
  )
}
