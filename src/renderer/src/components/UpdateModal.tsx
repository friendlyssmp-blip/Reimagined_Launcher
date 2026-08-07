/**
 * Update dialog.
 *
 * Shown when the user clicks "Update" in the sidebar (only visible when a new
 * GitHub release is available). Displays the changelog and drives the
 * download -> install -> relaunch flow with live progress from the main
 * process (update:progress events).
 */
import { useEffect, useState } from 'react'
import { useApp } from '../state/AppContext'
import { Button, Spinner } from './ui'
import { api, friendlyError } from '../lib/api'

type Phase = 'idle' | 'downloading' | 'downloaded' | 'installing' | 'done'

export function UpdateModal({ auto = false }: { auto?: boolean }) {
  const { setModals, updateInfo } = useApp()
  const [phase, setPhase] = useState<Phase>('idle')
  const [percent, setPercent] = useState(0)
  const [phaseText, setPhaseText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /* Auto-update mode ("Auto-update updates" = ON, the default): the newest
   * release downloads and installs by itself on launcher start — the user
   * just watches it happen. On failure it falls back to the manual buttons. */
  useEffect(() => {
    if (!auto) return
    let cancelled = false
    void (async () => {
      try {
        setBusy(true)
        setPhase('downloading')
        setPhaseText('Downloading update…')
        await api.update.download()
        if (cancelled) return
        setPhase('downloaded')
        setPhaseText('Installing update…')
        setPhase('installing')
        await api.update.install()
        if (!cancelled) {
          setBusy(false)
          setPhase('done')
        }
      } catch (err) {
        if (cancelled) return
        setError(friendlyError(err))
        setPhase('idle')
        setPhaseText('')
        setBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [auto])

  /* Live progress events from the main process. */
  useEffect(() => {
    const off = api.onEvent((e) => {
      if (e.type !== 'update:progress') return
      const p = e.payload as { phase?: string; percent?: number }
      const pct = p.percent ?? 0
      setPercent(pct)
      if (p.phase === 'download') setPhaseText('Downloading update...')
      else if (p.phase === 'extract') setPhaseText('Extracting update...')
      else if (p.phase === 'apply') setPhaseText('Applying files...')
      else if (p.phase === 'build') setPhaseText('Rebuilding the launcher...')
      else if (p.phase === 'done') setPhaseText('Relaunching...')
    })
    return off
  }, [])

  const download = async () => {
    setBusy(true)
    setError(null)
    try {
      setPhase('downloading')
      setPhaseText('Downloading update...')
      await api.update.download()
      setPhase('downloaded')
      setPhaseText('Ready to install')
    } catch (err) {
      setError(friendlyError(err))
      setPhase('idle')
      setPhaseText('')
    } finally {
      setBusy(false)
    }
  }

  const install = async () => {
    setBusy(true)
    setError(null)
    try {
      setPhase('installing')
      setPhaseText('Installing update...')
      await api.update.install()
      setPhase('done')
    } catch (err) {
      setError(friendlyError(err))
      setPhase('downloaded')
      setPhaseText('Ready to install')
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && setModals({ update: false })}>
      <div className="modal modal-lg">
        <div className="modal-head">
          <h3>Update available</h3>
          {auto && phase !== 'done' && (
            <span className="badge" style={{ background: 'var(--accent-soft)', color: 'var(--accent-3)', fontWeight: 700, marginRight: 'auto', marginLeft: 10 }}>
              auto-updating…
            </span>
          )}
          {!busy && (
            <button className="btn btn-icon" onClick={() => setModals({ update: false })} aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          )}
        </div>
        <div className="modal-body">
          <div className="row" style={{ gap: 10, marginBottom: 14 }}>
            <span className="badge badge-success">v{updateInfo?.currentVersion}</span>
            <span style={{ color: 'var(--text-3)' }}>-&gt;</span>
            <span className="badge" style={{ background: 'var(--accent-soft)', color: 'var(--accent-3)', fontWeight: 700 }}>
              v{updateInfo?.latestVersion}
            </span>
            {updateInfo?.publishedAt && (
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                published {new Date(updateInfo.publishedAt).toLocaleDateString()}
              </span>
            )}
          </div>

          <div className="panel-title" style={{ marginBottom: 6 }}>What&apos;s new</div>
          <pre
            className="update-notes"
            style={{
              maxHeight: 260,
              overflow: 'auto',
              background: 'var(--bg-2)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: 12,
              fontSize: 12,
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              fontFamily: 'var(--font)',
              color: 'var(--text-2)'
            }}
          >
            {updateInfo?.notes?.trim() || 'No release notes provided.'}
          </pre>

          {(phase === 'downloading' || phase === 'installing' || phase === 'done') && (
            <div style={{ marginTop: 16 }}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{phaseText}</span>
                <b style={{ fontSize: 12.5 }}>{percent}%</b>
              </div>
              <div className="progress">
                <span style={{ width: `${Math.max(2, percent)}%` }} />
              </div>
            </div>
          )}

          {error && (
            <div className="banner" style={{ marginTop: 14 }}>
              {error}{' '}
              {updateInfo?.url && (
                <span className="link" onClick={() => window.open(updateInfo.url, '_blank')}>
                  Open the release page to download manually.
                </span>
              )}
            </div>
          )}

          {phase === 'downloaded' && (
            <div className="banner banner-info" style={{ marginTop: 14 }}>
              The update replaces the launcher&apos;s files (your profiles, saves and settings in <span className="mono">data/</span> are preserved), rebuilds and restarts automatically.
            </div>
          )}
        </div>
        <div className="modal-foot">
          {!busy && auto && phase === 'idle' && (
            <Button variant="ghost" onClick={() => setModals({ update: false })}>
              Skip this update
            </Button>
          )}
          {!busy && !auto && (
            <Button variant="ghost" onClick={() => setModals({ update: false })}>
              Remind me later
            </Button>
          )}
          {!busy && updateInfo?.url && (
            <Button variant="ghost" onClick={() => window.open(updateInfo.url, '_blank')}>
              Open release page
            </Button>
          )}
          {phase === 'idle' && (
            <Button variant="primary" onClick={download} disabled={!updateInfo?.assetUrl}>
              {updateInfo?.assetUrl ? 'Download & Install' : 'No installer asset'}
            </Button>
          )}
          {phase === 'downloaded' && (
            <Button variant="primary" onClick={install}>
              Install now
            </Button>
          )}
          {busy && (
            <Button disabled>
              {phase === 'installing' || phase === 'done' ? (
                <><Spinner /> Installing...</>
              ) : (
                <><Spinner /> Downloading...</>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
