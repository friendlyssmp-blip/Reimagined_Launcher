import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../state/AppContext'
import { sound } from '../lib/sound'
import { Button, Badge, Spinner, EmptyState, Toggle, TabBar } from './ui'
import { ModIcon } from './ModIcon'
import { InstallConfirmModal, type InstallTarget } from './InstallConfirmModal'
import { ProjectImage } from './ProjectImage'
import { api, friendlyError } from '../lib/api'
import { sanitizeHtml, isHtmlish } from '../lib/sanitizeHtml'
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
import type { ProfileMod, ProjectDetail as ProjectDetailData, ProjectVersionInfo, ShaderCrashRecord, ShaderSupport } from '@shared/types'
import { shaderFitFor, shaderFitClass } from '../lib/shaderFit'

type ContentType = 'mod' | 'resourcepack' | 'datapack' | 'shader' | 'modpack' | 'world'
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
  modpack: 'Modpack',
  world: 'World'
}

/** Minimal, safe markdown renderer — v1.0.52 (Bug 7).
 * Everything is HTML-escaped BEFORE parsing, so crafted input can never
 * inject markup. Supports images, fenced + inline code, headings, rules,
 * blockquotes, ordered/unordered lists (one nesting level), tables,
 * bold/italic/strikethrough and links. Malformed syntax degrades to plain
 * text — a broken construct never breaks the whole page. */
function renderMarkdown(md: string): string {
  const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // Pull fenced code blocks aside first so nothing inside them is parsed.
  const fences: string[] = []
  const step1 = md.replace(/```(\w*)[^\n]*\n?([\s\S]*?)```/g, (_m, _l, code) => {
    fences.push(code.replace(/\n$/, ''))
    return `\u0000FENCE${fences.length - 1}\u0000`
  })

  const inline = (raw: string): string => {
    let h = escapeHtml(raw)
    // v1.0.85 — badges: [![alt](image)](link) — image INSIDE a link (the
    // classic shields.io pattern). Handled first so the generic link regex
    // never leaves raw syntax behind.
    h = h.replace(
      /\[!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)\]\((https?:\/\/[^)\s]+)\)/g,
      (_m, alt, img, url) => {
        let isrc = ''
        let href = ''
        try { isrc = new URL(String(img)).href } catch { return String(alt) }
        try { href = new URL(String(url)).href } catch { return String(alt) }
        const esc = (s: string) => s.replace(/"/g, '%22').replace(/</g, '%3C').replace(/>/g, '%3E')
        return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer"><img src="${esc(isrc)}" alt="${String(alt ?? '').replace(/"/g, '&quot;').slice(0, 120)}" loading="lazy" /></a>`
      }
    )
    // Images — rendered inline, never raw markdown syntax.
    h = h.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (_m, alt, url) => {
      let href = ''
      try { href = new URL(String(url)).href } catch { return alt ? `[${alt}]` : '' }
      const safe = href.replace(/"/g, '%22').replace(/</g, '%3C').replace(/>/g, '%3E')
      return `<img src="${safe}" alt="${String(alt ?? '').replace(/"/g, '&quot;').slice(0, 120)}" loading="lazy" />`
    })
    // Links — validate + HTML-escape the href so a crafted URL can never
    // break out of the attribute (the body is injected via innerHTML).
    h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, text, url) => {
      let href = ''
      try { href = new URL(String(url)).href } catch { return String(text) }
      const safe = href.replace(/"/g, '%22').replace(/</g, '%3C').replace(/>/g, '%3E')
      return '<a href="' + safe + '" target="_blank" rel="noopener noreferrer">' + text + '</a>'
    })
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>')
    h = h.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    h = h.replace(/__([^_]+)__/g, '<b>$1</b>')
    h = h.replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>')
    h = h.replace(/~~([^~]+)~~/g, '<s>$1</s>')
    return h
  }

  const out: string[] = []
  const lines = step1.split('\n')
  let i = 0
  let para: string[] = []
  const flushPara = (): void => {
    if (para.length) { out.push('<p>' + para.join(' ') + '</p>'); para = [] }
  }
  const listKind = (l: string): 'ul' | 'ol' | null => {
    if (/^\s*[-*+]\s+/.test(l)) return 'ul'
    if (/^\s*\d+[.)]\s+/.test(l)) return 'ol'
    return null
  }

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    const fenceMatch = line.match(/^\u0000FENCE(\d+)\u0000$/)
    if (fenceMatch) {
      flushPara()
      out.push('<pre><code>' + escapeHtml(fences[Number(fenceMatch[1])] ?? '') + '</code></pre>')
      i++
      continue
    }

    if (!trimmed) { flushPara(); i++; continue }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      flushPara()
      const level = Math.min(6, heading[1].length + 1)
      out.push(`<h${level}>` + inline(heading[2]) + `</h${level}>`)
      i++
      continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed)) {
      flushPara()
      out.push('<hr />')
      i++
      continue
    }

    if (/^>\s?/.test(trimmed)) {
      flushPara()
      const quote: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(inline(lines[i].replace(/^>\s?/, '')))
        i++
      }
      out.push('<blockquote>' + quote.join(' ') + '</blockquote>')
      continue
    }

    // Pipe tables: header row + separator row + data rows.
    if (/^\|.*\|$/.test(trimmed) && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
      flushPara()
      const header = trimmed.split('|').slice(1, -1).map((c) => c.trim())
      i += 2
      const rows: string[][] = []
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
        rows.push(lines[i].split('|').slice(1, -1).map((c) => inline(c.trim())))
        i++
      }
      out.push(
        '<div class="md-table-wrap"><table><thead><tr>' +
        header.map((c) => `<th>${inline(c)}</th>`).join('') +
        '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + r.map((c) => `<td>${c}</td>`).join('') + '</tr>').join('') +
        '</tbody></table></div>'
      )
      continue
    }

    const kind = listKind(trimmed)
    if (kind) {
      flushPara()
      const tag = kind === 'ul' ? 'ul' : 'ol'
      out.push(`<${tag}>`)
      while (i < lines.length && listKind(lines[i].trim())) {
        const content = lines[i].trim().replace(/^\s*[-*+]\s+/, '').replace(/^\s*\d+[.)]\s+/, '')
        const nested: string[] = []
        while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && listKind(lines[i + 1].trim())) {
          nested.push('<li>' + inline(lines[i + 1].trim().replace(/^\s*[-*+]\s+/, '').replace(/^\s*\d+[.)]\s+/, '')) + '</li>')
          i++
        }
        out.push(
          nested.length > 0
            ? `<li>${inline(content)}<${tag === 'ul' ? 'ul' : 'ol'}>${nested.join('')}</${tag === 'ul' ? 'ul' : 'ol'}></li>`
            : '<li>' + inline(content) + '</li>'
        )
        i++
      }
      out.push(`</${tag}>`)
      continue
    }

    para.push(inline(trimmed))
    i++
  }
  flushPara()

  return out.join('\n')
}

/**
 * v1.0.85 — detect content that is actually markdown (headings, bold,
 * images, links, fences, lists, tables, quotes) even when the provider
 * didn't flag the format — the old "plain text" path showed raw `# title`
 * and `[![badge]](url)` syntax to the user.
 */
function looksLikeMarkdown(t: string): boolean {
  return /(^|\n)\s{0,3}#{1,6}\s|\*\*|__|!\[|\[[^\]]+\]\((https?:|\/)|```|^\s*[-*+]\s|^\s*\d+[.)]\s|^\s*>\s?|^\s*\|.*\|/m.test(t)
}

/**
 * Render a provider description/changelog safely. HTML (CurseForge) and
 * markdown-that-is-really-HTML (some Modrinth changelogs) are sanitized;
 * plain markdown goes through the escaped markdown renderer; plain text is
 * escaped paragraph by paragraph. v1.0.85 — markdown-looking content with no
 * explicit format is now rendered as markdown, and badge-style image-in-link
 * syntax inside HTML content is converted before sanitizing so it can never
 * show raw.
 */
function renderBody(text: string, format?: string): string {
  if (!text) return ''
  if (format === 'html') return sanitizeHtml(text)
  if (isHtmlish(text)) {
    const withBadges = text.replace(
      /\[!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$3" target="_blank" rel="noopener noreferrer"><img src="$2" alt="$1" loading="lazy" /></a>'
    )
    return sanitizeHtml(withBadges)
  }
  if (format === 'markdown' || looksLikeMarkdown(text)) return renderMarkdown(text)
  return text
    .split('\n').filter(Boolean)
    .map((p) => '<p>' + p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>')
    .join('')
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
  const { activeProfile, notify, setModals, pushContent } = useApp()
  const [detail, setDetail] = useState<ProjectDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [tab, setTab] = useState<DetailTab>('overview')
  const [showAllVersions, setShowAllVersions] = useState(false)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const overflowRef = useRef<HTMLDivElement | null>(null)
  /* v1.0.52 — open the menu leftward (default) unless the button sits near the
     left edge, where the menu would overflow the viewport on that side. */
  const [overflowAlign, setOverflowAlign] = useState<'right' | 'left'>('right')
  // Lazily-fetched CurseForge release notes, keyed by version id.
  const [changelogs, setChangelogs] = useState<Record<string, string>>({})
  const [changelogLoading, setChangelogLoading] = useState(false)
  // Install confirmation (plain click = dialog with real deps; Shift-click
  // = install immediately with dependencies).
  const [confirm, setConfirm] = useState<InstallTarget | null>(null)
  /* Part 1 (V2) — gallery lightbox: click any screenshot to view it full-size
   * with prev/next navigation; Esc or click-outside closes. v1.0.54 adds
   * scroll-wheel zoom centred on the cursor (reset on navigate / reopen). */
  const [lightbox, setLightbox] = useState<number | null>(null)
  const [lbZoom, setLbZoom] = useState(1)
  const [lbOrigin, setLbOrigin] = useState('50% 50%')
  /* v1.0.54 — reset zoom whenever a different screenshot is opened/navigated. */
  useEffect(() => {
    setLbZoom(1)
    setLbOrigin('50% 50%')
  }, [lightbox])
  /* Modpack Includes tab data (fetched from the .mrpack index on demand). */
  const [includes, setIncludes] = useState<PackFile[] | null>(null)
  const [includesLoading, setIncludesLoading] = useState(false)
  const [includesError, setIncludesError] = useState<string | null>(null)
  /* v1.0.56 — per-shader hardware-fit badge on the detail page. */
  const [shaderSupport, setShaderSupport] = useState<(ShaderSupport & { recentCrashes?: ShaderCrashRecord[] }) | null>(null)

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

  /* v1.0.56 — assess THIS machine for shaders (VRAM/driver via Shader Guard). */
  useEffect(() => {
    if (projectType !== 'shader') return
    let cancelled = false
    api.shaders
      .support(activeProfile?.id)
      .then((s) => {
        if (!cancelled) setShaderSupport(s)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [projectType, activeProfile?.id])

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
  // v1.0.51 — “Update Available” must only appear when the newest COMPATIBLE
  // version is genuinely newer than the installed one. The raw version list
  // mixes every Minecraft version/loader, so versions[0] used to trigger
  // false “Update Available” states for items that were already up to date.
  const isCompat = (v: ProjectVersionInfo): boolean => {
    if (compatibleCheck) return compatibleCheck(v)
    const mc = activeProfile?.minecraftVersion ?? ''
    const loader = activeProfile?.loader.type ?? ''
    return (
      (v.gameVersions.length === 0 || v.gameVersions.includes(mc)) &&
      (projectType !== 'mod' || v.loaders.length === 0 || v.loaders.includes(loader) || v.loaders.includes('any'))
    )
  }
  const latest = versions.find(isCompat) ?? versions[0]
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
    // v1.0.82 — page-driven install (global browse / modpacks) must work even
    // without an active profile; check onInstallVersion BEFORE the guard.
    if (onInstallVersion) {
      if (latest) installPackVersion(latest.id)
      return
    }
    if (!activeProfile) return
    // CurseForge first — its shift-click fast path is the same install (the
    // proxy exposes no dependency tree for CF), so the Modrinth-only
    // installWithDeps is never called with a CurseForge project id.
    if (provider === 'curseforge') {
      setBusy('latest')
      void api.mods
        .installCurseforge(activeProfile.id, projectId, { title: detail?.title, iconUrl: detail?.iconUrl, downloads: detail?.downloads }, projectType)
        .then((mod) => {
          onInstalledChange(mod)
          // v1.0.35 — install-complete payoff with the success checkmark.
          sound.installComplete()
          notify('success', 'Installed', mod.title, { silent: true })
        })
        .catch((err) => notify('error', 'Could not install', friendlyError(err)))
        .finally(() => setBusy(null))
      return
    }
    // Shift-click fast path — install immediately WITH dependencies.
    if (e?.shiftKey) {
      setBusy('latest')
      void api.mods
        .installWithDeps(activeProfile.id, projectId, '', projectType as 'mod' | 'resourcepack' | 'datapack' | 'shader')
        .then((res) => {
          onInstalledChange(res.mod)
          // v1.0.35 — install-complete payoff with the success checkmark.
          sound.installComplete()
          notify('success', 'Installed with dependencies', res.installed.join(', '), { silent: true })
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
    // v1.0.82 — page-driven install (global browse / modpacks) works without
    // an active profile; check onInstallVersion BEFORE the guard.
    if (onInstallVersion) {
      setBusy('v:' + v.id)
      void onInstallVersion(v.id)
        .catch(() => {})
        .finally(() => setBusy(null))
      return
    }
    if (!activeProfile) return
    // CurseForge first — the same install handles plain and shift-click (no
    // dependency tree is available for CF through the proxy).
    if (provider === 'curseforge') {
      setBusy('v:' + v.id)
      void api.mods
        .installVersion(activeProfile.id, provider, projectId, v.id, projectType)
        .then((mod) => {
          onInstalledChange(mod)
          // v1.0.35 — install-complete payoff with the success checkmark.
          sound.installComplete()
          notify('success', 'Installed', mod.title + ' ' + v.versionNumber, { silent: true })
        })
        .catch((err) => notify('error', 'Could not install this version', friendlyError(err)))
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
          // v1.0.35 — install-complete payoff with the success checkmark.
          sound.installComplete()
          notify('success', 'Installed with dependencies', res.installed.join(', '), { silent: true })
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
    const candidates = versions.filter((v) => v.id !== installed?.versionId && isCompat(v))
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
            <span style={{ fontSize: 13, color: 'var(--text-3)', fontWeight: 500 }}>
              by{' '}
              {/* v1.0.86 — author names open the creator's native profile page. */}
              <button
                className="author-link"
                title={`Open ${detail.author}'s creator profile`}
                onClick={(e) => {
                  e.stopPropagation()
                  pushContent({ kind: 'author', provider: detail.provider, username: detail.author })
                }}
              >
                {detail.author}
              </button>
            </span>
          </h2>
          <div style={{ color: 'var(--text-2)', fontSize: 13, marginTop: 2, lineHeight: 1.5 }}>
            {detail.description.split('\n')[0].slice(0, 140)}
          </div>
          <div className="mod-tags" style={{ marginTop: 8 }}>
            <span className="badge" style={{ background: 'var(--accent-soft)', color: 'var(--accent-3)', fontWeight: 600 }}>
              {CONTENT_LABEL[projectType]}
            </span>
            {projectType === 'shader' && shaderSupport && (() => {
              const crashPacks = (shaderSupport.recentCrashes ?? []).map((c) => c.shaderPack).filter((x): x is string => !!x)
              const fit = shaderFitFor(shaderSupport, detail.categories, crashPacks, detail.title)
              return (
                <span className={'badge ' + shaderFitClass(fit.level)} title={fit.hint} style={{ fontWeight: 600 }}>
                  {fit.label}
                </span>
              )
            })()}
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
          {projectType === 'shader' && shaderSupport && (() => {
            const crashPacks = (shaderSupport.recentCrashes ?? []).map((c) => c.shaderPack).filter((x): x is string => !!x)
            const fit = shaderFitFor(shaderSupport, detail.categories, crashPacks, detail.title)
            return (
              <div
                style={{
                  marginTop: 6,
                  fontSize: 11.5,
                  lineHeight: 1.4,
                  color: fit.level === 'ok' ? 'var(--success)' : fit.level === 'limited' ? 'var(--warn)' : 'var(--danger)'
                }}
              >
                {fit.hint}
              </div>
            )
          })()}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {!installed ? (
              <Button
                variant="primary"
                onClick={(e) => installLatest(e)}
                disabled={busy !== null}
                title={projectType === 'world' ? 'Download this world into an instance' : provider === 'curseforge' ? 'Install from CurseForge' : 'Install (hold Shift to install immediately with dependencies)'}
              >
                {busy === 'latest' ? <><Spinner /> {projectType === 'world' ? 'Downloading…' : 'Installing…'}</> : projectType === 'world' ? 'Download' : 'Install'}
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
            <div className="overflow-menu" ref={overflowRef}>
              <button
                className="nav-btn"
                onClick={() => {
                  const rect = overflowRef.current?.getBoundingClientRect()
                  setOverflowAlign(rect && rect.left < 220 ? 'left' : 'right')
                  /* v1.0.53 — the menu feels like it is expanding. */
                  if (!overflowOpen) sound.menuOpen()
                  setOverflowOpen((v) => !v)
                }}
                title="More actions"
              >
                <IconDots style={{ width: 15, height: 15 }} />
              </button>
              {overflowOpen && (
                <div
                  className="ctx-menu"
                  style={overflowAlign === 'left' ? { left: 0, right: 'auto', transformOrigin: 'top left' } : undefined}
                  onMouseDown={(e) => e.stopPropagation()}
                >
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
          Clicking it opens the lightbox directly at the first screenshot.
          v1.0.54 — uses the highest-resolution source when the provider
          exposes one (Modrinth raw original) instead of the optimised one. */}
      {detail.gallery?.[0]?.url && (
        <div className="detail-hero">
          <ProjectImage
            src={detail.gallery[0].raw ?? detail.gallery[0].url}
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
              dangerouslySetInnerHTML={{ __html: renderBody(detail.description, detail.descriptionFormat) }}
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
                                  ? renderBody(text, provider === 'curseforge' ? 'html' : 'markdown')
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
                      {projectType === 'world' ? (
                        /* v1.0.82 — worlds install through the instance picker as
                           a whole (latest file → saves/), not per-version. */
                        <Button variant="ghost" size="sm" disabled title="Worlds install as a full download">Download</Button>
                      ) : isThisCurrent ? (
                        <Button variant="ghost" size="sm" disabled>Current</Button>
                      ) : compatible ? (
                        <Button
                          variant={installed ? 'ghost' : 'primary'}
                          size="sm"
                          disabled={busy !== null}
                          onClick={(e) => (installed ? void changeVersion(v.id) : void installVersion(v, e))}
                          title={installed
                            ? 'Switch to this version'
                            : provider === 'curseforge'
                              ? 'Install this version from CurseForge'
                              : 'Install (hold Shift to install immediately with dependencies)'}
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

      {/* Install confirmation with real dependency data. v1.0.85 — portaled to
          <body> like the lightbox: the page wrapper (.page-enter) animates
          with transforms, which would trap a fixed overlay inside its stacking
          context and render it BEHIND the UI. */}
      {confirm &&
        createPortal(
          <InstallConfirmModal
            target={confirm}
            onClose={() => setConfirm(null)}
            onInstalled={(mod) => {
              if (mod) onInstalledChange(mod)
            }}
          />,
          document.body
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
            <div
              className="lightbox-stage"
              onClick={(e) => e.stopPropagation()}
              onWheel={(e) => {
                /* v1.0.54 — wheel zoom centred on the cursor, 1x..6x. Never
                 * lets the wheel bubble to anything behind the overlay. */
                e.stopPropagation()
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                if (rect.width === 0 || rect.height === 0) return
                const px = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100))
                const py = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100))
                setLbZoom((z) => {
                  const next = z * (e.deltaY < 0 ? 1.14 : 1 / 1.14)
                  return Math.min(6, Math.max(1, next))
                })
                setLbOrigin(`${px}% ${py}%`)
              }}
            >
              <ProjectImage
                src={detail.gallery[lightbox].raw ?? detail.gallery[lightbox].url}
                alt={detail.gallery[lightbox].title ?? detail.title}
                style={{
                  transform: lbZoom > 1 ? `scale(${lbZoom})` : undefined,
                  transformOrigin: lbOrigin,
                  transition: 'transform 0.12s var(--ease)',
                  willChange: lbZoom > 1 ? 'transform' : undefined
                }}
              />
              <div className="lightbox-counter">{lightbox + 1} / {detail.gallery.length} · {lbZoom > 1 ? `${Math.round(lbZoom * 100)}% · scroll to reset` : 'scroll to zoom'}</div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
