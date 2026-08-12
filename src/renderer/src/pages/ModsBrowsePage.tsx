/**
 * v1.0.82 — Games → Mods: the GLOBAL content browser.
 *
 * Unlike the per-profile Mods page (locked to one instance's version/loader),
 * this section browses Modrinth + CurseForge for ANY Minecraft version and
 * loader: mods, resource packs, data packs, shaders AND worlds. Content is
 * installed into whichever instance you pick afterwards — the picker shows
 * each instance's compatibility (a Forge mod can never land in a Fabric
 * instance) and the exact version that will be installed for it.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../state/AppContext'
import { Button, TextInput, Spinner, EmptyState, Badge, TabBar } from '../components/ui'
import { api, friendlyError } from '../lib/api'
import { ProjectDetail } from '../components/ProjectDetail'
import { PickInstanceModal, type PickTarget } from '../components/PickInstanceModal'
import { SearchableSelect } from '../components/SearchableSelect'
import { ModIcon } from '../components/ModIcon'
import { IconPuzzle, IconDownload, IconGlobe } from '../components/icons'
import type { ModrinthSearchResult } from '@shared/types'

type Provider = 'modrinth' | 'curseforge'
type BrowseType = 'mod' | 'resourcepack' | 'datapack' | 'shader' | 'world'
type SortKey = 'relevance' | 'downloads' | 'newest' | 'updated' | 'name'
type LoaderFilter = 'any' | 'fabric' | 'forge'

const TYPE_TABS: { id: BrowseType; label: string; icon?: 'globe' }[] = [
  { id: 'mod', label: 'Mods' },
  { id: 'resourcepack', label: 'Resource Packs' },
  { id: 'datapack', label: 'Data Packs' },
  { id: 'shader', label: 'Shader Packs' },
  { id: 'world', label: 'Worlds', icon: 'globe' }
]

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'downloads', label: 'Popularity' },
  { id: 'relevance', label: 'Relevance' },
  { id: 'newest', label: 'Newest' },
  { id: 'updated', label: 'Recently updated' },
  { id: 'name', label: 'Name' }
]

interface ProviderResult extends ModrinthSearchResult {
  source: 'modrinth' | 'curseforge'
}

function fmtDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

const PAGE_SIZE = 24

export function ModsBrowsePage() {
  const { notify } = useApp()
  const [provider, setProvider] = useState<Provider>('modrinth')
  const [browseType, setBrowseType] = useState<BrowseType>('mod')
  const [mcVersion, setMcVersion] = useState('')
  const [loader, setLoader] = useState<LoaderFilter>('any')
  const [mcVersions, setMcVersions] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProviderResult[]>([])
  const [searching, setSearching] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [offset, setOffset] = useState(0)
  const [totalHits, setTotalHits] = useState(0)
  const [cfHasMore, setCfHasMore] = useState(false)
  const [cfSetup, setCfSetup] = useState(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  // Detail view (same pattern as the per-profile Mods page). Worlds open
  // through CurseForge (they have no Modrinth detail source).
  const [detail, setDetail] = useState<{ provider: 'modrinth' | 'curseforge'; projectId: string; projectType: BrowseType } | null>(null)
  const [detailHistory, setDetailHistory] = useState<typeof detail[]>([])
  const [detailIndex, setDetailIndex] = useState(-1)

  // Instance picker (portaled to <body> — the page wrapper is transformed).
  const [pickTarget, setPickTarget] = useState<PickTarget | null>(null)

  const [sort, setSort] = useState<SortKey>('downloads')
  const searchSeq = useRef(0)

  const isMod = browseType === 'mod'
  const isWorld = browseType === 'world'
  const effectiveProvider: Provider = isWorld ? 'curseforge' : provider
  const modrinthIndex = sort === 'updated' ? 'updated' : sort === 'newest' ? 'newest' : sort === 'name' ? 'relevance' : sort === 'downloads' ? 'downloads' : 'relevance'

  /* MC versions once per mount (release list from the launcher's own manager). */
  useEffect(() => {
    let active = true
    api.versions
      .list()
      .then((v) => {
        if (active) setMcVersions(v)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  const doSearch = useCallback(
    async (append = false) => {
      const term = query
      const mySeq = append ? searchSeq.current : ++searchSeq.current
      if (append) setLoadingMore(true)
      else setSearching(true)
      try {
        if (effectiveProvider === 'modrinth') {
          const r = await api.mods.searchAny(term, modrinthIndex, {
            mcVersion: mcVersion || undefined,
            loader: isMod && loader !== 'any' ? loader : undefined,
            projectType: browseType,
            offset: append ? offset : 0,
            limit: PAGE_SIZE
          })
          if (!append && mySeq !== searchSeq.current) return
          setTotalHits(r.totalHits)
          const page = r.items
            .map((x) => ({ ...x, source: 'modrinth' as const }))
            .sort((a, b) => (sort === 'name' ? a.title.localeCompare(b.title) : 0))
          setResults((prev) => (append ? [...prev, ...page] : page))
          setOffset((append ? offset : 0) + page.length)
          setCfHasMore(false)
        } else {
          const page = await api.mods.searchCurseforgeAny(term, sort === 'updated' ? 'recent' : sort === 'relevance' ? 'downloads' : sort, browseType, undefined, {
            mcVersion: mcVersion || undefined,
            loader: isMod && loader !== 'any' ? loader : undefined,
            offset: append ? offset : 0,
            limit: PAGE_SIZE
          })
          if (!append && mySeq !== searchSeq.current) return
          const mapped = page.map((x) => ({ ...x, source: 'curseforge' as const }))
          setResults((prev) =>
            append ? [...prev, ...mapped] : mapped.sort((a, b) => (sort === 'name' ? a.title.localeCompare(b.title) : 0))
          )
          setOffset((append ? offset : 0) + mapped.length)
          setCfHasMore(mapped.length >= PAGE_SIZE)
          setCfSetup(false)
        }
      } catch (err) {
        const code = (err as { code?: string }).code
        setCfSetup(code === 'CF_NO_PROXY')
        if (!append) {
          setResults([])
          setTotalHits(0)
          setCfHasMore(false)
        }
        notify('error', 'Search failed', friendlyError(err))
      } finally {
        setSearching(false)
        setLoadingMore(false)
      }
    },
    [query, effectiveProvider, browseType, mcVersion, loader, isMod, sort, modrinthIndex, offset, notify]
  )

  // Re-search on filter change (fresh first page).
  useEffect(() => {
    void doSearch(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveProvider, browseType, mcVersion, loader, sort])

  // Auto-search while typing (debounced on query only).
  useEffect(() => {
    const t = setTimeout(() => void doSearch(false), 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const loadMore = useCallback(() => {
    if (loadingMore || searching) return
    if (effectiveProvider === 'modrinth') {
      if (totalHits > 0 && results.length >= totalHits) return
      void doSearch(true)
    } else if (cfHasMore) {
      void doSearch(true)
    }
  }, [doSearch, loadingMore, searching, effectiveProvider, results.length, totalHits, cfHasMore])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || loadingMore) return
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore()
    }, { rootMargin: '400px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [loadMore, loadingMore, results.length, cfHasMore])

  const openDetail = (r: ProviderResult) => {
    const target = {
      provider: (isWorld ? 'curseforge' : r.source) as 'modrinth' | 'curseforge',
      projectId: r.projectId,
      projectType: browseType
    }
    const next = detailIndex + 1
    setDetailHistory((h) => [...h.slice(0, next), target])
    setDetailIndex(next)
    setDetail(target)
  }

  const goBack = () => {
    if (detailIndex <= 0) return
    const i = detailIndex - 1
    setDetailIndex(i)
    setDetail(detailHistory[i] ?? null)
  }

  const goForward = () => {
    if (detailIndex >= detailHistory.length - 1) return
    const i = detailIndex + 1
    setDetailIndex(i)
    setDetail(detailHistory[i] ?? null)
  }

  const closeDetail = () => {
    setDetail(null)
    setDetailHistory([])
    setDetailIndex(-1)
  }

  const install = (r: ProviderResult) => {
    setPickTarget({
      provider: r.source === 'curseforge' ? 'curseforge' : 'modrinth',
      projectId: r.projectId,
      projectType: browseType,
      title: r.title,
      iconUrl: r.iconUrl,
      loaderFilter: isMod ? loader : 'any'
    })
  }

  const renderRow = (r: ProviderResult) => (
    <div key={r.projectId} className="mod-row card" onClick={() => openDetail(r)} role="button" tabIndex={0}>
      <div className="mod-icon">
        {r.iconUrl ? <ModIcon src={r.iconUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : isWorld ? <IconGlobe style={{ width: 20, height: 20 }} /> : <IconPuzzle style={{ width: 20, height: 20 }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="mod-title link" style={{ fontWeight: 700, fontSize: 13.5 }} onClick={(e) => { e.stopPropagation(); openDetail(r) }}>{r.title}</span>
          <Badge variant="accent">{r.source === 'curseforge' ? 'CurseForge' : 'Modrinth'}</Badge>
          {isWorld && <Badge variant="success">World</Badge>}
        </div>
        <div className="mod-desc">{r.description}</div>
        <div className="mod-tags">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <IconDownload style={{ width: 12, height: 12 }} /> {fmtDownloads(r.downloads)}
          </span>
          {(r.categories ?? []).slice(0, 4).map((c) => (
            <span key={c} className="badge">{c}</span>
          ))}
          {r.latestVersion && <span className="badge">MC {r.latestVersion}</span>}
        </div>
      </div>
      <div className="mod-actions" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="ghost" onClick={() => openDetail(r)}>View</Button>
        <Button size="sm" variant="primary" onClick={() => install(r)}>
          <IconDownload style={{ width: 13, height: 13 }} /> {isWorld ? 'Download' : 'Install'}
        </Button>
      </div>
    </div>
  )

  if (detail) {
    return (
      <>
        <ProjectDetail
          provider={detail.provider}
          projectId={detail.projectId}
          projectType={detail.projectType}
          installed={null}
          onBack={goBack}
          onForward={goForward}
          canBack={detailIndex > 0}
          canForward={detailIndex < detailHistory.length - 1}
          onClose={closeDetail}
          onInstalledChange={() => {}}
          contextLabel={`Browse${mcVersion ? ` · ${mcVersion}` : ''}`}
          /* v1.0.82 — worlds aren't MC-version-locked per-file the way mods are. */
          compatibleCheck={detail.projectType === 'world' ? () => true : undefined}
          onInstallVersion={async (versionId: string) => {
            // Detail page installs route through the instance picker too.
            setPickTarget({
              provider: detail.provider,
              projectId: detail.projectId,
              projectType: detail.projectType,
              loaderFilter: isMod ? loader : 'any'
            })
          }}
        />
        {/* v1.0.82 — the picker must be reachable from the DETAIL branch too
            (the early return above would otherwise skip the portal below). */}
        {pickTarget &&
          createPortal(<PickInstanceModal target={pickTarget} onClose={() => setPickTarget(null)} />, document.body)}
      </>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="section-head">
        <div>
          <h2 className="page-title">Mods</h2>
          <p className="page-sub">Browse Modrinth &amp; CurseForge for any Minecraft version — install into any instance</p>
        </div>
      </div>

      <TabBar
        tabs={[
          { id: 'modrinth', label: 'Modrinth' },
          { id: 'curseforge', label: 'CurseForge' }
        ]}
        active={effectiveProvider}
        onChange={(id) => !isWorld && setProvider(id as Provider)}
      />
      {isWorld && (
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: -8 }}>
          Worlds are hosted on CurseForge — the provider tab is locked for this content type.
        </p>
      )}

      {/* Content type */}
      <div className="inst-tabs">
        {TYPE_TABS.map((t) => (
          <button
            key={t.id}
            className={'inst-tab' + (browseType === t.id ? ' active' : '')}
            onClick={() => {
              setBrowseType(t.id)
              setResults([])
              setQuery('')
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Version + loader filters — v1.0.83: the version picker matches the
          Modpacks section's SearchableSelect (live filter, pinned "Any"). */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <SearchableSelect
          options={mcVersions}
          value={mcVersion}
          onChange={(v) => setMcVersion(v)}
          firstOption="Any Minecraft version"
          firstValue=""
          placeholder="Search versions…"
          className="sort-select"
        />
        {isMod && (
          <select className="select sort-select" value={loader} onChange={(e) => setLoader(e.target.value as LoaderFilter)} title="Filter by loader">
            <option value="any">Any loader</option>
            <option value="fabric">Fabric</option>
            <option value="forge">Forge</option>
          </select>
        )}
        <select className="select sort-select" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} title="Sort results">
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: 'var(--text-3)', marginLeft: 'auto' }}>
          {results.length}{totalHits > 0 ? ` of ${totalHits}` : ''} results
          {isMod && mcVersion && ` · MC ${mcVersion}`}
          {isMod && loader !== 'any' && ` · ${loader}`}
        </span>
      </div>

      {/* Search */}
      <div className="mod-search">
        <TextInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${isWorld ? 'worlds' : effectiveProvider === 'curseforge' ? 'CurseForge' : 'Modrinth'}… (results update as you type)`}
          autoFocus
        />
        <Button size="sm" variant="ghost" onClick={() => void doSearch(false)} disabled={searching}>
          {searching ? <Spinner /> : 'Search'}
        </Button>
      </div>

      {cfSetup ? (
        <div className="panel warn-panel">
          <div className="panel-title">CurseForge browsing is not connected</div>
          <p style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.55, marginTop: 6 }}>
            Deploy the included backend proxy (backend/cf-proxy) with your CurseForge API key, then paste its URL in{' '}
            <b>Settings → Advanced → CurseForge proxy URL</b>. Modrinth works without any setup.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {results.map(renderRow)}
          {loadingMore && (
            <div className="row" style={{ justifyContent: 'center', padding: '16px 0' }}><Spinner /></div>
          )}
          {!loadingMore &&
            ((effectiveProvider === 'modrinth' && totalHits > 0 && results.length < totalHits) ||
              (effectiveProvider === 'curseforge' && cfHasMore)) && <div ref={sentinelRef} style={{ height: 2 }} />}
        </div>
      )}

      {results.length === 0 && !searching && !cfSetup && (
        <EmptyState
          title="Nothing found"
          sub={query ? 'Try a different search term, Minecraft version or loader.' : 'Search above, or pick a content type to browse everything.'}
        />
      )}

      {pickTarget &&
        createPortal(<PickInstanceModal target={pickTarget} onClose={() => setPickTarget(null)} />, document.body)}
    </div>
  )
}
