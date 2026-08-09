/**
 * ModIcon — reliable remote project icon (V2 fix).
 *
 * Icons used to be fetched directly from Modrinth's CDN, but the renderer's
 * CSP (`connect-src 'self'`) blocks in-page fetch() and the direct <img>
 * fallback failed intermittently — that's why covers sometimes didn't load.
 *
 * Icons now go through the MAIN-process proxy (retries + browser headers +
 * bounded cache) and show the Reimagined logo (Logo/Logo.png) while loading
 * or when a project has no icon of its own — never a broken-image glyph.
 */
import { useProjectImage } from '../lib/useProjectImage'

export function ModIcon({ src, style, draggable = false }: { src?: string | null; style?: React.CSSProperties; draggable?: boolean }) {
  // v1.0.50 — embedded icons (extracted from the mod/pack file itself) are
  // already data: URLs — the main-process image proxy is for remote CDNs
  // only, so render these directly.
  // v1.0.58 — decoding="async" keeps large covers from blocking the main
  // thread (jank while scrolling long lists); loading="lazy" defers offscreen
  // decodes entirely.
  if (src && src.startsWith('data:')) {
    return <img src={src} alt="" style={style} draggable={draggable} decoding="async" />
  }
  const state = useProjectImage(src)

  if (state.status === 'ready') {
    return <img src={state.dataUrl} alt="" style={style} draggable={draggable} decoding="async" loading="lazy" />
  }

  // Loading / unavailable — the app logo (Logo/Logo.png) replaces a broken glyph.
  return (
    <div
      style={{
        ...style,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, var(--bg-4, #22222c), var(--bg-3, #191921))',
        borderRadius: style?.borderRadius ?? 9,
        overflow: 'hidden'
      }}
    >
      <img
        src="./app-logo.png"
        alt=""
        draggable={false}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          opacity: state.status === 'loading' ? 0.45 : 0.72
        }}
      />
    </div>
  )
}
