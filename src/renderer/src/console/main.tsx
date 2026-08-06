/**
 * Detached game console window renderer.
 *
 * A standalone React root (no AppProvider — this is its own BrowserWindow)
 * showing the live game output. The window is frameless with a draggable
 * custom title bar: it can be moved, minimized, resized and closed without
 * ever touching the running game.
 */
import { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import '../styles/global.css'
import { api } from '../lib/api'
import type { AppEvent } from '@shared/ipc'
import type { LaunchLogLine } from '@shared/types'

type Phase = 'idle' | 'preparing' | 'downloading' | 'launching' | 'running'

function ConsoleApp() {
  const [logs, setLogs] = useState<LaunchLogLine[]>([])
  const [message, setMessage] = useState('Waiting…')
  const [percent, setPercent] = useState<number | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [follow, setFollow] = useState(true)
  const logRef = useRef<HTMLDivElement>(null)

  // Seed the view from the main process, then stream live events.
  useEffect(() => {
    let alive = true
    let off: (() => void) | undefined

    void api.console
      .getState()
      .then((s) => {
        if (!alive) return
        // Merge the snapshot under any lines that streamed in during the IPC
        // round-trip (dedup by content so nothing is lost or doubled).
        setLogs((prev) => {
          if (prev.length === 0) return s.logs
          const seen = new Set(prev.map((l) => l.at + l.text))
          return [...s.logs.filter((l) => !seen.has(l.at + l.text)), ...prev].slice(-3000)
        })
        if (s.progress) {
          setMessage(s.progress.message)
          setPercent(s.progress.percent)
          setPhase(s.running ? 'running' : 'preparing')
        }
      })
      .catch(() => {})

    off = api.onEvent((e: AppEvent) => {
      switch (e.type) {
        case 'launch:log':
          setLogs((prev) => [...prev.slice(-2999), e.payload as LaunchLogLine])
          break
        case 'launch:progress': {
          const p = e.payload as { stage: string; message: string; percent: number | null }
          setMessage(p.message)
          setPercent(p.percent ?? null)
          setPhase(p.stage === 'running' ? 'running' : p.stage === 'launching' ? 'launching' : 'preparing')
          break
        }
        case 'launch:status': {
          const p = e.payload as { running: boolean }
          if (p.running) setPhase('running')
          else setPhase((prev) => (prev === 'running' || prev === 'launching' ? 'idle' : prev))
          break
        }
        case 'launch:exit':
          setPhase('idle')
          setPercent(null)
          break
        default:
          break
      }
    })

    return () => {
      alive = false
      off?.()
    }
  }, [])

  // Auto-scroll to the newest line while following.
  useEffect(() => {
    if (follow && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs, follow])

  const running = phase === 'running' || phase === 'launching'

  return (
    <div className="cw">
      <div className="cw-titlebar">
        <span className="cw-dot" />
        <span className="cw-title">Game Console</span>
        <span className={`cw-status${running ? ' on' : ''}`}>{running ? '● running' : 'idle'}</span>
        <div className="cw-controls">
          <button className="cw-ctl" title="Minimize" onClick={() => void api.console.minimize()}>
            –
          </button>
          <button
            className="cw-ctl cw-close"
            title="Close console (the game keeps running)"
            onClick={() => void api.console.close()}
          >
            ✕
          </button>
        </div>
      </div>

      <div className="cw-stage">
        <span className="stage-label">{message}</span>
        {percent != null && percent > 0 && (
          <div className="progress cw-progress">
            <span style={{ width: `${percent}%` }} />
          </div>
        )}
        {running && (
          <button className="cw-stop" onClick={() => void api.launch.stop()}>
            Stop game
          </button>
        )}
      </div>

      <div className="cw-log" ref={logRef}>
        {logs.length === 0 && <div className="cw-empty">No output yet — launch a profile to see the game console here.</div>}
        {logs.map((line, i) => (
          <div key={i} className={`cw-line ${line.stream}`}>
            {line.text}
          </div>
        ))}
      </div>

      <div className="cw-footer">
        <span className="cw-count">{logs.length.toLocaleString()} lines</span>
        <button className={`cw-link${follow ? ' active' : ''}`} onClick={() => setFollow((f) => !f)}>
          Auto-scroll {follow ? 'on' : 'off'}
        </button>
        <button className="cw-link" onClick={() => setLogs([])}>
          Clear
        </button>
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<ConsoleApp />)
