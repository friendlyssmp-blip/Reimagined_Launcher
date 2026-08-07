import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../state/AppContext'
import { Button, Badge, Spinner, EmptyState, Toggle, TabBar } from './ui'
import { ModIcon } from './ModIcon'
import { InstallConfirmModal, type InstallTarget } from './InstallConfirmModal'
import { ProjectImage } from './ProjectImage'
import { api, friendlyError } from '../lib/api'
import {
  IconDownload,
  IconExternal,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconFolder,
  IconX,
  IconDots,
  IconCopy,
  IconPuzzle,
  IconCheck,
  IconTrash
} from './icons'
import type { ProfileMod, ProjectDetail as ProjectDetailData, ProjectVersionInfo } from '@shared/types'

type ContentType = 'mod' | 'resourcepack' | 'datapack' | 'shader' | 'modpack'
type DetailTab = 'overview' | 'changelog' | 'gallery' | 'versions' | 'includes'

interface PackFile {
  path: string
  size: number
  source: 'modrinth' | 'curseforge' | 'bundled'
}

const CONTENT_LABEL: Record<ContentType, string> = {
  mod: 'Mod',
  resourcepack: 'Resource Pack',
  datapack: 'Data Pack',
  shader: 'Shader Pack',
  modpack: 'Modpack'
}

/** Minimal, safe markdown renderer (escapes everything first). */
function renderMarkdown(md: string): string {
  let html = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _l, code) => '<pre>' + code.trim() + '</pre>')
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/^### (.*)$/gm, '<h4>$1</h4>')
  html = html.replace(/^## (.*)$/gm, '<h3>$1</h3>')
  html = html.replace(/^# (.*)$/gm, '<h2>$1</h2>')
  html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  html = html.replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>')
  // Links — validate + HTML-escape the href so a crafted URL can never
  // break out of the attribute (the body is injected via innerHTML).
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, text, url) => {
    let href = ''
    try {
      href = new URL(String(url)).href
    } catch {
      return String(text)
    }
    const safe = href.replace(/"/g, '%22').replace(/</g, '%3C').replace(/>/g, '%3E')
    return '<a href="' + safe + '" target="_blank" rel="noopener noreferrer">' + text + '</a>'
  })
  html = html.replace(/^\s*[-*] (.*)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>[\s\S]*?<\/li>)\n?(?!<li>)/g, '<ul>$1</ul>')
  html = html.split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => (l.startsWith('<') ? l : '<p>' + l + '</p>')).join('\n')
  return html
}

function fmtCount(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}

function fmtDate(iso: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function fmtBytes(n?: number): string {
  if (!n || n <= 0) return '—'
  if (n >= 1 << 30) return (n / (1 << 30)).toFixed(1) + ' GB'
  if (n >= 1 << 20) return (n / (1 << 20)).toFixed(1) + ' MB'
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB'
  return n + ' B'
}

/** Client/server compatibility pill (Modrinth exposes these; CurseForge doesn't). */
function sideLabel(clientSide?: string, serverSide?: string): string | null {
  if (!clientSide && !serverSide) return null
  if (clientSide === 'unsupported') return 'Server Only'
  if (serverSide === 'unsupported') return 'Client Only'
  return 'Client and Server'
}

/**
 * Full project detail page — one component reused for mods, resource packs,
 * data packs and shaders, populated with each source's real data. Includes
 * browser-style back/forward history (owned by ModsPage), a breadcrumb of the
 * current profile context, header stat pills, an overflow menu and four tabs
 * (Overview / Changelog / Gallery / Versions).
 */
export function ProjectDetail({
  provider,
  projectId,
  projectType,
  installed,
  onBack,
  onForward,
  canBack,
  canForward,
  onClose,
  onInstalledChange,
  /* Modpacks (V2): installs create a whole new profile — the page drives the
   * action through these optional props instead of the per-profile install. */
  onInstallVersion,
  compatibleCheck,
  contextLabel,
  modpackIncludes
}: {
  provider: 'modrinth' | 'curseforge'
  projectId: string
  projectType: ContentType
  installed: ProfileMod | null
  onBack: () => void
  onForward: () => void
  canBack: boolean
  canForward: boolean
  onClose: () => void
  onInstalledChange: (mod: ProfileMod | null) => void
  onInstallVersion?: (versionId: string) => Promise<void>
  compatibleCheck?: (v: ProjectVersionInfo) => boolean
  contextLabel?: string
  /* Modpacks: resolve what the pack actually contains (Includes tab). */
  modpackIncludes?: (versionId: string) => Promise<PackFile[]>
}) {
  const { activeProfile, notify, setModals } = useApp()
  const [detail, setDetail] = useState<ProjectDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [tab, setTab] = useState<DetailTab>('overview')
  const [showAllVersions, setShowAllVersions] = useState(false)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const overflowRef = useRef<HTMLDivElement | null>(null)
  // Lazily-fetched CurseForge release notes, keyed by version id.
  const [changelogs, setChangelogs] = useState<Record<string, string>>({})
  const [changelogLoading, setChangelogLoading] = useState(false)
  // Install confirmation (plain click = dialog with real deps; Shift-click
  // = install immediately with dependencies).
  const [confirm, setConfirm] = useState<InstallTarget | null>(null)
  /* Part 1 (V2) — gallery lightbox: click any screenshot to view it full-size
   * with prev/next navigation; Esc or click-outside closes. */
  const [lightbox, setLightbox] = useState<number | null>(null)
  /* Modpack Includes tab data (fetched from the .mrpack index on demand). */
  const [includes, setIncludes] = useState<PackFile[] | null>(null)
  const [includesLoading, setIncludesLoading] = useState(false)
  const [includesError, setIncludesError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setDetail(await api.content.detail({ provider, projectId, projectType }))
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }, [provider, projectId, projectType])

  useEffect(() => { void load() }, [load])

  // Fresh page state for every project (incl. closing any open lightbox so
  // back/forward navigation never shows a stale screenshot from the last one).
  useEffect(() => {
    setTab('overview')
    setOverflowOpen(false)
    setChangelogs({})
    setChangelogLoading(false)
    setShowAllVersions(false)
    setLightbox(null)
    setIncludes(null)
    setIncludesError(null)
  }, [provider, projectId])

  /* Includes: fetch the pack's manifest file list when the tab opens. */
  useEffect(() => {
    if (tab !== 'includes' || projectType !== 'modpack' || !modpackIncludes || includes !== null) return
    const target = detail?.versions?.[0] ?? null
    if (!target) {
      setIncludes([])
      return
    }
    let cancelled = false
    setIncludesLoading(true)
    setIncludesError(null)
    modpackIncludes(target.id)
      .then((files) => {
        if (!cancelled) setIncludes(files)
      })
      .catch((err) => {
        if (!cancelled) setIncludesError(friendlyError(err))
      })
      .finally(() => {
        if (!cancelled) setIncludesLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, projectType, detail, includes, modpackIncludes])

  /* Lightbox keyboard: Esc closes, ← / → navigate between screenshots. */
  useEffect(() => {
    if (lightbox === null) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setLightbox(null)
      else if (e.key === 'ArrowRight' && detail && detail.gallery.length > 1) {
        setLightbox((i) => ((i ?? 0) + 1) % detail.gallery.length)
      } else if (e.key === 'ArrowLeft' && detail && detail.gallery.length > 1) {
        setLightbox((i) => ((i ?? 0) - 1 + detail.gallery.length) % detail.gallery.length)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox, detail])

  // Close the overflow menu on outside clicks or Escape (never swallow its own clicks).
  useEffect(() => {
    if (!overflowOpen) return
    const close = (e: MouseEvent): void => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) setOverflowOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOverflowOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [overflowOpen])

  const versions = detail?.versions ?? []
  const latest = versions[0]
  const isCurrent = Boolean(installed && latest && installed.versionId === latest.id)

  // CurseForge release notes are per-file — fetch them lazily in the tab.
  useEffect(() => {
    if (tab !== 'changelog' || provider !== 'curseforge' || !detail) return
    const missing = detail.versions.filter((v) => changelogs[v.id] === undefined)
    if (missing.length === 0) return
    let cancelled = false
    setChangelogLoading(true)
    ;(async () => {
      for (const v of missing) {
        if (cancelled) return
        let text = ''
        try {
          text = await api.content.changelog(projectId, v.id)
        } catch {
          text = ''
        }
        if (!cancelled) setChangelogs((prev) => ({ ...prev, [v.id]: text }))
      }
      if (!cancelled) setChangelogLoading(false)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, provider, projectId, detail])

  /* Part 1 (V2) — modpacks install a whole new profile through the page that
   * owns them; the per-profile install flow never runs for those. */
  const installPackVersion = (versionId: string) => {
    if (!onInstallVersion) return
    setBusy('latest')
    void onInstallVersion(versionId)
      .catch(() => {})
      .finally(() => setBusy(null))
  }

  const installLatest = (e?: React.MouseEvent) => {
    if (!activeProfile) return
    // Modpack path — page-driven install (new profile is created by the page).
    if (onInstallVersion) {
      if (latest) installPackVersion(latest.id)
      return
    }
    // Shift-click fast path — install immediately WITH dependencies.
    if (e?.shiftKey) {
      setBusy('latest')
      void api.mods
        .installWithDeps(activeProfile.id, projectId, '', projectType as 'mod' | 'resourcepack' | 'datapack' | 'shader')
        .then((res) => {
          onInstalledChange(res.mod)
          notify('success', 'Installed with dependencies', res.installed.join(', '))
        })
        .catch((err) => notify('error', 'Could not install', friendlyError(err)))
        .finally(() => setBusy(null))
      return
    }
    if (provider === 'curseforge') {
      // CurseForge is no longer supported — direct fallback for legacy items.
      setBusy('latest')
      void api.mods
        .installCurseforge(activeProfile.id, projectId, { title: detail?.title, iconUrl: detail?.iconUrl, downloads: detail?.downloads }, projectType)
        .then((mod) => {
          onInstalledChange(mod)
          notify('success', 'Installed', mod.title)
        })
        .catch((err) => notify('error', 'Could not install', friendlyError(err)))
        .finally(() => setBusy(null))
      return
    }
    setConfirm({ provider: 'modrinth', projectId, projectType: projectType as 'mod' | 'resourcepack' | 'datapack' | 'shader' })
  }

  const updateInstalled = async () => {
    if (!activeProfile || !installed) return
    setBusy('update')
    try {
      const mod = await api.mods.update(activeProfile.id, installed.slug)
      onInstalledChange(mod)
      notify('success', 'Updated', `${mod.title} → ${mod.versionNumber}`)
    } catch (err) {
      notify('error', 'Could not update', friendlyError(err))
    } finally {
      setBusy(null)
    }
  }

  const installVersion = (v: ProjectVersionInfo, e?: React.MouseEvent) => {
    if (!activeProfile) return
    // Modpack path — page-driven install.
    if (onInstallVersion) {
      setBusy('v:' + v.id)
      void onInstallVersion(v.id)
        .catch(() => {})
        .finally(() => setBusy(null))
      return
    }
    // Shift-click fast path — install immediately WITH dependencies.
    if (e?.shiftKey) {
      setBusy('v:' + v.id)
      void api.mods
        .installWithDeps(activeProfile.id, projectId, v.id, projectType as 'mod' | 'resourcepack' | 'datapack' | 'shader')
        .then((res) => {
          onInstalledChange(res.mod)
          notify('success', 'Installed with dependencies', res.installed.join(', '))
        })
        .catch((err) => notify('error', 'Could not install this version', friendlyError(err)))
        .finally(() => setBusy(null))
      return
    }
    if (provider === 'curseforge') {
      setBusy('v:' + v.id)
      void api.mods
        .installVersion(activeProfile.id, provider, projectId, v.id, projectType)
        .then((mod) => {
          onInstalledChange(mod)
          notify('success', 'Installed', mod.title + ' ' + v.versionNumber)
        })
        .catch((err) => notify('error', 'Could not install this version', friendlyError(err)))
        .finally(() => setBusy(null))
      return
    }
    setConfirm({ provider: 'modrinth', projectId, projectType: projectType as 'mod' | 'resourcepack' | 'datapack' | 'shader', versionId: v.id })
  }

  const changeVersion = async (versionId: string) => {
    if (!activeProfile || !installed) return
    setBusy('cv:' + versionId)
    try {
      const mod = await api.mods.changeVersion(activeProfile.id, installed.slug, versionId)
      onInstalledChange(mod)
      notify('success', 'Version changed', mod.title + ' → ' + mod.versionNumber)
    } catch (err) {
      notify('error', 'Could not change version', friendlyError(err))
    } finally {
      setBusy(null)
    }
  }

  const toggleEnabled = async (enabled: boolean) => {
    if (!activeProfile || !installed) return
    setBusy('toggle')
    try {
      const mod = await api.mods.setEnabled(activeProfile.id, installed.slug, enabled)
      onInstalledChange(mod)
      notify('info', enabled ? 'Enabled' : 'Disabled', mod.title)
    } catch (err) {
      notify('error', 'Could not toggle item', friendlyError(err))
    } finally {
      setBusy(null)
    }
  }

  const doRemoveInstalled = async () => {
    if (!activeProfile || !installed) return
    setBusy('remove')
    try {
      await api.mods.remove(activeProfile.id, installed.slug)
      onInstalledChange(null)
      notify('success', 'Removed', installed.title)
    } catch (err) {
      notify('error', 'Could not remove', friendlyError(err))
    } finally {
      setBusy(null)
    }
  }

  /** Remove always asks first unless the user holds SHIFT (immediate). */
  const removeInstalled = (e?: React.MouseEvent) => {
    if (!activeProfile || !installed) return
    if (e?.shiftKey) {
      void doRemoveInstalled()
      return
    }
    setModals({
      confirm: {
        title: 'Remove item',
        message: `Are you sure you want to remove “${installed.title}”? This deletes its file from the instance (hold Shift next time to skip this confirmation).`,
        confirmLabel: 'Remove',
        danger: true,
        onConfirm: () => void doRemoveInstalled()
      }
    })
  }

  const openFolder = async () => {
    if (!activeProfile) return
    try {
      await api.content.openFolder(activeProfile.id)
    } catch (err) {
      notify('error', 'Could not open folder', friendlyError(err))
    }
  }

  const copyLink = async () => {
    if (!detail) return
    try {
      await navigator.clipboard.writeText(detail.url)
      notify('success', 'Link copied')
    } catch {
      notify('error', 'Could not copy link')
    }
  }

  const changeToNewestCompatible = () => {
    const candidates = versions.filter(
      (v) => v.id !== installed?.versionId &&
        (v.gameVersions.length === 0 || v.gameVersions.includes(activeProfile?.minecraftVersion ?? ''))
    )
    if (candidates.length === 0) {
      notify('info', 'No other versions', 'No other compatible versions were found for this profile.')
      return
    }
    void changeVersion(candidates[0].id)
  }

  const loaderPills = (latest?.loaders ?? []).filter((l) => l === 'fabric' || l === 'forge').slice(0, 2)
  const compat = sideLabel(detail?.clientSide, detail?.serverSide)
  const showChangelogTab = provider === 'curseforge' || versions.some((v) => v.changelog)
  const visibleVersions = showAllVersions ? versions : versions.slice(0, 8)

  if (loading && !detail) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '40px 0', justifyContent: 'center' }}>
        <Spinner lg />
        <span style={{ color: 'var(--text-2)' }}>Loading project details…</span>
      </div>
    )
  }

  if (error && !detail) {
    return (
      <EmptyState
        title="Could not load this project"
        sub={error}
        action={<Button variant="ghost" onClick={onClose}>Go back</Button>}
      />
    )
  }

  if (!detail) return null

  return (
    <div className="detail-page" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Top bar: browser-style nav + breadcrumb, close on the right */}
      <div className="detail-topbar">
        <div className="detail-nav">
          <button className="nav-btn" onClick={onBack} disabled={!canBack} title="Back">
            <IconChevronLeft style={{ width: 15, height: 15 }} />
          </button>
          <button className="nav-btn" onClick={onForward} disabled={!canForward} title="Forward">
            <IconChevronRight style={{ width: 15, height: 15 }} />
          </button>
          <span className="detail-breadcrumb">
            <IconPuzzle style={{ width: 13, height: 13 }} />
            {contextLabel ??
              (activeProfile
                ? `${activeProfile.name} · ${activeProfile.loader.type === 'vanilla' ? 'Vanilla' : activeProfile.loader.type} / ${activeProfile.minecraftVersion}`
                : 'Mods')}
          </span>
        </div>
        <button className="nav-btn" onClick={onClose} title="Close">
          <IconX style={{ width: 15, height: 15 }} />
        </button>
      </div>

      {/* Header: big icon, title/author, tagline, stat pills, actions */}
      <div className="detail-head">
        <div className="mod-icon detail-icon" style={{ width: 96, height: 96, borderRadius: 22 }}>
          {detail.iconUrl ? <ModIcon src={detail.iconUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <IconPuzzle style={{ width: 34, height: 34 }} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: 26, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            {detail.title}
            <span style={{ fontSize: 13, color: 'var(--text-3)', fontWeight: 500 }}>by {detail.author}</span>
          </h2>
          <div style={{ color: 'var(--text-2)', fontSize: 13, marginTop: 2, lineHeight: 1.5 }}>
            {detail.description.split('\n')[0].slice(0, 140)}
          </div>
          <div className="mod-tags" style={{ marginTop: 8 }}>
            <span className="badge" style={{ background: 'var(--accent-soft)', color: 'var(--accent-3)', fontWeight: 600 }}>
              {CONTENT_LABEL[projectType]}
            </span>
            <span className="badge"><IconDownload style={{ width: 11, height: 11 }} /> {fmtCount(detail.downloads)}</span>
            <span className="badge"><IconClock style={{ width: 11, height: 11 }} /> {fmtDate(detail.updatedAt)}</span>
            {latest?.size ? <span className="badge">{fmtBytes(latest.size)}</span> : null}
            {(latest?.gameVersions?.[0] || activeProfile?.minecraftVersion) && (
              <span className="badge">MC {latest?.gameVersions?.[0] || activeProfile?.minecraftVersion}</span>
            )}
            {compat && <span className="badge">{compat}</span>}
            {loaderPills.map((l) => <span key={l} className="badge" style={{ textTransform: 'capitalize' }}>{l}</span>)}
            {(detail.categories ?? []).slice(0, 3).map((c) => <span key={c} className="badge">{c}</span>)}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {!installed ? (
              <Button
                variant="primary"
                onClick={(e) => installLatest(e)}
                disabled={busy !== null}
                title="Install (hold Shift to install immediately with dependencies)"
              >
                {busy === 'latest' ? <><Spinner /> Installing…</> : 'Install'}
              </Button>
            ) : isCurrent ? (
              <Button variant="ghost" disabled>
                <IconCheck style={{ width: 13, height: 13 }} /> Up to date
              </Button>
            ) : (
              <Button variant="primary" onClick={updateInstalled} disabled={busy !== null}>
                {busy === 'update' ? <><Spinner /> Updating…</> : 'Update Available'}
              </Button>
            )}
            <div style={{ position: 'relative' }} ref={overflowRef}>
              <button className="nav-btn" onClick={() => setOverflowOpen((v) => !v)} title="More actions">
                <IconDots style={{ width: 15, height: 15 }} />
              </button>
              {overflowOpen && (
                <div className="overflow-menu" onMouseDown={(e) => e.stopPropagation()}>
                  <button onClick={() => { setOverflowOpen(false); window.open(detail.url, '_blank') }}>
                    <IconExternal style={{ width: 13, height: 13 }} /> Open project page
                  </button>
                  <button onClick={() => { setOverflowOpen(false); void copyLink() }}>
                    <IconCopy style={{ width: 13, height: 13 }} /> Copy link
                  </button>
                </div>
              )}
            </div>
          </div>
          {installed && (
            <div style={{ display: 'flex', gap: 6 }}>
              <Toggle
                checked={!installed.disabled}
                onChange={(v) => void toggleEnabled(v)}
                label={installed.disabled ? 'Off' : 'On'}
              />
              <Button variant="ghost" size="sm" onClick={openFolder} title="Open instance folder">
                <IconFolder style={{ width: 13, height: 13 }} />
              </Button>
              {/* Part 5 (V2) — Remove as a minimalist trash icon; same
                  function (confirm unless Shift is held). */}
              <button
                className="icon-danger-btn"
                onClick={(e) => removeInstalled(e)}
                disabled={busy === 'remove'}
                title="Remove (hold Shift to remove immediately)"
                aria-label="Remove"
              >
                {busy === 'remove' ? <Spinner /> : <IconTrash style={{ width: 14, height: 14 }} />}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Big preview — the project's main gallery image, full-width hero.
          Clicking it opens the lightbox directly at the first screenshot. */}
      {detail.gallery?.[0]?.url && (
        <div className="detail-hero">
          <ProjectImage
            src={detail.gallery[0].url}
            alt={detail.gallery[0].title ?? detail.title}
            onClick={() => setLightbox(0)}
            title="View gallery (click to enlarge)"
          />
          {detail.gallery.length > 1 && (
            <span className="detail-hero-count">{detail.gallery.length} screenshots</span>
          )}
        </div>
      )}

      {installed && (
        <div className="detail-actions">
          <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
            Installed: <b>{installed.versionNumber}</b>{installed.disabled ? ' · disabled' : ''}
            {installed.updateAvailable && !isCurrent ? ` · update to ${installed.updateAvailable.versionNumber} available` : ''}
          </span>
          <Button variant="ghost" size="sm" disabled={busy !== null} onClick={changeToNewestCompatible}>
            Change to newest compatible
          </Button>
        </div>
      )}

      {/* Tabs */}
      <TabBar
        tabs={[
          { id: 'overview', label: 'Overview' },
          ...(showChangelogTab ? [{ id: 'changelog', label: 'Changelog' }] : []),
          { id: 'gallery', label: 'Gallery' },
          ...(projectType === 'modpack' && modpackIncludes ? [{ id: 'includes', label: 'Includes' }] : []),
          { id: 'versions', label: `Versions (${versions.length})` }
        ]}
        active={tab}
        onChange={(id) => setTab(id as DetailTab)}
      />

      <div key={tab} className="tab-fade">
        {tab === 'overview' && detail.description && (
          <div className="panel">
            <div className="panel-title">Description</div>
            <div
              className="detail-body"
              style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.65, marginTop: 8, userSelect: 'text' }}
              dangerouslySetInnerHTML={{
                __html:
                  detail.descriptionFormat === 'markdown'
                    ? renderMarkdown(detail.description)
                    : detail.description.split('\n').filter(Boolean).map((p) => '<p>' + p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>').join('')
              }}
            />
          </div>
        )}

        {tab === 'changelog' && (
          <div className="panel">
            <div className="panel-title">Changelog</div>
            {changelogLoading && versions.filter((v) => changelogs[v.id] === undefined).length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', color: 'var(--text-3)', fontSize: 12.5 }}>
                <Spinner /> Loading changelogs…
              </div>
            )}
            <div className="version-list" style={{ marginTop: changelogLoading ? 4 : 8 }}>
              {versions
                .filter((v) => provider === 'curseforge' || v.changelog)
                .map((v) => {
                  const text = provider === 'curseforge' ? changelogs[v.id] : (v.changelog ?? '')
                  return (
                    <div key={v.id} className="version-row">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 650, fontSize: 13 }}>
                          {v.versionNumber}
                          <span className="badge" style={{ marginLeft: 8 }}>{fmtDate(v.datePublished)}</span>
                        </div>
                        <div className="changelog-body" style={{ marginTop: 6, fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6, userSelect: 'text' }}>
                          {text === undefined ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-3)' }}>
                              <Spinner /> Loading…
                            </span>
                          ) : (
                            <div
                              dangerouslySetInnerHTML={{
                                __html: text
                                  ? renderMarkdown(text)
                                  : '<em>No changelog available for this version.</em>'
                              }}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              {versions.filter((v) => provider === 'curseforge' || v.changelog).length === 0 && (
                <p style={{ color: 'var(--text-3)', fontSize: 13 }}>No changelog entries available.</p>
              )}
            </div>
          </div>
        )}

        {tab === 'gallery' && (
          detail.gallery.length === 0 ? (
            <EmptyState title="No screenshots" sub="This project has no gallery images." />
          ) : (
            <div className="panel">
              <div className="panel-title">Gallery ({detail.gallery.length})</div>
              <div className="detail-gallery">
                {detail.gallery.map((g, i) => (
                  <ProjectImage
                    key={i}
                    src={g.url}
                    alt={g.title ?? ''}
                    loading="lazy"
                    onClick={() => setLightbox(i)}
                    title="Click to enlarge"
                  />
                ))}
              </div>
            </div>
          )
        )}

        {tab === 'versions' && (
          <div className="panel">
            <div className="panel-title">Versions ({versions.length})</div>
            {versions.length === 0 ? (
              <p style={{ color: 'var(--text-3)', fontSize: 13, marginTop: 6 }}>No versions available.</p>
            ) : (
              <div className="version-list">
                {visibleVersions.map((v) => {
                  const isThisCurrent = installed?.versionId === v.id
                  const compatible = compatibleCheck
                    ? compatibleCheck(v)
                    : v.gameVersions.length === 0 || v.gameVersions.includes(activeProfile?.minecraftVersion ?? '')
                  return (
                    <div key={v.id} className={'version-row' + (isThisCurrent ? ' current' : '') + (compatible ? '' : ' incompatible')}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 650, fontSize: 13 }}>
                          {v.versionNumber}
                          {isThisCurrent && <span style={{ marginLeft: 8 }}><Badge variant="success">installed</Badge></span>}
                          {!compatible && <span style={{ marginLeft: 8 }}><Badge variant="danger">incompatible</Badge></span>}
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 3 }}>
                          {fmtDate(v.datePublished)}
                          {v.gameVersions.slice(0, 6).map((g) => <span key={g} className="badge" style={{ marginLeft: 6 }}>MC {g}</span>)}
                          {v.loaders.slice(0, 4).map((l) => <span key={l} className="badge" style={{ marginLeft: 6 }}>{l}</span>)}
                        </div>
                      </div>
                      {isThisCurrent ? (
                        <Button variant="ghost" size="sm" disabled>Current</Button>
                      ) : compatible ? (
                        <Button
                          variant={installed ? 'ghost' : 'primary'}
                          size="sm"
                          disabled={busy !== null}
                          onClick={(e) => (installed ? void changeVersion(v.id) : void installVersion(v, e))}
                          title={installed ? 'Switch to this version' : 'Install (hold Shift to install immediately with dependencies)'}
                        >
                          {busy === 'v:' + v.id || busy === 'cv:' + v.id ? <Spinner /> : installed ? 'Switch' : 'Install'}
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" disabled title="Needs a different Minecraft version">—</Button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {versions.length > 8 && (
              <Button variant="ghost" size="sm" onClick={() => setShowAllVersions((v) => !v)} style={{ marginTop: 10 }}>
                {showAllVersions ? 'Show fewer' : 'Show all ' + versions.length + ' versions'}
              </Button>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
          {contextLabel
            ? contextLabel
            : `Profile: ${activeProfile?.name} · ${activeProfile?.minecraftVersion} · ${activeProfile?.loader.type}`}
        </span>
      </div>

      {/* Install confirmation with real dependency data */}
      {confirm && (
        <InstallConfirmModal
          target={confirm}
          onClose={() => setConfirm(null)}
          onInstalled={(mod) => {
            if (mod) onInstalledChange(mod)
          }}
        />
      )}

      {/* Part 1 (V2) — full-screen gallery lightbox, portaled to <body> so no
          ancestor transform/overflow can clip it. Click outside or Esc to
          close; ← / → (or the arrows) move between screenshots. */}
      {lightbox !== null && detail.gallery[lightbox] &&
        createPortal(
          <div className="lightbox-overlay" onClick={() => setLightbox(null)} role="dialog" aria-modal="true" aria-label="Screenshot viewer">
            <button className="lightbox-close" onClick={() => setLightbox(null)} aria-label="Close">
              <IconX style={{ width: 18, height: 18 }} />
            </button>
            {detail.gallery.length > 1 && (
              <>
                <button
                  className="lightbox-nav lightbox-prev"
                  onClick={(e) => { e.stopPropagation(); setLightbox((lightbox - 1 + detail.gallery.length) % detail.gallery.length) }}
                  aria-label="Previous image"
                >
                  <IconChevronLeft style={{ width: 22, height: 22 }} />
                </button>
                <button
                  className="lightbox-nav lightbox-next"
                  onClick={(e) => { e.stopPropagation(); setLightbox((lightbox + 1) % detail.gallery.length) }}
                  aria-label="Next image"
                >
                  <IconChevronRight style={{ width: 22, height: 22 }} />
                </button>
              </>
            )}
            <div className="lightbox-stage" onClick={(e) => e.stopPropagation()}>
              <ProjectImage
                src={detail.gallery[lightbox].url}
                alt={detail.gallery[lightbox].title ?? detail.title}
              />
              <div className="lightbox-counter">{lightbox + 1} / {detail.gallery.length}</div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
