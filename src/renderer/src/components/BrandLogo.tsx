import type { CSSProperties } from 'react'

/** The official Reimagined wordmark. Aspect ratio is always preserved — the
 *  height is the single sizing input, so it renders sharp at any DPI. */
export function BrandLogo({ height = 24, className = '', style }: { height?: number; className?: string; style?: CSSProperties }) {
  return (
    <img
      src="./brand/logo.png"
      alt="Reimagined"
      draggable={false}
      className={`brand-logo ${className}`}
      style={{ height, width: 'auto', ...style }}
    />
  )
}
