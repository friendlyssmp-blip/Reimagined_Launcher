import { useState } from 'react'
import { useApp } from '../state/AppContext'
import { Button, Field, TextInput, Toggle, Slider, Select } from '../components/ui'
import { api, friendlyError } from '../lib/api'
import { sound, SOUND_PACKS } from '../lib/sound'
import { BrandLogo } from '../components/BrandLogo'
import { IconSettings, IconGamepad, IconShield, IconDownload, IconRefresh, IconImage, IconGauge, IconVolume, IconSparkle } from '../components/icons'
import type { ThemeId, LauncherSettings } from '@shared/types'

const themes: { id: ThemeId; label: string; colors: string[] }[] = [
  { id: 'night', label: 'Night', colors: ['#0d0d0f', '#1a1a20', '#8b5cf6'] },
  { id: 'amethyst', label: 'Amethyst', colors: ['#0d0a12', '#1a1424', '#a855f7'] },
  { id: 'obsidian', label: 'Obsidian', colors: ['#0a0a0e', '#15151d', '#9d8cff'] }
]

const sections = [
  { id: 'general', label: 'General', icon: IconSettings },
  { id: 'minecraft', label: 'Minecraft', icon: IconGamepad },
  { id: 'java', label: 'Java', icon: IconShield },
  { id: 'downloads', label: 'Downloads', icon: IconDownload },
  { id: 'updates', label: 'Updates', icon: IconRefresh },
  { id: 'appearance', label: 'Appearance', icon: IconImage },
  { id: 'audio', label: 'Audio', icon: IconVolume },
  { id: 'about', label: 'About', icon: IconSparkle },
  { id: 'advanced', label: 'Advanced', icon: IconGauge }
] as const

type SectionId = (typeof sections)[number]['id']

export function SettingsPage() {
  const { settings, updateSettings, notify, info, account, logout, setModals } = useApp()
  const [section, setSection] = useState<SectionId>('general')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="section-head">
        <div>
          <h2 className="page-title">Settings</h2>
          <p className="page-sub">Launcher configuration</p>
        </div>
      </div>

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
                  <Button variant="danger" onClick={() => api.logs.clear().then(() => notify('success', 'Logs cleared'))}>Clear Logs</Button>
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

          {section === 'java' && (
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

          {section === 'downloads' && (
            <div className="panel">
              <div className="panel-title">Downloads</div>
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
          )}

          {section === 'updates' && (
            <div className="panel">
              <div className="panel-title">Updates</div>
              <p className="panel-sub">
                The launcher checks the official Reimagined GitHub repository for new releases — no
                configuration needed. You only ever see Check, Download and Install.
              </p>
              <Toggle checked={settings.autoCheckUpdates ?? true} onChange={(v) => updateSettings({ autoCheckUpdates: v })} label="Check for updates automatically" />
              <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Button
                  onClick={async () => {
                    try {
                      const r = await api.update.check()
                      notify(
                        r.hasUpdate ? 'info' : 'success',
                        r.hasUpdate ? 'Update available' : 'You are up to date',
                        r.hasUpdate ? `v${r.latestVersion} is ready` : `v${r.currentVersion} is the latest release`
                      )
                    } catch (err) {
                      notify('error', 'Update check failed', friendlyError(err))
                    }
                  }}
                >
                  Check for updates
                </Button>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    try {
                      const r = await api.update.getInfo()
                      if (r?.url) window.open(r.url, '_blank')
                      else notify('info', 'No release page', 'Run a check first, or open the release page manually.')
                    } catch {
                      notify('info', 'No release page', 'Open the release page manually to see releases.')
                    }
                  }}
                >
                  Open release page
                </Button>
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
                  {(['potato', 'balanced', 'high'] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => updateSettings({ preset: p })}
                      style={{
                        flex: 1,
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
                      {p === 'potato' ? '🥔 Potato' : p === 'balanced' ? '⚖️ Balanced' : '🚀 High'}
                    </button>
                  ))}
                </div>
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
                <div className="panel-title">Customize sounds</div>
                <p className="panel-sub">Pick a sound pack — every change applies immediately.</p>
                <div className="theme-cards" style={{ marginTop: 12 }}>
                  {SOUND_PACKS.map((pk) => (
                    <button
                      key={pk.id}
                      className={'card' + (settings.audioPack === pk.id ? ' active' : '')}
                      style={{ cursor: 'pointer', textAlign: 'center', padding: '14px 12px' }}
                      onClick={() => updateSettings({ audioPack: pk.id })}
                    >
                      <div style={{ fontSize: 22, marginBottom: 6 }}>{pk.id === 'aurora' ? '🌌' : pk.id === 'crystal' ? '🔮' : '🍃'}</div>
                      <b style={{ fontSize: 13 }}>{pk.label}</b>
                      <small className="muted" style={{ display: 'block', marginTop: 3 }}>{pk.desc}</small>
                    </button>
                  ))}
                </div>
                <div className="divider" />
                <div className="panel-title">Preview sounds</div>
                <p className="panel-sub">Hear each action before you enable it.</p>
                <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {([
                    ['hover', 'Hover'],
                    ['click', 'Click'],
                    ['notify', 'Notification'],
                    ['download', 'Download'],
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

          {section === 'about' && (
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
          )}

          {section === 'advanced' && (
            <>
              <div className="panel">
                <div className="panel-title">About Reimagined</div>
                <div className="about-section" style={{ marginTop: 10 }}>
                  <div className="about-item">
                    <div className="about-dot" />
                    <div className="about-text">
                      <h4>Version</h4>
                      <p>{info?.version ?? 'Unknown'} · {info?.platform ?? 'Unknown'}</p>
                    </div>
                  </div>
                  <div className="about-item">
                    <div className="about-dot" />
                    <div className="about-text">
                      <h4>Credits</h4>
                      <p>
                        <span style={{ color: 'var(--accent-3)', fontWeight: 600 }}>@MoustachePetit</span>
                        <span style={{ margin: '0 6px', color: 'var(--text-3)' }}>|</span>
                        The creator
                      </p>
                    </div>
                  </div>
                  <div className="about-item">
                    <div className="about-dot" />
                    <div className="about-text">
                      <h4>Description</h4>
                      <p>A modern Minecraft management platform for creating, managing, and launching your perfect Minecraft experience.</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="panel">
                <div className="panel-title">Danger Zone</div>
                <p className="panel-sub">Actions that cannot be undone</p>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <Button variant="danger" onClick={() => api.logs.clear().then(() => notify('success', 'Logs cleared'))}>Clear all logs</Button>
                  <Button
                    variant="danger"
                    onClick={() =>
                      setModals({
                        confirm: {
                          title: 'Clean Release Reset',
                          message: 'This restores the launcher to a fresh installation: it logs out your Microsoft account, deletes every profile, save, mod, log and cache, resets all settings, and restarts the launcher. This cannot be undone.',
                          confirmLabel: 'Reset & Restart',
                          danger: true,
                          onConfirm: async () => {
                            try {
                              await api.system.cleanReset()
                              notify('info', 'Resetting…', 'The launcher will restart as a fresh installation.')}
                            catch (err) {
                              notify('error', 'Reset failed', friendlyError(err))
                            }
                          }
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
