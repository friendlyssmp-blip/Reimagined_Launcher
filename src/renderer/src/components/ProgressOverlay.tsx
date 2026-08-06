/**
 * Progress overlay for profile create/delete operations.
 *
 * Driven by real `profile:progress` events from the main process — the bar is
 * tied to actual file-system work (folder creation, file deletion), never an
 * artificial timer. Indeterminate while no percentage is measurable.
 */
import { useApp } from '../state/AppContext'

export function ProgressOverlay() {
  const { profileOp } = useApp()
  if (!profileOp) return null

  const determinate = profileOp.percent != null

  return (
    <div className="modal-overlay" style={{ zIndex: 110 }}>
      <div className="modal" style={{ width: 420, textAlign: 'center' }}>
        <div className="modal-body" style={{ padding: '34px 28px' }}>
          <div className="progress-ring">
            {determinate && profileOp.percent !== null ? (
              <span>{Math.round(profileOp.percent)}%</span>
            ) : (
              <span className="progress-ring-spinner" />
            )}
          </div>
          <h3 style={{ marginTop: 18, fontSize: 16 }}>
            {profileOp.action === 'create' && 'Creating profile'}
            {profileOp.action === 'delete' && 'Deleting profile'}
            {profileOp.action === 'duplicate' && 'Duplicating profile'}
            {profileOp.action === 'prepare' && 'Preparing profile'}
            {profileOp.action === 'import' && 'Importing profile'}
          </h3>
          <p className="panel-sub" style={{ marginTop: 6, fontSize: 13 }}>
            “{profileOp.name}”
          </p>
          <div style={{ marginTop: 18 }}>
            <div className={`progress ${determinate ? '' : 'progress-indeterminate'}`}>
              <span style={determinate ? { width: `${profileOp.percent ?? 0}%` } : undefined} />
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 10, fontWeight: 600 }}>
              {profileOp.message}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
