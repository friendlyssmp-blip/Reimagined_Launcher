/**
 * Update dialog (v1.0.34 — 3-option prompt; v1.0.54 — closing-state fix).
 *
 * Shown when a new GitHub release is detected. Silent auto-updating was
 * removed entirely: the launcher NEVER downloads or installs anything without
 * the user explicitly choosing "Update". The three options:
 *  - Update — download → verify checksum → install → relaunch.
 *  - Cancel — dismiss the prompt now; the next periodic check re-prompts
 *    (lighter dismissal, for a user who just wants it gone right now).
 *  - Remind Me Later — suppress auto-prompts for the rest of this session;
 *    the prompt reappears on the next app start.
 *
 * v1.0.54 (Change 4): once the download reaches 100% and the launcher is
 * about to close itself to install, the dialog is REPLACED by a final
 * "Closing launcher…" state — the old Cancel / Remind Me Later / Close
 * buttons can never flash back during the ~1.5s window before app.exit().
 * If the automatic relaunch hasn't happened within ~3s (helper failed), a
 * "relaunch manually" fallback appears instead of a silently dead screen.
 */
import { useEffect, useRef, useState } from 'react'
import { useApp } from '../state/AppContext'
import { Button, Spinner } from './ui'
import { api, friendlyError } from '../lib/api'

type Phase = 'idle' | 'downloading' | 'closing' | 'done'

export function UpdateModal() {
  const { setModals, dismissUpdatePrompt, updateInfo } = useApp()
  const [phase, setPhase] = useState<Phase>('idle')
  const [percent, setPercent] = useState(0)
  const [phaseText, setPhaseText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /* v1.0.54 — the app should have quit itself by now; if it is still alive
   * the automatic relaunch silently failed, so offer a manual one. */
  const [stuck, setStuck] = useState(false)
  const fallbackTimer = useRef(0)

  useEffect(() => () => window.clearTimeout(fallbackTimer.current), [])

  /* Live progress events from the main process. */
  useEffect(() => {
    const off = api.onEvent((e) => {
      if (e.type !== 'update:progress') return
      const p = e.payload as { phase?: string; percent?: number; message?: string }
      const pct = p.percent ?? 0
      setPercent(pct)
      if (p.phase === 'download') setPhaseText('Downloading update...')
      else if (p.phase === 'extract') setPhaseText('Extracting update...')
      else if (p.phase === 'apply') setPhaseText('Applying files...')
      else if (p.phase === 'build') setPhaseText('Rebuilding the launcher...')
      else if (p.phase === 'restarting') setPhaseText('Relaunching… Minecraft keeps running')
      else if (p.phase === 'done') setPhaseText(p.message ?? 'Relaunching...')
    })
    return off
  }, [])

  /** Arm the 3s "did the relaunch happen?" fallback after an install attempt. */
  const armFallback = () => {
    window.clearTimeout(fallbackTimer.current)
    fallbackTimer.current = window.setTimeout(() => {
      /* Still mounted and the app never closed itself → helper failed. */
      setStuck(true)
      setBusy(false)
    }, 3000)
  }

  /** Run the installer (already downloaded). The app normally exits itself
   *  ~1.5s after this resolves; if it doesn't, the fallback kicks in. */
  const runInstaller = async () => {
    setBusy(true)
    setStuck(false)
    setError(null)
    setPhase('closing')
    setPhaseText('Closing launcher…')
    try {
      await api.update.install()
      /* Resolved — the close is scheduled. Wait for it, then offer help. */
      setPhase('done')
      setPhaseText('Relaunching…')
      armFallback()
    } catch (err) {
      setError(friendlyError(err))
      setPhase('idle')
      setPhaseText('')
      setBusy(false)
    }
  }

  /** "Update" — download then install in one explicit user choice. */
  const update = async () => {
    setBusy(true)
    setError(null)
    setStuck(false)
    try {
      setPhase('downloading')
      setPhaseText('Downloading update...')
      await api.update.download()
      /* v1.0.54 — download complete: switch IMMEDIATELY to the closing state
       * so the 3-option prompt cannot re-render while the launcher shuts
       * down (the old flow flashed Cancel/Remind/Close for ~1s here). */
      await runInstaller()
    } catch (err) {
      setError(friendlyError(err))
      setPhase('idle')
      setPhaseText('')
      setBusy(false)
    }
  }

  const closing = phase === 'closing' || phase === 'done'

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && !closing && setModals({ update: false })}>
      <div className="modal modal-lg">
        <div className="modal-head">
          <h3>{closing ? 'Updating' : 'Update available'}</h3>
          {!busy && !closing && (
            <button className="btn btn-icon" onClick={() => setModals({ update: false })} aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          )}
        </div>
        <div className="modal-body">
          {!closing && (
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
          )}

          {!closing && (
            <>
              <div className="panel-title" style={{ marginBottom: 6 }}>What&apos;s new</div>
              <pre
                className="update-notes"
                style={{
                  maxHeight: 220,
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
            </>
          )}

          {(phase === 'downloading' || phase === 'closing') && (
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

          {stuck && (
            <div className="banner" style={{ marginTop: 14 }}>
              Taking longer than expected — the automatic relaunch may have failed.
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
        </div>
        <div className="modal-foot">
          {!busy && !closing && !stuck && (
            <>
              <Button variant="ghost" onClick={() => dismissUpdatePrompt('later')}>
                Remind me later
              </Button>
              <Button variant="ghost" onClick={() => dismissUpdatePrompt('cancel')}>
                Cancel
              </Button>
            </>
          )}
          {!busy && !closing && !stuck && updateInfo?.url && (
            <Button variant="ghost" onClick={() => window.open(updateInfo.url, '_blank')}>
              Open release page
            </Button>
          )}
          {phase === 'idle' && !closing && !stuck && (
            <Button variant="primary" onClick={() => void update()} disabled={!updateInfo?.assetUrl}>
              {updateInfo?.assetUrl ? 'Update' : 'No installer asset'}
            </Button>
          )}
          {(busy || closing) && !stuck && (
            <Button disabled>
              <><Spinner /> {phase === 'downloading' ? 'Downloading...' : 'Closing launcher…'}</>
            </Button>
          )}
          {stuck && (
            <Button variant="primary" onClick={() => void runInstaller()}>
              Relaunch Reimagined
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
