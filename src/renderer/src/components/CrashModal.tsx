/**
 * Crash Assistant dialog.
 *
 * Shown automatically when the game exits with a crash report: a clear
 * headline cause, concrete suggestions and quick access to the report file.
 * Everything stays local — nothing is uploaded anywhere.
 */
import { useApp } from '../state/AppContext'
import { Modal, Button } from './ui'
import { api, friendlyError } from '../lib/api'

export function CrashModal() {
  const { modals, setModals, notify } = useApp()
  const report = modals.crash
  if (!report) return null

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(report.snippet)
      notify('success', 'Crash report copied', 'Paste it anywhere to share with mod authors.')
    } catch {
      notify('error', 'Could not copy', 'Clipboard access was blocked.')
    }
  }

  const copyLog = async () => {
    try {
      const lines = report.logTail ?? []
      await navigator.clipboard.writeText(lines.join('\n') || '(No game log lines were captured before this crash.)')
      notify('success', 'Log tail copied', 'The last game log lines before the crash are on your clipboard.')
    } catch {
      notify('error', 'Could not copy', 'Clipboard access was blocked.')
    }
  }

  const openFolder = async () => {
    try {
      await api.content.openFolder(report.profileId, 'crash-reports')
    } catch (err) {
      notify('error', 'Could not open folder', friendlyError(err))
    }
  }

  return (
    <Modal
      title="Crash Assistant"
      onClose={() => setModals({ crash: null })}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => setModals({ crash: null })}>
            Dismiss
          </Button>
          <Button variant="ghost" onClick={copyLog}>
            Copy Log
          </Button>
          <Button variant="ghost" onClick={copyReport}>
            Copy Crash Report
          </Button>
          <Button variant="ghost" onClick={openFolder}>
            Open crash folder
          </Button>
          <Button variant="primary" onClick={() => setModals({ crash: null })}>
            Got it
          </Button>
        </>
      }
    >
      <div
        className="banner"
        style={{
          borderColor: 'var(--danger, #f87171)',
          background: 'rgba(248, 113, 113, 0.08)',
          color: 'var(--text-1)'
        }}
      >
        <b style={{ color: 'var(--danger, #f87171)' }}>{report.profileName}</b> crashed.
        <span style={{ color: 'var(--text-3)' }}>
          {' '}· {report.file} — generated {new Date(report.at).toLocaleTimeString()}
        </span>
      </div>

      {/* Confidence — honest about how sure the analysis is */}
      {report.confidence && (
        <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--text-3)' }}>
          Analysis confidence:{' '}
          <b style={{ color: report.confidence === 'high' ? 'var(--green, #34d399)' : report.confidence === 'medium' ? 'var(--yellow, #fbbf24)' : 'var(--text-2)' }}>
            {report.confidence === 'high' ? 'high — clear exception and stack evidence' : report.confidence === 'medium' ? 'medium — exception identified, cause not pinned down' : 'low — cause uncertain'}
          </b>
          {report.confidence === 'low' && <span> — the report is generic; see the evidence below.</span>}
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <div className="panel-title">Crash summary</div>
        <p
          className="mono"
          style={{
            marginTop: 8,
            background: 'var(--bg-2)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '10px 12px',
            fontSize: 12.5,
            color: 'var(--text-1)',
            wordBreak: 'break-word',
            lineHeight: 1.55
          }}
        >
          {report.cause}
        </p>
      </div>

      {(report.exception || report.causedBy) && (
        <div style={{ marginTop: 12 }}>
          <div className="panel-title">Root cause</div>
          <p className="mono" style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 6, lineHeight: 1.5, wordBreak: 'break-word' }}>
            {report.exception ?? ''}
            {report.causedBy ? <span style={{ color: 'var(--danger, #f87171)' }}>{'\n'}Caused by: {report.causedBy}</span> : null}
          </p>
        </div>
      )}

      {report.responsibleMods && report.responsibleMods.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="panel-title">Likely responsible</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            {report.responsibleMods.map((m) => (
              <span key={m} className="badge" style={{ background: 'var(--accent-soft)', color: 'var(--accent-3)', fontWeight: 600 }}>{m}</span>
            ))}
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 6 }}>
            Non-vanilla classes found in the crash stack — a strong hint, not a verdict.
          </p>
        </div>
      )}

      {report.stackTop && report.stackTop.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="panel-title">Technical details</div>
          <pre style={{ marginTop: 6, fontSize: 11, lineHeight: 1.5, color: 'var(--text-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {report.stackTop.map((f) => `  at ${f}`).join('\n')}
          </pre>
        </div>
      )}

      {report.logTail && report.logTail.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="panel-title">Right before the crash (game log)</div>
          <pre
            style={{
              marginTop: 6,
              maxHeight: 120,
              overflow: 'auto',
              fontSize: 10.5,
              lineHeight: 1.45,
              color: 'var(--text-3)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: 'Consolas, Menlo, monospace'
            }}
          >
            {report.logTail.join('\n')}
          </pre>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <div className="panel-title">Possible solution</div>
        <ul style={{ margin: '8px 0 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 7 }}>
          {report.suggestions.map((s, i) => (
            <li key={i} style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>{s}</li>
          ))}
        </ul>
      </div>

      <div style={{ marginTop: 14 }}>
        <div className="panel-title">Crash report</div>
        <pre
          style={{
            marginTop: 8,
            maxHeight: 210,
            overflow: 'auto',
            background: 'var(--bg-2)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 12,
            fontSize: 11,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: 'Consolas, Menlo, monospace',
            color: 'var(--text-2)'
          }}
        >
          {report.snippet}
        </pre>
      </div>

      <p className="muted" style={{ fontSize: 11.5, marginTop: 12 }}>
        Crash reports stay on your PC inside the instance's crash-reports folder — the launcher never uploads anything.
      </p>
    </Modal>
  )
}
