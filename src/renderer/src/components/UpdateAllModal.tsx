import { useMemo, useState } from 'react'
import { Modal, Button, Spinner, Toggle, Badge } from './ui'
import { ModIcon } from './ModIcon'
import type { ProfileMod } from '@shared/types'

/**
 * v1.0.52 — "Update All" preview (Bug 2). Before updating everything, show a
 * fast, lightweight list: one row per mod with its real icon, name and a
 * clear "current → new" change where the NEW version sits on a green pill.
 * A single confirm action runs the EXISTING update pipeline — nothing here
 * re-implements the updater, it is only the preview experience around it.
 *
 * v1.0.75 — per-row "Skip" toggle: mark anything you want to leave on its
 * current version. Confirming updates every non-skipped item and hands the
 * skipped slugs back through onConfirm so the batch skips them for real.
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
  onConfirm: (excluded: string[]) => void
}) {
  const rows = useMemo(() => items.filter((m) => m.updateAvailable), [items])
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set())

  const toggleSkip = (slug: string) => {
    if (busy) return
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }

  const toUpdate = rows.length - excluded.size

  return (
    <Modal title={excluded.size > 0 ? `Update All (${toUpdate} of ${rows.length})` : `Update All (${rows.length})`} onClose={busy ? undefined : onClose} size="lg">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '2px 2px' }}>
        <p style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.5, margin: 0 }}>
          {rows.length} update(s) ready. Toggle <b>Skip</b> on anything you want to leave on its
          current version — confirming updates the rest. Updates are manual and nothing installs until you do.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 340, overflowY: 'auto', paddingRight: 4 }}>
          {rows.map((m) => {
            const skipped = excluded.has(m.slug)
            return (
              <div
                key={m.slug}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 10,
                  background: skipped ? 'var(--bg-2)' : 'var(--bg-3)',
                  border: '1px solid var(--border)',
                  opacity: skipped ? 0.55 : 1,
                  transition: 'opacity 120ms ease, background 120ms ease'
                }}
              >
                <div className="mod-icon" style={{ width: 36, height: 36, borderRadius: 9, flexShrink: 0 }}>
                  <ModIcon src={m.iconUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.title}</span>
                    {skipped && <Badge variant="warn">Skipped</Badge>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                    <span>{m.versionNumber}</span>
                    <span style={{ color: 'var(--text-3)' }}>→</span>
                    <span className="badge badge-success" style={{ fontWeight: 700 }}>{m.updateAvailable!.versionNumber}</span>
                  </div>
                </div>
                <div style={{ flexShrink: 0 }} title={skipped ? 'Skip this update (already skipped)' : 'Skip this update — keep the current version'}>
                  <Toggle checked={skipped} onChange={() => toggleSkip(m.slug)} label="Skip" />
                </div>
              </div>
            )
          })}
          {rows.length === 0 && (
            <p style={{ color: 'var(--text-3)', fontSize: 13, margin: 0 }}>Nothing to update right now.</p>
          )}
        </div>

        {excluded.size > 0 && (
          <p style={{ color: 'var(--text-3)', fontSize: 12, margin: 0 }}>
            {excluded.size} skipped — {toUpdate} will be updated.
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onConfirm([...excluded])} disabled={busy || toUpdate === 0}>
            {busy ? <><Spinner /> Updating…</> : `Update All (${toUpdate})`}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
