import { api } from '../lib/api'
import { useApp } from '../state/AppContext'
import { BrandLogo } from './BrandLogo'
import { useMusicState, toggleMusic, skipMusic } from '../lib/music'
import { sound } from '../lib/sound'
import { IconPause, IconPlay, IconSkipForward, IconVolume } from './icons'

export function TitleBar() {
  const music = useMusicState()
  const { settings, updateSettings } = useApp()
  const current = music.tracks[music.idx]
  /* v1.0.99 — the mini-player volume control is INDEPENDENT from the UI
     sound volume (its own audioMusicVolume setting). */
  const volume = settings?.audioMusicVolume ?? 0.35

  return (
    <div className="titlebar">
      <div className="titlebar-brand">
        <BrandLogo height={13} />
        {/* v1.0.87 — mini player next to the logo: play/pause + next. It
            mirrors the Settings → Audio music panel (shared controller), so
            both stay in sync. Hidden until tracks are added to the library. */}
        {music.tracks.length > 0 && (
          <div className="titlebar-music">
            <span className="titlebar-music-name" title={current?.name ?? ''}>
              {current?.name ?? ''}
            </span>
            <button
              className="titlebar-btn"
              onClick={() => toggleMusic()}
              title={music.playing ? 'Pause music' : 'Play music'}
              aria-label={music.playing ? 'Pause music' : 'Play music'}
            >
              {music.playing ? (
                <IconPause style={{ width: 13, height: 13 }} />
              ) : (
                <IconPlay style={{ width: 13, height: 13 }} />
              )}
            </button>
            <button className="titlebar-btn" onClick={() => skipMusic(1)} title="Next track" aria-label="Next track">
              <IconSkipForward style={{ width: 13, height: 13 }} />
            </button>
            {/* v1.0.99 — music volume right in the title bar (independent from
                UI sounds). Live-adjusts playback and persists. */}
            <span className="titlebar-music-vol" title="Background music volume (independent from UI sounds)">
              <IconVolume style={{ width: 11, height: 11 }} />
              <input
                type="range"
                className="slider"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                aria-label="Background music volume"
                onChange={(e) => {
                  const v = Number(e.target.value)
                  void updateSettings({ audioMusicVolume: v })
                  sound.setMusicVolume(v)
                }}
              />
            </span>
          </div>
        )}
      </div>
      <div className="titlebar-btns">
        <button className="titlebar-btn" onClick={() => api.window.minimize()}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14" /></svg>
        </button>
        <button className="titlebar-btn" onClick={() => api.window.toggleMaximize()}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
        </button>
        <button className="titlebar-btn close" onClick={() => api.window.close()}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
    </div>
  )
}
