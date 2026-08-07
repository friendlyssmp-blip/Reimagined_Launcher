import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../state/AppContext'
import { sound } from '../lib/sound'
import { Button, EmptyState, Spinner, AnimatedNumber } from '../components/ui'
import { api, friendlyError } from '../lib/api'
import { IconDownload, IconCheck, IconX, IconRefresh } from '../components/icons'

interface Download {
  id: string
  label: string
  kind: string
  status: 'downloading' | 'done' | 'failed'
  percent: number
  downloadedBytes: number
  totalBytes: number
  at: string
}

function fmtSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`
  return `${bytes} B`
}

const kindLabel: Record<string, string> = {
  manifest: 'Version manifest',
  version: 'Minecraft version',
  client: 'Client jar',
  libraries: 'Libraries',
  assets: 'Assets',
  log4j: 'Log4j config',
  loader: 'Loader',
  installer: 'Installer',
  mods: 'Mods'
}

export function DownloadsPage() {
  const { launch, notify } = useApp()
  const [history, setHistory] = useState<Download[]>([])
  const [loading, setLoading] = useState(true)
  /* Ids already announced as done — plays the completion chime only once. */
  const announced = useRef<Set<string>>(new Set())
  const seeded = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const next = await api.content.downloads()
      if (!seeded.current) {
        /* First fetch: seed with pre-existing 'done' entries silently so a
         * fresh session never plays the completion chime for old downloads. */
        seeded.current = true
        next.forEach((d) => {
          if (d.status === 'done') announced.current.add(d.id)
        })
      } else {
        const fresh = next.filter((d) => d.status === 'done' && !announced.current.has(d.id))
        if (fresh.length > 0) {
          fresh.forEach((d) => announced.current.add(d.id))
          if (announced.current.size > 500) announced.current.clear()
          sound.download()
        }
      }
      setHistory(next)
    } finally {
      setLoading(false)
    }
  }, [])

  /** Cancel one real download — the underlying fetch is aborted in main. */
  const cancel = useCallback(async (d: { id: string; label: string }) => {
    try {
      await api.content.cancelDownload(d.id)
      notify('info', 'Download cancelled', d.label)
      void refresh()
    } catch (err) {
      notify('error', 'Could not cancel download', friendlyError(err))
    }
  }, [notify, refresh])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 2000)
    return () => clearInterval(t)
  }, [refresh])

  /* The "active downloads" panel reflects REAL state only. It prefers the
   * live download-history entry (mods, deps, modpacks — anything recorded by
   * a real task), falling back to the launch pipeline's progress. The moment
   * the underlying task resolves, its entry stops being 'downloading', so the
   * bar + spinner can never sit frozen at 100%. */
  const dlActive = history.find((d) => d.status === 'downloading') ?? null
  const launchActive = launch.phase === 'preparing' || launch.phase === 'downloading' || launch.phase === 'launching'
    ? { label: launch.message || 'Working…', percent: launch.percent ?? 0, id: undefined as string | undefined }
    : null
  const active = dlActive
    ? { label: dlActive.label, percent: dlActive.percent, id: dlActive.id }
    : launchActive

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 120 }}><Spinner /></div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="section-head">
        <div>
          <h2 className="page-title">Downloads</h2>
          <p className="page-sub">Installs and updates, live</p>
        </div>
        <Button onClick={refresh}><IconRefresh style={{ width: 14, height: 14 }} /> Refresh</Button>
      </div>

      <div className="panel dl-active">
        <div className="dl-active-head">
          <div className="dl-icon"><IconDownload /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>{active ? active.label : 'No active downloads'}</b>
            <small>{active ? (active.id ? 'Downloading in real time' : 'Streaming from the launch pipeline') : 'Downloads appear here when you install versions, loaders or mods.'}</small>
          </div>
          {active && active.id && (
            <Button size="sm" variant="danger" onClick={() => void cancel({ id: active.id as string, label: active.label })}>
              Cancel
            </Button>
          )}
          {active && !active.id && <Spinner />}
        </div>
        {active && (
          <>
            <div className="progress"><span style={{ width: `${Math.max(3, active.percent)}%` }} /></div>
            <div className="dl-meta">
              <span>Progress <AnimatedNumber value={active.percent} format={(v) => `${Math.round(v)}%`} /></span>
            </div>
          </>
        )}
      </div>

      <div className="panel">
        <div className="panel-title">History</div>
        <div className="panel-sub">Recent install operations recorded by the launcher</div>
        {history.length === 0 ? (
          <EmptyState title="Nothing downloaded yet" sub="Version and mod installs will be tracked here." />
        ) : (
          <div className="dl-history">
            {history.map((d) => (
              <div key={d.id} className="dl-row">
                <div className={`dl-status ${d.status === 'done' ? 'done' : d.status === 'failed' ? 'error' : ''}`}>
                  {d.status === 'done' ? <IconCheck /> : d.status === 'failed' ? <IconX /> : <Spinner />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Specific label — the real item/dependency name + version,
                      never a generic "Mods" placeholder. */}
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{d.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {kindLabel[d.kind] ?? d.kind}
                    {' · '}{d.status === 'done' ? `Complete · ${fmtSize(d.totalBytes)}` : d.status === 'failed' ? 'Failed' : 'In progress'}
                    {' · '}{new Date(d.at).toLocaleTimeString()}
                  </div>
                </div>
                {d.status === 'downloading' && (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => void cancel(d)}
                    title="Stop this download and remove partial files"
                  >
                    Cancel
                  </Button>
                )}
                <span className={`badge ${d.status === 'done' ? 'badge-success' : d.status === 'failed' ? 'badge-danger' : ''}`}>
                  {d.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
