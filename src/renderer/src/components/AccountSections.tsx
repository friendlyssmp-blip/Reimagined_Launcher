/**
 * Account extras (v1.0.88): Language, Accessibility and Statistics.
 * Account is the home for account-level personal settings.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../state/AppContext'
import { api } from '../lib/api'
import { Toggle, Spinner } from './ui'
import { useT, setLanguage, type AppLanguage } from '../lib/i18n'
import { IconGlobe, IconGauge, IconShield, IconPlay, IconStop, IconFolder, IconCopy, IconRefresh, IconGauge as IconGauge2 } from './icons'
import type { PerfSessionMetrics, FpsTestStatus } from '@shared/types'

function fmtHours(sec: number): string {
  const h = sec / 3600
  return h >= 100 ? Math.round(h).toString() : h.toFixed(1)
}

/* --------------------------------- Language --------------------------------- */

function LanguageSection() {
  const { settings, updateSettings } = useApp()
  const t = useT()
  const current = settings.language ?? 'en'
  const set = (l: AppLanguage) => {
    setLanguage(l)
    void updateSettings({ language: l })
  }
  const opts: { id: AppLanguage; label: string }[] = [
    { id: 'en', label: 'English' },
    { id: 'es', label: 'Español' },
    { id: 'fr', label: 'Français' }
  ]
  return (
    <div className="panel">
      <div className="panel-title">{t('acc.language')}</div>
      <p className="panel-sub">{t('set.language')} — English / Español / Français</p>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {opts.map((o) => (
          <button
            key={o.id}
            className={'chip' + (current === o.id ? ' active' : '')}
            onClick={() => set(o.id)}
          >
            <IconGlobe style={{ width: 13, height: 13 }} /> {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------ Accessibility ------------------------------ */

function AccessibilitySection() {
  const { settings, updateSettings } = useApp()
  const t = useT()

  /* Apply instantly on document root so CSS can react. */
  useEffect(() => {
    const root = document.documentElement
    root.dataset.fontScale = String(settings.accessFontScale ?? 1)
    root.dataset.hc = (settings.accessHighContrast ?? false) ? '1' : '0'
    root.dataset.cb = (settings.accessColorblind ?? false) ? '1' : '0'
  }, [settings.accessFontScale, settings.accessHighContrast, settings.accessColorblind])

  const scales = [
    { v: 1, label: '100%' },
    { v: 1.15, label: '115%' },
    { v: 1.3, label: '130%' }
  ]

  return (
    <div className="panel">
      <div className="panel-title">{t('acc.accessibility')}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
        <div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-3)', width: 120 }}>{t('acc.fontScale')}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {scales.map((s) => (
                <button
                  key={s.v}
                  className={'chip' + ((settings.accessFontScale ?? 1) === s.v ? ' active' : '')}
                  onClick={() => void updateSettings({ accessFontScale: s.v })}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <Toggle
          checked={settings.accessHighContrast ?? false}
          onChange={(v) => void updateSettings({ accessHighContrast: v })}
          label={t('acc.highContrast')}
          desc={t('acc.highContrast.desc')}
        />
        <Toggle
          checked={settings.accessColorblind ?? false}
          onChange={(v) => void updateSettings({ accessColorblind: v })}
          label={t('acc.colorblind')}
          desc={t('acc.colorblind.desc')}
        />
      </div>
    </div>
  )
}

/* ------------------------------- Statistics ------------------------------- */

function StatisticsSection() {
  const { profiles } = useApp()
  const t = useT()
  const [sessions, setSessions] = useState<PerfSessionMetrics[] | null>(null)

  useEffect(() => {
    let cancelled = false
    api.perf
      .status()
      .then((s) => {
        if (!cancelled) setSessions(s.sessions ?? [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const totalSec = useMemo(() => profiles.reduce((a, p) => a + (p.playtimeSeconds ?? 0), 0), [profiles])
  const byProfile = useMemo(() => {
    const list = profiles
      .map((p) => ({ name: p.name, sec: p.playtimeSeconds ?? 0 }))
      .filter((x) => x.sec > 0)
      .sort((a, b) => b.sec - a.sec)
      .slice(0, 6)
    const max = Math.max(1, ...list.map((x) => x.sec))
    return { list, max }
  }, [profiles])

  const week = useMemo(() => {
    const days: { label: string; h: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      d.setDate(d.getDate() - i)
      days.push({ label: d.toLocaleDateString(undefined, { weekday: 'narrow' }), h: 0 })
    }
    for (const s of sessions ?? []) {
      const at = new Date(s.at)
      const d0 = new Date()
      d0.setHours(0, 0, 0, 0)
      const dayIdx = Math.round((at.getTime() - d0.getTime()) / 86400000)
      if (dayIdx >= -6 && dayIdx <= 0) {
        days[6 + dayIdx].h += (s.durationSec ?? 0) / 3600
      }
    }
    const max = Math.max(0.01, ...days.map((d) => d.h))
    return { days, max }
  }, [sessions])

  return (
    <div className="panel">
      <div className="panel-title">{t('acc.statistics')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 14 }} className="stats-grid">
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {t('acc.totalPlaytime')}
          </div>
          <div style={{ fontSize: 30, fontWeight: 700, color: 'var(--text-1)', marginTop: 4 }}>
            {fmtHours(totalSec)}
            <span style={{ fontSize: 13, color: 'var(--text-3)', fontWeight: 500, marginLeft: 4 }}>{t('acc.hours')}</span>
          </div>
          {byProfile.list.length === 0 ? (
            <p style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 10, lineHeight: 1.5 }}>
              No playtime recorded yet — launch a profile and it will show up here.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
              {byProfile.list.map((p) => (
                <div key={p.name}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 3 }}>
                    <span style={{ color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{p.name}</span>
                    <span style={{ color: 'var(--text-3)' }}>{fmtHours(p.sec)}{t('acc.hours')}</span>
                  </div>
                  <div className="stat-bar"><div className="stat-bar-fill" style={{ width: `${(p.sec / byProfile.max) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Last 7 days</div>
          {sessions === null ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-3)', fontSize: 12, marginTop: 14 }}>
              <Spinner /> Loading…
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 96, marginTop: 14 }} className="week-chart">
              {week.days.map((d, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
                  <div
                    className="week-bar"
                    title={`${d.h.toFixed(1)}h`}
                    style={{ height: `${Math.max(3, (d.h / week.max) * 78)}px` }}
                  />
                  <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{d.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------ FPS Test (v1.0.92) ------------------------------ */

interface BenchInstance {
  id: string
  name: string
  minecraftVersion: string
  loader: string
  modCount: number
  fpsBoost: boolean
}

function FpsTestSection() {
  const t = useT()
  const { notify } = useApp()
  const [instances, setInstances] = useState<BenchInstance[] | null>(null)
  const [selected, setSelected] = useState<BenchInstance | null>(null)
  const [status, setStatus] = useState<FpsTestStatus | null>(null)
  const [starting, setStarting] = useState(false)
  const [results, setResults] = useState<{
    reportPath: string | null
    text: string
    profile: { name: string; minecraftVersion: string; loader: string; modCount: number } | null
  } | null>(null)
  const [copied, setCopied] = useState(false)

  const loadInstances = useCallback(async () => {
    try {
      const list = await api.fpsTest.list()
      setInstances((prev) => {
        if (!prev || prev.length === 0) {
          if (list.length > 0) setSelected(list[0])
        }
        return list
      })
    } catch (err) {
      notify('error', 'Could not load instances', err instanceof Error ? err.message : String(err))
    }
  }, [notify])

  useEffect(() => {
    void loadInstances()
  }, [loadInstances])

  // Poll live status while a benchmark is running.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null
    const poll = async () => {
      try {
        const st = await api.fpsTest.status()
        setStatus(st)
        if (st?.stage === 'finished') {
          const res = await api.fpsTest.results()
          setResults(res)
          if (timer) clearInterval(timer)
        } else if (st?.stage === 'failed') {
          if (timer) clearInterval(timer)
        }
      } catch {
        /* transient — keep polling */
      }
    }
    if (status?.stage === 'running' || status?.stage === 'world' || status?.stage === 'launching') {
      timer = setInterval(poll, 1500)
      void poll()
    }
    return () => {
      if (timer) clearInterval(timer)
    }
  }, [status?.stage])

  const start = async () => {
    if (!selected) return
    setStarting(true)
    setResults(null)
    try {
      const res = await api.fpsTest.start(selected.id)
      if (!res.ok) {
        notify('error', 'Cannot start the FPS test', res.error)
        setStarting(false)
        return
      }
      const st = await api.fpsTest.status()
      setStatus(st)
    } catch (err) {
      notify('error', 'Cannot start the FPS test', err instanceof Error ? err.message : String(err))
    } finally {
      setStarting(false)
    }
  }

  const cancel = async () => {
    await api.fpsTest.cancel().catch(() => {})
    setStatus(null)
  }

  const copyResults = async () => {
    if (!results?.text) return
    await navigator.clipboard.writeText(results.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const running = status?.stage === 'world' || status?.stage === 'launching' || status?.stage === 'running'

  return (
    <div className="panel">
      <div className="panel-title">
        <IconGauge style={{ width: 16, height: 16 }} /> {t('acc.fpsTest')}
      </div>
      <p className="panel-sub">{t('acc.fpsTestSub')}</p>

      {!running && !results && (
        <>
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>
              {t('acc.fpsTestPick')}
            </div>
            {instances === null ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text-3)' }}>
                <Spinner lg={false} /> Loading instances…
              </div>
            ) : instances.length === 0 ? (
              <div style={{ color: 'var(--text-3)', fontSize: 13, padding: '10px 0' }}>
                {t('acc.fpsTestNone')}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                {instances.map((inst) => (
                  <button
                    key={inst.id}
                    className={'row-select' + (selected?.id === inst.id ? ' active' : '')}
                    style={{
                      textAlign: 'left',
                      padding: '10px 12px',
                      borderRadius: 10,
                      background: selected?.id === inst.id ? 'rgba(168,85,247,0.14)' : 'var(--panel-2)',
                      border: '1px solid ' + (selected?.id === inst.id ? 'rgba(168,85,247,0.5)' : 'var(--line)'),
                      cursor: 'pointer',
                      transition: 'all .18s ease'
                    }}
                    onClick={() => setSelected(inst)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{inst.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{inst.modCount} mods</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4, fontSize: 11, color: 'var(--text-3)' }}>
                      <span className="chip">MC {inst.minecraftVersion}</span>
                      <span className="chip">{inst.loader}</span>
                      <span className="chip">{inst.fpsBoost ? 'FPS Boost ✓' : 'FPS Boost —'}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" disabled={!selected || starting} onClick={() => void start()}>
              <IconPlay style={{ width: 14, height: 14 }} />
              {starting ? 'Starting…' : t('acc.fpsTestStart')}
            </button>
            <button className="btn" onClick={() => void loadInstances()}>
              <IconRefresh style={{ width: 14, height: 14 }} /> Refresh
            </button>
          </div>
          {selected && (
            <div style={{ marginTop: 14, fontSize: 12, color: 'var(--text-3)' }}>
              {t('acc.fpsTestSelected')}: <b>{selected.name}</b> — Minecraft {selected.minecraftVersion} · {selected.loader}
            </div>
          )}
        </>
      )}

      {running && status && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 10 }}>{status.message}</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>
            {t('acc.fpsTestCurrent')}: <b style={{ color: 'var(--accent)' }}>{status.currentTest}</b>
          </div>
          <div style={{ height: 8, borderRadius: 6, background: 'var(--panel-2)', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${Math.max(2, status.progress)}%`,
                background: 'linear-gradient(90deg,#a855f7,#6366f1)',
                borderRadius: 6,
                transition: 'width .6s ease'
              }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12 }}>
            <span style={{ color: 'var(--text-3)' }}>{status.progress}%</span>
            <span style={{ color: 'var(--text-2)' }}>
              {t('acc.fpsTestLowest')}: <b>{status.lowestFps ?? '—'}</b>
            </span>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button className="btn" onClick={() => void cancel()}>
              <IconStop style={{ width: 14, height: 14 }} /> {t('acc.fpsTestCancel')}
            </button>
          </div>
        </div>
      )}

      {!running && status?.stage === 'failed' && (
        <div style={{ marginTop: 14 }}>
          <div style={{ color: 'var(--danger, #f87171)', fontSize: 13 }}>{status.message}</div>
          {status.error && status.error !== 'cancelled' && (
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>{status.error}</div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button className="btn" onClick={() => void loadInstances()}>
              {t('acc.fpsTestRetry')}
            </button>
          </div>
        </div>
      )}

      {results && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
            <IconGauge2 style={{ width: 16, height: 16, verticalAlign: 'middle' }} /> {t('acc.fpsTestDone')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12 }}>
            {results.profile
              ? `${results.profile.name} — Minecraft ${results.profile.minecraftVersion} · ${results.profile.loader} · ${results.profile.modCount} mods`
              : ''}
          </div>
          <pre
            style={{
              maxHeight: 320,
              overflowY: 'auto',
              background: 'var(--panel-2)',
              border: '1px solid var(--line)',
              borderRadius: 10,
              padding: 12,
              fontSize: 11.5,
              lineHeight: 1.55,
              color: 'var(--text-2)',
              whiteSpace: 'pre-wrap'
            }}
          >
            {results.text}
          </pre>
          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            {results.reportPath && (
              <button
                className="btn btn-primary"
                onClick={() => void api.fpsTest.openReport(results.reportPath ?? undefined)}
              >
                <IconFolder style={{ width: 14, height: 14 }} /> {t('acc.fpsTestOpenReport')}
              </button>
            )}
            <button className="btn" onClick={() => void copyResults()}>
              <IconCopy style={{ width: 14, height: 14 }} /> {copied ? '✓ Copied!' : t('acc.fpsTestCopy')}
            </button>
            <button
              className="btn"
              onClick={() => {
                setResults(null)
                setStatus(null)
                void loadInstances()
              }}
            >
              <IconRefresh style={{ width: 14, height: 14 }} /> {t('acc.fpsTestRunAgain')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** All Account-page personal sections (v1.0.88). */
export function AccountSections() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <LanguageSection />
      <AccessibilitySection />
      <StatisticsSection />
      <FpsTestSection />
    </div>
  )
}
