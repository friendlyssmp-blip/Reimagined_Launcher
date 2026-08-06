import type { ReactNode, ButtonHTMLAttributes } from 'react'
import { useEffect } from 'react'
import { useApp } from '../state/AppContext'
import { sound } from '../lib/sound'

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: 'sm' | 'md' }

export function Button({ variant = 'default', size = 'md', className = '', children, ...rest }: BtnProps) {
  const cls = ['btn', variant === 'primary' ? 'btn-primary' : variant === 'ghost' ? 'btn-ghost' : variant === 'danger' ? 'btn-danger' : variant === 'play' ? 'btn-play' : '', size === 'sm' ? 'btn-sm' : '', className].filter(Boolean).join(' ')
  return <button className={cls} {...rest}>{children}</button>
}

export function IconButton({ className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`btn btn-icon ${className}`} {...rest}>{children}</button>
}

export function Modal({ title, onClose, children, footer, size }: { title: ReactNode; onClose?: () => void; children: ReactNode; footer?: ReactNode; size?: 'lg' }) {
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

export function Slider({ value, min, max, step = 1, onChange, label }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; label?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="row"><span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{label ? `${label}: ${value}MB` : `${value}MB`}</span></div>
      <input type="range" className="slider" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )
}

export function Badge({ variant, children }: { variant?: string; children: ReactNode }) {
  return <span className={`badge ${variant && variant !== 'default' ? `badge-${variant}` : ''}`}>{children}</span>
}

/**
 * Profile avatar content.
 *
 * An uploaded photo is stored as a base64 data URL — it must ALWAYS render as
 * an <img>, never as raw text (dumping the base64 blob into the DOM is what
 * caused the "garbage text" overflow in the top bar). Emoji/letter icons pass
 * through as-is.
 */
export function ProfileGlyph({ icon, name }: { icon?: string | null; name: string }) {
  if (icon && icon.startsWith('data:')) {
    return <img src={icon} alt="" draggable={false} />
  }
  return <>{icon || name.charAt(0).toUpperCase()}</>
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
   * must not replay the previous toast's sound. */
  useEffect(() => {
    if (!last) return
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
