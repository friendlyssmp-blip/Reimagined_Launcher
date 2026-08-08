/**
 * Enhanced "Check for Updates" experience (v1.0.36 - Change 1).
 *
 * Opened when the user clicks "Check for Updates" in Settings (and from the
 * sidebar update arrow). The existing update engine (GitHub manifest check,
 * download, checksum verify, install, relaunch) is untouched - this modal is
 * ONLY the experience around it:
 *
 *   CHECKING  -> (real elapsed timer, indeterminate animation - never a fake
 *               percentage, because the check API has no progress)
 *   AVAILABLE -> current -> new version, real check duration, Update Now /
 *               Remind Me Later / Cancel, expandable release notes.
 *   UP TO DATE -> checkmark + Done.
 *   FAILED    -> clear reason, Retry / Cancel (never claims "no update" on error).
 *
 * Guards: one check at a time (the button is disabled while checking), the
 * same update state as the sidebar arrow (both read the shared updateInfo),
 * and Esc / overlay click closes safely.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { useApp } from '../state/AppContext'
import { Button, Spinner } from './ui'
import { api, friendlyError } from '../lib/api'

type Phase = 'checking' | 'available' | 'uptodate' | 'failed' | 'downloading' | 'installing'

export function CheckUpdatesModal() {
  const { setModals, dismissUpdatePrompt, updateInfo, info, checkForUpdates } = useApp()
  const [phase, setPhase] = useState<Phase>('checking')
  const [error, setError] = useState<string | null>(null)
  const [showNotes, setShowNotes] = useState(false)
  const [busy, setBusy] = useState(false)
  const [percent, setPercent] = useState(0)
  const [phaseText, setPhaseText] = useState('')
  /* Real check duration (ms) - measured, never fabricated. */
  const [elapsedMs, setElapsedMs] = useState(0)
  const checkStartRef = useRef(0)
  /* Single-flight guard - a second Check while one is running is a no-op. */
  const checkingRef = useRef(false)
  /* Timer for the live "Time elapsed" readout during the checking phase. */
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fmt = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.max(0, Math.round(ms))}ms`)

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const startCheck = useCallback(async () => {
    if (checkingRef.current) return
    checkingRef.current = true
    setPhase('checking')
    setError(null)
    setElapsedMs(0)
    checkStartRef.current = performance.now()
    /* Live elapsed timer - a real chronometer, updated ~10x/s. */
    timerRef.current = setInterval(() => {
      setElapsedMs(performance.now() - checkStartRef.current)
    }, 100)
    try {
      /* The shared checkForUpdates (silent=true, force=true): refreshes the
         SAME updateInfo the sidebar arrow reads (single source of truth),
         never opens the auto-prompt, and does a real fresh check. */
      const res = await checkForUpdates(true, true)
      const elapsed = performance.now() - checkStartRef.current
      stopTimer()
      setElapsedMs(elapsed)
      checkingRef.current = false
      if (res === null) {
        setError('Could not reach the update server. Check your connection and try again.')
        setPhase('failed')
      } else if (res.hasUpdate) setPhase('available')
      else setPhase('uptodate')
    } catch (err) {
      const elapsed = performance.now() - checkStartRef.current
      stopTimer()
      setElapsedMs(elapsed)
      checkingRef.current = false
      setError(friendlyError(err))
      setPhase('failed')
    }
  }, [checkForUpdates])

  useEffect(() => {
    void startCheck()
    return () => {
      checkingRef.current = false
      stopTimer()
    }
  }, [startCheck])

  /* Live update:progress during download/install phases. */
  useEffect(() => {
    const off = api.onEvent((e) => {
      if (e.type !== 'update:progress') return
      const p = e.payload as { phase?: string; percent?: number; message?: string }
      setPercent(p.percent ?? 0)
      if (p.phase === 'download') setPhaseText('Downloading update...')
      else if (p.phase === 'extract') setPhaseText('Extracting update...')
      else if (p.phase === 'apply') setPhaseText('Applying files...')
      else if (p.phase === 'build') setPhaseText('Rebuilding the launcher...')
      else if (p.phase === 'restarting') setPhaseText('Relaunching... Minecraft keeps running')
      else if (p.phase === 'done') setPhaseText(p.message ?? 'Update complete')
    })
    return off
  }, [])

  /* "Update Now" - the EXACT existing flow: download -> verify -> install ->
     close -> helper relaunch. No second updater exists. */
  const updateNow = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      setPhase('downloading')
      setPhaseText('Downloading update...')
      await api.update.download()
      setPhase('installing')
      setPhaseText('Installing update...')
      await api.update.install()
      /* install() closes/relaunches the app - this is a fallback. */
    } catch (err) {
      setError(friendlyError(err))
      setPhase('failed')
      setBusy(false)
    }
  }

  const close = () => setModals({ checkUpdates: false })

  const renderChecking = () => (
    <div className="cu-checking">
      <div className="cu-orbit" aria-hidden="true">
        <span className="cu-orbit-ring" />
        <span className="cu-orbit-dot" />
        <span className="cu-orbit-glow" />
      </div>
      <div className="cu-title">Checking for updates...</div>
      <div className="cu-sub">Searching for the latest Reimagined Launcher version</div>
      <div className="cu-timer">
        Time elapsed: <b>{fmt(elapsedMs)}</b>
      </div>
    </div>
  )

  const renderAvailable = () => (
    <>
      <div className="cu-hero cu-hero-avail">
        <div className="cu-badge-avail">Update available!</div>
        <div className="cu-versions">
          <div className="cu-ver">
            <span className="cu-ver-label">Current version</span>
            <span className="cu-ver-num">v{updateInfo?.currentVersion ?? '--'}</span>
          </div>
          <span className="cu-arrow" aria-hidden="true">↓</span>
          <div className="cu-ver cu-ver-new">
            <span className="cu-ver-label">New version</span>
            <span className="cu-ver-num">v{updateInfo?.latestVersion ?? '--'}</span>
          </div>
        </div>
        <div className="cu-duration">Found in {fmt(elapsedMs)}</div>
      </div>
      {updateInfo?.publishedAt && (
        <div className="cu-meta">Published {new Date(updateInfo.publishedAt).toLocaleDateString()}</div>
      )}
      {updateInfo?.notes?.trim() && (
        <div className="cu-notes">
          <button className="cu-notes-toggle" onClick={() => setShowNotes((v) => !v)} aria-expanded={showNotes}>
            {showNotes ? 'Hide' : 'View'} release notes <span aria-hidden="true">{showNotes ? '▲' : '▼'}</span>
          </button>
          {showNotes && <pre className="cu-notes-body">{updateInfo.notes}</pre>}
        </div>
      )}
    </>
  )

  const renderUptodate = () => (
    <div className="cu-hero cu-hero-ok">
      <div className="cu-check-circle" aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </div>
      <div className="cu-title">You&apos;re up to date</div>
      <div className="cu-sub">Current version: v{updateInfo?.currentVersion ?? info?.version ?? '--'}</div>
      <div className="cu-sub">No update is currently available.</div>
      <div className="cu-duration">Check completed in {fmt(elapsedMs)}</div>
    </div>
  )

  const renderFailed = () => (
    <div className="cu-hero cu-hero-err">
      <div className="cu-title">Unable to check for updates</div>
      <div className="cu-duration">Check completed in {fmt(elapsedMs)}</div>
      <div className="cu-sub cu-err">{error || 'The update server could not be reached.'}</div>
      <div className="cu-sub">Your connection or the repository may be temporarily unavailable.</div>
    </div>
  )

  const renderWorking = () => (
    <>
      <div className="cu-working">
        <Spinner />
        <div className="cu-title">{phaseText}</div>
      </div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{phaseText}</span>
        <b style={{ fontSize: 12.5 }}>{percent}%</b>
      </div>
      <div className="progress">
        <span style={{ width: `${Math.max(2, percent)}%` }} />
      </div>
    </>
  )

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy && phase !== 'downloading' && phase !== 'installing') close()
      }}
    >
      <div className="modal modal-lg cu-modal" role="dialog" aria-modal="true" aria-label="Check for updates">
        <div className="modal-head">
          <h3>Reimagined Update</h3>
          {phase !== 'checking' && !busy && (
            <button className="btn btn-icon" onClick={close} aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          )}
        </div>
        <div className="modal-body cu-body">
          {phase === 'checking' && renderChecking()}
          {phase === 'available' && renderAvailable()}
          {phase === 'uptodate' && renderUptodate()}
          {phase === 'failed' && renderFailed()}
          {(phase === 'downloading' || phase === 'installing') && renderWorking()}
        </div>
        <div className="modal-foot cu-foot">
          {phase === 'checking' && (
            <Button variant="ghost" disabled>
              <Spinner /> Checking…
            </Button>
          )}
          {phase === 'available' && (
            <>
              <Button variant="ghost" onClick={() => { dismissUpdatePrompt('later'); close() }}>
                Remind Me Later
              </Button>
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void updateNow()} disabled={!updateInfo?.assetUrl}>
                {updateInfo?.assetUrl ? 'Update Now' : 'No installer asset'}
              </Button>
            </>
          )}
          {phase === 'uptodate' && (
            <Button variant="primary" onClick={close}>Done</Button>
          )}
          {phase === 'failed' && (
            <>
              <Button variant="ghost" onClick={close}>Cancel</Button>
              <Button variant="primary" onClick={() => void startCheck()}>Retry</Button>
            </>
          )}
          {(phase === 'downloading' || phase === 'installing') && (
            <Button disabled>
              <><Spinner /> {phase === 'installing' ? 'Installing…' : 'Downloading…'}</>
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
