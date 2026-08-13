/**
 * Servers (v1.0.88) — browse your favorite servers with live ping / MOTD /
 * player counts, add new ones, and join directly into the game with the
 * active profile. Reachable from the Games sidebar section.
 */
import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../state/AppContext'
import { api, friendlyError } from '../lib/api'
import { Button, Spinner } from '../components/ui'
import { IconPlus, IconTrash, IconRefresh, IconGlobe, IconPlay, IconClock } from '../components/icons'
import { useT } from '../lib/i18n'
import type { ServerStatus, ServerFavorite, RecentServer } from '@shared/types'

export function ServersPage() {
  const { settings, updateSettings, activeProfile, notify } = useApp()
  const t = useT()
  const favorites = settings.servers ?? []
  const recents = settings.recentServers ?? []

  const [statuses, setStatuses] = useState<Record<string, ServerStatus>>({})
  const [pinging, setPinging] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newAddr, setNewAddr] = useState('')
  const [joining, setJoining] = useState<string | null>(null)

  const pingAll = useCallback(async () => {
    if (favorites.length === 0) return
    setPinging(true)
    const results = await Promise.allSettled(favorites.map((f) => api.servers.ping(f.address)))
    const next: Record<string, ServerStatus> = {}
    favorites.forEach((f, i) => {
      const r = results[i]
      if (r.status === 'fulfilled') next[f.address] = r.value
      else next[f.address] = { address: f.address, online: false, latencyMs: null }
    })
    setStatuses(next)
    setPinging(false)
  }, [favorites])

  useEffect(() => {
    void pingAll()
  }, [pingAll])

  const add = async () => {
    const addr = newAddr.trim()
    if (!addr) {
      notify('error', 'Add server', 'Enter a server address, e.g. play.example.com:25565')
      return
    }
    setAdding(true)
    try {
      const list = await api.servers.addFavorite({ name: newName.trim() || addr, address: addr })
      await updateSettings({ servers: list })
      setNewName('')
      setNewAddr('')
      notify('success', 'Server added', `${newName.trim() || addr} was saved to your favorites.`)
    } catch (err) {
      notify('error', 'Could not add server', friendlyError(err))
    } finally {
      setAdding(false)
    }
  }

  const remove = async (id: string) => {
    try {
      const list = await api.servers.removeFavorite(id)
      await updateSettings({ servers: list })
    } catch (err) {
      notify('error', 'Could not remove server', friendlyError(err))
    }
  }

  const join = async (f: ServerFavorite) => {
    if (!activeProfile) {
      notify('info', 'No profile selected', 'Select an instance in the top bar first — Join launches the game with that profile.')
      return
    }
    setJoining(f.id)
    try {
      const recents = await api.servers.join({ profileId: activeProfile.id, address: f.address, name: f.name })
      /* Sync the main-process recents back into the renderer settings state. */
      await updateSettings({ recentServers: recents })
      notify('success', 'Joining server', `Launching ${activeProfile.name} into ${f.address}…`)
    } catch (err) {
      notify('error', 'Could not join', friendlyError(err))
    } finally {
      setJoining(null)
    }
  }

  const renderRow = (f: ServerFavorite) => {
    const s = statuses[f.address]
    return (
      <div key={f.id} className="card server-card" style={{ padding: '14px 16px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <b style={{ fontSize: 13.5 }}>{f.name}</b>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>{f.address}</span>
          </div>
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {s ? (
              <>
                <BadgeDot ok={s.online} ping={s.latencyMs} />
                {s.motd ? <span style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{s.motd}</span> : null}
                {s.players ? (
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {s.players.online}/{s.players.max} {t('srv.playerCount')}
                  </span>
                ) : null}
                {s.version ? <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{s.version}</span> : null}
              </>
            ) : (
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{t('status.loading')}</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Button size="sm" variant="primary" disabled={joining === f.id} onClick={() => void join(f)}>
            {joining === f.id ? <Spinner /> : <IconPlay style={{ width: 12, height: 12 }} />} {t('action.join')}
          </Button>
          <button className="icon-danger-btn" title="Remove" aria-label="Remove server" onClick={() => void remove(f.id)}>
            <IconTrash style={{ width: 13, height: 13 }} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 860 }}>
      <div className="section-head">
        <div>
          <h2 className="page-title">{t('page.servers')}</h2>
          <p className="page-sub">{t('page.servers.sub')}</p>
        </div>
        <Button variant="ghost" onClick={() => void pingAll()} disabled={pinging}>
          {pinging ? <Spinner /> : <IconRefresh style={{ width: 13, height: 13 }} />} {t('action.refresh')}
        </Button>
      </div>

      <div className="panel">
        <div className="panel-title">{t('srv.addServer')}</div>
        <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <input
            className="input"
            placeholder={t('srv.name')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{ flex: 1, minWidth: 160, maxWidth: 260 }}
            spellCheck={false}
          />
          <input
            className="input"
            placeholder={t('srv.address')} 
            value={newAddr}
            onChange={(e) => setNewAddr(e.target.value)}
            style={{ flex: 1, minWidth: 200 }}
            spellCheck={false}
            onKeyDown={(e) => { if (e.key === 'Enter') void add() }}
          />
          <Button variant="primary" onClick={() => void add()} disabled={adding}>
            {adding ? <Spinner /> : <IconPlus style={{ width: 13, height: 13 }} />} {t('action.add')}
          </Button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">{t('srv.favorites')}</div>
        {favorites.length === 0 ? (
          <div style={{ padding: '22px 4px' }}>
            <div className="empty-illustration" style={{ width: 54, height: 54, margin: '0 auto 12px' }}>
              <IconGlobe style={{ width: 24, height: 24 }} />
            </div>
            <p style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 12.5, lineHeight: 1.5 }}>
              {t('srv.noServers')}.<br />{t('srv.noServers.desc')}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            {favorites.map(renderRow)}
          </div>
        )}
      </div>

      {recents.length > 0 && (
        <div className="panel">
          <div className="panel-title"><IconClock style={{ width: 13, height: 13, marginRight: 6 }} /> {t('srv.recent')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
            {recents.map((r) => (
              <div key={r.address} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
                <span style={{ color: 'var(--text-3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>{r.address}</span>
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{new Date(r.at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function BadgeDot({ ok, ping }: { ok: boolean; ping: number | null }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: ok ? 'var(--success, #4ade80)' : 'var(--danger, #f87171)',
          boxShadow: `0 0 6px ${ok ? 'rgba(74,222,128,0.5)' : 'rgba(248,113,113,0.5)'}`
        }}
      />
      {ok ? `${ping ?? '—'} ms` : 'offline'}
    </span>
  )
}
