/**
 * ProjectImage — reliable remote cover/screenshot (V2 fix).
 *
 * Used for detail-page hero images and gallery screenshots. Images load
 * through the MAIN-process proxy (no CSP, retries, browser headers) and fall
 * back to a styled placeholder instead of a broken-image glyph.
 *
 * When `loading="lazy"` the fetch only starts once the element is near the
 * viewport (IntersectionObserver) — off-screen gallery screenshots are never
 * downloaded, keeping memory and bandwidth flat.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useProjectImage } from '../lib/useProjectImage'

interface Props {
  src: string
  alt?: string
  style?: CSSProperties
  className?: string
  loading?: 'lazy' | 'eager'
  title?: string
  onClick?: () => void
}

export function ProjectImage({ src, alt = '', style, className, loading = 'eager', title, onClick }: Props) {
  /* Lazy: only mount the real loader once the element is near the viewport. */
  const [visible, setVisible] = useState(loading !== 'lazy')
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (loading !== 'lazy') return
    const el = boxRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          obs.disconnect()
        }
      },
      { rootMargin: '300px' }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [loading])

  const state = useProjectImage(visible ? src : null)

  if (state.status === 'ready') {
    return <img src={state.dataUrl} alt={alt} style={style} className={className} loading={loading} title={title} onClick={onClick} draggable={false} />
  }

  return (
    <div
      ref={boxRef}
      className={'project-image-ph' + (className ? ' ' + className : '')}
      title={title}
      onClick={onClick}
      style={{
        ...style,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, var(--bg-4, #22222c), var(--bg-3, #191921))',
        color: 'var(--text-3)',
        fontSize: 12,
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default'
      }}
    >
      {state.status === 'loading' ? (
        <span style={{ opacity: 0.65 }}>Loading image…</span>
      ) : (
        <span style={{ opacity: 0.7 }}>Image unavailable</span>
      )}
    </div>
  )
}
