/**
 * SearchableSelect — a dark, Reimagined-styled dropdown with a live filter
 * box, for long option lists (Minecraft versions, loader builds). An optional
 * pinned first option ("Any Minecraft version", "Auto …") is always shown and
 * never affected by the search filter. Esc or an outside click closes it.
 */
import { useEffect, useRef, useState } from 'react'
import { IconChevronDown, IconSearch } from './icons'

export function SearchableSelect({
  options,
  value,
  onChange,
  firstOption,
  firstValue,
  placeholder = 'Type to filter…',
  className = ''
}: {
  options: string[]
  value: string
  onChange: (v: string) => void
  /** Pinned first option label — e.g. "Any Minecraft version". */
  firstOption?: string
  /** Value of the pinned first option (defaults to its label). */
  firstValue?: string
  placeholder?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const filtered = q.trim() ? options.filter((o) => o.toLowerCase().includes(q.trim().toLowerCase())) : options
  const entries = [
    ...(firstOption !== undefined ? [{ label: firstOption, val: firstValue !== undefined ? firstValue : firstOption }] : []),
    ...filtered.map((o) => ({ label: o, val: o }))
  ]

  // Keyboard navigation: ↑/↓ move the highlight, Enter picks it, Esc closes.
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) { setOpen(true); return }
      setHi((h) => Math.min(h + 1, entries.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) { setOpen(true); return }
      setHi((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      if (!open) { setOpen(true); return }
      const cur = entries[hi]
      if (cur) { onChange(cur.val); setOpen(false) }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (open) {
      setQ('')
      setHi(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  return (
    <div className={'searchable-select' + (className ? ' ' + className : '')} ref={rootRef}>
      <button type="button" className="ss-trigger" onClick={() => setOpen((v) => !v)} onKeyDown={onKeyDown} aria-haspopup="listbox" aria-expanded={open}>
        <span className={value ? 'ss-value' : 'ss-placeholder'}>
          {value || firstOption || placeholder}
        </span>
        <IconChevronDown style={{ width: 13, height: 13, opacity: 0.6 }} />
      </button>
      {open && (
        <div className="ss-pop">
          <div className="ss-search">
            <IconSearch style={{ width: 13, height: 13 }} />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={placeholder}
              aria-label={placeholder}
            />
          </div>
          <div className="ss-list" role="listbox">
            {entries.length === 0 && <div className="ss-empty">No matches</div>}
            {entries.map((e, i) => (
              <button
                key={e.label}
                type="button"
                className={'ss-opt' + (e.val === value ? ' selected' : '') + (i === hi ? ' hover' : '')}
                onMouseDown={(ev) => {
                  ev.preventDefault() // keep focus so the outside-click handler sees the root
                  onChange(e.val)
                  setOpen(false)
                }}
                onMouseEnter={() => setHi(i)}
                role="option"
                aria-selected={e.val === value}
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
