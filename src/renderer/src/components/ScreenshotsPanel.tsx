/**
 * Screenshots (v1.0.88) — the instance's own F2 screenshots, shown next to
 * the Worlds tab inside the Installed panel. Thumbnails open a fullscreen
 * viewer with scroll-wheel zoom (centered on the cursor), multi-select
 * export and confirmed per-file delete.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../state/AppContext'
import { api, friendlyError } from '../lib/api'
import { Button, Spinner, EmptyState } from './ui'
import { IconImage, IconTrash, IconDownload, IconX } from './icons'

interface Shot {
  id: string
  name: string
  size: number
  at: string
  url: string
}

export function ScreenshotsPanel({ profileId }: { profileId: string }) {
  const { notify, setModals } = useApp()
  const [shots, setShots] = useState<Shot[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)
  /* Fullscreen viewer (same interaction language as the gallery lightbox). */
  const [viewer, setViewer] = useState<number | null>(null)
  const [zoom, setZoom] = useState(1)
  const [origin, setOrigin] = useState('50% 50%')

  useEffect(() => {
    setZoom(1)
    setOrigin('50% 50%')
  }, [viewer])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setShots(await api.screenshots.list(profileId))
    } catch (err) {
      notify('error', 'Could not load screenshots', friendlyError(err))
    } finally {
      setLoading(false)
    }
  }, [profileId, notify])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (viewer === null) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setViewer(null)
      else if (e.key === 'ArrowRight') setViewer((i) => ((i ?? 0) + 1) % shots.length)
      else if (e.key === 'ArrowLeft') setViewer((i) => ((i ?? 0) - 1 + shots.length) % shots.length)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewer, shots.length])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const exportSel = async () => {
    const ids = [...selected]
    if (ids.length === 0) {
      notify('info', 'Export screenshots', 'Select one or more screenshots first, then export them all at once.')
      return
    }
    setExporting(true)
    try {
      const n = await api.screenshots.export({ profileId, ids })
      notify('success', 'Screenshots exported', n > 0 ? `${n} file(s) saved to the folder you picked.` : 'Nothing was exported.')
      setSelected(new Set())
    } catch (err) {
      notify('error', 'Could not export screenshots', friendlyError(err))
    } finally {
      setExporting(false)
    }
  }

  const removeOne = (shot: Shot) => {
    setModals({
      confirm: {
        title: 'Delete screenshot',
        message: `Delete “${shot.name}” permanently? This cannot be undone.`,
        confirmLabel: 'Delete',
        danger: true,
        onConfirm: async () => {
          try {
            await api.screenshots.delete({ profileId, id: shot.id })
            await refresh()
            notify('info', 'Screenshot deleted', shot.name)
          } catch (err) {
            notify('error', 'Could not delete screenshot', friendlyError(err))
          }
        }
      }
    })
  }

  const current = viewer !== null ? shots[viewer] : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
          F2 screenshots inside this instance's <code className="mono">screenshots/</code> folder.
        </span>
        <span style={{ flex: 1 }} />
        {selected.size > 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{selected.size} selected</span>
        )}
        <Button size="sm" variant="ghost" onClick={() => void exportSel()} disabled={exporting}>
          {exporting ? <Spinner /> : <IconDownload style={{ width: 13, height: 13 }} />} Export
        </Button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-3)', fontSize: 12.5 }}>
          <Spinner /> Loading screenshots…
        </div>
      ) : shots.length === 0 ? (
        <EmptyState
          icon={<IconImage style={{ width: 34, height: 34 }} />}
          title="No screenshots yet"
          sub="Press F2 in game to take a screenshot — it lands in this instance's screenshots folder and shows up here."
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
          {shots.map((shot, i) => {
            const isSel = selected.has(shot.id)
            return (
              <div
                key={shot.id}
                className={'shot-tile' + (isSel ? ' selected' : '')}
                onClick={() => setViewer(i)}
                style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', cursor: 'zoom-in', border: '1px solid var(--border)' }}
              >
                <img
                  src={shot.url}
                  alt={shot.name}
                  loading="lazy"
                  style={{ width: '100%', height: 110, objectFit: 'cover', display: 'block', background: 'var(--bg-3)' }}
                />
                <div style={{ position: 'absolute', inset: 'auto 0 0 0', padding: '16px 8px 6px', background: 'linear-gradient(transparent, rgba(0,0,0,0.75))', fontSize: 10.5, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {shot.name}
                </div>
                <button
                  className={'shot-select' + (isSel ? ' on' : '')}
                  aria-label="Select screenshot"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggle(shot.id)
                  }}
                >
                  {isSel ? '✓' : ''}
                </button>
                <button
                  className="shot-delete"
                  aria-label="Delete screenshot"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeOne(shot)
                  }}
                >
                  <IconTrash style={{ width: 12, height: 12 }} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {current && (
        <div
          className="lightbox-overlay"
          onWheel={(e) => {
            e.preventDefault()
            const rect = e.currentTarget.getBoundingClientRect()
            const x = ((e.clientX - rect.left) / rect.width) * 100
            const y = ((e.clientY - rect.top) / rect.height) * 100
            setOrigin(`${x}% ${y}%`)
            setZoom((z) => Math.min(6, Math.max(1, z * (e.deltaY < 0 ? 1.15 : 0.87))))
          }}
          onClick={() => setViewer(null)}
        >
          <img
            src={current.url}
            alt={current.name}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '92vw',
              maxHeight: '86vh',
              objectFit: 'contain',
              transform: zoom > 1 ? 'scale(1)' : undefined,
              zoom: zoom,
              transformOrigin: origin,
              transition: 'zoom 0.08s ease',
              borderRadius: 6,
              boxShadow: '0 20px 70px rgba(0,0,0,0.6)'
            }}
          />
          <div className="lightbox-meta">
            <span>{current.name}</span>
            <span className="mono" style={{ opacity: 0.7 }}>{Math.round(zoom * 100)}%</span>
          </div>
          <button className="lightbox-close" onClick={() => setViewer(null)} aria-label="Close">
            <IconX style={{ width: 16, height: 16 }} />
          </button>
        </div>
      )}
    </div>
  )
}
