/**
 * Servers (v1.0.89, visually upgraded v2.0.0) — a real server browser:
 *
 *   Favorites   your saved servers (live ping / MOTD / players, add + join)
 *   Discover    a curated directory of real public servers, searchable and
 *               filterable by category, with previews (MOTD, players, version)
 *   Recommended servers matched to the mods in the active profile
 *
 * Any directory server can be INSTALLED into an instance — the launcher writes
 * it into that instance's servers.dat, so it appears in the in-game multiplayer
 * list. Join launches the active profile straight into the server.
 *
 * v2.0.0: every string routes through i18n (no raw keys), live status actually
 * resolves (ping re-runs when data arrives + periodic refresh), and cards show
 * the server's real favicon icon with full dark/purple theming.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../state/AppContext'
import { api, friendlyError } from '../lib/api'
import { Button, Spinner, Modal } from '../components/ui'
import {
  IconPlus,
  IconTrash,
  IconRefresh,
  IconGlobe,
  IconPlay,
  IconClock,
  IconSearch,
  IconDownload,
  IconStar,
  IconX,
  IconUser,
  IconChevronRight
} from '../components/icons'
import { useT } from '../lib/i18n'
import type { ServerStatus, ServerFavorite, RecentServer, DirectoryServer, ServerCategory } from '@shared/types'

const CATEGORIES: ServerCategory[] = ['Minigames', 'Survival', 'Skyblock', 'Anarchy', 'MMORPG', 'Creative', 'Prison']

/** Minecraft §-code MOTD → safe colored HTML. */
function motdHtml(motd: string): string {
  const colors: Record<string, string> = {
    '0': '#000', '1': '#00a', '2': '#0a0', '3': '#0aa', '4': '#a00', '5': '#a0a',
    '6': '#aa0', '7': '#aaa', '8': '#555', '9': '#55f', a: '#5f5', b: '#5ff',
    c: '#f55', d: '#f5f', e: '#ff5', f: '#fff'
  }
  let out = ''
  let i = 0
  let cur = 'color:#fff'
  const parts = motd.split('§')
  out = parts[0] ?? ''
  for (const p of parts.slice(1)) {
    const code = p[0]
    const rest = p.slice(1)
    if (code === 'l') cur = cur + ';font-weight:bold'
    else if (code === 'r') cur = 'color:#fff'
    else if (code && colors[code]) cur = `color:${colors[code]}`
    out += `<span style="${cur}">${rest}</span>`
  }
  return out
}

/** v2.0.0 — the server's real favicon (data:image/png;base64), or a clean
 * on-brand generic server tile when the server provides no icon. */
function ServerIcon({ status, name, size = 44 }: { status?: ServerStatus; name: string; size?: number }) {
  if (status?.icon) {
    return (
      <div className="srv-icon" style={{ width: size, height: size }}>
        <img src={status.icon} alt="" draggable={false} />
      </div>
    )
  }
  return (
    <div className="srv-icon fallback" style={{ width: size, height: size }} title={name}>
      <IconGlobe style={{ width: size * 0.5, height: size * 0.5 }} />
    </div>
  )
}

export function ServersPage() {
  const { settings, updateSettings, activeProfile, profiles, notify } = useApp()
  const t = useT()
  const favorites = settings.servers ?? []
  const recents = settings.recentServers ?? []

  const [tab, setTab] = useState<'favorites' | 'discover' | 'recommended'>('discover')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<'' | ServerCategory>('')
  const [directory, setDirectory] = useState<DirectoryServer[]>([])
  const [recommended, setRecommended] = useState<DirectoryServer[]>([])
  const [statuses, setStatuses] = useState<Record<string, ServerStatus>>({})
  const [preview, setPreview] = useState<DirectoryServer | null>(null)
  const [installServer, setInstallServer] = useState<DirectoryServer | null>(null)
  const [installSearch, setInstallSearch] = useState('')
  const [joining, setJoining] = useState<string | null>(null)
  const [pinging, setPinging] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newAddr, setNewAddr] = useState('')

  useEffect(() => {
    void api.servers.discover({}).then(setDirectory).catch(() => {})
  }, [])
  useEffect(() => {
    void api.servers.recommended(activeProfile?.id ?? null).then(setRecommended).catch(() => {})
  }, [activeProfile?.id])

  const pingOne = useCallback(async (address: string) => {
    try {
      const s = await api.servers.ping(address)
      setStatuses((prev) => ({ ...prev, [address]: s }))
    } catch {
      setStatuses((prev) => ({ ...prev, [address]: { address, online: false, latencyMs: null } }))
    }
  }, [])

  const pingAll = useCallback(async () => {
    setPinging(true)
    const addrs = [...new Set([...favorites.map((f) => f.address), ...directory.map((d) => d.address), ...recommended.map((d) => d.address)])]
    await Promise.allSettled(addrs.map((a) => pingOne(a)))
    setPinging(false)
  }, [favorites, directory, recommended, pingOne])

  /* v2.0.0 — BUG FIX: the old code pinged once on mount, but the directory /
   * recommended lists load AFTER mount, so those cards never got a status and
   * stayed on "Loading…" forever. Now the effect re-runs whenever the server
   * set changes (data arrival, favorite add/remove) and refreshes in the
   * background every 60 s. */
  const addrKey = [
    favorites.map((f) => f.address).join(','),
    directory.map((d) => d.address).join(','),
    recommended.map((d) => d.address).join(',')
  ].join('|')
  useEffect(() => {
    void pingAll()
    const iv = window.setInterval(() => void pingAll(), 60_000)
    return () => window.clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addrKey])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = directory
    if (category) list = list.filter((s) => s.category === category)
    if (q) {
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.address.toLowerCase().includes(q) ||
          s.tags.some((tag) => tag.includes(q))
      )
    }
    return list
  }, [directory, query, category])

  /* ------------------------------- actions ------------------------------- */

  const add = async () => {
    const addr = newAddr.trim()
    if (!addr) {
      notify('error', t('srv.addServer'), t('srv.enterAddress'))
      return
    }
    setAdding(true)
    try {
      const list = await api.servers.addFavorite({ name: newName.trim() || addr, address: addr })
      await updateSettings({ servers: list })
      setNewName('')
      setNewAddr('')
      void pingOne(addr)
      notify('success', t('srv.added'), t('srv.added.sub', { name: newName.trim() || addr }))
    } catch (err) {
      notify('error', t('srv.couldNotAdd'), friendlyError(err))
    } finally {
      setAdding(false)
    }
  }

  const remove = async (id: string) => {
    try {
      const list = await api.servers.removeFavorite(id)
      await updateSettings({ servers: list })
    } catch (err) {
      notify('error', t('srv.couldNotRemove'), friendlyError(err))
    }
  }

  const toggleFavorite = async (address: string, name: string) => {
    const existing = favorites.find((f) => f.address === address)
    if (existing) {
      await remove(existing.id)
      notify('info', t('srv.removedFav'), name)
    } else {
      try {
        const list = await api.servers.addFavorite({ name, address })
        await updateSettings({ servers: list })
        notify('success', t('srv.addedFav'), name)
      } catch (err) {
        notify('error', t('srv.couldNotAdd'), friendlyError(err))
      }
    }
  }

  const join = async (address: string, name: string) => {
    if (!activeProfile) {
      notify('info', t('srv.noProfileSel'), t('srv.noProfileSel.sub'))
      return
    }
    setJoining(address)
    try {
      const list = await api.servers.join({ profileId: activeProfile.id, address, name })
      await updateSettings({ recentServers: list })
      setPreview(null)
      notify('success', t('srv.joining'), t('srv.joining.sub', { profile: activeProfile.name, address }))
    } catch (err) {
      notify('error', t('srv.couldNotJoin'), friendlyError(err))
    } finally {
      setJoining(null)
    }
  }

  const doInstall = async (profileId: string) => {
    if (!installServer) return
    const profile = profiles.find((p) => p.id === profileId)
    try {
      const res = await api.servers.install({ profileId, address: installServer.address, name: installServer.name })
      setInstallServer(null)
      setPreview(null)
      notify(
        'success',
        t('srv.installed'),
        res.installed
          ? t('srv.installed.sub', { name: installServer.name, profile: profile?.name ?? t('srv.installTo') })
          : t('srv.alreadyInstalled.sub', { name: installServer.name, profile: profile?.name ?? t('srv.installTo') })
      )
    } catch (err) {
      notify('error', t('srv.couldNotInstall'), friendlyError(err))
    }
  }

  /* ------------------------------- renders ------------------------------- */

  const statusRow = (address: string, small = false) => {
    const s = statuses[address]
    if (!s) return <span className="mono muted">{t('status.loading')}</span>
    if (!s.online) {
      return (
        <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--text-3)' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--text-3)', display: 'inline-block' }} />
          {t('srv.unreachable')}
        </span>
      )
    }
    return (
      <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-2)', flexWrap: 'wrap' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#34d399', display: 'inline-block' }} />
        {s.latencyMs != null ? `${s.latencyMs}ms` : t('status.online')}
        {s.players ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <IconUser style={{ width: 11, height: 11 }} />
            {s.players.online.toLocaleString()}
            {s.players.max > 0 ? <span className="muted">/ {s.players.max.toLocaleString()}</span> : null}
          </span>
        ) : null}
        {s.version && small ? <span className="muted">· {s.version}</span> : null}
      </span>
    )
  }

  const DirectoryCard = ({ s, showCategory = true }: { s: DirectoryServer; showCategory?: boolean }) => {
    const fav = favorites.find((f) => f.address === s.address)
    const status = statuses[s.address]
    return (
      <div className="card srv-card">
        <button className="srv-card-body" onClick={() => setPreview(s)}>
          <ServerIcon status={status} name={s.name} />
          <div className="srv-info">
            <div className="srv-title-row">
              <b>{s.name}</b>
              {showCategory ? <span className="srv-cat">{t(`srv.cat.${s.category}`)}</span> : null}
              {fav ? (
                <span className="srv-cat fav">
                  <IconStar style={{ width: 10, height: 10 }} /> {t('srv.favBadge')}
                </span>
              ) : null}
            </div>
            <span className="mono muted srv-addr">{s.address}</span>
            <p className="srv-desc">{s.description}</p>
            <div className="srv-status-row">{statusRow(s.address, true)}</div>
          </div>
          <IconChevronRight style={{ width: 14, height: 14, color: 'var(--text-3)', flexShrink: 0 }} />
        </button>
        <div className="srv-actions">
          <Button size="sm" variant="primary" disabled={joining === s.address} onClick={() => void join(s.address, s.name)}>
            {joining === s.address ? <Spinner /> : <IconPlay style={{ width: 12, height: 12 }} />} {t('action.join')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setInstallServer(s)}>
            <IconDownload style={{ width: 12, height: 12 }} /> {t('action.install')}
          </Button>
          <button
            className={`icon-btn ${fav ? 'active' : ''}`}
            title={fav ? t('srv.unfavorite') : t('srv.favorite')}
            aria-label="Toggle favorite"
            onClick={() => void toggleFavorite(s.address, s.name)}
          >
            <IconStar style={{ width: 13, height: 13 }} />
          </button>
        </div>
      </div>
    )
  }

  const renderFavoriteRow = (f: ServerFavorite) => (
    <div key={f.id} className="card server-card" style={{ padding: '14px 16px' }}>
      <ServerIcon status={statuses[f.address]} name={f.name} size={40} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 13.5 }}>{f.name}</b>
          <span className="mono muted" style={{ fontSize: 11 }}>{f.address}</span>
        </div>
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {statusRow(f.address)}
          {statuses[f.address]?.motd ? (
            <span
              style={{ fontSize: 11.5, color: 'var(--text-2)' }}
              dangerouslySetInnerHTML={{ __html: motdHtml(statuses[f.address]!.motd!) }}
            />
          ) : null}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <Button size="sm" variant="primary" disabled={joining === f.address} onClick={() => void join(f.address, f.name)}>
          {joining === f.address ? <Spinner /> : <IconPlay style={{ width: 12, height: 12 }} />} {t('action.join')}
        </Button>
        <button className="icon-danger-btn" title={t('action.remove')} aria-label="Remove server" onClick={() => void remove(f.id)}>
          <IconTrash style={{ width: 13, height: 13 }} />
        </button>
      </div>
    </div>
  )

  const installableProfiles = profiles.filter((p) =>
    installSearch.trim() === '' ||
    p.name.toLowerCase().includes(installSearch.trim().toLowerCase())
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 920 }}>
      <div className="section-head">
        <div>
          <h2 className="page-title">{t('page.servers')}</h2>
          <p className="page-sub">{t('page.servers.sub')}</p>
        </div>
        <Button variant="ghost" onClick={() => void pingAll()} disabled={pinging}>
          {pinging ? <Spinner /> : <IconRefresh style={{ width: 13, height: 13 }} />} {t('action.refresh')}
        </Button>
      </div>

      {/* Tabs */}
      <div className="srv-tabs">
        {(['favorites', 'discover', 'recommended'] as const).map((k) => (
          <button key={k} className={`srv-tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
            {k === 'favorites' ? `${t('srv.favorites')} (${favorites.length})` : k === 'discover' ? t('srv.discover') : t('srv.recommended')}
          </button>
        ))}
      </div>

      {tab === 'discover' || tab === 'recommended' ? (
        <>
          <div className="srv-toolbar">
            <div className="search-wrap" style={{ flex: 1, minWidth: 220 }}>
              <IconSearch style={{ width: 13, height: 13 }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('misc.searchPlaceholder')}
                style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-1)', flex: 1, fontSize: 13 }}
              />
              {query ? (
                <button className="icon-btn" onClick={() => setQuery('')} aria-label="Clear search">
                  <IconX style={{ width: 11, height: 11 }} />
                </button>
              ) : null}
            </div>
            {tab === 'discover' ? (
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as '' | ServerCategory)}
                className="srv-select"
              >
                <option value="">{t('srv.allCategories')}</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{t(`srv.cat.${c}`)}</option>
                ))}
              </select>
            ) : null}
          </div>

          <div className="srv-grid">
            {(tab === 'discover' ? filtered : recommended).map((s) => (
              <DirectoryCard key={s.id} s={s} showCategory={tab === 'discover'} />
            ))}
            {(tab === 'discover' ? filtered : recommended).length === 0 ? (
              <div className="empty-block" style={{ gridColumn: '1 / -1' }}>
                <IconGlobe style={{ width: 22, height: 22, opacity: 0.4 }} />
                <p>{t('srv.noResults')}</p>
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <>
          {/* Add server */}
          <div className="card srv-add-card">
            <input
              className="srv-input"
              placeholder={t('srv.namePlaceholder')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={{ flex: 1, minWidth: 140 }}
            />
            <input
              className="srv-input"
              placeholder={t('srv.addressPlaceholder')}
              value={newAddr}
              onChange={(e) => setNewAddr(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void add()}
              style={{ flex: 1.4, minWidth: 200 }}
            />
            <Button variant="primary" disabled={adding} onClick={() => void add()}>
              {adding ? <Spinner /> : <IconPlus style={{ width: 12, height: 12 }} />} {t('action.add')}
            </Button>
          </div>

          {favorites.length === 0 ? (
            <div className="empty-block">
              <IconGlobe style={{ width: 24, height: 24, opacity: 0.4 }} />
              <p>{t('srv.noFavorites')}</p>
            </div>
          ) : (
            favorites.map(renderFavoriteRow)
          )}

          {recents.length > 0 ? (
            <div>
              <h3 className="srv-section-title">
                <IconClock style={{ width: 13, height: 13 }} /> {t('srv.recentlyPlayed')}
              </h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {recents.map((r: RecentServer) => (
                  <button key={r.address + r.at} className="srv-recent" onClick={() => void join(r.address, r.name ?? r.address)}>
                    <IconPlay style={{ width: 11, height: 11 }} /> {r.name ?? r.address}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}

      {/* Preview modal */}
      {preview ? (
        <Modal onClose={() => setPreview(null)} title={preview.name}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <ServerIcon status={statuses[preview.address]} name={preview.name} size={46} />
              <div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="srv-cat">{t(`srv.cat.${preview.category}`)}</span>
                  {favorites.some((f) => f.address === preview.address) ? (
                    <span className="srv-cat fav">
                      <IconStar style={{ width: 10, height: 10 }} /> {t('srv.favBadge')}
                    </span>
                  ) : null}
                </div>
                <span className="mono muted">{preview.address}</span>
              </div>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>{preview.description}</p>
            <div className="srv-preview-status">
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>{statusRow(preview.address)}</div>
              {statuses[preview.address]?.motd ? (
                <div
                  style={{ fontSize: 13, color: 'var(--text-2)' }}
                  dangerouslySetInnerHTML={{ __html: motdHtml(statuses[preview.address]!.motd!) }}
                />
              ) : null}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {preview.tags.map((tag) => (
                  <span key={tag} className="srv-tag">#{tag}</span>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={() => void toggleFavorite(preview.address, preview.name)}>
                <IconStar style={{ width: 12, height: 12 }} /> {favorites.some((f) => f.address === preview.address) ? t('srv.unfavorite') : t('srv.favorite')}
              </Button>
              <Button variant="ghost" onClick={() => setInstallServer(preview)}>
                <IconDownload style={{ width: 12, height: 12 }} /> {t('action.install')}
              </Button>
              <Button variant="primary" disabled={joining === preview.address} onClick={() => void join(preview.address, preview.name)}>
                {joining === preview.address ? <Spinner /> : <IconPlay style={{ width: 12, height: 12 }} />} {t('action.join')}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* Install-to-instance modal */}
      {installServer ? (
        <Modal onClose={() => setInstallServer(null)} title={`${t('srv.installTo')} — ${installServer.name}`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="search-wrap">
              <IconSearch style={{ width: 13, height: 13 }} />
              <input
                value={installSearch}
                onChange={(e) => setInstallSearch(e.target.value)}
                placeholder={t('srv.searchInstances')}
                style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-1)', flex: 1, fontSize: 13 }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
              {installableProfiles.length === 0 ? (
                <p className="muted" style={{ fontSize: 12.5, padding: 8 }}>{t('srv.noInstances')}</p>
              ) : (
                installableProfiles.map((p) => (
                  <button key={p.id} className="srv-instance-row" onClick={() => void doInstall(p.id)}>
                    <div className="srv-instance-icon">{p.name.charAt(0).toUpperCase()}</div>
                    <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                      <div className="mono muted" style={{ fontSize: 11 }}>
                        {p.minecraftVersion} · {p.loader.type}
                      </div>
                    </div>
                    <IconChevronRight style={{ width: 13, height: 13, color: 'var(--text-3)' }} />
                  </button>
                ))
              )}
            </div>
            <p className="muted" style={{ fontSize: 11.5, lineHeight: 1.45 }}>
              {t('srv.installHint')}
            </p>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
