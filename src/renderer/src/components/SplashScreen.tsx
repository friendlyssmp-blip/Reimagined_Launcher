import { useEffect, useRef, useState } from 'react'

/* Deterministic ambient field — pure transform/opacity, GPU-cheap. */
const AMBIENT = Array.from({ length: 26 }, (_, i) => {
  const seed = ((i * 9301 + 49297) % 233280) / 233280
  return {
    left: 4 + seed * 92,
    top: 8 + ((i * 37) % 84),
    size: 1.5 + ((i * 7) % 3),
    delay: 0.05 + (i % 10) * 0.05,
    dur: 3 + ((i * 13) % 20) / 10,
    drift: (i % 2 === 0 ? 1 : -1) * (10 + (i % 5) * 6)
  }
})

/* Tiny lights that ride the drawing ring as the energy line forms. */
const TRAIL = Array.from({ length: 10 }, (_, i) => ({
  angle: (i / 10) * 360,
  delay: 0.5 + (i / 10) * 0.85,
  size: 2 + (i % 3)
}))

/* REIMAGINED — letters revealed one by one with light traces. */
const LETTERS = 'REIMAGINED'.split('')

/* Final outward particle burst at the signature moment (3.3s). */
const BURST = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2
  return {
    dx: Math.round(Math.cos(a) * (26 + (i % 3) * 12)),
    dy: Math.round(Math.sin(a) * (26 + (i % 3) * 12)),
    size: 2 + (i % 2)
  }
})

/**
 * Premium startup sequence (v1.0.52) — a cinematic, ~4.5s intro:
 *
 *   0.00–0.50s  dark atmosphere: faint ambient particles + purple radial glow
 *   0.50–1.40s  an energy line draws a thin luminous ring around the centre
 *               (SVG dash animation with a brightening flash on completion)
 *   1.40–2.30s  the Reimagined logo is physically CONSTRUCTED — a clip-path
 *               wipe with a light sweep across its surface + converging glow
 *   2.30–3.10s  REIMAGINED typography locks in, letter by letter
 *   3.10–3.70s  signature: one final ring sweep, a soft purple light pass
 *               and a tiny outward particle burst — then everything settles
 *   3.70–4.55s  the whole scene dissolves into the launcher behind it
 *
 * Pure CSS transforms/opacity + one SVG — no heavy canvas, no fake progress,
 * skippable by click or any key, and it never blocks launcher init.
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
      window.setTimeout(onDone, 620)
    }
    // ~4.3s scene + 0.62s dissolve keeps the WHOLE sequence under the 5s cap.
    const t = window.setTimeout(finish, 4300)
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
    window.setTimeout(onDone, 620)
  }

  return (
    <div className={`splash ${phase}`} onPointerDown={skip}>
      {/* 0.00s — dark atmosphere */}
      <div className="splash-ambient" />
      {AMBIENT.map((p, i) => (
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

      {/* 0.50s — energy ring draws itself */}
      <svg className="splash-ring" viewBox="0 0 240 240" aria-hidden="true">
        <circle className="splash-ring-track" cx="120" cy="120" r="104" />
        <circle className="splash-ring-draw" cx="120" cy="120" r="104" />
      </svg>
      {TRAIL.map((t, i) => (
        <span
          key={i}
          className="splash-trail"
          style={{
            ['--angle' as string]: `${t.angle}deg`,
            animationDelay: `${t.delay}s`,
            width: t.size,
            height: t.size
          }}
        />
      ))}

      {/* 1.40s — the logo is constructed, not faded in */}
      <div className="splash-logo-wrap">
        <div className="splash-logo-sheen" />
        <img src="./brand/logo.png" alt="Reimagined" draggable={false} className="splash-logo" />
      </div>

      {/* 2.30s — REIMAGINED typography, letter by letter */}
      <div className="splash-word" aria-hidden="true">
        {LETTERS.map((l, i) => (
          <span key={i} style={{ animationDelay: `${2.3 + i * 0.075}s` }}>{l}</span>
        ))}
      </div>

      {/* 3.10s — signature: one final ring sweep + light pass + tiny burst */}
      <svg className="splash-sig-ring" viewBox="0 0 240 240" aria-hidden="true">
        <circle className="splash-sig-draw" cx="120" cy="120" r="104" />
      </svg>
      {BURST.map((b, i) => (
        <span
          key={i}
          className="splash-burst"
          style={{
            ['--bx' as string]: `${b.dx}px`,
            ['--by' as string]: `${b.dy}px`,
            width: b.size,
            height: b.size,
            animationDelay: `${3.32 + (i % 4) * 0.05}s`
          }}
        />
      ))}

      <div className="splash-hint">click anywhere or press any key to skip</div>
    </div>
  )
}
