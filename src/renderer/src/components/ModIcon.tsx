/**
 * ModIcon — reliable remote project icon (V2 fix).
 *
 * Icons used to be fetched directly from Modrinth's CDN, but the renderer's
 * CSP (`connect-src 'self'`) blocks in-page fetch() and the direct <img>
 * fallback failed intermittently — that's why covers sometimes didn't load.
 *
 * Icons now go through the MAIN-process proxy (retries + browser headers +
 * bounded cache) and show a styled placeholder while loading or on failure —
 * a broken-image glyph can never appear.
 */
import { useProjectImage } from '../lib/useProjectImage'
import { IconPuzzle } from './icons'

export function ModIcon({ src, style, draggable = false }: { src?: string | null; style?: React.CSSProperties; draggable?: boolean }) {
  const state = useProjectImage(src)

  if (state.status === 'ready') {
    return <img src={state.dataUrl} alt="" style={style} draggable={draggable} />
  }

  // Loading / unavailable — a clean placeholder instead of a broken image.
  return (
    <div
      style={{
        ...style,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, var(--bg-4, #22222c), var(--bg-3, #191921))',
        color: 'var(--text-3)',
        borderRadius: style?.borderRadius ?? 9,
        overflow: 'hidden'
      }}
    >
      <IconPuzzle style={{ width: '38%', height: '38%', opacity: 0.6 }} />
    </div>
  )
}
