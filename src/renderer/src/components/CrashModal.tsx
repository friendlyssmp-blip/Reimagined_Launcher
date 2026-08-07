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
          <Button variant="ghost" onClick={copyReport}>
            Copy report
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

      <div style={{ marginTop: 14 }}>
        <div className="panel-title">What happened</div>
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

      <div style={{ marginTop: 14 }}>
        <div className="panel-title">Suggested fixes</div>
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
