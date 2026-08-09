import type { ReactNode, ButtonHTMLAttributes } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useApp } from '../state/AppContext'
import { sound } from '../lib/sound'
import { ProfileIcon, profileIconId } from './icons'

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: 'sm' | 'md' }

export function Button({ variant = 'default', size = 'md', className = '', children, ...rest }: BtnProps) {
  const cls = ['btn', variant === 'primary' ? 'btn-primary' : variant === 'ghost' ? 'btn-ghost' : variant === 'danger' ? 'btn-danger' : variant === 'play' ? 'btn-play' : '', size === 'sm' ? 'btn-sm' : '', className].filter(Boolean).join(' ')
  return <button className={cls} {...rest}>{children}</button>
}

export function IconButton({ className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`btn btn-icon ${className}`} {...rest}>{children}</button>
}

export function Modal({ title, onClose, children, footer, size }: { title: ReactNode; onClose?: () => void; children: ReactNode; footer?: ReactNode; size?: 'lg' }) {
  /* v1.0.53 — the panel feels alive: a soft expanding cue on open, a gentle
   * settling cue on close (component unmount). */
  useEffect(() => {
    sound.panelOpen()
    return () => sound.panelClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${size === 'lg' ? 'modal-lg' : ''}`}>
        <div className="modal-head">
          <h3>{title}</h3>
          {onClose && <IconButton onClick={onClose} aria-label="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg></IconButton>}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Field({ label, hint, children, style }: { label: string; hint?: string; children: ReactNode; style?: React.CSSProperties }) {
  return <div className="field" style={style}><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</div>
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="select" {...props} />
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="textarea" {...props} />
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="row" style={{ cursor: 'pointer' }}>
      {/* The `on` class mirrors the checkbox state so the CSS can animate the
       * track even though the native input is visually hidden. */}
      <span className={'switch' + (checked ? ' on' : '')}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="track" />
      </span>
      {label && <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>}
    </label>
  )
}

/** Smoothly tweens numeric changes (progress %, RAM slider, counters).
 *  Respects prefers-reduced-motion and snaps instantly when it's on. */
export function AnimatedNumber({ value, format }: { value: number; format?: (v: number) => string }) {
  const [display, setDisplay] = useState(value)
  const current = useRef(value)
  /* Performance Mode (potato preset) or reduced motion → snap, no tween. */
  const { settings } = useApp()
  useEffect(() => {
    const reduced =
      settings?.preset === 'potato' ||
      (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    if (reduced || current.current === value) {
      current.current = value
      setDisplay(value)
      return
    }
    let raf = 0
    const from = current.current
    const to = value
    const start = performance.now()
    const DUR = 200
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DUR)
      const eased = 1 - Math.pow(1 - t, 3)
      current.current = from + (to - from) * eased
      setDisplay(current.current)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, settings?.preset])
  return <>{format ? format(display) : Math.round(display)}</>
}

/** Tabs with a sliding active indicator (same markup/classes as before, plus
 *  an absolutely-positioned underline that glides to the active tab). */
export function TabBar({ tabs, active, onChange, className = '' }: { tabs: { id: string; label: ReactNode }[]; active: string; onChange: (id: string) => void; className?: string }) {
  const listRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; width: number } | null>(null)
  /* v1.0.53 — tab switches get the connected two-note cue (skip the mount). */
  const firstTab = useRef(true)
  useEffect(() => {
    if (firstTab.current) {
      firstTab.current = false
      return
    }
    sound.tab()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
  useLayoutEffect(() => {
    const measure = () => {
      const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
      if (!el || !listRef.current) return
      const next = { left: el.offsetLeft + 12, width: Math.max(0, el.offsetWidth - 24) }
      // Bail out when unchanged — callers often pass inline tab arrays, and
      // re-setting an identical object would re-render forever.
      setPos((prev) => (prev && prev.left === next.left && prev.width === next.width ? prev : next))
    }
    measure()
    /* Re-measure on resize so the indicator tracks the new layout. */
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [active, tabs])
  return (
    <div className={'tabs' + (className ? ' ' + className : '')} ref={listRef}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          data-active={active === t.id}
          className={'tab' + (active === t.id ? ' active' : '')}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
      <span className="tab-indicator" style={pos ? { left: pos.left, width: pos.width } : undefined} />
    </div>
  )
}

export function Slider({ value, min, max, step = 1, onChange, label }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; label?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="row">
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
          {label ? `${label}: ` : ''}
          <AnimatedNumber value={value} format={(v) => `${Math.round(v)}MB`} />
        </span>
      </div>
      <input type="range" className="slider" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )
}

export function Badge({ variant, title, children }: { variant?: string; title?: string; children: ReactNode }) {
  return (
    <span title={title} className={`badge ${variant && variant !== 'default' ? `badge-${variant}` : ''}`}>
      {children}
    </span>
  )
}

/**
 * Profile avatar content.
 *
 * An uploaded photo is stored as a base64 data URL — it must ALWAYS render as
 * an <img>, never as raw text (dumping the base64 blob into the DOM is what
 * caused the "garbage text" overflow in the top bar). Preset icons are custom
 * vector SVGs (new ids + legacy emoji values both resolve to the same icon),
 * and anything unknown falls back to the profile's initial letter.
 */
export function ProfileGlyph({ icon, name }: { icon?: string | null; name: string }) {
  if (icon && icon.startsWith('data:')) {
    return <img src={icon} alt="" draggable={false} />
  }
  const pid = profileIconId(icon)
  if (pid) return <ProfileIcon id={pid} size={22} />
  return <>{name.charAt(0).toUpperCase()}</>
}

export function Spinner({ lg }: { lg?: boolean }) {
  return <div className={`spinner ${lg ? 'spinner-lg' : ''}`} />
}

export function EmptyState({ title, sub, action, icon }: { title: string; sub?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-illustration">{icon ?? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2 2 7l10 5 10-5-10-5Z" />
          <path d="m2 17 10 5 10-5M2 12l10 5 10-5" />
        </svg>
      )}</div>
      <h3>{title}</h3>
      {sub && <p>{sub}</p>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  )
}

export function Toasts() {
  const { toasts } = useApp()
  const last = toasts[toasts.length - 1]
  /* Play one sound per new toast, keyed on its unique id — dismissing a toast
   * must not replay the previous toast's sound. A toast marked silent (v1.0.35)
   * lets the caller play its own more specific cue (e.g. install-complete). */
  useEffect(() => {
    if (!last || last.silent) return
    if (last.kind === 'success') sound.success()
    else if (last.kind === 'error') sound.error()
    else sound.notify()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.id])
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <div>
            <div className="toast-title">{t.title}</div>
            {t.desc && <div className="toast-desc">{t.desc}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}
