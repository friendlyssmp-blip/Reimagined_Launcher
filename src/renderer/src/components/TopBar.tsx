import { useState, useEffect, useRef } from 'react'
import { useApp } from '../state/AppContext'
import { SkinHeadPreview } from './SkinHead'
import { Badge, ProfileGlyph } from './ui'
import { api } from '../lib/api'
import { useMusicState, toggleMusic, seekMusicBy, seekMusicTo } from '../lib/music'
import { IconSearch, IconTerminal, IconSettings, IconBell, IconArrowLeft, IconMusic, IconPause, IconPlay } from './icons'
import type { Page } from '../App'

export function TopBar({
  onNavigate,
  hideSearch = false,
  onBack
}: {
  onNavigate: (p: Page) => void
  hideSearch?: boolean
  /** v1.0.86 — universal back arrow (reverses the real navigation path). */
  onBack?: () => void
}) {
  const { account, activeProfile, running, setModals, notify } = useApp()
  const music = useMusicState()
  /* v1.0.100 — small "now playing" menu next to the instance: progress bar,
     pause and ±10 s jumps, minimalist by design. */
  const [musicOpen, setMusicOpen] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)
  const current = music.tracks[music.idx]
  const progress = music.progress
  const pct = progress && progress.duration > 0 ? Math.min(100, (progress.current / progress.duration) * 100) : 0
  const fmt = (s: number): string => {
    const m = Math.floor(s / 60)
    const ss = Math.floor(s % 60)
    return `${m}:${String(ss).padStart(2, '0')}`
  }
  /* Close the menu when clicking elsewhere or pressing Escape. */
  useEffect(() => {
    if (!musicOpen) return
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setMusicOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMusicOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [musicOpen])

  return (
    <div className="topbar">
      {onBack && (
        <button className="btn-icon topbar-back" title="Back" aria-label="Back" onClick={onBack}>
          <IconArrowLeft style={{ width: 15, height: 15 }} />
        </button>
      )}
      <div className="topbar-profile">
        {activeProfile ? (
          <>
            <div className={`tb-icon ${activeProfile.icon ? '' : 'plain'}`}>
              <ProfileGlyph icon={activeProfile.icon} name={activeProfile.name} />
            </div>
            <div>
              <b>{activeProfile.name}</b>
              <small>
                {activeProfile.minecraftVersion}
                <Badge variant={activeProfile.loader.type !== 'vanilla' ? 'accent' : 'default'}>
                  {activeProfile.loader.type}
                </Badge>
                <Badge>{activeProfile.memory}MB</Badge>
              </small>
            </div>
          </>
        ) : (
          <div>
            <b>No profile selected</b>
            <small>Create a profile to start playing</small>
          </div>
        )}
      </div>

      {/* v1.0.100 — tiny "now playing" menu next to the instance. Only shows
          when there are library tracks, and collapses to a clean music icon. */}
      {music.tracks.length > 0 && (
        <div className="topbar-music-pop" ref={popRef}>
          <button
            className={`btn-icon topbar-music-btn ${musicOpen ? 'active' : ''}`}
            title={current ? `${current.name} — ${music.playing ? 'playing' : 'paused'}` : 'Music'}
            aria-label="Now playing"
            aria-expanded={musicOpen}
            onClick={() => setMusicOpen((o) => !o)}
          >
            <IconMusic style={{ width: 15, height: 15 }} />
          </button>
          {musicOpen && (
            <div className="topbar-music-menu">
              <div className="tmm-track" title={current?.name ?? ''}>
                {current?.name ?? 'No track'}
              </div>
              {/* v1.0.100 — click-to-seek progress bar with time labels. */}
              <div
                className="tmm-progress"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  const ratio = (e.clientX - rect.left) / rect.width
                  if (progress && progress.duration > 0) seekMusicTo(ratio * progress.duration)
                }}
              >
                <div className="tmm-progress-fill" style={{ width: `${pct}%` }} />
              </div>
              <div className="tmm-times">
                <span>{progress ? fmt(progress.current) : '0:00'}</span>
                <span>{progress ? fmt(progress.duration) : '0:00'}</span>
              </div>
              <div className="tmm-controls">
                <button className="tmm-btn" title="Back 10 s" aria-label="Back 10 seconds" onClick={() => seekMusicBy(-10)}>
                  <span className="tmm-seek-label">-10</span>
                </button>
                <button
                  className="tmm-btn tmm-play"
                  title={music.playing ? 'Pause' : 'Play'}
                  aria-label={music.playing ? 'Pause' : 'Play'}
                  onClick={() => toggleMusic()}
                >
                  {music.playing ? (
                    <IconPause style={{ width: 14, height: 14 }} />
                  ) : (
                    <IconPlay style={{ width: 14, height: 14 }} />
                  )}
                </button>
                <button className="tmm-btn" title="Forward 10 s" aria-label="Forward 10 seconds" onClick={() => seekMusicBy(10)}>
                  <span className="tmm-seek-label">+10</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* v1.0.54 — hidden on screens that have their own page-level search
          (Mods, Modpacks) so there is never a confusing double search bar. */}
      {!hideSearch && (
        <div className="top-search">
          <IconSearch />
          <input
            className="input"
            placeholder={activeProfile ? `Search ${activeProfile.name}...` : 'Search mods...'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                onNavigate('mods')
              }
            }}
          />
        </div>
      )}

      <div className="topbar-actions">
        <button
          className="btn-icon"
          title="Notifications"
          onClick={() => notify('info', 'Notifications', 'Updates and alerts will appear here.')}
        >
          <IconBell />
        </button>
        <button className="btn-icon" title={running ? 'Game console' : 'Console'} onClick={() => void api.console.open()}>
          <IconTerminal />
        </button>
        <button className="btn-icon" title="Settings" onClick={() => onNavigate('settings')}>
          <IconSettings />
        </button>
        <div
          className="topbar-account"
          onClick={() => (account.profile ? onNavigate('account') : setModals({ login: true }))}
          title={account.profile ? 'Open Account' : 'Sign in'}
        >
          {account.profile?.id ? (
            <SkinHeadPreview url={account.profile?.skins?.[0]?.url} size={36} />
          ) : (
            <div className="tb-icon plain" style={{ width: 36, height: 36 }}>
              {account.status === 'expired' ? '!' : '?'}
            </div>
          )}
          <div>
            <div className="ta-name">{account.profile?.name ?? (account.status === 'expired' ? 'Re-login' : 'Sign in')}</div>
            <small>{account.status === 'online' ? 'Online' : account.status === 'expired' ? 'Expired session' : 'Offline'}</small>
          </div>
        </div>
      </div>
    </div>
  )
}
