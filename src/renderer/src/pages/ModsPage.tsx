import { useState, useCallback, Fragment, useEffect, useRef } from 'react'
import { useApp } from '../state/AppContext'
import { sound } from '../lib/sound'
import { Button, TextInput, Spinner, EmptyState, Badge, Toggle, TabBar } from '../components/ui'
import { api, friendlyError } from '../lib/api'
import { ProjectDetail } from '../components/ProjectDetail'
import { InstallConfirmModal, type InstallTarget } from '../components/InstallConfirmModal'
import { ModIcon } from '../components/ModIcon'
import { IconPuzzle, IconDownload, IconFolder, IconChevronDown, IconRefresh, IconArchive, IconGlobe, IconTrash } from '../components/icons'
import type { ModrinthSearchResult, ProfileMod, ProjectVersionInfo } from '@shared/types'

type SourceTab = 'installed' | 'modrinth' | 'curseforge'
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
  const { activeProfile, notify, runGuarded, setModals } = useApp()
  const [tab, setTab] = useState<SourceTab>('installed')
  const [contentType, setContentType] = useState<ContentType>('mod')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProviderResult[]>([])
  const [installed, setInstalled] = useState<ProfileMod[]>(activeProfile?.mods ?? [])
  /* v1.0.23: untracked manual files per content type (mods / packs / shaders / datapacks). */
  const [manualFiles, setManualFiles] = useState<Record<string, string[]>>({})
  const [searching, setSearching] = useState(false)
  const [installingId, setInstallingId] = useState<string | null>(null)
  const [category, setCategory] = useState<string | null>(null)
  const [categories, setCategories] = useState<string[]>([])
  /* v1.0.50 — CurseForge's own category list (the sidebar is per-provider). */
  const [cfCategories, setCfCategories] = useState<string[]>([])
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
  // Install confirmation with real dependencies (plain click = dialog,
  // Shift-click = install immediately with dependencies).
  const [installConfirm, setInstallConfirm] = useState<InstallTarget | null>(null)
  // Installed panel organization: Mods / Resource Packs / Data Packs /
  // Shaders / Worlds — everything lives under its own clean tab.
  const [instTab, setInstTab] = useState<InstTab>('mods')
  const [worlds, setWorlds] = useState<{ name: string; folder: string; sizeBytes: number; lastModified: string | null }[]>([])
  const [worldsLoading, setWorldsLoading] = useState(false)
  // Reimagined FPS Boost — manual install/remove (V2), version-gated.
  const [fpsBoost, setFpsBoost] = useState<{ installed: boolean; compatible: boolean; version: string | null }>({ installed: false, compatible: false, version: null })
  const [fpsBoostBusy, setFpsBoostBusy] = useState(false)

  const modrinthIndex = sort === 'updated' ? 'updated' : sort === 'newest' ? 'newest' : sort === 'name' ? 'relevance' : sort === 'downloads' ? 'downloads' : 'relevance'

  const profileId = activeProfile?.id
  const profileLoader = activeProfile?.loader.type === 'vanilla' ? undefined : activeProfile?.loader.type

  // Keep the installed list + manual files in sync when the profile changes.
  useEffect(() => {
    setInstalled(activeProfile?.mods ?? [])
    if (activeProfile && tab === 'installed') {
      const type = typeForInst[instTab] ?? 'mod'
      api.mods
        .localFiles(activeProfile.id, type)
        .then((files) => setManualFiles((prev) => ({ ...prev, [type]: files })))
        .catch(() => setManualFiles((prev) => ({ ...prev, [type]: [] })))
    }
    // FPS Boost status follows the live installed list (local slug id).
    if (activeProfile) {
      setFpsBoost({
        installed: activeProfile.mods.some((m) => m.id === 'reimagined-fps-boost' || m.slug === 'reimagined-fps-boost'),
        compatible: /^26\.2/.test(activeProfile.minecraftVersion),
        version: activeProfile.mods.find((m) => m.id === 'reimagined-fps-boost' || m.slug === 'reimagined-fps-boost')?.versionNumber ?? null
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfile, tab, installed, instTab])

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
        // v1.0.39 — Modrinth-first: when the FIRST page of a real query has no
        // results (and no category filter is active), automatically look in
        // CurseForge for the same term so users never hit a dead end. The
        // results keep the CurseForge badge and install through CurseForge.
        if (!append && page.length === 0 && term.trim() && category === null) {
          setCfFallback(true)
          setSearching(true)
          try {
            const cfSort = modrinthIndex === 'updated' ? 'recent' : modrinthIndex === 'relevance' ? 'downloads' : modrinthIndex
            const cfPage = await api.mods.searchCurseforge(activeProfile.id, term, cfSort, contentType)
            if (mySeq === searchSeq.current) {
              setResults(cfPage.map((x) => ({ ...x, source: 'curseforge' as const })))
              setCfFallbackCount(cfPage.length)
            }
          } catch {
            if (mySeq === searchSeq.current) setCfFallbackCount(0)
          }
        } else {
          setCfFallback(false)
          if (!append) setCfFallbackCount(0)
        }
      } catch (err) {
        notify('error', 'Search failed', friendlyError(err))
      } finally {
        setSearching(false)
        setLoadingMore(false)
      }
    },
    [activeProfile, query, notify, modrinthIndex, contentType, profileLoader, category]
  )

  /** CurseForge search (Change 5) — routed through the user's backend proxy.
   *  Same result shape + row rendering as Modrinth; the provider badge shows
   *  which source a hit came from. If no proxy is configured, the setup card
   *  is shown instead of a broken search. */
  const [cfSearching, setCfSearching] = useState(false)
  const [cfError, setCfError] = useState<string | null>(null)
  const [cfSetup, setCfSetup] = useState(false)
  const [cfFallback, setCfFallback] = useState(false)
  const [cfFallbackCount, setCfFallbackCount] = useState(0)
  const doCurseforgeSearch = useCallback(
    async (q?: string, _append = false) => {
      if (!activeProfile) return
      const term = q ?? query
      setCfSearching(true)
      setCfError(null)
      try {
        const cfSort = sort === 'updated' ? 'recent' : sort === 'relevance' ? 'downloads' : sort
        const page = await api.mods.searchCurseforge(activeProfile.id, term, cfSort, contentType, category ?? undefined)
        setResults(page.map((x) => ({ ...x, source: 'curseforge' as const })))
      } catch (err) {
        const code = (err as { code?: string }).code
        // Setup card ONLY when no proxy is configured; real failures (proxy
        // down, HTTP error) get a compact retry banner instead.
        setCfSetup(code === 'CF_NO_PROXY')
        setCfError(friendlyError(err))
        setResults([])
      } finally {
        setCfSearching(false)
      }
    },
    [activeProfile, query, notify, sort, contentType, category]
  )

  // Auto-load results the moment the Modrinth tab opens, and re-run whenever
  // the sort order, content type or category changes (fresh first page).
  useEffect(() => {
    if (tab === 'modrinth') void doSearch(undefined, 0, false)
    else if (tab === 'curseforge') void doCurseforgeSearch(undefined, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, sort, contentType, category, profileId])

  // AUTO-SEARCH: as soon as the user stops typing (350 ms) the results update
  // by themselves — no Enter key needed. Typing "simple" and pausing shows
  // every result containing "simple" automatically. Debounced on QUERY only
  // (the tab/sort/category effect above handles those changes) so switching
  // tabs never triggers a duplicate search.
  useEffect(() => {
    if (tab === 'modrinth') {
      const t = setTimeout(() => void doSearch(undefined, 0, false), 350)
      return () => clearTimeout(t)
    }
    if (tab === 'curseforge') {
      const t = setTimeout(() => void doCurseforgeSearch(undefined, false), 350)
      return () => clearTimeout(t)
    }
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

  /* v1.0.50 — CurseForge categories for the same sidebar (real data from the
   * proxy's /api/cf/categories route; older proxies degrade to an empty list
   * and the sidebar just hides — never a fake list). */
  useEffect(() => {
    if (tab !== 'curseforge' || cfCategories.length > 0 || contentType !== 'mod') return
    api.mods
      .categoriesCurseforge()
      .then((c) => setCfCategories(c.map((x) => x.name)))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, contentType])

  const installMod = async (r: ProviderResult) => {
    if (!activeProfile) return
    setInstallingId(r.projectId)
    try {
      await runGuarded('Install', () => api.mods.install(activeProfile.id, r.projectId, contentType))
      setInstalled(await api.mods.list(activeProfile.id))
      // v1.0.35 — install-complete payoff plays with the success checkmark.
      sound.installComplete()
      notify('success', 'Installed', r.title, { silent: true })
    } catch {
      // handled by runGuarded
    } finally {
      setInstallingId(null)
    }
  }

  /** Shift-click fast path — install immediately WITH dependencies. */
  const installFast = async (r: ProviderResult, versionId?: string) => {
    if (!activeProfile) return
    setInstallingId(r.projectId)
    try {
      if (r.source === 'curseforge') {
        const m = await api.mods.installCurseforge(activeProfile.id, r.projectId, { title: r.title, iconUrl: r.iconUrl, downloads: r.downloads }, contentType)
        setInstalled(await api.mods.list(activeProfile.id))
        notify('success', 'Installed from CurseForge', `${m.title} v${m.versionNumber}`)
        setInstallingId(null)
        return
      }
      const res = await api.mods.installWithDeps(activeProfile.id, r.projectId, versionId, contentType)
      setInstalled(await api.mods.list(activeProfile.id))
      notify(
        'success',
        'Installed with dependencies',
        res.installed.join(', ') + (res.skipped.length > 0 ? ` — skipped: ${res.skipped.join('; ')}` : '')
      )
    } catch (err) {
      notify('error', 'Could not install', friendlyError(err))
    } finally {
      setInstallingId(null)
    }
  }

  /* Remove confirmations (V2): every removal asks first unless the user holds
   * SHIFT (immediate remove). Consistent across mods, manual files, packs. */
  const doRemove = async (slug: string) => {
    if (!activeProfile) return
    await runGuarded('Remove', async () => {
      await api.mods.remove(activeProfile.id, slug)
      setInstalled((prev) => prev.filter((m) => m.slug !== slug))
    })
  }

  const removeMod = (slug: string, e?: React.MouseEvent) => {
    if (!activeProfile) return
    if (e?.shiftKey) {
      void doRemove(slug)
      return
    }
    const m = installed.find((x) => x.slug === slug)
    setModals({
      confirm: {
        title: 'Remove item',
        message: `Are you sure you want to remove “${m?.title ?? slug}”? This deletes its file from the instance (hold Shift next time to skip this confirmation).`,
        confirmLabel: 'Remove',
        danger: true,
        onConfirm: () => void doRemove(slug)
      }
    })
  }

  const removeManual = (filename: string, e?: React.MouseEvent) => {
    if (!activeProfile) return
    if (e?.shiftKey) {
      void doRemoveManual(filename)
      return
    }
    const type = typeForInst[instTab] ?? 'mod'
    setModals({
      confirm: {
        title: 'Remove file',
        message: `Are you sure you want to remove “${filename}”? This deletes it from the ${
          type === 'mod' ? 'mods folder' : type === 'resourcepack' ? 'resource packs folder' : type === 'shader' ? 'shader packs folder' : 'data packs folder'
        } (hold Shift next time to skip this confirmation).`,
        confirmLabel: 'Remove',
        danger: true,
        onConfirm: () => void doRemoveManual(filename)
      }
    })
  }

  const doRemoveManual = async (filename: string) => {
    if (!activeProfile) return
    const type = typeForInst[instTab] ?? 'mod'
    await runGuarded('Remove', async () => {
      await api.mods.removeLocalFile(activeProfile.id, filename, type)
      setManualFiles((prev) => ({ ...prev, [type]: (prev[type] ?? []).filter((f) => f !== filename) }))
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

  /* Part 4 (V2) — the actual "update everything" work, shared by the
   * confirmation flow and the Shift-click fast path. */
  const runUpdateAll = async () => {
    if (!activeProfile) return
    setUpdatingAll(true)
    try {
      const updatable = installed.filter((m) => m.updateAvailable)
      for (const m of updatable) {
        notify('info', 'Updating', `${m.title} → ${m.updateAvailable!.versionNumber}`)
        await api.mods.update(activeProfile.id, m.slug).catch((err) => notify('error', `Update failed: ${m.title}`, friendlyError(err)))
      }
      setInstalled(await api.mods.list(activeProfile.id))
      notify('success', 'Updates finished', `${updatable.length} item(s) updated.`)
    } finally {
      setUpdatingAll(false)
    }
  }

  /** Update list detail shown inside the Update All confirmation. */
  const updateAllDetail = (): string => {
    const updatable = installed.filter((m) => m.updateAvailable).slice(0, 8)
    if (updatable.length === 0) return ''
    return updatable.map((m) => `• ${m.title}: ${m.versionNumber} → ${m.updateAvailable!.versionNumber}`).join('\n') +
      (installed.filter((m) => m.updateAvailable).length > 8 ? '\n…and more' : '')
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
  /** Install/remove the bundled Reimagined FPS Boost (V2) — manual, per profile. */
  const toggleFpsBoost = async () => {
    if (!activeProfile) return
    setFpsBoostBusy(true)
    try {
      if (fpsBoost.installed) {
        setModals({
          confirm: {
            title: 'Remove Reimagined FPS Boost?',
            message: 'Removing it deletes the mod file from this instance. The launcher keeps the bundle, so you can reinstall it anytime from this button (hold Shift next time to remove immediately).',
            confirmLabel: 'Remove',
            danger: true,
            onConfirm: async () => {
              await api.fpsboost.remove(activeProfile.id)
              const fresh = await api.mods.list(activeProfile.id)
              setInstalled(fresh)
              notify('info', 'FPS Boost removed', 'The Reimagined FPS Boost was removed from this instance.')
            }
          }
        })
      } else {
        const res = await api.fpsboost.install(activeProfile.id)
        const fresh = await api.mods.list(activeProfile.id)
        setInstalled(fresh)
        notify('success', 'FPS Boost installed', `${res.version} is ready — it activates on the next launch.`)
      }
    } catch (err) {
      notify('error', 'FPS Boost action failed', friendlyError(err))
    } finally {
      setFpsBoostBusy(false)
    }
  }

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
      sound.installComplete()
      notify('success', 'World backed up', `“${w.name}” was copied into the instance's backups folder.`)
    })
  }

  const visible = results
  /** Installed items shown in the active sub-tab (by project type). */
  const instItems = installed.filter((m) => (m.projectType ?? 'mod') === (typeForInst[instTab] ?? 'mod'))
  /* v1.0.23: untracked manual files for the ACTIVE sub-tab (all 4 content types). */
  const curType = typeForInst[instTab] ?? 'mod'
  const currentManual = manualFiles[curType] ?? []
  /* v1.0.24 — the search bar also filters the Installed panel: items, manual
     files and worlds, with the same live-typing behavior as Modrinth search. */
  const installedQ = query.trim().toLowerCase()
  const filteredInstItems = installedQ
    ? instItems.filter((m) =>
        `${m.title} ${m.filename} ${m.versionNumber ?? ''}`.toLowerCase().includes(installedQ)
      )
    : instItems
  const filteredManual = installedQ ? currentManual.filter((f) => f.toLowerCase().includes(installedQ)) : currentManual
  const filteredWorlds = installedQ ? worlds.filter((w) => w.name.toLowerCase().includes(installedQ)) : worlds
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

  /* Part 1 (V2) — the detail page replaces the whole screen; always start at
   * the top so its header is visible from the first frame (the .content
   * scroll position would otherwise persist from the long list below). */
  useEffect(() => {
    if (!detail) return
    const el = document.querySelector<HTMLElement>('.content')
    el?.scrollTo({ top: 0 })
  }, [detail, detailIndex])

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

  /* Part 7 — content-type context: the Installed sub-tab the user is on
   * (Mods / Resource Packs / Data Packs / Shaders) travels with them into
   * Browse (Modrinth). Once the user manually changes the type inside
   * Browse, that choice wins from then on and is never overridden again. */
  const contentTypeUserSet = useRef(false)

  /* Part 4 — keep the "Update" badges honest: refresh the installed list
   * against Modrinth's real release order whenever the Installed panel is
   * opened or the profile changes, so "Up to date" / "Update" / the
   * "Update All (N)" count always match reality (never stale metadata).
   *
   * v1.0.22 — also run manual-mod identification here: jars dropped straight
   * into the mods/ folder get their REAL name + icon resolved (and registered
   * as installed), so Modrinth search marks them "Installed" instead of
   * offering a re-download, and the list shows the mod name, not the file. */
  useEffect(() => {
    if (tab !== 'installed' || !activeProfile) return
    let cancelled = false
    ;(async () => {
      await api.mods.identifyManual(activeProfile.id).catch(() => {})
      // v1.0.50 — re-match ALREADY-tracked local items so they gain real
      // provider identity (icon + versionId → Update / Change Version /
      // Update All). Cheap: provider lookups run once per profile per session.
      await api.mods.enrichManual(activeProfile.id).catch(() => {})
      if (cancelled) return
      // After identification, freshly-registered mods must appear immediately.
      setInstalled(await api.mods.list(activeProfile.id).catch(() => []))
      // v1.0.24 — backfill missing Modrinth icons (fire-and-forget; emits
      // mods:changed when resolved, which re-runs this effect with the icons).
      api.mods.ensureIcons(activeProfile.id).catch(() => {})
      const type = typeForInst[instTab] ?? 'mod'
      api.mods
        .localFiles(activeProfile.id, type)
        .then((files) => setManualFiles((prev) => ({ ...prev, [type]: files })))
        .catch(() => setManualFiles((prev) => ({ ...prev, [type]: [] })))
      api.mods
        .checkUpdates(activeProfile.id)
        .then((fresh) => {
          if (!cancelled) setInstalled(fresh)
        })
        .catch(() => {})
    })()
    return () => {
      cancelled = true
    }
  }, [tab, instTab, activeProfile])

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
          <Badge variant="accent">{r.source === 'curseforge' ? 'CurseForge' : 'Modrinth'}</Badge>
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
          onClick={(e) => {
            e.stopPropagation()
            // Shift-click skips the confirmation and installs with deps.
            if (e.shiftKey) void installFast(r)
            else setInstallConfirm({ provider: r.source === 'curseforge' ? 'curseforge' : 'modrinth', projectId: r.projectId, projectType: contentType })
          }}
          title="Install (hold Shift to install immediately with dependencies)"
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
      {/* v1.0.24 — ALWAYS show an icon: the real Modrinth icon when the item
          has one, otherwise ModIcon falls back to the Reimagined logo (never
          a bare letter placeholder). */}
      <ModIcon src={m.iconUrl} style={{ width: 38, height: 38, borderRadius: 9, objectFit: 'cover', opacity: m.disabled ? 0.45 : 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            className="link"
            style={{ textDecoration: m.disabled ? 'none' : undefined, opacity: m.disabled ? 0.55 : 1 }}
            onClick={() =>
              openDetail({
                provider: m.source === 'curseforge' ? 'curseforge' : 'modrinth',
                projectId: m.id,
                projectType: (m.projectType ?? 'mod') as ContentType
              })
            }
            title="Open full details"
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
                    <span className="version-opt-sub" style={{ fontSize: 10.5 }}>
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
      {/* v1.0.26 — Disable/Enable works for EVERY installed mod: the backend
          toggles the real file on disk (.disabled suffix), so a manually-
          dropped mod toggles exactly like a launcher-installed one. */}
      <Toggle
        checked={!m.disabled}
        onChange={(v) => void setEnabled(m, v)}
        label=""
      />
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
      {/* Part 5 (V2) — Remove is a minimalist trash icon; the function is
          unchanged (confirm unless Shift is held). */}
      <button
        className="icon-danger-btn"
        onClick={(e) => removeMod(m.slug, e)}
        title="Remove (hold Shift to remove immediately)"
        aria-label={`Remove ${m.title}`}
      >
        <IconTrash style={{ width: 14, height: 14 }} />
      </button>
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
            placeholder={`Search ${tab === 'curseforge' ? 'CurseForge' : contentType === 'mod' ? 'Modrinth' : 'Modrinth packs'}… (results update as you type)`}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              if (tab === 'curseforge') void doCurseforgeSearch(undefined, false)
              else void doSearch(undefined, 0, false)
            }}
            autoFocus
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (tab === 'curseforge') void doCurseforgeSearch(undefined, false)
              else void doSearch(undefined, 0, false)
            }}
            disabled={tab === 'curseforge' ? cfSearching : searching}
          >
            {tab === 'curseforge' ? (cfSearching ? <Spinner /> : 'Search') : searching ? <Spinner /> : 'Search'}
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
              // Part 7 — a manual choice inside Browse always wins from here on.
              contentTypeUserSet.current = true
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
            {tab === 'modrinth' && cfFallback && query.trim() && (
              <div className="panel cf-fallback-note">
                <b>No Modrinth results for “{query}”</b>
                <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
                  {' '}— showing {cfFallbackCount} match{cfFallbackCount === 1 ? '' : 'es'} from CurseForge instead. Install works the same way.
                </span>
              </div>
            )}
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
            {(() => {
              const sidebarCategories = tab === 'curseforge' ? cfCategories : categories
              if (sidebarCategories.length === 0) {
                return <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>Loading categories…</p>
              }
              return (
                <div className="category-list">
                  {sidebarCategories.slice(0, showAllCategories ? undefined : 14).map((c) => (
                    <button
                      key={c}
                      className={category === c ? 'active' : ''}
                      onClick={() => setCategory(category === c ? null : c)}
                    >
                      {c}
                    </button>
                  ))}
                  {sidebarCategories.length > 14 && (
                    <button className="clear" onClick={() => setShowAllCategories((v) => !v)}>
                      {showAllCategories ? 'Show less' : `View ${sidebarCategories.length - 14} more`}
                    </button>
                  )}
                  {category && (
                    <button className="clear" onClick={() => setCategory(null)}>Clear category</button>
                  )}
                </div>
              )
            })()}
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
      {/* Part 5 (V2) — the detail page REPLACES the whole screen while open:
          header, tabs and lists are hidden behind it, so the preview is fully
          visible from the first frame with no scrolling required. */}
      {detail ? (
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
      ) : (
        <Fragment>
      <div className="section-head">
        <div>
          <h2 className="page-title">Mods</h2>
          <p className="page-sub">
            {activeProfile.name} - {activeProfile.loader.type} / {activeProfile.minecraftVersion}
          </p>
        </div>
      </div>

      {/* Tabs — Installed / Modrinth / CurseForge (Change 5). */}
      <TabBar
        tabs={[
          { id: 'installed', label: `Installed (${installed.length + currentManual.length})` },
          { id: 'modrinth', label: 'Modrinth' },
          { id: 'curseforge', label: 'CurseForge' }
        ]}
        active={tab}
        onChange={(id) => {
          const next = id as SourceTab
          // Part 7 — entering Browse from an Installed sub-tab carries that
          // content type (e.g. Resource Packs → Modrinth opens on Resource
          // Packs), unless the user already chose a type manually in Browse.
          if (next === 'modrinth' && !contentTypeUserSet.current && instTab !== 'worlds') {
            setContentType((typeForInst[instTab] ?? 'mod') as ContentType)
          }
          // v1.0.50 — provider categories are different facets: never let a
          // stale Modrinth category leak into a CurseForge search (or back).
          setCategory(null)
          setTab(next)
        }}
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

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button variant="ghost" onClick={openInstTabFolder}>
              <IconFolder style={{ width: 14, height: 14 }} /> Open Folder
            </Button>
            {/* Reimagined FPS Boost — aligned with the section header, only for
                versions we have a build for (26.2.x today). Removable and
                reinstallable — never permanent. */}
            {instTab === 'mods' && fpsBoost.compatible && (
              <Button
                variant={fpsBoost.installed ? 'ghost' : 'primary'}
                disabled={fpsBoostBusy}
                onClick={() => void toggleFpsBoost()}
                title={fpsBoost.installed ? `Remove Reimagined FPS Boost v${fpsBoost.version ?? ''} from this instance` : 'Install the bundled Reimagined FPS Boost into this instance'}
              >
                {fpsBoostBusy ? <Spinner /> : fpsBoost.installed ? <IconRefresh style={{ width: 13, height: 13 }} /> : <IconDownload style={{ width: 13, height: 13 }} />}
                {fpsBoostBusy ? 'Working…' : fpsBoost.installed ? `Remove FPS Boost` : 'Install FPS Booster'}
              </Button>
            )}
            {instTab !== 'worlds' && (
              <Button
                variant="primary"
                disabled={updatingAll || !installed.some((m) => m.updateAvailable)}
                onClick={(e) => {
                  // Always ask first — show the exact update list — unless
                  // Shift is held, which skips the confirmation (Part 4).
                  if (e.shiftKey) {
                    void runUpdateAll()
                    return
                  }
                  setModals({
                    confirm: {
                      title: 'Update all available?',
                      message: `${installed.filter((m) => m.updateAvailable).length} update(s) are available. Updates are manual — nothing installs until you confirm (hold Shift next time to update all immediately).\n\n${updateAllDetail()}`, 
                      confirmLabel: 'Update All',
                      onConfirm: () => void runUpdateAll()
                    }
                  })
                }}
                title="Update every installed item that has a newer version (hold Shift to update all immediately)"
              >
                {updatingAll ? <><Spinner /> Updating…</> : `Update All (${installed.filter((m) => m.updateAvailable).length})`}
              </Button>
            )}
            <span style={{ fontSize: 12, color: 'var(--text-3)', marginLeft: 'auto' }}>
              {currentManual.length > 0 && `${currentManual.length} manual file(s) detected`}
            </span>
          </div>

          {/* v1.0.24 — the same live search bar also filters what's installed
              (items, manual files and worlds). Escape clears it. */}
          <div className="mod-search">
            <TextInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                instTab === 'worlds'
                  ? 'Search worlds…'
                  : `Search ${INST_TABS.find((t) => t.id === instTab)?.label.toLowerCase() ?? 'installed items'}…`
              }
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            />
          </div>

          {instTab === 'worlds' ? (
            worldsLoading ? (
              <div className="row" style={{ justifyContent: 'center', padding: '28px 0' }}><Spinner /></div>
            ) : filteredWorlds.length === 0 ? (
              <EmptyState
                icon={<IconArchive style={{ width: 38, height: 38 }} />}
                title={installedQ ? 'No matches' : 'No worlds yet'}
                sub={
                  installedQ
                    ? `Nothing matches “${query.trim()}” in this instance's saves.`
                    : 'Worlds appear here after you play this instance once. Each world stays inside this profile — open the saves folder to manage the files.'
                }
              />
            ) : (
              <div>
                {filteredWorlds.map((w) => (
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
          ) : filteredInstItems.length === 0 && filteredManual.length === 0 ? (
            <EmptyState
              icon={<IconPuzzle style={{ width: 40, height: 40 }} />}
              title={installedQ ? 'No matches' : `No ${INST_TABS.find((t) => t.id === instTab)?.label.toLowerCase() ?? 'items'} installed yet`}
              sub={
                installedQ
                  ? `Nothing in this profile matches “${query.trim()}”.`
                  : `Browse Modrinth to install ${instTab === 'mods' ? 'mods' : 'content'} into this profile, or drop files in via Open Folder.`
              }
              action={
                installedQ ? undefined : (
                  <Button
                    variant="primary"
                    onClick={() => {
                      // Part 7 — an explicit "Browse <type>" choice is as good as
                      // a manual one: it wins and is never overridden again.
                      contentTypeUserSet.current = true
                      setContentType((typeForInst[instTab] ?? 'mod') as ContentType)
                      setTab('modrinth')
                    }}
                  >
                    Browse {INST_TABS.find((t) => t.id === instTab)?.label ?? 'Modrinth'}
                  </Button>
                )
              }
            />
          ) : (
            <div>
              {filteredInstItems.map((m) => renderInstalledRow(m))}
              {filteredManual.map((f) => (
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
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{f.replace(/\.(jar|zip)$/i, '')}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                        Manual —{' '}
                        {curType === 'mod'
                          ? 'dropped into the mods folder'
                          : curType === 'resourcepack'
                            ? 'dropped into the resource packs folder'
                            : curType === 'shader'
                              ? 'dropped into the shader packs folder'
                              : 'dropped into the data packs folder'}
                      </div>
                    </div>
                    <button
                      className="icon-danger-btn"
                      onClick={(e) => removeManual(f, e)}
                      title="Remove (hold Shift to remove immediately)"
                      aria-label={`Remove ${f}`}
                    >
                      <IconTrash style={{ width: 14, height: 14 }} />
                    </button>
                  </div>
                ))}
            </div>
          )}
        </Fragment>
      )}

      {/* Browse Modrinth */}
      {(tab === 'modrinth' || tab === 'curseforge') && renderBrowse()}
      {tab === 'curseforge' && cfSetup && (
        <div className="panel">
          <div className="panel-title">CurseForge is not connected</div>
          <p style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.55, marginTop: 6 }}>
            {cfError}
          </p>
          <p style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.55, marginTop: 8 }}>
            CurseForge requires an API key, and Reimagined keeps it out of the launcher
            entirely: you run the included <b>backend proxy</b> (folder{' '}
            <code style={{ fontFamily: 'monospace', background: 'var(--bg-2)', padding: '1px 5px', borderRadius: 5 }}>backend/cf-proxy</code>{' '}
            in the repo) with your key as a server-side <code style={{ fontFamily: 'monospace', background: 'var(--bg-2)', padding: '1px 5px', borderRadius: 5 }}>CF_API_KEY</code>{' '}
            env var, then paste its URL in Settings → Advanced → CurseForge proxy URL.
            The key never reaches your PC or this repository.
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <Button size="sm" variant="ghost" onClick={() => void doCurseforgeSearch(undefined, false)} disabled={cfSearching}>
              {cfSearching ? <Spinner /> : 'Retry search'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => window.open('https://github.com/friendlyssmp-blip/Reimagined_Launcher/tree/main/backend/cf-proxy', '_blank')}>
              Proxy setup guide
            </Button>
          </div>
        </div>
      )}
      {tab === 'curseforge' && cfError && !cfSetup && (
        <div className="panel warn-panel">
          <div className="panel-title">CurseForge request failed</div>
          <p style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.55, marginTop: 6 }}>
            {cfError}
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <Button size="sm" variant="ghost" onClick={() => void doCurseforgeSearch(undefined, false)} disabled={cfSearching}>
              {cfSearching ? <Spinner /> : 'Retry'}
            </Button>
          </div>
        </div>
      )}

        </Fragment>
      )}

      {/* Install confirmation with real dependency data */}
      {installConfirm && (
        <InstallConfirmModal
          target={installConfirm}
          onClose={() => setInstallConfirm(null)}
          onInstalled={(mod) => {
            if (mod && activeProfile) {
              setInstalled((prev) =>
                prev.some((m) => m.id === mod.id) ? prev.map((m) => (m.id === mod.id ? mod : m)) : [...prev, mod]
              )
              void api.mods.list(activeProfile.id).then(setInstalled).catch(() => {})
            }
          }}
        />
      )}
    </div>
  )
}
