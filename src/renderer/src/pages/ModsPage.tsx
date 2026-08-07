import { useState, useCallback, Fragment, useEffect, useRef } from 'react'
import { useApp } from '../state/AppContext'
import { Button, TextInput, Spinner, EmptyState, Badge, Toggle, TabBar } from '../components/ui'
import { api, friendlyError } from '../lib/api'
import { ProjectDetail } from '../components/ProjectDetail'
import { ModIcon } from '../components/ModIcon'
import { IconPuzzle, IconDownload, IconFolder, IconChevronDown, IconRefresh, IconArchive, IconGlobe } from '../components/icons'
import type { ModrinthSearchResult, ProfileMod, ProjectVersionInfo } from '@shared/types'

type SourceTab = 'installed' | 'modrinth'
type SortKey = 'relevance' | 'downloads' | 'newest' | 'updated' | 'name'
type ContentType = 'mod' | 'resourcepack' | 'datapack' | 'shader'
/** Installed panel sub-tabs — organized per content type (instance menu). */
type InstTab = 'mods' | 'resourcepacks' | 'datapacks' | 'shaders' | 'worlds'

const INST_TABS: { id: InstTab; label: string }[] = [
  { id: 'mods', label: 'Mods' },
  { id: 'resourcepacks', label: 'Resource Packs' },
  { id: 'datapacks', label: 'Data Packs' },
  { id: 'shaders', label: 'Shaders' },
  { id: 'worlds', label: 'Worlds' }
]

const CONTENT_TYPES: { id: ContentType; label: string }[] = [
  { id: 'mod', label: 'Mods' },
  { id: 'resourcepack', label: 'Resource Packs' },
  { id: 'datapack', label: 'Data Packs' },
  { id: 'shader', label: 'Shader Packs' }
]

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'downloads', label: 'Popularity' },
  { id: 'relevance', label: 'Relevance' },
  { id: 'newest', label: 'Newest' },
  { id: 'updated', label: 'Recently updated' },
  { id: 'name', label: 'Name' }
]

/** A browsed hit tagged with its provider. */
interface ProviderResult extends ModrinthSearchResult {
  source: 'modrinth' | 'curseforge'
}

function fmtDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function fmtSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`
  return `${bytes} B`
}

/** Sub-folder each Installed sub-tab manages (worlds = saves/). */
const FOLDER_FOR_INST: Record<InstTab, string | null> = {
  mods: 'mods',
  resourcepacks: 'resourcepacks',
  datapacks: 'datapacks',
  shaders: 'shaderpacks',
  worlds: 'saves'
}

/** Project type each Installed sub-tab filters (worlds has no project type). */
const typeForInst: Record<InstTab, ContentType | null> = {
  mods: 'mod',
  resourcepacks: 'resourcepack',
  datapacks: 'datapack',
  shaders: 'shader',
  worlds: null
}

/** Modrinth page size — results append as the user scrolls (infinite scroll). */
const PAGE_SIZE = 24

export function ModsPage() {
  const { activeProfile, notify, runGuarded } = useApp()
  const [tab, setTab] = useState<SourceTab>('installed')
  const [contentType, setContentType] = useState<ContentType>('mod')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProviderResult[]>([])
  const [installed, setInstalled] = useState<ProfileMod[]>(activeProfile?.mods ?? [])
  const [manualFiles, setManualFiles] = useState<string[]>([])
  const [searching, setSearching] = useState(false)
  const [installingId, setInstallingId] = useState<string | null>(null)
  const [category, setCategory] = useState<string | null>(null)
  const [categories, setCategories] = useState<string[]>([])
  const [showAllCategories, setShowAllCategories] = useState(false)
  // Infinite scroll pagination state.
  const [offset, setOffset] = useState(0)
  const [totalHits, setTotalHits] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  // Part 5 — full detail page for any content (mod/pack/shader), with
  // browser-style back/forward history (a simple stack of the last views).
  type DetailTarget = { provider: 'modrinth' | 'curseforge'; projectId: string; projectType: ContentType }
  const [detail, setDetail] = useState<DetailTarget | null>(null)
  const [detailHistory, setDetailHistory] = useState<DetailTarget[]>([])
  const [detailIndex, setDetailIndex] = useState(-1)
  // Part 4 — per-item Change Version selector state.
  const [versionsOpen, setVersionsOpen] = useState<string | null>(null)
  const [versionsFor, setVersionsFor] = useState<Record<string, ProjectVersionInfo[]>>({})
  const [versionsBusy, setVersionsBusy] = useState(false)
  const [sort, setSort] = useState<SortKey>('downloads')
  const [updatingAll, setUpdatingAll] = useState(false)
  // Installed panel organization: Mods / Resource Packs / Data Packs /
  // Shaders / Worlds — everything lives under its own clean tab.
  const [instTab, setInstTab] = useState<InstTab>('mods')
  const [worlds, setWorlds] = useState<{ name: string; folder: string; sizeBytes: number; lastModified: string | null }[]>([])
  const [worldsLoading, setWorldsLoading] = useState(false)

  const modrinthIndex = sort === 'updated' ? 'updated' : sort === 'newest' ? 'newest' : sort === 'name' ? 'relevance' : sort === 'downloads' ? 'downloads' : 'relevance'

  const profileId = activeProfile?.id
  const profileLoader = activeProfile?.loader.type === 'vanilla' ? undefined : activeProfile?.loader.type

  // Keep the installed list + manual files in sync when the profile changes.
  useEffect(() => {
    setInstalled(activeProfile?.mods ?? [])
    if (activeProfile && tab === 'installed') {
      api.mods.localFiles(activeProfile.id).then(setManualFiles).catch(() => setManualFiles([]))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfile, tab])

  /* Stale-response guard: with auto-search firing on every keystroke, a slow
   * earlier response must never overwrite a newer one. First-page searches
   * bump the sequence; append loads keep the current one and only the latest
   * first-page search may render. */
  const searchSeq = useRef(0)

  /** Search Modrinth (profile-scoped: version + loader locked at the API
   *  level — incompatible results can never appear). Supports pagination. */
  const doSearch = useCallback(
    async (q?: string, startOffset = 0, append = false) => {
      if (!activeProfile) return
      const term = q ?? query
      const mySeq = append ? searchSeq.current : ++searchSeq.current
      if (append) setLoadingMore(true)
      else setSearching(true)
      try {
        const r = await api.mods.search(activeProfile.id, term, modrinthIndex, {
          mcVersion: activeProfile.minecraftVersion,
          loader: contentType === 'mod' ? profileLoader : undefined,
          category: category ?? undefined,
          projectType: contentType,
          offset: startOffset,
          limit: PAGE_SIZE
        })
        if (!append && mySeq !== searchSeq.current) return // stale — a newer search superseded this one
        setTotalHits(r.totalHits)
        const page = r.items.map((x) => ({ ...x, source: 'modrinth' as const }))
        setResults((prev) => (append ? [...prev, ...page] : page))
        setOffset(startOffset + page.length)
      } catch (err) {
        notify('error', 'Search failed', friendlyError(err))
      } finally {
        setSearching(false)
        setLoadingMore(false)
      }
    },
    [activeProfile, query, notify, modrinthIndex, contentType, profileLoader, category]
  )

  // Auto-load results the moment the Modrinth tab opens, and re-run whenever
  // the sort order, content type or category changes (fresh first page).
  useEffect(() => {
    if (tab === 'modrinth') void doSearch(undefined, 0, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, sort, contentType, category, profileId])

  // AUTO-SEARCH: as soon as the user stops typing (350 ms) the results update
  // by themselves — no Enter key needed. Typing "simple" and pausing shows
  // every result containing "simple" automatically. Debounced on QUERY only
  // (the tab/sort/category effect above handles those changes) so switching
  // tabs never triggers a duplicate search.
  useEffect(() => {
    if (tab !== 'modrinth') return
    const t = setTimeout(() => void doSearch(undefined, 0, false), 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  /** Append the next page when the sentinel enters the viewport. */
  const loadMore = useCallback(() => {
    if (loadingMore || searching || !activeProfile) return
    if (results.length >= totalHits && totalHits > 0) return
    void doSearch(undefined, offset, true)
  }, [doSearch, loadingMore, searching, activeProfile, results.length, totalHits, offset])

  /* Re-create the observer whenever the sentinel can appear (first page loaded)
   * or when a load-more cycle finishes — otherwise the observer would stay
   * attached to a detached node and infinite scroll would stop forever. */
  useEffect(() => {
    if (tab !== 'modrinth') return
    const el = sentinelRef.current
    if (!el || loadingMore) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore()
      },
      { rootMargin: '400px' }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [tab, loadMore, loadingMore, results.length])

  // Real category list from Modrinth's tags API (mods only, for the sidebar).
  useEffect(() => {
    if (tab !== 'modrinth' || categories.length > 0 || contentType !== 'mod') return
    api.mods
      .categories()
      .then((c) => setCategories(c.slice(0, 60)))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, contentType])

  const installMod = async (r: ProviderResult) => {
    if (!activeProfile) return
    setInstallingId(r.projectId)
    try {
      await runGuarded('Install', () => api.mods.install(activeProfile.id, r.projectId, contentType))
      setInstalled(await api.mods.list(activeProfile.id))
      notify('success', 'Installed', r.title)
    } catch {
      // handled by runGuarded
    } finally {
      setInstallingId(null)
    }
  }

  const removeMod = async (slug: string) => {
    if (!activeProfile) return
    await runGuarded('Remove', async () => {
      await api.mods.remove(activeProfile.id, slug)
      setInstalled((prev) => prev.filter((m) => m.slug !== slug))
    })
  }

  const removeManual = async (filename: string) => {
    if (!activeProfile) return
    await runGuarded('Remove', async () => {
      await api.mods.removeLocalFile(activeProfile.id, filename)
      setManualFiles((prev) => prev.filter((f) => f !== filename))
      notify('success', 'File removed', filename)
    })
  }

  const updateMod = async (slug: string) => {
    if (!activeProfile) return
    await runGuarded('Update', async () => {
      await api.mods.update(activeProfile.id, slug)
      setInstalled(await api.mods.list(activeProfile.id))
    })
  }

  /** Part 7 — Update All: sequentially update every updatable mod. */
  const updateAll = async () => {
    if (!activeProfile) return
    const updatable = installed.filter((m) => m.updateAvailable)
    if (updatable.length === 0) {
      notify('info', 'All up to date', 'No updates available for this profile.')
      return
    }
    setUpdatingAll(true)
    try {
      for (const m of updatable) {
        notify('info', 'Updating', `${m.title} → ${m.updateAvailable!.versionNumber}`)
        await api.mods.update(activeProfile.id, m.slug).catch((err) => notify('error', `Update failed: ${m.title}`, friendlyError(err)))
      }
      setInstalled(await api.mods.list(activeProfile.id))
      notify('success', 'Updates finished', `${updatable.length} mod(s) updated.`)
    } finally {
      setUpdatingAll(false)
    }
  }

  /** Part 4 — load other compatible versions of an installed item on demand. */
  const loadVersions = async (slug: string) => {
    if (!activeProfile || versionsFor[slug]) return
    setVersionsBusy(true)
    try {
      const list = await api.mods.availableVersions(activeProfile.id, slug)
      setVersionsFor((prev) => ({ ...prev, [slug]: list }))
    } catch (err) {
      notify('error', 'Could not load versions', friendlyError(err))
    } finally {
      setVersionsBusy(false)
    }
  }

  /** Part 4 — swap the installed file to a different version of the same project. */
  const changeVersion = async (slug: string, versionId: string) => {
    if (!activeProfile) return
    await runGuarded('Change version', async () => {
      const mod = await api.mods.changeVersion(activeProfile.id, slug, versionId)
      setInstalled(await api.mods.list(activeProfile.id))
      setVersionsOpen(null)
      notify('success', 'Version changed', `${mod.title} → ${mod.versionNumber}`)
    })
  }

  /** Part 4 — disable/enable without uninstalling (.disabled suffix). */
  const setEnabled = async (m: ProfileMod, enabled: boolean) => {
    if (!activeProfile) return
    await runGuarded(enabled ? 'Enable' : 'Disable', async () => {
      const mod = await api.mods.setEnabled(activeProfile.id, m.slug, enabled)
      setInstalled((prev) => prev.map((x) => (x.slug === m.slug ? mod : x)))
    })
  }

  /** Push a project onto the detail history (forward entries are dropped). */
  const openDetail = (r: ProviderResult | DetailTarget) => {
    const target = 'source' in r
      ? { provider: r.source, projectId: r.projectId, projectType: contentType }
      : r
    const next = detailIndex + 1
    setDetailHistory((h) => [...h.slice(0, next), target])
    setDetailIndex(next)
    setDetail(target)
  }

  const goBack = () => {
    if (detailIndex <= 0) return
    const i = detailIndex - 1
    setDetailIndex(i)
    setDetail(detailHistory[i])
  }

  const goForward = () => {
    if (detailIndex >= detailHistory.length - 1) return
    const i = detailIndex + 1
    setDetailIndex(i)
    setDetail(detailHistory[i])
  }

  /** Exit the detail page entirely and reset the history. */
  const closeDetail = () => {
    setDetail(null)
    setDetailHistory([])
    setDetailIndex(-1)
  }

  /** Open the folder of the ACTIVE Installed sub-tab (mods/, saves/, …). */
  const openInstTabFolder = async () => {
    if (!activeProfile) return
    try {
      await api.content.openFolder(activeProfile.id, FOLDER_FOR_INST[instTab] ?? undefined)
    } catch (err) {
      notify('error', 'Could not open folder', friendlyError(err))
    }
  }

  /** Copy a world into the instance's backups/ folder (never touches the original). */
  const backupWorld = async (w: { folder: string; name: string }) => {
    if (!activeProfile) return
    await runGuarded('Back up world', async () => {
      await api.content.backupWorld(activeProfile.id, w.folder)
      notify('success', 'World backed up', `“${w.name}” was copied into the instance's backups folder.`)
    })
  }

  const visible = results
  /** Installed items shown in the active sub-tab (by project type). */
  const instItems = installed.filter((m) => (m.projectType ?? 'mod') === (typeForInst[instTab] ?? 'mod'))
  /* Installed check matches by real project id OR slug — so the Fabric API
   * (stored under the 'fabric-api' slug on older profiles) shows as
   * "Installed" in Modrinth results and can never be double-installed. */
  const isInstalled = (r: ProviderResult | string): boolean => {
    if (typeof r === 'string') return installed.some((m) => m.id === r)
    return installed.some((m) => m.id === r.projectId || m.slug === r.slug)
  }

  /* Worlds are live filesystem data — load them when the Worlds sub-tab opens. */
  useEffect(() => {
    if (tab !== 'installed' || instTab !== 'worlds' || !activeProfile) return
    let cancelled = false
    setWorldsLoading(true)
    api.content
      .worlds(activeProfile.id)
      .then((w) => {
        if (!cancelled) setWorlds(w)
      })
      .catch(() => {
        if (!cancelled) setWorlds([])
      })
      .finally(() => {
        if (!cancelled) setWorldsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tab, instTab, activeProfile])

  /** Keep the installed list in sync after detail-page actions (Part 5). */
  const handleInstalledChange = (mod: ProfileMod | null) => {
    if (!activeProfile) return
    if (mod === null) {
      setInstalled((prev) => prev.filter((m) => m.id !== detail?.projectId))
    } else {
      setInstalled((prev) => {
        const idx = prev.findIndex((m) => m.id === mod.id)
        return idx >= 0 ? prev.map((m) => (m.id === mod.id ? mod : m)) : [...prev, mod]
      })
    }
    void api.mods.list(activeProfile.id).then(setInstalled).catch(() => {})
  }

  // Part 3 — a Vanilla profile has no loader, so mods can't run on it. Packs
  // (resource packs / data packs / shaders) work fine and stay reachable.
  const noModsLoader = activeProfile?.loader.type === 'vanilla'

  const renderRow = (r: ProviderResult) => (
    <div key={r.projectId} className="mod-row card" onClick={() => openDetail(r)} role="button" tabIndex={0}>
      <div className="mod-icon">
        {r.iconUrl ? <ModIcon src={r.iconUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <IconPuzzle style={{ width: 20, height: 20 }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="mod-title link" onClick={(e) => { e.stopPropagation(); openDetail(r) }}>
            {r.title}
          </span>
          <Badge variant="accent">Modrinth</Badge>
          {isInstalled(r) && <Badge variant="success">Installed</Badge>}
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
        <Button size="sm" variant="ghost" onClick={() => openDetail(r)}>
          View
        </Button>
        <Button
          size="sm"
          variant={isInstalled(r) ? 'ghost' : 'primary'}
          disabled={installingId === r.projectId || isInstalled(r)}
          onClick={() => installMod(r)}
        >
          {installingId === r.projectId ? <Spinner /> : isInstalled(r) ? 'Installed' : 'Install'}
        </Button>
      </div>
    </div>
  )

  /** One installed item row — used by every Installed sub-tab (mods, packs,
   *  shaders). Update shows as a compact ARROW: click to jump to the newest
   *  version. Disable/Enable, Change Version and Remove are always available. */
  const renderInstalledRow = (m: ProfileMod) => (
    <div key={m.slug} className={'installed-row' + (m.disabled ? ' disabled' : '')}>
      {m.iconUrl ? (
        <ModIcon src={m.iconUrl} style={{ width: 38, height: 38, borderRadius: 9, objectFit: 'cover', opacity: m.disabled ? 0.45 : 1 }} />
      ) : (
        <div style={{
          width: 38,
          height: 38,
          borderRadius: 9,
          background: 'var(--bg-4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-3)',
          fontSize: 14,
          fontWeight: 700
        }}>
          {m.title.charAt(0)}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            className="link"
            style={{ textDecoration: m.disabled ? 'none' : undefined, opacity: m.disabled ? 0.55 : 1 }}
            onClick={() => {
              if (m.source === 'curseforge') {
                notify('error', 'CurseForge not supported', 'This mod was installed from CurseForge in an earlier version — it can only be removed, or re-installed from Modrinth.')
                return
              }
              openDetail({ provider: 'modrinth', projectId: m.id, projectType: (m.projectType ?? 'mod') as ContentType })
            }}
            title={m.source === 'curseforge' ? 'CurseForge is no longer supported' : 'Open full details'}
          >
            {m.title}
          </span>
          {m.disabled && <Badge variant="warn">Off</Badge>}
          {m.source === 'local' && <Badge>Manual</Badge>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
          v{m.versionNumber} · {m.source === 'curseforge' ? 'CurseForge' : m.source === 'modrinth' ? 'Modrinth' : 'Manual'}
        </div>
        {versionsOpen === m.slug && (
          <div className="version-picker" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 11.5, color: 'var(--text-2)' }}>Change version:</span>
              {versionsBusy && <Spinner />}
            </div>
            {versionsFor[m.slug]?.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {versionsFor[m.slug].slice(0, 10).map((v) => (
                  <button
                    key={v.id}
                    className={'version-opt' + (v.id === m.versionId ? ' current' : '')}
                    onClick={() => changeVersion(m.slug, v.id)}
                    disabled={v.id === m.versionId}
                  >
                    {v.versionNumber}
                    <span style={{ color: 'var(--text-3)', fontSize: 10.5 }}>
                      {v.gameVersions[0] ?? ''}{v.loaders[0] ? ' · ' + v.loaders[0] : ''}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: 11.5, color: 'var(--text-3)' }}>No other compatible versions found.</p>
            )}
          </div>
        )}
      </div>
      {m.updateAvailable && (
        <button
          className="update-arrow-btn"
          onClick={() => void updateMod(m.slug)}
          title={`Update to ${m.updateAvailable.versionNumber} (click to update)`}
        >
          <IconRefresh style={{ width: 13, height: 13 }} />
        </button>
      )}
      {m.source !== 'local' && (
        <Toggle
          checked={!m.disabled}
          onChange={(v) => void setEnabled(m, v)}
          label=""
        />
      )}
      {m.source !== 'local' && (
        <Button
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation()
            setVersionsOpen((cur) => (cur === m.slug ? null : m.slug))
            void loadVersions(m.slug) // cached internally — no duplicate fetches
          }}
          title="Change version"
        >
          <IconChevronDown style={{ width: 13, height: 13 }} /> Versions
        </Button>
      )}
      <Button size="sm" variant="danger" onClick={() => removeMod(m.slug)}>
        Remove
      </Button>
    </div>
  )

  const renderBrowse = () => (
    <div className="browse-layout">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minWidth: 0 }}>
        {/* Sticky search — always one keystroke away while scrolling. */}
        <div className="mod-search sticky-search">
          <TextInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${contentType === 'mod' ? 'Modrinth' : 'Modrinth packs'}… (results update as you type)`}
            onKeyDown={(e) => e.key === 'Enter' && doSearch(undefined, 0, false)}
            autoFocus
          />
          <Button size="sm" variant="ghost" onClick={() => doSearch(undefined, 0, false)} disabled={searching}>
            {searching ? <Spinner /> : 'Search'}
          </Button>
        </div>

        <div className="mod-toolbar">
          {/* Part 2 — content-type scope dropdown */}
          <select
            className="select sort-select"
            value={contentType}
            onChange={(e) => {
              setContentType(e.target.value as ContentType)
              setResults([])
              setCategory(null)
            }}
            title="Browse content type"
          >
            {CONTENT_TYPES.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          <select
            className="select sort-select"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            title="Sort results"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
            {visible.length}{totalHits > 0 ? ` of ${totalHits}` : ''} results
          </span>
        </div>

        {/* Active filters — profile-scoped chips are LOCKED (Part 11) */}
        <div className="filter-chips">
          <span className="chip locked" title="Locked to this profile's Minecraft version">
            MC {activeProfile?.minecraftVersion}
          </span>
          {contentType === 'mod' && profileLoader && (
            <span className="chip locked" title="Locked to this profile's loader">
              {profileLoader}
            </span>
          )}
          {category && (
            <button className="chip" onClick={() => setCategory(null)} title="Remove category filter">
              {category} <span className="chip-x">×</span>
            </button>
          )}
        </div>

        {noModsLoader && contentType === 'mod' ? (
          <div className="panel warn-panel">
            <div className="panel-title">Mods need a loader</div>
            <p style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.55, marginTop: 6 }}>
              This profile is <b>Vanilla</b> — installing mods would break it. Switch the content-type
              dropdown above to <b>Resource Packs</b>, <b>Data Packs</b> or <b>Shader Packs</b> (they work
              with any loader), or add Fabric/Forge to the profile from Profiles → right-click → Edit.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {visible.map(renderRow)}
            {loadingMore && (
              <div className="row" style={{ justifyContent: 'center', padding: '16px 0' }}>
                <Spinner />
              </div>
            )}
            {!loadingMore && totalHits > 0 && visible.length < totalHits && <div ref={sentinelRef} style={{ height: 2 }} />}
          </div>
        )}

        {results.length === 0 && !searching && !noModsLoader && contentType === 'mod' && (
          <EmptyState
            title="Nothing found"
            sub="Try a different search term or content type."
          />
        )}
      </div>

      <aside className="browse-side">
        {contentType === 'mod' && (
          <Fragment>
            <div className="panel-title">Categories</div>
            {categories.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>Loading categories…</p>
            ) : (
              <div className="category-list">
                {categories.slice(0, showAllCategories ? undefined : 14).map((c) => (
                  <button
                    key={c}
                    className={category === c ? 'active' : ''}
                    onClick={() => setCategory(category === c ? null : c)}
                  >
                    {c}
                  </button>
                ))}
                {categories.length > 14 && (
                  <button className="clear" onClick={() => setShowAllCategories((v) => !v)}>
                    {showAllCategories ? 'Show less' : `View ${categories.length - 14} more`}
                  </button>
                )}
                {category && (
                  <button className="clear" onClick={() => setCategory(null)}>Clear category</button>
                )}
              </div>
            )}
            <div className="divider" />
          </Fragment>
        )}
        <div className="panel-title">Profile</div>
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6, lineHeight: 1.5 }}>
          {activeProfile?.minecraftVersion} · {activeProfile?.loader.type}
          <br />
          Results are strictly limited to this profile's version{contentType === 'mod' && profileLoader ? ` and ${profileLoader} loader` : ''}. Scroll to load more — use the dropdown above to switch content type.
        </p>
      </aside>
    </div>
  )

  if (!activeProfile) {
    return (
      <EmptyState
        title="Select a profile"
        sub="Create or select a profile from Home or Profiles page to manage mods."
      />
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="section-head">
        <div>
          <h2 className="page-title">Mods</h2>
          <p className="page-sub">
            {activeProfile.name} - {activeProfile.loader.type} / {activeProfile.minecraftVersion}
          </p>
        </div>
      </div>

      {/* Tabs — Modrinth only (CurseForge removed from this launcher). */}
      <TabBar
        tabs={[
          { id: 'installed', label: `Installed (${installed.length + manualFiles.length})` },
          { id: 'modrinth', label: 'Modrinth' }
        ]}
        active={tab}
        onChange={setTab}
      />

      {/* Part 3 — Vanilla profiles can't run mods, but packs work fine. */}
      {tab === 'installed' && noModsLoader && contentType === 'mod' && (
        <div className="panel warn-panel">
          <div className="panel-title">Mods need a loader</div>
          <p style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.55, marginTop: 6 }}>
            “{activeProfile?.name}” is a <b>Vanilla</b> profile, so mods can't be loaded in it.
            Switch to <b>Fabric</b> or <b>Forge</b> (Profiles → right-click → Edit) to install mods,
            or use the content-type dropdown above to browse <b>Resource Packs</b>, <b>Data Packs</b> or{' '}
            <b>Shader Packs</b> — those work with any loader.
          </p>
        </div>
      )}

      {/* Part 7 — Installed panel: organized sub-tabs (Mods / Resource Packs /
          Data Packs / Shaders / Worlds) + Open Folder + Update All. */}
      {tab === 'installed' && (
        <Fragment>
          <div className="inst-tabs">
            {INST_TABS.map((t) => (
              <button
                key={t.id}
                className={'inst-tab' + (instTab === t.id ? ' active' : '')}
                onClick={() => setInstTab(t.id)}
              >
                {t.label}
                {t.id === 'mods' && installed.some((m) => (m.projectType ?? 'mod') === 'mod') && (
                  <span className="inst-count">{installed.filter((m) => (m.projectType ?? 'mod') === 'mod').length}</span>
                )}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button variant="ghost" onClick={openInstTabFolder}>
              <IconFolder style={{ width: 14, height: 14 }} /> Open Folder
            </Button>
            {instTab !== 'worlds' && (
              <Button variant="primary" disabled={updatingAll || !installed.some((m) => m.updateAvailable)} onClick={updateAll}>
                {updatingAll ? <><Spinner /> Updating…</> : `Update All (${installed.filter((m) => m.updateAvailable).length})`}
              </Button>
            )}
            <span style={{ fontSize: 12, color: 'var(--text-3)', marginLeft: 'auto' }}>
              {instTab === 'mods' && manualFiles.length > 0 && `${manualFiles.length} manual file(s) detected`}
            </span>
          </div>

          {instTab === 'worlds' ? (
            worldsLoading ? (
              <div className="row" style={{ justifyContent: 'center', padding: '28px 0' }}><Spinner /></div>
            ) : worlds.length === 0 ? (
              <EmptyState
                icon={<IconArchive style={{ width: 38, height: 38 }} />}
                title="No worlds yet"
                sub="Worlds appear here after you play this instance once. Each world stays inside this profile — open the saves folder to manage the files."
              />
            ) : (
              <div>
                {worlds.map((w) => (
                  <div key={w.folder} className="installed-row">
                    <div style={{
                      width: 38,
                      height: 38,
                      borderRadius: 9,
                      background: 'linear-gradient(135deg, var(--bg-4), var(--bg-3))',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }} title="World">
                      <IconGlobe style={{ width: 18, height: 18 }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{w.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                        {fmtSize(w.sizeBytes)}{w.lastModified ? ` · played ${new Date(w.lastModified).toLocaleDateString()}` : ''}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void api.content.openFolder(activeProfile.id, 'saves/' + w.folder).catch((err) => notify('error', 'Could not open folder', friendlyError(err)))}
                      title="Open this world's folder"
                    >
                      <IconFolder style={{ width: 13, height: 13 }} /> Open
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void backupWorld(w)} title="Copy this world into the instance's backups folder">
                      Back up
                    </Button>
                  </div>
                ))}
              </div>
            )
          ) : instItems.length === 0 && manualFiles.length === 0 ? (
            <EmptyState
              icon={<IconPuzzle style={{ width: 40, height: 40 }} />}
              title={`No ${INST_TABS.find((t) => t.id === instTab)?.label.toLowerCase() ?? 'items'} installed yet`}
              sub={`Browse Modrinth to install ${instTab === 'mods' ? 'mods' : 'content'} into this profile, or drop files in via Open Folder.`}
              action={
                <Button
                  variant="primary"
                  onClick={() => {
                    setContentType((typeForInst[instTab] ?? 'mod') as ContentType)
                    setTab('modrinth')
                  }}
                >
                  Browse {INST_TABS.find((t) => t.id === instTab)?.label ?? 'Modrinth'}
                </Button>
              }
            />
          ) : (
            <div>
              {instItems.map((m) => renderInstalledRow(m))}
              {instTab === 'mods' &&
                manualFiles.map((f) => (
                  <div key={f} className="installed-row">
                    <div style={{
                      width: 38,
                      height: 38,
                      borderRadius: 9,
                      background: 'var(--bg-4)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--text-3)',
                      fontSize: 14,
                      fontWeight: 700
                    }}>
                      {f.charAt(0)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{f.replace(/\.jar$/i, '')}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                        Manual — dropped into the mods folder
                      </div>
                    </div>
                    <Button size="sm" variant="danger" onClick={() => removeManual(f)}>
                      Remove
                    </Button>
                  </div>
                ))}
            </div>
          )}
        </Fragment>
      )}

      {/* Browse Modrinth */}
      {tab === 'modrinth' && renderBrowse()}

      {/* Part 5 — full detail page (mods, resource packs, data packs, shaders) */}
      {detail && (
        <ProjectDetail
          provider={detail.provider}
          projectId={detail.projectId}
          projectType={detail.projectType}
          installed={installed.find((m) => m.id === detail.projectId) ?? null}
          onBack={goBack}
          onForward={goForward}
          canBack={detailIndex > 0}
          canForward={detailIndex < detailHistory.length - 1}
          onClose={closeDetail}
          onInstalledChange={handleInstalledChange}
        />
      )}
    </div>
  )
}
