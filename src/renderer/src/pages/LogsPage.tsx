import { useState, useEffect, useRef, useCallback } from 'react'
import { useApp } from '../state/AppContext'
import { Button, Spinner } from '../components/ui'
import { api } from '../lib/api'
import { IconSearch, IconCopy, IconFolder, IconTrash } from '../components/icons'

interface LogLine {
  at: string
  level: string
  text: string
}

const LEVEL_CLASS: Record<string, string> = {
  info: 'lv-info',
  warn: 'lv-warn',
  warning: 'lv-warn',
  error: 'lv-error',
  success: 'lv-success',
  debug: 'lv-debug',
  stdout: 'lv-stdout',
  stderr: 'lv-stderr'
}

const LEVEL_SHORT: Record<string, string> = {
  info: 'INFO',
  warn: 'WARN',
  warning: 'WARN',
  error: 'ERROR',
  success: 'SUCCESS',
  debug: 'DEBUG',
  stdout: 'OUT',
  stderr: 'ERR'
}

export function LogsPage() {
  const { notify } = useApp()
  const [lines, setLines] = useState<LogLine[]>([])
  const [files, setFiles] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [levelFilter, setLevelFilter] = useState<'all' | 'info' | 'warn' | 'error'>('all')
  const [loading, setLoading] = useState(true)
  const [autoScroll, setAutoScroll] = useState(true)
  const bodyRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    try {
      const [data, list] = await Promise.all([api.logs.read(), api.logs.listFiles()])
      const merged = [...data.fileTail, ...data.recent]
      const seen = new Set<string>()
      const unique = merged.filter((l) => {
        const key = `${l.at}|${l.level}|${l.text}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      setLines(unique.slice(-1200))
      setFiles(list)
    } catch {
      /* keep last */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 4000)
    return () => clearInterval(t)
  }, [refresh])

  useEffect(() => {
    if (autoScroll && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [lines, autoScroll])

  const LEVEL_GROUP: Record<string, 'info' | 'warn' | 'error'> = {
    info: 'info',
    success: 'info',
    debug: 'info',
    stdout: 'info',
    warn: 'warn',
    warning: 'warn',
    error: 'error',
    stderr: 'error'
  }

  const filtered = lines.filter((l) => {
    if (levelFilter !== 'all' && LEVEL_GROUP[l.level] !== levelFilter) return false
    if (!query) return true
    return l.text.toLowerCase().includes(query.toLowerCase()) || l.level.toLowerCase().includes(query.toLowerCase())
  })

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(filtered.map((l) => `[${l.at}] ${l.level.toUpperCase()}: ${l.text}`).join('\n'))
      notify('success', 'Logs copied to clipboard')
    } catch {
      notify('error', 'Could not copy logs')
    }
  }

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 120 }}><Spinner /></div>

  return (
    <div className="logs-page">
      <div className="section-head">
        <div>
          <h2 className="page-title">Logs</h2>
          <p className="page-sub">Launcher diagnostics — never hidden, always useful</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={copyAll}><IconCopy style={{ width: 14, height: 14 }} /> Copy</Button>
          <Button onClick={() => api.logs.openFolder()}><IconFolder style={{ width: 14, height: 14 }} /> Open Folder</Button>
          <Button variant="danger" onClick={async () => { await api.logs.clear(); notify('success', 'Logs cleared'); refresh() }}>
            <IconTrash style={{ width: 14, height: 14 }} /> Clear
          </Button>
        </div>
      </div>

      <div className="log-toolbar">
        <div className="log-search">
          <IconSearch />
          <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter logs…" />
        </div>
        <div className="log-levels">
          {(['all', 'info', 'warn', 'error'] as const).map((lv) => (
            <button key={lv} className={`chip ${levelFilter === lv ? 'active' : ''}`} onClick={() => setLevelFilter(lv)}>
              {lv === 'all' ? 'All' : lv === 'warn' ? 'Warnings' : lv === 'error' ? 'Errors' : 'Info'}
            </button>
          ))}
        </div>
        <button className={`chip ${autoScroll ? 'active' : ''}`} onClick={() => setAutoScroll((v) => !v)}>Auto-scroll</button>
        {files.length > 0 && <span className="badge">{files[0]}</span>}
      </div>

      <div className="log-viewer">
        <div className="log-viewer-head">
          <div className="lv-dots"><span className="lv-dot" /><span className="lv-dot" /><span className="lv-dot" /></div>
          {files[0] ?? 'launcher.log'} · {filtered.length} lines
        </div>
        <div className="log-body" ref={bodyRef}>
          {filtered.map((l, i) => (
            <div key={i} className={`log-line ${LEVEL_CLASS[l.level] ?? 'lv-info'}`}>
              <span className="log-time">{l.at}</span>
              <span className="log-level">{LEVEL_SHORT[l.level] ?? l.level.toUpperCase()}</span>
              <span className="log-text">{l.text}</span>
            </div>
          ))}
          {filtered.length === 0 && <div style={{ color: 'var(--text-3)', padding: 20 }}>No log lines match the filter.</div>}
        </div>
      </div>
    </div>
  )
}
