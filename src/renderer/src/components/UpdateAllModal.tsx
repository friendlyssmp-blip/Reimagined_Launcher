import { useMemo, useState } from 'react'
import { Modal, Button, Spinner, Badge } from './ui'
import { ModIcon } from './ModIcon'
import { IconCheck } from './icons'
import type { ProfileMod } from '@shared/types'

/** Live progress while Update All runs (v1.0.76). */
export interface UpdateAllProgress {
  total: number
  done: string[]
  /** Slugs whose update attempt failed — shown as Failed instead of Updated. */
  failed: string[]
  current: string | null
}

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
 *
 * v1.0.76 — while the batch runs the modal stays open and shows live state:
 * the count in the title/button ticks down in real time, the item being
 * updated shows a spinner and finished items get a green check.
 */
export function UpdateAllModal({
  items,
  busy,
  progress,
  onClose,
  onConfirm
}: {
  items: ProfileMod[]
  busy: boolean
  progress: UpdateAllProgress | null
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

  const remaining = busy && progress ? Math.max(0, progress.total - progress.done.length) : rows.length - excluded.size
  const doneSet = useMemo(() => new Set(progress?.done ?? []), [progress])
  const failedSet = useMemo(() => new Set(progress?.failed ?? []), [progress])

  return (
    <Modal
      title={
        busy && progress
          ? `Update All (${remaining})`
          : excluded.size > 0
            ? `Update All (${remaining} of ${rows.length})`
            : `Update All (${rows.length})`
      }
      onClose={busy ? undefined : onClose}
      size="lg"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '2px 2px' }}>
        {busy && progress ? (
          <p style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.5, margin: 0 }}>
            Updating… <b>{progress.done.length} of {progress.total}</b> done
            {remaining > 0 ? ` — ${remaining} to go.` : ' — everything finished.'}
          </p>
        ) : (
          <p style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.5, margin: 0 }}>
            {rows.length} update(s) ready. Toggle <b>Skip</b> on anything you want to leave on its
            current version — confirming updates the rest. Updates are manual and nothing installs until you do.
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 340, overflowY: 'auto', paddingRight: 4 }}>
          {rows.map((m) => {
            const skipped = !busy && excluded.has(m.slug)
            const isFailed = busy && failedSet.has(m.slug)
            const isDone = busy && doneSet.has(m.slug) && !isFailed
            const isCurrent = busy && !isDone && progress?.current === m.slug
            return (
              <div
                key={m.slug}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 10,
                  background: skipped ? 'var(--bg-2)' : isDone ? 'var(--bg-2)' : isFailed ? 'var(--danger-soft)' : 'var(--bg-3)',
                  border: '1px solid ' + (isDone ? 'var(--success)' : isFailed ? 'var(--danger)' : 'var(--border)'),
                  opacity: skipped ? 0.55 : 1,
                  transition: 'opacity 120ms ease, background 120ms ease, border-color 120ms ease'
                }}
              >
                <div className="mod-icon" style={{ width: 36, height: 36, borderRadius: 9, flexShrink: 0 }}>
                  <ModIcon src={m.iconUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.title}</span>
                    {skipped && <Badge variant="warn">Skipped</Badge>}
                    {isFailed && <Badge variant="danger">Failed</Badge>}
                    {isDone && <Badge variant="success">Updated</Badge>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                    <span>{m.versionNumber}</span>
                    <span style={{ color: 'var(--text-3)' }}>→</span>
                    <span className="badge badge-success" style={{ fontWeight: 700 }}>{m.updateAvailable!.versionNumber}</span>
                  </div>
                </div>
                <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', minWidth: 56, justifyContent: 'flex-end' }}>
                  {busy ? (
                    isDone ? (
                      <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <IconCheck style={{ width: 12, height: 12 }} /> Done
                      </span>
                    ) : isFailed ? (
                      <span className="badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--danger-soft)', color: 'var(--danger)' }}>
                        Failed
                      </span>
                    ) : isCurrent ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)' }}>
                        <Spinner /> Updating
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Queued</span>
                    )
                  ) : (
                    /* v2.1.0 — Skip is a real checkbox: one click marks it (no
                       toggle switch), so the row reads at a glance which items
                       are kept on their current version. */
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={skipped}
                      onClick={() => toggleSkip(m.slug)}
                      title={skipped ? 'Include this update again' : 'Skip this update — keep the current version'}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '4px 8px',
                        borderRadius: 8,
                        border: '1px solid ' + (skipped ? 'var(--accent-3)' : 'var(--border)'),
                        background: skipped ? 'var(--accent-soft, rgba(139,92,246,0.12))' : 'transparent',
                        color: skipped ? 'var(--accent-3)' : 'var(--text-3)',
                        fontSize: 11.5,
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'border-color 120ms ease, background 120ms ease, color 120ms ease'
                      }}
                    >
                      <span
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: 4,
                          border: '1px solid ' + (skipped ? 'var(--accent-3)' : 'var(--border-strong)'),
                          background: skipped ? 'var(--accent-3)' : 'var(--bg-2)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#fff',
                          flexShrink: 0
                        }}
                      >
                        {skipped && <IconCheck style={{ width: 10, height: 10 }} />}
                      </span>
                      Skip
                    </button>
                  )}
                </div>
              </div>
            )
          })}
          {rows.length === 0 && (
            <p style={{ color: 'var(--text-3)', fontSize: 13, margin: 0 }}>Nothing to update right now.</p>
          )}
        </div>

        {!busy && excluded.size > 0 && (
          <p style={{ color: 'var(--text-3)', fontSize: 12, margin: 0 }}>
            {excluded.size} skipped — {remaining} will be updated.
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {busy ? 'Working…' : 'Cancel'}
          </Button>
          <Button variant="primary" onClick={() => onConfirm([...excluded])} disabled={busy || remaining === 0}>
            {busy ? <><Spinner /> Updating… ({remaining})</> : `Update All (${remaining})`}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
