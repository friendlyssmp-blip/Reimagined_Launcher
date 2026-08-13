import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../state/AppContext'
import { sound } from '../lib/sound'
import { Button, EmptyState, Spinner, AnimatedNumber } from '../components/ui'
import { ModIcon } from '../components/ModIcon'
import { api, friendlyError } from '../lib/api'
import { humanDuration, fmtBytes } from '../lib/format'
import { IconDownload, IconRefresh, IconCheck, IconX } from '../components/icons'
import { useT } from '../lib/i18n'

interface Download {
  id: string
  label: string
  kind: string
  status: 'downloading' | 'done' | 'failed'
  percent: number
  downloadedBytes: number
  totalBytes: number
  at: string
  iconUrl?: string
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

/**
 * Downloads — v1.0.85 rebuild.
 * Same engine, same colors — a cleaner, calmer reading of the page:
 * a single "Now" hero, quiet summary chips and grouped history cards
 * with the real artwork, byte-level progress, speed and ETA.
 */
export function DownloadsPage() {
  const t = useT()
  const { launch, notify } = useApp()
  const [history, setHistory] = useState<Download[]>([])
  const [loading, setLoading] = useState(true)
  const announced = useRef<Set<string>>(new Set())
  const seeded = useRef(false)
  const prevBytes = useRef<Record<string, { bytes: number; at: number }>>({})
  const [speedMap, setSpeedMap] = useState<Record<string, number>>({})

  const refresh = useCallback(async () => {
    try {
      const next = await api.content.downloads()
      if (!seeded.current) {
        seeded.current = true
        next.forEach((d) => {
          if (d.status === 'done') announced.current.add(d.id)
        })
      } else {
        const fresh = next.filter((d) => d.status === 'done' && !announced.current.has(d.id))
        if (fresh.length > 0) {
          fresh.forEach((d) => announced.current.add(d.id))
          if (announced.current.size > 500) announced.current.clear()
          sound.installComplete()
        }
      }
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
    const off = api.onEvent((e) => {
      if (e.type === 'downloads:changed') void refresh()
    })
    const t = setInterval(refresh, 5000)
    return () => {
      off()
      clearInterval(t)
    }
  }, [refresh])

  const active = history.find((d) => d.status === 'downloading') ?? null
  const launchActive =
    launch.phase === 'preparing' || launch.phase === 'downloading' || launch.phase === 'launching'
      ? { label: launch.message || 'Working…', percent: launch.percent ?? 0, id: undefined as string | undefined }
      : null

  const activeSpeed = active?.id ? (speedMap[active.id] ?? 0) : 0
  const activeRemaining = active && (active.totalBytes || 0) > 0
    ? Math.max(0, active.totalBytes - active.downloadedBytes)
    : 0
  const activeEta = activeSpeed > 0 ? activeRemaining / activeSpeed : null

  const inProgress = history.filter((d) => d.status === 'downloading')
  const done = history.filter((d) => d.status === 'done')
  const failed = history.filter((d) => d.status === 'failed')


function renderCard(d: Download) {
  const isActive = d.status === 'downloading'
  return (
    <div
      key={d.id}
      className={'dl-card' + (isActive ? ' dl-card-active' : d.status === 'failed' ? ' dl-card-err' : ' dl-card-done')}
    >
      <div className="dl-card-art">
        {d.iconUrl ? (
          <ModIcon src={d.iconUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <IconDownload style={{ width: 20, height: 20 }} />
        )}
      </div>
      <div className="dl-card-main">
        <div className="dl-card-head">
          <b className="dl-card-title" title={d.label}>{d.label}</b>
          <span className={'badge ' + (d.status === 'done' ? 'badge-success' : d.status === 'failed' ? 'badge-danger' : '')}>
            {d.status === 'done' ? 'Complete' : d.status === 'failed' ? 'Failed' : 'In progress'}
          </span>
        </div>
        <div className="dl-card-sub">
          {kindLabel[d.kind] ?? d.kind}
          {' · '}{new Date(d.at).toLocaleTimeString()}
        </div>
        {isActive && <ActiveCardBody d={d} />}
        {d.status === 'done' && <div className="dl-card-meta done">Complete · {fmtBytes(d.totalBytes)}</div>}
        {d.status === 'failed' && <div className="dl-card-meta err">The download stopped before finishing.</div>}
      </div>
      <div className="dl-card-actions">
        {isActive && (
          <Button size="sm" variant="danger" onClick={() => void cancel(d)}>
            Cancel
          </Button>
        )}
        {d.status === 'failed' && (
          <Button size="sm" variant="ghost" onClick={() => void refresh()} title="Re-check the download state (the operation can be re-run from its source)">
            Retry
          </Button>
        )}
      </div>
    </div>
  )
}

function ActiveCardBody({ d }: { d: Download }) {
  const speed = speedMap[d.id] ?? 0
  const remaining = Math.max(0, (d.totalBytes || 0) - d.downloadedBytes)
  const eta = speed > 0 ? remaining / speed : null
  return (
    <>
      <div className="progress dl-card-progress">
        <span style={{ width: `${Math.max(2, d.percent)}%` }} />
      </div>
      <div className="dl-card-meta">
        <AnimatedNumber value={d.percent} format={(v) => `${Math.round(v)}%`} />
        {d.totalBytes > 0 && <span>{fmtBytes(d.downloadedBytes)} / {fmtBytes(d.totalBytes)}</span>}
        {speed > 0 && <span>{fmtBytes(speed)}/s</span>}
        {eta !== null && eta < 3600 && <span>~{humanDuration(eta)} left</span>}
      </div>
    </>
  )
}


  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 120 }}><Spinner /></div>
  }

  const hero = active ?? launchActive

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="section-head">
        <div>
          <h2 className="page-title">{t('page.downloads')}</h2>
          <p className="page-sub">Installs and updates, live — real progress, real speed, real artwork</p>
        </div>
        <Button onClick={refresh}><IconRefresh style={{ width: 14, height: 14 }} /> Refresh</Button>
      </div>

      {/* Now — the single hero of the page */}
      <div className="dl-hero">
        {hero ? (
          <>
            <div className="dl-hero-art">
              {active?.iconUrl ? (
                <ModIcon src={active.iconUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <IconDownload style={{ width: 26, height: 26 }} />
              )}
            </div>
            <div className="dl-hero-main">
              <div className="dl-hero-top">
                <div style={{ minWidth: 0 }}>
                  <b className="dl-hero-title" title={hero.label}>{hero.label}</b>
                  <small>
                    {hero.id ? 'Downloading in real time' : 'Streaming from the launch pipeline'}
                    {active?.kind && ` · ${kindLabel[active.kind] ?? active.kind}`}
                  </small>
                </div>
                {hero.id && (
                  <Button size="sm" variant="danger" onClick={() => void cancel(hero as { id: string; label: string })}>
                    Cancel
                  </Button>
                )}
              </div>
              <div className="dl-hero-progress">
                <span style={{ width: `${Math.max(3, hero.percent)}%` }} />
              </div>
              <div className="dl-hero-meta">
                <span className="dl-hero-pct"><AnimatedNumber value={hero.percent} format={(v) => `${Math.round(v)}%`} /></span>
                {active && active.totalBytes > 0 && (
                  <span>{fmtBytes(active.downloadedBytes)} / {fmtBytes(active.totalBytes)}</span>
                )}
                {activeSpeed > 0 && <span className="dl-hero-speed">{fmtBytes(activeSpeed)}/s</span>}
                {activeEta !== null && activeEta < 3600 && <span>~{humanDuration(activeEta)} left</span>}
              </div>
            </div>
          </>
        ) : (
          <div className="dl-hero-idle">
            <div className="dl-hero-art idle"><IconDownload style={{ width: 24, height: 24 }} /></div>
            <div>
              <b>All quiet here</b>
              <small>Installs appear the moment they start — with real artwork and byte-level progress.</small>
            </div>
          </div>
        )}
      </div>

      {/* Summary chips */}
      <div className="dl-summary">
        <span className="dl-summary-chip">{inProgress.length} in progress</span>
        <span className="dl-summary-chip ok">{done.length} completed</span>
        {failed.length > 0 && <span className="dl-summary-chip err">{failed.length} failed</span>}
      </div>

      {history.length === 0 ? (
        <div className="panel">
          <EmptyState title="Nothing downloaded yet" sub="Version and mod installs will be tracked here." />
        </div>
      ) : (
        <div className="panel">
          <div className="panel-title">History</div>
          <div className="panel-sub">Grouped by state — completed installs, anything still moving, and anything that needs a retry</div>

          {inProgress.length > 0 && (
            <div className="dl-group">
              <div className="dl-group-title">In progress ({inProgress.length})</div>
              <div className="dl-grid">{inProgress.map(renderCard)}</div>
            </div>
          )}
          {inProgress.length === 0 && (done.length > 0 || failed.length > 0) && (
            <div className="dl-group">
              <div className="dl-group-title">In progress</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-3)', fontSize: 12.5, padding: '2px 2px 6px' }}>
                <IconDownload style={{ width: 14, height: 14 }} />
                <span>Nothing downloading right now — new installs appear here the moment they start.</span>
              </div>
            </div>
          )}
          {failed.length > 0 && (
            <div className="dl-group">
              <div className="dl-group-title err">Failed ({failed.length})</div>
              <div className="dl-grid">{failed.map(renderCard)}</div>
            </div>
          )}
          {done.length > 0 && (
            <div className="dl-group">
              <div className="dl-group-title ok">Completed ({done.length})</div>
              <div className="dl-grid">{done.map(renderCard)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
