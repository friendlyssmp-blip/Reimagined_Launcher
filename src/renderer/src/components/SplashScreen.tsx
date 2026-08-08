import { useEffect, useRef, useState } from 'react'

/* Deterministic pseudo-random particles — transform/opacity only, GPU-cheap. */
const PARTICLES = Array.from({ length: 16 }, (_, i) => {
  const seed = ((i * 9301 + 49297) % 233280) / 233280
  return {
    left: 6 + seed * 88,
    top: 10 + ((i * 37) % 66),
    size: 2 + ((i * 7) % 3),
    delay: (i % 8) * 0.16,
    dur: 2.2 + ((i * 13) % 15) / 10,
    drift: (i % 2 === 0 ? 1 : -1) * (14 + (i % 5) * 7)
  }
})

/**
 * Premium startup splash (~2.6s): fades in from black, an ambient purple glow
 * breathes, the logo fades in scaling from 96% to 100% with a soft bloom,
 * and light particles drift past. Skippable by click or any key. It runs as
 * a pure overlay so launcher initialization is never delayed.
 */
export function SplashScreen({ onDone, onStart }: { onDone: () => void; onStart?: () => void }) {
  const [phase, setPhase] = useState<'in' | 'out'>('in')
  const finished = useRef(false)

  useEffect(() => {
    onStart?.()
    const finish = () => {
      if (finished.current) return
      finished.current = true
      setPhase('out')
      window.setTimeout(onDone, 520)
    }
    const t = window.setTimeout(finish, 2600)
    window.addEventListener('pointerdown', finish)
    window.addEventListener('keydown', finish)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('pointerdown', finish)
      window.removeEventListener('keydown', finish)
    }
  }, [onDone])

  const skip = () => {
    if (finished.current) return
    finished.current = true
    setPhase('out')
    window.setTimeout(onDone, 520)
  }

  return (
    <div className={`splash ${phase}`} onPointerDown={skip}>
      <div className="splash-glow" />
      <div className="splash-bloom" />
      {PARTICLES.map((p, i) => (
        <span
          key={i}
          className="splash-particle"
          style={{
            left: `${p.left}%`,
            top: `${p.top}%`,
            width: p.size,
            height: p.size,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.dur}s`,
            ['--drift' as string]: `${p.drift}px`
          }}
        />
      ))}
      <div className="splash-logo-wrap">
        <img src="./brand/logo.png" alt="Reimagined" draggable={false} className="splash-logo" />
      </div>
      <div className="splash-hint">click anywhere or press any key to skip</div>
    </div>
  )
}
