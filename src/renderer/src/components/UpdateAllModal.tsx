import { useMemo } from 'react'
import { Modal, Button, Spinner } from './ui'
import { ModIcon } from './ModIcon'
import type { ProfileMod } from '@shared/types'

/**
 * v1.0.52 — "Update All" preview (Bug 2). Before updating everything, show a
 * fast, lightweight list: one row per mod with its real icon, name and a
 * clear "current → new" change where the NEW version sits on a green pill.
 * A single confirm action runs the EXISTING update pipeline — nothing here
 * re-implements the updater, it is only the preview experience around it.
 */
export function UpdateAllModal({
  items,
  busy,
  onClose,
  onConfirm
}: {
  items: ProfileMod[]
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const rows = useMemo(() => items.filter((m) => m.updateAvailable).slice(0, 40), [items])
  const hidden = items.length - rows.length

  return (
    <Modal title={`Update All (${items.length})`} onClose={busy ? undefined : onClose} size="lg">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '2px 2px' }}>
        <p style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.5, margin: 0 }}>
          {items.length} update(s) ready. Review the list below, then confirm — updates are manual and nothing installs until you do.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 340, overflowY: 'auto', paddingRight: 4 }}>
          {rows.map((m) => (
            <div
              key={m.slug}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 10px',
                borderRadius: 10,
                background: 'var(--bg-3)',
                border: '1px solid var(--border)'
              }}
            >
              <div className="mod-icon" style={{ width: 36, height: 36, borderRadius: 9, flexShrink: 0 }}>
                <ModIcon src={m.iconUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {m.title}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                  <span>{m.versionNumber}</span>
                  <span style={{ color: 'var(--text-3)' }}>→</span>
                  <span className="badge badge-success" style={{ fontWeight: 700 }}>{m.updateAvailable!.versionNumber}</span>
                </div>
              </div>
            </div>
          ))}
          {hidden > 0 && (
            <p style={{ color: 'var(--text-3)', fontSize: 12, margin: '4px 2px' }}>…and {hidden} more</p>
          )}
          {rows.length === 0 && (
            <p style={{ color: 'var(--text-3)', fontSize: 13, margin: 0 }}>Nothing to update right now.</p>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm} disabled={busy || rows.length === 0}>
            {busy ? <><Spinner /> Updating…</> : `Update All (${rows.length})`}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
