import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../state/AppContext'
import { Button, Field, TextInput, Toggle, Slider, Select, Spinner } from '../components/ui'
import { api, friendlyError } from '../lib/api'
import { sound } from '../lib/sound'
import { BrandLogo } from '../components/BrandLogo'
import { ModIcon } from '../components/ModIcon'
import { IconSettings, IconGamepad, IconDownload, IconRefresh, IconImage, IconGauge, IconVolume, IconSparkle, IconPotato, IconRocket } from '../components/icons'

const IconBolt = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
)

/** Custom tier icon — Potato / Balanced / High / Turbo (no OS emoji rendering). */
function PerfTierIcon({ tier, size = 14 }: { tier: string; size?: number }) {
  const Icon = tier === 'potato' ? IconPotato : tier === 'high' ? IconRocket : tier === 'turbo' ? IconBolt : IconGauge
  return <Icon style={{ width: size, height: size, flex: '0 0 auto' }} />
}

import type { ThemeId, LauncherSettings, PerfStatus, PerfRecommendation, PerfModOption } from '@shared/types'

const themes: { id: ThemeId; label: string; colors: string[] }[] = [
  { id: 'night', label: 'Night', colors: ['#0d0d0f', '#1a1a20', '#8b5cf6'] },
  { id: 'amethyst', label: 'Amethyst', colors: ['#0d0a12', '#1a1424', '#a855f7'] },
  { id: 'obsidian', label: 'Obsidian', colors: ['#0a0a0e', '#15151d', '#9d8cff'] }
]

const sections = [
  { id: 'general', label: 'General', icon: IconSettings },
  { id: 'minecraft', label: 'Minecraft', icon: IconGamepad },
  { id: 'performance', label: 'Performance', icon: IconBolt },
  { id: 'downloads', label: 'Downloads', icon: IconDownload },
  { id: 'updates', label: 'Updates', icon: IconRefresh },
  { id: 'appearance', label: 'Appearance', icon: IconImage },
  { id: 'audio', label: 'Audio', icon: IconVolume },
  { id: 'advanced', label: 'Advanced', icon: IconGauge }
] as const

type SectionId = (typeof sections)[number]['id']

/** Settings search index (V2) — every searchable setting with its category
 *  and a short description. The search box in Settings filters this live and
 *  clicking a result jumps straight to that category. */
const SETTINGS_INDEX: { query: string[]; section: SectionId; label: string; desc: string }[] = [
  { query: ['close on launch', 'hide launcher', 'game starts'], section: 'general', label: 'Hide launcher when game starts', desc: 'Close the launcher window when a game starts' },
  { query: ['console', 'game console', 'window on launch'], section: 'general', label: 'Open game console window on launch', desc: 'Open the detached game console when launching' },
  { query: ['ram', 'memory', 'default ram'], section: 'general', label: 'Default RAM', desc: 'Memory applied to new profiles' },
  { query: ['log level', 'logs', 'keep logs'], section: 'general', label: 'Logs', desc: 'Log level and how many days logs are kept' },
  { query: ['snapshots', 'beta', 'versions'], section: 'minecraft', label: 'Show snapshots & beta versions', desc: 'Include snapshots and pre-releases in the version picker' },
  { query: ['microsoft', 'account', 'sign in', 'logout'], section: 'minecraft', label: 'Microsoft account', desc: 'Sign in / sign out of your Microsoft account' },
  { query: ['java', 'java path', 'runtime'], section: 'minecraft', label: 'Java', desc: 'Custom java.exe path (leave empty for auto-detect)' },
  { query: ['performance engine', 'rpe', 'auto optimize', 'tier', 'preset'], section: 'performance', label: 'Performance Engine', desc: 'Hardware detection, auto-optimization and presets' },
  { query: ['fps cap', 'unlimited fps', 'frame rate'], section: 'performance', label: 'Frame rate', desc: 'Safe FPS cap by default; unlimited is a warned opt-in' },
  { query: ['shaders', 'shader guard', 'vram', 'crash'], section: 'performance', label: 'Shader Guard', desc: 'GPU/driver shader assessment and crash auto-recovery' },
  { query: ['vsync', 'render distance', 'recommendations'], section: 'performance', label: 'Recommendations', desc: 'Hardware-based suggestions you choose to apply' },
  { query: ['downloads', 'concurrency', 'parallel', 'queue'], section: 'downloads', label: 'Download queue', desc: 'How many downloads run at the same time (1 / 3 / 5)' },
  { query: ['cache', 'download cache'], section: 'downloads', label: 'Download cache', desc: 'Minecraft files cached for reuse across profiles' },
  { query: ['updates', 'check for updates', 'update prompt', 'remind'], section: 'updates', label: 'Updates', desc: 'Check for updates; each release is offered via the 3-option prompt' },
  { query: ['theme', 'colors', 'appearance'], section: 'appearance', label: 'Theme', desc: 'The launcher color identity' },
  { query: ['performance mode', 'animations', '2d previews'], section: 'appearance', label: 'Performance mode', desc: 'Fewer animations, 2D previews' },
  { query: ['preset', 'potato', 'balanced', 'high', 'turbo'], section: 'appearance', label: 'Performance preset', desc: 'How aggressively optimizations apply' },
  { query: ['sound', 'audio', 'volume', 'music'], section: 'audio', label: 'Audio', desc: 'UI sounds, volume, hover/click/notifications' },
  { query: ['sound pack', 'customize sounds', 'preview sounds', 'aurora'], section: 'audio', label: 'Preview sounds', desc: 'Hear each action cue (single Aurora theme)' },
  { query: ['about', 'version', 'credits'], section: 'advanced', label: 'About', desc: 'Version, credits and data directory' },
  { query: ['reset', 'clean release', 'danger'], section: 'advanced', label: 'Clean Release Reset', desc: 'Restore the launcher to a fresh installation' }
]

export function SettingsPage() {
  const { settings, updateSettings, notify, info, account, logout, setModals, updateInfo } = useApp()
  const [section, setSection] = useState<SectionId>('general')
  /* Settings search (V2): filters the index below and jumps to the result. */
  const [settingsQuery, setSettingsQuery] = useState('')
  const results = settingsQuery.trim()
    ? SETTINGS_INDEX.filter((s) =>
        s.label.toLowerCase().includes(settingsQuery.toLowerCase()) ||
        s.desc.toLowerCase().includes(settingsQuery.toLowerCase()) ||
        s.query.some((q) => q.toLowerCase().includes(settingsQuery.toLowerCase()))
      ).slice(0, 12)
    : []

  const goToSection = (id: SectionId) => {
    setSection(id)
    setSettingsQuery('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="section-head">
        <div>
          <h2 className="page-title">Settings</h2>
          <p className="page-sub">Launcher configuration</p>
        </div>
      </div>

      {/* Settings search — searches settings instead of mods while in Settings */}
      <div className="mod-search">
        <input
          className="input"
          value={settingsQuery}
          onChange={(e) => setSettingsQuery(e.target.value)}
          placeholder="Search settings… (e.g. VSync, RAM, sound, updates)"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setSettingsQuery('')
          }}
        />
      </div>

      {settingsQuery.trim() && (
        <div className="panel">
          <div className="panel-title">Search results ({results.length})</div>
          <p className="panel-sub">Click a result to jump to that setting.</p>
          {results.length === 0 ? (
            <p style={{ color: 'var(--text-3)', fontSize: 13, marginTop: 8 }}>No settings match “{settingsQuery}”.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
              {results.map((r) => (
                <button
                  key={r.label}
                  onClick={() => goToSection(r.section)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 14px',
                    borderRadius: 10,
                    background: 'var(--bg-2)',
                    border: '1px solid var(--border)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'border-color 0.15s ease'
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--accent-3)', flexShrink: 0 }}>
                    {r.section}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ fontSize: 13, display: 'block' }}>{r.label}</b>
                    <small style={{ color: 'var(--text-3)', fontSize: 11.5 }}>{r.desc}</small>
                  </span>
                  <span style={{ color: 'var(--text-3)', fontSize: 13 }}>→</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="settings-layout">
        <nav className="settings-nav">
          {sections.map(({ id, label, icon: Icon }) => (
            <button key={id} className={section === id ? 'active' : ''} onClick={() => setSection(id)}>
              <Icon /> {label}
            </button>
          ))}
        </nav>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {section === 'general' && (
            <>
              <div className="panel">
                <div className="panel-title">General</div>
                <div style={{ marginTop: 16 }}>
                  <Toggle checked={settings.closeOnLaunch} onChange={(v) => updateSettings({ closeOnLaunch: v })} label="Hide launcher when game starts" />
                </div>
                <div style={{ marginTop: 12 }}>
                  <Toggle checked={settings.showConsoleOnLaunch} onChange={(v) => updateSettings({ showConsoleOnLaunch: v })} label="Open game console window on launch" />
                </div>
              </div>
              <div className="panel">
                <div className="panel-title">Default RAM</div>
                <p className="panel-sub">Applied to new profiles — each profile can override it.</p>
                <Slider value={settings.memory} min={1024} max={16384} step={512} label="Default RAM" onChange={(v) => updateSettings({ memory: v })} />
              </div>
              <div className="panel">
                <div className="panel-title">Logs</div>
                <div className="row" style={{ gap: 12, marginTop: 14 }}>
                  <Field label="Log Level" style={{ flex: 1 }}>
                    <Select value={settings.logLevel} onChange={(e) => updateSettings({ logLevel: e.target.value as LauncherSettings['logLevel'] })}>
                      {['debug', 'info', 'warn', 'error'].map((l) => (
                        <option key={l} value={l}>{l.toUpperCase()}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Keep Logs (days)" style={{ flex: 1 }}>
                    <TextInput type="number" value={String(settings.keepLogDays)} onChange={(e) => updateSettings({ keepLogDays: Number(e.target.value) })} />
                  </Field>
                </div>
                <div className="row" style={{ marginTop: 12, gap: 10 }}>
                  <Button variant="ghost" onClick={() => api.logs.openFolder()}>Open Log Folder</Button>
                  <Button
                    variant="danger"
                    onClick={() =>
                      setModals({
                        confirm: {
                          title: 'Clear this log?',
                          message: 'The on-disk launcher log will be emptied. This cannot be undone.',
                          confirmLabel: 'Clear',
                          danger: true,
                          onConfirm: () => void api.logs.clear().then(() => notify('success', 'Logs cleared'))
                        }
                      })
                    }
                  >
                    Clear Logs
                  </Button>
                </div>
              </div>
            </>
          )}

          {section === 'minecraft' && (
            <div className="panel">
              <div className="panel-title">Versions</div>
              <p className="panel-sub">Control which Minecraft versions are available for profiles</p>
              <Toggle
                checked={settings.showSnapshots ?? false}
                onChange={(v) => updateSettings({ showSnapshots: v })}
                label="Show snapshots & beta versions"
              />
              <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 10, lineHeight: 1.5 }}>
                When enabled, the version picker will include snapshots, pre-releases, and release candidates alongside stable releases.
              </p>
              <div className="divider" />
              <div className="panel-title">Microsoft Account</div>
              <p style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.5, marginTop: 8 }}>
                {account.status !== 'offline'
                  ? `Signed in as ${account.profile?.name ?? 'a Microsoft account'}.`
                  : 'You are not signed in. Sign in with your Microsoft account to play Minecraft — authentication is handled securely through Microsoft official servers.'}
              </p>
              <div
                style={{
                  marginTop: 12,
                  padding: '12px 14px',
                  background: 'var(--bg-2)',
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>Account status</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-2)', textTransform: 'capitalize' }}>
                    {account.status === 'offline'
                      ? 'Signed out'
                      : account.status === 'expired'
                        ? 'Session expired — re-sign in to keep playing'
                        : 'Online'}
                  </div>
                </div>
                {account.status !== 'offline' ? (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() =>
                      setModals({
                        confirm: {
                          title: 'Log out',
                          message: `Log out of ${account.profile?.name ?? 'your Microsoft account'}? You can sign back in anytime.`,
                          confirmLabel: 'Log Out',
                          danger: true,
                          onConfirm: () => void logout()
                        }
                      })
                    }
                  >
                    Log Out
                  </Button>
                ) : (
                  <Button variant="primary" size="sm" onClick={() => setModals({ login: true })}>
                    Sign In
                  </Button>
                )}
              </div>
            </div>
          )}

          {section === 'minecraft' && (
            <div className="panel">
              <div className="panel-title">Java</div>
              <p className="panel-sub">Leave empty for auto-detection. The launcher finds compatible runtimes automatically.</p>
              <Field label="Java Path">
                <div className="row">
                  <TextInput value={settings.javaPath} onChange={(e) => updateSettings({ javaPath: e.target.value })} placeholder="Auto-detect" style={{ flex: 1 }} />
                  <Button onClick={async () => { const picked = await api.dialog.pickJava(); if (picked) void updateSettings({ javaPath: picked }) }}>Browse</Button>
                </div>
              </Field>
              <div className="banner banner-info" style={{ marginTop: 6 }}>
                Tip: Minecraft 1.20.5+ requires Java 21. Reimagined ships Java detection for 8, 17 and 21.
              </div>
            </div>
          )}

          {section === 'performance' && (
            <>
              <PerformanceSection />
              <StabilitySection />
            </>
          )}

          {section === 'downloads' && (
            <>
              <div className="panel">
                <div className="panel-title">Download queue</div>
                <p className="panel-sub">How many installs/downloads may run at the same time. 1 = strict queue (everything waits its turn); 3 or 5 speed up batch installs on fast connections.</p>
                <div className="row" style={{ marginTop: 12, gap: 8 }}>
                  {([1, 3, 5] as const).map((n) => (
                    <button
                      key={n}
                      onClick={() => void updateSettings({ downloadConcurrency: n })}
                      style={{
                        flex: 1,
                        maxWidth: 140,
                        padding: '10px 14px',
                        borderRadius: 10,
                        border: `1px solid ${(settings.downloadConcurrency ?? 1) === n ? 'var(--accent-3)' : 'var(--border)'}`,
                        background: (settings.downloadConcurrency ?? 1) === n ? 'var(--accent-soft, rgba(139,92,246,0.12))' : 'var(--bg-2)',
                        color: (settings.downloadConcurrency ?? 1) === n ? 'var(--accent-3)' : 'var(--text-2)',
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      {n} {n === 1 ? 'at a time' : 'at a time'}
                    </button>
                  ))}
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 12, lineHeight: 1.5 }}>
                  When you click Install on several items they are added to the queue and processed according to this setting — real tasks only, no phantom downloads.
                </p>
              </div>
              <div className="panel">
                <div className="panel-title">Cache</div>
                <p className="panel-sub">Version, library and asset download behavior</p>
                <div className="row" style={{ marginTop: 8 }}>
                  <Button onClick={() => notify('info', 'Download cache', 'All Minecraft files are cached in data/games for reuse across profiles.')}>
                    Clear download cache
                  </Button>
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 14, lineHeight: 1.5 }}>
                  Files already downloaded are skipped on future installs, so reinstalling versions is instant.
                </p>
              </div>
            </>
          )}

          {section === 'updates' && (
            <div className="panel">
              <div className="panel-title">Updates</div>
              <p className="panel-sub">
                The launcher <b>always</b> checks the official Reimagined GitHub repository on its own — no
                toggle needed. When a new version is found you choose what happens: the launcher
                <b> never updates itself without your explicit "Update" click</b>.
              </p>
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>Re-check frequency while the launcher is open</div>
                <select
                  className="select sort-select"
                  style={{ maxWidth: 240 }}
                  value={settings.updateCheckIntervalSec ?? 15}
                  onChange={(e) => updateSettings({ updateCheckIntervalSec: Number(e.target.value) })}
                  title="How often the launcher asks GitHub for new releases"
                >
                  {[
                    [15, 'Every 15 seconds'],
                    [30, 'Every 30 seconds'],
                    [60, 'Every minute'],
                    [120, 'Every 2 minutes'],
                    [300, 'Every 5 minutes'],
                    [600, 'Every 10 minutes'],
                    [900, 'Every 15 minutes']
                  ].map(([sec, label]) => (
                    <option key={sec} value={sec}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="divider" style={{ margin: '16px 0' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
                  Installed: <b>v{info?.version ?? '?'}</b>
                  {updateInfo?.hasUpdate ? (
                    <>
                      {' '}→ latest: <b style={{ color: 'var(--accent-3)' }}>v{updateInfo.latestVersion}</b>
                    </>
                  ) : (
                    <span className="muted"> — you are up to date</span>
                  )}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
                <Button variant="primary" size="sm" onClick={() => setModals({ checkUpdates: true })}>
                  Check for Updates
                </Button>
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  Opens the live update check — real timing, a clear result, and a one-click update.
                </span>
              </div>
            </div>
          )}

          {section === 'appearance' && (
            <div className="panel">
              <div className="panel-title">Theme</div>
              <p className="panel-sub">Choose the launcher's color identity</p>
              <div className="theme-cards" style={{ marginTop: 8 }}>
                {themes.map((t) => (
                  <button key={t.id} className={'theme-card' + (settings.theme === t.id ? ' active' : '')} onClick={() => updateSettings({ theme: t.id })}>
                    <div className="theme-swatch">{t.colors.map((c, i) => <span key={i} style={{ background: c }} />)}</div>
                    <small>{t.label}</small>
                  </button>
                ))}
              </div>
              <div className="divider" />
              <div className="panel-title">Performance</div>
              <div style={{ marginTop: 10 }}>
                <Toggle checked={settings.performanceMode ?? false} onChange={(v) => updateSettings({ performanceMode: v })} label="Performance mode (2D previews, fewer animations)" />
              </div>
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>Performance preset</div>
                <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 0, marginBottom: 10, lineHeight: 1.5 }}>
                  How aggressively the Reimagined Client's native optimizations apply (chunk-build threads, culling thresholds, auto render distance).
                </p>
                <div className="row" style={{ gap: 8 }}>
                  {(['potato', 'balanced', 'high', 'turbo'] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => updateSettings({ preset: p })}
                      style={{
                        flex: 1,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                        padding: '9px 12px',
                        borderRadius: 10,
                        border: `1px solid ${settings.preset === p ? 'var(--accent-3)' : 'var(--border)'}`,
                        background: settings.preset === p ? 'var(--accent-soft, rgba(139,92,246,0.12))' : 'var(--bg-2)',
                        color: settings.preset === p ? 'var(--accent-3)' : 'var(--text-2)',
                        fontSize: 12.5,
                        fontWeight: settings.preset === p ? 700 : 500,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <PerfTierIcon tier={p} size={14} />
                      {p === 'potato' ? 'Potato' : p === 'balanced' ? 'Balanced' : p === 'high' ? 'High' : 'Turbo'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="divider" style={{ marginTop: 6 }} />
              <div className="panel-title">Startup Experience</div>
              <p className="panel-sub">A premium waking-up sequence — logo reveal with purple illumination and a soft startup sound. Lightweight, never blocks initialization.</p>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Toggle checked={settings.startupAnimation ?? true} onChange={(v) => updateSettings({ startupAnimation: v })} label="Startup Animation" />
                <Toggle checked={settings.startupSound ?? true} onChange={(v) => updateSettings({ startupSound: v })} label="Startup Sound" />
              </div>
            </div>
          )}

          {section === 'audio' && (
            <>
              <div className="panel">
                <div className="panel-title">Audio</div>
                <p className="panel-sub">UI sounds follow the Reimagined premium sound library — soft, clean, never spammy.</p>
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <Toggle checked={settings.audioEnabled ?? true} onChange={(v) => updateSettings({ audioEnabled: v })} label="UI sounds" />
                  <Toggle checked={settings.audioMusic ?? false} onChange={(v) => updateSettings({ audioMusic: v })} label="Menu music" />
                  <p style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: -6, lineHeight: 1.45 }}>
                    Menu music is <b>off by default</b> — turn it on here to play the bundled menu track quietly in the background.
                  </p>
                  <div>
                    <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Master volume</span>
                      <b style={{ fontSize: 12.5 }}>{Math.round((settings.audioVolume ?? 0.7) * 100)}%</b>
                    </div>
                    <input
                      type="range"
                      className="slider"
                      min={0}
                      max={100}
                      value={Math.round((settings.audioVolume ?? 0.7) * 100)}
                      onChange={(e) => updateSettings({ audioVolume: Number(e.target.value) / 100 })}
                    />
                  </div>
                  <div className="divider" style={{ margin: '4px 0' }} />
                  <Toggle checked={settings.audioHover ?? true} onChange={(v) => updateSettings({ audioHover: v })} label="Hover sounds" />
                  <Toggle checked={settings.audioClick ?? true} onChange={(v) => updateSettings({ audioClick: v })} label="Click sounds" />
                  <Toggle checked={settings.audioNotify ?? true} onChange={(v) => updateSettings({ audioNotify: v })} label="Notification sounds" />
                  <Toggle checked={settings.audioDownload ?? true} onChange={(v) => updateSettings({ audioDownload: v })} label="Download complete sounds" />
                  <Toggle checked={settings.audioSuccess ?? true} onChange={(v) => updateSettings({ audioSuccess: v })} label="Success sounds" />
                  <Toggle checked={settings.audioError ?? true} onChange={(v) => updateSettings({ audioError: v })} label="Error sounds" />
                </div>
              </div>
              <div className="panel">
                <div className="panel-title">Preview sounds</div>
                <p className="panel-sub">Hear each action before you enable it — one theme, always Aurora.</p>
                <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {([
                    ['hover', 'Hover'],
                    ['click', 'Click'],
                    ['notify', 'Notification'],
                    ['download', 'Download'],
                    ['install', 'Install complete'],
                    ['update', 'Update available'],
                    ['success', 'Success'],
                    ['error', 'Error']
                  ] as const).map(([kind, label]) => (
                    <Button key={kind} variant="ghost" size="sm" onClick={() => sound.preview(kind)}>
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
            </>
          )}

          {section === 'advanced' && (
            <>
              <div className="panel" style={{ textAlign: 'center', padding: '36px 28px' }}>
                <BrandLogo height={40} style={{ margin: '0 auto 18px' }} />
                <h3 style={{ fontSize: 18, marginBottom: 4 }}>Reimagined Launcher</h3>
                <p className="muted" style={{ marginBottom: 20 }}>Version {info?.version ?? 'Unknown'} · {info?.platform ?? ''}</p>
                <div className="about-section" style={{ textAlign: 'left', maxWidth: 460, margin: '0 auto', gap: 10 }}>
                  <div className="about-item">
                    <div className="about-dot" />
                    <div className="about-text">
                      <h4 style={{ fontSize: 12.5, color: 'var(--text-1)', marginBottom: 2 }}>Credits</h4>
                      <p><span style={{ color: 'var(--accent-3)', fontWeight: 600 }}>@MoustachePetit</span> — creator</p>
                    </div>
                  </div>
                  <div className="about-item">
                    <div className="about-dot" />
                    <div className="about-text">
                      <h4 style={{ fontSize: 12.5, color: 'var(--text-1)', marginBottom: 2 }}>Description</h4>
                      <p>A modern Minecraft management platform for creating, managing, and launching your perfect Minecraft experience.</p>
                    </div>
                  </div>
                  <div className="about-item">
                    <div className="about-dot" />
                    <div className="about-text">
                      <h4 style={{ fontSize: 12.5, color: 'var(--text-1)', marginBottom: 2 }}>Data directory</h4>
                      <p className="mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>{info?.dataRoot ?? ''}</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="panel">
                <div className="panel-title">Danger Zone</div>
                <p className="panel-sub">Actions that cannot be undone</p>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <Button
                    variant="danger"
                    onClick={() =>
                      setModals({
                        confirm: {
                          title: 'Clear all logs?',
                          message: 'This is a destructive action. Are you sure you want to continue?',
                          confirmLabel: 'Continue',
                          danger: true,
                          onConfirm: () =>
                            setModals({
                              confirm: {
                                title: 'Really clear all logs?',
                                message: 'The on-disk launcher log will be emptied. This cannot be undone. Confirm once more to proceed.',
                                confirmLabel: 'Clear all logs',
                                danger: true,
                                onConfirm: () => void api.logs.clear().then(() => notify('success', 'Logs cleared'))
                              }
                            })
                        }
                      })
                    }
                  >
                    Clear all logs
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() =>
                      setModals({
                        confirm: {
                          title: 'Clean Release Reset',
                          message: 'This restores the launcher to a fresh installation: it logs out your Microsoft account, deletes every profile, save, mod, log and cache, resets all settings, and restarts the launcher. This cannot be undone. Are you sure?',
                          confirmLabel: 'Continue',
                          danger: true,
                          onConfirm: () =>
                            setModals({
                              confirm: {
                                title: 'Really reset everything?',
                                message: 'Every profile, save, mod, log, cache and setting will be permanently deleted and the launcher will restart as a fresh installation. Type your final confirmation below.',
                                confirmLabel: 'Reset & Restart',
                                danger: true,
                                option: { label: 'I understand this permanently deletes everything', defaultChecked: false },
                                onConfirm: async (r) => {
                                  if (!r?.optionChecked) {
                                    notify('error', 'Reset cancelled', 'You must confirm the checkbox to reset.')
                                    return
                                  }
                                  try {
                                    await api.system.cleanReset()
                                    notify('info', 'Resetting…', 'The launcher will restart as a fresh installation.')
                                  } catch (err) {
                                    notify('error', 'Reset failed', friendlyError(err))
                                  }
                                }
                              }
                            })
                        }
                      })
                    }
                  >
                    Clean Release Reset
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------ Reimagined Performance Engine (RPE) ------------------------------ */

function PerformanceSection() {
  const { settings, updateSettings, notify, profiles } = useApp()
  const [status, setStatus] = useState<PerfStatus | null>(null)
  const [recs, setRecs] = useState<PerfRecommendation[]>([])
  const [mods, setMods] = useState<PerfModOption[]>([])
  const [selectedProfile, setSelectedProfile] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  const profileId = selectedProfile || profiles[0]?.id || ''

  async function load(): Promise<void> {
    setLoading(true)
    try {
      const s = await api.perf.status()
      setStatus(s)
      const r = await api.perf.recommendations(profileId || undefined)
      setRecs(r)
      if (profileId) {
        const m = await api.perf.mods(profileId).catch(() => ({ profileId, mods: [] as PerfModOption[] }))
        setMods(m.mods)
      } else {
        setMods([])
      }
    } catch (err) {
      notify('error', 'Performance engine', friendlyError(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (profiles.length > 0 && !selectedProfile) setSelectedProfile(profiles[0].id)
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyRec = async (r: PerfRecommendation): Promise<void> => {
    setBusy(true)
    try {
      const res = await api.perf.apply({ id: r.id, profileId: (r.profileId ?? profileId) || undefined })
      notify(res.ok ? 'success' : 'error', res.ok ? 'Applied' : 'Not applied', res.message)
      // Pull the freshest settings from main so every UI reflects the change.
      await updateSettings(await api.settings.get())
      void load()
    } catch (err) {
      notify('error', 'Could not apply', friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  const setTier = async (t: 'auto' | 'potato' | 'balanced' | 'high' | 'turbo'): Promise<void> => {
    if (t === 'auto') {
      await updateSettings({ perfTier: 'auto', perfAutoTune: true })
      notify('success', 'Auto-optimization on', 'The engine will pick the best profile for your hardware.')
    } else {
      await updateSettings({ perfTier: t, preset: t, perfAutoTune: false })
      notify('success', 'Profile set', t.charAt(0).toUpperCase() + t.slice(1) + ' will be used for every launch.')
    }
    void load()
  }

  const toggleMod = async (mo: PerfModOption): Promise<void> => {
    if (!profileId) return
    setBusy(true)
    try {
      if (mo.installed) {
        await api.perf.removeMod(profileId, mo.slug)
        notify('success', 'Removed', mo.title + ' was removed from this profile.')
      } else {
        await api.perf.installMod(profileId, mo.slug)
        notify('success', 'Installed', mo.title + ' is ready — it activates the next time you play.')
      }
      void load()
    } catch (err) {
      notify('error', 'Mod action failed', friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  const hw = status?.hardware
  const tierLabel = status?.tier === 'potato' ? 'Potato' : status?.tier === 'high' ? 'High' : status?.tier === 'turbo' ? 'Turbo' : 'Balanced'

  return (
    <>
      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <div className="panel-title">Reimagined Performance Engine</div>
            <p className="panel-sub">
              Detects your hardware and adapts Minecraft to it — RAM, JVM flags, render distance, particles, clouds and entity distance. Everything is transparent and logged.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? <Spinner /> : 'Refresh'}
          </Button>
        </div>

        <div style={{ marginTop: 14 }}>
          <Toggle
            checked={settings.perfAutoTune ?? true}
            onChange={(v) => void updateSettings({ perfAutoTune: v }).then(() => notify('info', 'Auto-tune ' + (v ? 'enabled' : 'disabled'))).then(() => void load())}
            label="Auto-optimize for this computer"
          />
        </div>

        {/* v1.0.13 frame-rate safety: the engine always caps FPS by default;
            "unlimited" is a clearly-warned, explicit opt-in, OFF by default. */}
        <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <Toggle
            checked={settings.unlimitedFps ?? false}
            onChange={(v) => {
              void updateSettings({ unlimitedFps: v })
              notify(v ? 'error' : 'success', v ? 'Unlimited FPS enabled' : 'Frame cap restored', v ? 'Driving the GPU without a cap can cause overheating or shutdowns on some hardware — you were warned.' : 'The engine will re-apply its safe frame cap on the next launch.')
            }}
            label="Unlimited FPS (not recommended)"
          />
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.5 }}>
            {settings.unlimitedFps
              ? 'Off by default for a reason: without a frame cap the GPU runs at 100% load and on some PCs that triggers thermal shutdown or a power-protection restart. Only enable this on desktop hardware with strong cooling.'
              : 'The engine caps FPS to a safe value (matching your monitor refresh rate, max 240) so the GPU never runs unbounded — this prevents whole-PC crashes on weaker hardware.'}
          </div>
        </div>

        {/* v1.0.43 — VSync: a 60 Hz panel with VSync on caps FPS at 60 no
            matter the frame cap; this forces it off for unlocked frames. */}
        <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <Toggle
            checked={settings.forceVsyncOff ?? false}
            onChange={(v) => {
              void updateSettings({ forceVsyncOff: v })
              notify('success', v ? 'VSync forced off' : 'VSync left to the game', v ? 'The launcher will write enableVsync:false into options.txt on the next launch so your monitor refresh rate cannot cap the FPS.' : 'VSync is left exactly as you set it in the game.')
            }}
            label="Force VSync off (unlock to your monitor-free FPS)"
          />
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.5 }}>
            With VSync on, a 60 Hz monitor caps the game at 60 FPS no matter the frame cap. Enabling this makes the launcher write enableVsync:false on every launch — useful on high-refresh panels with unlocked FPS.
          </div>
        </div>

        {/* v1.0.26 — recording/streaming guidance (borderless fullscreen is
            applied automatically by the in-game FPS Boost for capture-hook
            compatibility; hardware encoding is a user-side choice). */}
        <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 12, lineHeight: 1.5, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <b>Recording / streaming:</b> the in-game FPS Boost uses borderless windowed fullscreen (not exclusive)
          so capture tools like OBS Game Capture hook cleanly and grab frames via shared GPU textures — no extra FPS cost.
          If you still lose FPS while recording, check that OBS is using <b>hardware encoding</b> (NVENC / AMF / QuickSync)
          instead of software x264, which competes with the game for CPU. That is a setting on your capture tool, not the launcher.
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
          <div
            style={{
              padding: '8px 14px',
              borderRadius: 10,
              border: '1px solid var(--accent-3)',
              background: 'var(--accent-soft, rgba(139,92,246,0.12))',
              color: 'var(--accent-3)',
              fontSize: 13,
              fontWeight: 700
            }}
          >
            <PerfTierIcon tier={status?.tier ?? 'balanced'} size={15} /> {tierLabel} profile {status?.tierSource === 'auto' ? '(auto)' : '(manual)'}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
            Recommended memory: <b>{Math.round((status?.recommendedMemoryMB ?? 4096) / 1024)} GB</b>
            {status?.tuning?.sessionsLearned ? <> · learned from <b>{status.tuning.sessionsLearned}</b> session(s)</> : null}
          </div>
          <div style={{ flex: 1 }} />
          <div className="row" style={{ gap: 6 }}>
            {(['auto', 'potato', 'balanced', 'high', 'turbo'] as const).map((t) => (
              <button
                key={t}
                onClick={() => void setTier(t)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-2)',
                  color: 'var(--text-2)',
                  fontSize: 11.5,
                  cursor: 'pointer',
                  fontWeight: 600
                }}
              >
                {t === 'auto' ? <IconSparkle style={{ width: 13, height: 13 }} /> : <PerfTierIcon tier={t} size={13} />}
                {t === 'auto' ? 'Auto' : ''}
              </button>
            ))}
          </div>
        </div>

        {status?.tierReasons?.length ? (
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>
            {status.tierReasons.map((r, i) => (
              <div key={i}>• {r}</div>
            ))}
          </div>
        ) : null}
      </div>

      {/* v1.0.29 — Extended View: cached distant-chunk terrain (Bobby-style,
          but Reimagined's own native implementation). Persisted snapshots of
          visited chunks render as static ghost terrain beyond real RD — no
          simulation, no entities, no server traffic out there. */}
      <div className="panel">
        <div className="panel-title">Extended View</div>
        <p className="panel-sub">
          Shows previously-explored terrain far beyond your render distance using cached data — costs
          almost nothing extra since those chunks aren't actually simulated.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
          <Toggle
            checked={settings.extendedView ?? true}
            onChange={(v) => { void updateSettings({ extendedView: v }) }}
            label="Extended View (cached distant terrain)"
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <Field label={`Extra distance: +${settings.extendedViewDistance ?? 32} chunks`}>
              <Select
                value={String(settings.extendedViewDistance ?? 32)}
                onChange={(e) => void updateSettings({ extendedViewDistance: Number(e.target.value) })}
              >
                {[8, 16, 24, 32, 48, 64, 96].map((d) => <option key={d} value={d}>+{d} chunks</option>)}
              </Select>
            </Field>
            <Field label={`Disk cache limit: ${(settings.extendedCacheLimitMB ?? 512) >= 1024 ? `${(settings.extendedCacheLimitMB ?? 512) / 1024} GB` : `${settings.extendedCacheLimitMB ?? 512} MB`}`}>
              <Select
                value={String(settings.extendedCacheLimitMB ?? 512)}
                onChange={(e) => void updateSettings({ extendedCacheLimitMB: Number(e.target.value) })}
              >
                {[128, 256, 512, 1024, 2048, 4096].map((mb) => <option key={mb} value={mb}>{mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`}</option>)}
              </Select>
            </Field>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Button size="sm" variant="ghost" disabled={busy} onClick={async () => {
              try {
                const res = await api.extendedView.clearCache(profileId || undefined)
                notify('success', 'Extended View cache cleared', `Freed ${Math.round(res.freed / 1048576)} MB across ${res.instances} instance(s).`)
              } catch (err) {
                notify('error', 'Could not clear cache', friendlyError(err))
              }
            }}>
              Clear cache
            </Button>
            <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
              Reclaims disk space used by chunk snapshots (per-world, evicted oldest-first over the limit).
            </span>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.5, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            Chunks you visit are saved as compact static snapshots; when they leave render distance they stay as ghost terrain
            instead of being discarded. The real simulation radius is <b>never</b> changed — ghosts are static geometry only,
            no entity/block/server load, and they hand off seamlessly to the live chunk as you approach.
          </div>
        </div>
      </div>

      {/* v1.0.30 — Async server-chunk decode: incoming chunk packets from a
          server are decoded OFF the game thread (bounded, relevance-ordered,
          applied nearest-first with a per-tick budget). The game thread never
          blocks on a chunk packet and a join burst fills the screen
          progressively instead of stalling — the worst jank case on servers. */}
      <div className="panel">
        <div className="panel-title">Async chunk decode (servers)</div>
        <p className="panel-sub">
          Decodes incoming server chunk packets off the game thread — bounded, ordered by
          distance, and applied gradually so a server join or reconnect never stalls the game.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
          <Toggle
            checked={settings.asyncChunkDecode ?? true}
            onChange={(v) => { void updateSettings({ asyncChunkDecode: v }) }}
            label="Async chunk decode"
          />
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.5 }}>
            When on, chunk packets are decoded by a small worker pool, the queue drops the
            farthest queued chunk under a burst instead of growing without limit, and finished
            chunks appear nearest-first. A reconnect or server resync re-sends chunks through
            the same path (newest data always wins).
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Your hardware</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginTop: 12 }}>
          {[
            ['CPU', hw ? hw.cpu.model + ' · ' + hw.cpu.threads + ' threads · ' + hw.cpu.speedGHz + ' GHz · ' + hw.cpu.cache : 'Detecting…'],
            ['GPU', hw && hw.gpu.length ? hw.gpu.map((g) => g.name + (g.integrated ? ' (iGPU)' : ' · ' + g.vramGB + ' GB')).join(' + ') : 'Detecting…'],
            ['Memory', hw ? hw.memory.totalGB + ' GB' + (hw.memory.speedMHz ? ' · ' + hw.memory.speedMHz + ' MHz' : '') : 'Detecting…'],
            ['Storage', hw ? hw.storage.type + ' · ' + hw.storage.totalGB + ' GB' : 'Detecting…'],
            ['Display', hw ? hw.display.resolution + (hw.display.refreshHz ? ' · ' + hw.display.refreshHz + ' Hz' : '') : 'Detecting…'],
            ['Java', hw ? (hw.java ? 'Java ' + hw.java.major : 'auto-download on first launch') : 'Detecting…'],
            ['System', hw ? hw.os + (hw.laptop ? ' · laptop' : ' · desktop') : 'Detecting…']
          ].map(([label, value]) => (
            <div key={label} style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-1)', lineHeight: 1.45, wordBreak: 'break-word' }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Recommendations</div>
        <p className="panel-sub">Based on your hardware and measured sessions — you decide what t
o apply."
        </p>
        {recs.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 12 }}>
            {loading ? 'Analyzing your machine…' : 'Nothing to suggest right now — your setup already matches your hardware.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            {recs.map((r) => (
              <div key={r.id} style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>{r.title}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 2, lineHeight: 1.45 }}>{r.detail}</div>
                </div>
                <Button size="sm" variant="primary" disabled={busy} onClick={() => void applyRec(r)} style={{ flexShrink: 0 }}>
                  {r.applyLabel}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-title">Measured sessions</div>
        <p className="panel-sub">Real performance recorded from your play sessions — the engine learns from these.</p>
        {status?.sessions?.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
            {status.sessions.slice(0, 6).map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', background: 'var(--bg-2)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
                <span style={{ color: 'var(--text-3)', flexShrink: 0 }}>{new Date(s.at).toLocaleDateString()}</span>
                <span style={{ fontWeight: 600, color: 'var(--text-1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.profileName}</span>
                <span style={{ color: s.avgFps >= 60 ? 'var(--ok, #34d399)' : s.avgFps >= 45 ? 'var(--warning, #fbbf24)' : 'var(--danger, #f87171)', fontWeight: 700 }}>{s.avgFps} FPS</span>
                <span className="muted" style={{ flexShrink: 0 }}>low {s.lowFps}</span>
                <span className="muted" style={{ flexShrink: 0 }}>{s.heapMB} MB</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 12 }}>
            No sessions measured yet — play a few minutes and the profiler records real numbers here.
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-title">Performance mods (optional)</div>
        <p className="panel-sub">
          Trusted, compatible mods for the selected profile — resolved live from Modrinth. Nothing installs without your click.
        </p>
        {profiles.length > 0 ? (
          <>
            <div style={{ marginTop: 12, maxWidth: 360 }}>
              <Field label="Profile">
                <Select value={selectedProfile || profiles[0].id} onChange={(e) => { setSelectedProfile(e.target.value); }}>
                  {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
              {mods.length === 0 && !loading ? (
                <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
                  {profiles.find((p) => p.id === profileId)?.loader.type === 'vanilla'
                    ? 'This profile uses Vanilla — performance mods need a Fabric or Forge profile.'
                    : 'No compatible performance mods found for this profile.'}
                </div>
              ) : null}
              {mods.map((mo) => (
                <div key={mo.slug} style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
                  {mo.iconUrl ? <ModIcon src={mo.iconUrl} style={{ width: 30, height: 30, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} /> : <div style={{ width: 30, height: 30, borderRadius: 6, background: 'var(--bg-3)', flexShrink: 0 }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>{mo.title}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.4 }}>{mo.note}</div>
                  </div>
                  <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {mo.installed ? <span style={{ fontSize: 11, color: 'var(--ok, #34d399)', fontWeight: 600 }}>Installed</span> : null}
                    {!mo.compatible ? (
                      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>No version for {profiles.find((p) => p.id === profileId)?.minecraftVersion}</span>
                    ) : (
                      <Button size="sm" variant={mo.installed ? 'ghost' : 'primary'} disabled={busy} onClick={() => void toggleMod(mo)}>
                        {mo.installed ? 'Remove' : 'Install'}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 12 }}>Create a profile first — performance mods are installed per profile.</div>
        )}
      </div>
    </>
  )
}

/**
 * Stability — the Shader Guard panel (v1.0.12 anti-crash system).
 *
 * Shows the REAL GPU/driver assessment for the shader rendering path, the
 * auto-recovery state, and the two safety toggles. If the hardware genuinely
 * cannot run shaders, that is stated plainly here — and the launcher refuses
 * to even launch a shader session on it (see Shader Guard in main).
 */
function StabilitySection() {
  const { settings, updateSettings, notify, activeProfile, refreshProfiles } = useApp()
  const [support, setSupport] = useState<{
    level: 'ok' | 'limited' | 'unsupported'
    reasons: string[]
    vramGB: number
    driverVersion: string | null
    recoveryPending: boolean
    recentCrashes?: { profileId: string; profileName: string; cause: string; at: string }[]
  } | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const s = await api.shaders.support(activeProfile?.id)
      setSupport(s)
    } catch {
      setSupport(null)
    } finally {
      setLoading(false)
    }
  }, [activeProfile?.id])

  useEffect(() => { void load() }, [load])

  const levelColor = support?.level === 'ok' ? 'var(--green, #34d399)' : support?.level === 'limited' ? 'var(--yellow, #fbbf24)' : 'var(--red, #f87171)'
  const levelLabel = support?.level === 'ok' ? 'Shaders supported' : support?.level === 'limited' ? 'Shaders limited' : 'Shaders not supported'

  const disableForProfile = async (): Promise<void> => {
    if (!activeProfile) return
    try {
      await api.shaders.disable(activeProfile.id)
      notify('info', 'Shaders disabled', 'Shaders were turned off for this profile — the next launch starts without them.')
      void refreshProfiles()
    } catch (err) {
      notify('error', 'Could not disable shaders', friendlyError(err))
    }
  }

  return (
    <>
      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <div className="panel-title">Shader Guard</div>
            <p className="panel-sub">
              Real GPU/driver assessment for the shader rendering path. If the hardware can't safely run shaders, the launcher refuses them before the game starts — and if the game crashes with shaders on, they're automatically disabled for the next session.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? <Spinner /> : 'Re-check'}
          </Button>
        </div>

        <div style={{ marginTop: 14 }}>
          {loading ? (
            <div className="row" style={{ gap: 8, color: 'var(--text-3)', fontSize: 12.5 }}>
              <Spinner /> Checking your graphics hardware…
            </div>
          ) : support ? (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 10,
                border: '1px solid ' + levelColor,
                background: 'var(--bg-2)',
                fontSize: 12.5,
                lineHeight: 1.5
              }}
            >
              <div style={{ fontWeight: 700, color: levelColor, marginBottom: 6 }}>{levelLabel}</div>
              {support.reasons.map((r, i) => (
                <div key={i} style={{ color: 'var(--text-2)' }}>• {r}</div>
              ))}
              {support.recoveryPending && (
                <div style={{ color: 'var(--yellow, #fbbf24)', marginTop: 8, fontWeight: 600 }}>
                  The last session for this profile ended with shaders armed — the next launch starts with shaders disabled automatically.
                </div>
              )}
              {support.recentCrashes && support.recentCrashes.length > 0 && (
                <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 700, marginBottom: 4 }}>Recent shader crashes (auto-recovery):</div>
                  {support.recentCrashes.slice(0, 4).map((c, i) => (
                    <div key={i} style={{ fontSize: 11.5, color: 'var(--text-2)', marginBottom: 2 }}>
                      {new Date(c.at).toLocaleDateString()} — {c.cause.slice(0, 90)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>Could not read the hardware assessment.</div>
          )}
        </div>

        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Toggle
            checked={settings.shaderAutoReduceRd ?? true}
            onChange={(v) => void updateSettings({ shaderAutoReduceRd: v })}
            label="Auto-reduce render distance on low VRAM when shaders are on"
          />
          <Toggle
            checked={settings.autoDisableShadersOnCrash ?? true}
            onChange={(v) => void updateSettings({ autoDisableShadersOnCrash: v })}
            label="Auto-disable shaders after a shader crash"
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Button variant="ghost" size="sm" onClick={() => void disableForProfile()} disabled={!activeProfile}>
              Disable shaders now{activeProfile ? ' · ' + activeProfile.name : ''}
            </Button>
            {!activeProfile && <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>Select a profile to disable shaders for it.</span>}
          </div>
        </div>
      </div>
    </>
  )
}
