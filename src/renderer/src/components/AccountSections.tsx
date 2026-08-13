/**
 * Account extras (v1.0.88): Language, Accessibility and Statistics.
 * Account is the home for account-level personal settings.
 */
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../state/AppContext'
import { api } from '../lib/api'
import { Toggle, Spinner } from './ui'
import { useT, setLanguage, type AppLanguage } from '../lib/i18n'
import { IconGlobe, IconGauge, IconShield } from './icons'
import type { PerfSessionMetrics } from '@shared/types'

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

/** All Account-page personal sections (v1.0.88). */
export function AccountSections() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <LanguageSection />
      <AccessibilitySection />
      <StatisticsSection />
    </div>
  )
}
