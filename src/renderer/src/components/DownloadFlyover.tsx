/**
 * DownloadFlyover (v1.0.24).
 *
 * <p>A satisfying completion animation: the moment a real download hits 100%
 * (detected straight from the main-process `download:progress` event), the
 * item's icon — or a generic download glyph when the task has no icon — flies
 * from the center of the window into the Downloads button in the sidebar, as
 * if the file were dropping into the Downloads folder.</p>
 *
 * <p>Reality-first: the trigger is the ACTUAL download state reaching 100%,
 * never a timer. The same label is throttled to once per 3 seconds so a batch
 * of files doesn't spam the screen, and at most 6 are shown at once.</p>
 */
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { ModIcon } from './ModIcon'
import { IconDownload } from './icons'

interface Fly {
  id: number
  label: string
  iconUrl?: string
  dx: number
  dy: number
}

let seq = 0
const lastByLabel = new Map<string, number>()
const FLY_MS = 950

export function DownloadFlyover() {
  const [flies, setFlies] = useState<Fly[]>([])

  useEffect(() => {
    return api.onEvent((e) => {
      if (e.type !== 'download:progress') return
      const p = e.payload as { kind?: string; percent?: number; label?: string; iconUrl?: string } | null
      // Content installs (mods/resource packs/shaders/data packs/modpacks/imports)
      // all run with kind 'mods'. The MC launch pipeline (assets/libraries/loader/...)
      // must NEVER trigger the animation, so only 'mods' flies.
      if (!p?.label || p.kind !== 'mods' || (p.percent ?? 0) < 100) return
      const now = Date.now()
      const last = lastByLabel.get(p.label) ?? 0
      if (now - last < 3000) return
      lastByLabel.set(p.label, now)
      if (lastByLabel.size > 60) lastByLabel.clear()

      // Fly from the center of the window toward the Downloads nav button.
      const target = document.querySelector<HTMLElement>('[data-nav="downloads"]')
      const rect = target?.getBoundingClientRect()
      const cx = window.innerWidth / 2
      const cy = window.innerHeight / 2
      const dx = rect && rect.width > 0 ? rect.left + rect.width / 2 - cx : -cx + 48
      const dy = rect && rect.height > 0 ? rect.top + rect.height / 2 - cy : cy - 48

      const id = ++seq
      setFlies((f) => [...f.slice(-5), { id, label: p.label ?? '', iconUrl: p.iconUrl, dx, dy }])
      window.setTimeout(() => {
        setFlies((f) => f.filter((x) => x.id !== id))
      }, FLY_MS)
    })
  }, [])

  if (flies.length === 0) return null

  return (
    <div
      className="flyover-layer"
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999 }}
    >
      {flies.map((f) => (
        <div
          key={f.id}
          className="fly-item"
          title={f.label}
          style={{ '--dx': `${f.dx}px`, '--dy': `${f.dy}px` } as React.CSSProperties}
        >
          {f.iconUrl ? (
            <ModIcon src={f.iconUrl} style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover' }} />
          ) : (
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                background: 'linear-gradient(135deg, var(--accent), var(--accent-2, #b17cff))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#0b0b10'
              }}
            >
              <IconDownload style={{ width: 20, height: 20 }} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
