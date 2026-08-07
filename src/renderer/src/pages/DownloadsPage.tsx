import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../state/AppContext'
import { sound } from '../lib/sound'
import { Button, EmptyState, Spinner, AnimatedNumber } from '../components/ui'
import { api, friendlyError } from '../lib/api'
import { humanDuration, fmtBytes } from '../lib/format'
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
  /* Previous poll's bytes per active id → real download speed (bytes/s). */
  const prevBytes = useRef<Record<string, { bytes: number; at: number }>>({})
  const [speedMap, setSpeedMap] = useState<Record<string, number>>({})

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
      /* Real speed: delta of downloaded bytes between the last two polls. */
      const now = performance.now()
      const speeds: Record<string, number> = {}
      for (const d of next) {
        if (d.status !== 'downloading') continue
        const prev = prevBytes.current[d.id]
        if (prev) {
          const dt = (now - prev.at) / 1000
          if (dt > 0.5) speeds[d.id] = Math.max(0, (d.downloadedBytes - prev.bytes) / dt)
        }
        prevBytes.current[d.id] = { bytes: d.downloadedBytes, at: now }
      }
      /* Forget entries that are no longer active. */
      const activeIds = new Set(next.filter((d) => d.status === 'downloading').map((d) => d.id))
      for (const id of Object.keys(prevBytes.current)) {
        if (!activeIds.has(id)) delete prevBytes.current[id]
      }
      setSpeedMap(speeds)
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

  /* ETA — derived from the real measured speed, only while actually moving. */
  const activeSpeed = active?.id ? (speedMap[active.id] ?? 0) : 0
  const activeRemaining = active?.id && dlActive
    ? Math.max(0, (dlActive.totalBytes || 0) - dlActive.downloadedBytes)
    : 0
  const activeEta = activeSpeed > 0 ? activeRemaining / activeSpeed : null

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 120 }}><Spinner /></div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="section-head">
        <div>
          <h2 className="page-title">Downloads</h2>
          <p className="page-sub">Installs and updates, live — real progress from the actual download state</p>
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
            <div className="dl-meta" style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <span>Progress <AnimatedNumber value={active.percent} format={(v) => `${Math.round(v)}%`} /></span>
              {dlActive && dlActive.totalBytes > 0 && (
                <span>{fmtBytes(dlActive.downloadedBytes)} / {fmtBytes(dlActive.totalBytes)}</span>
              )}
              {activeSpeed > 0 && <span>{fmtBytes(activeSpeed)}/s</span>}
              {activeEta !== null && activeEta < 3600 && (
                <span>~{humanDuration(activeEta)} left</span>
              )}
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
            {history.map((d) => {
              const speed = speedMap[d.id] ?? 0
              const remaining = Math.max(0, (d.totalBytes || 0) - d.downloadedBytes)
              const eta = speed > 0 ? remaining / speed : null
              return (
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
                      {' · '}{d.status === 'done' ? `Complete · ${fmtBytes(d.totalBytes)}` : d.status === 'failed' ? 'Failed' : 'In progress'}
                      {d.status === 'downloading' && d.totalBytes > 0 && ` · ${fmtBytes(d.downloadedBytes)} / ${fmtBytes(d.totalBytes)}`}
                      {d.status === 'downloading' && speed > 0 && ` · ${fmtBytes(speed)}/s`}
                      {d.status === 'downloading' && eta !== null && eta < 3600 && ` · ~${humanDuration(eta)} left`}
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
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
