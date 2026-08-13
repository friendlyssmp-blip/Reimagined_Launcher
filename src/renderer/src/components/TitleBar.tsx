import { api } from '../lib/api'
import { BrandLogo } from './BrandLogo'
import { useMusicState, toggleMusic, skipMusic } from '../lib/music'
import { IconPause, IconPlay, IconSkipForward } from './icons'

export function TitleBar() {
  const music = useMusicState()
  const current = music.tracks[music.idx]

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
