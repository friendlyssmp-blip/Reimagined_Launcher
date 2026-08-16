/**
 * Music (v1.0.87 — Spotify removed).
 *
 * LOCAL LIBRARY — drop your own mp3/flac/ogg files into the launcher; they
 * play in the background through the same premium mixer as the menu music
 * (ducking + limiter apply), with play/pause/next/prev, shuffle, repeat and
 * volume. Sources stream over the locked-down reimagined-music:// protocol.
 * Playback state is shared with the mini player in the window title bar via
 * the music controller (lib/music.ts) — they always stay in sync.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../state/AppContext'
import { sound } from '../lib/sound'
import { api, friendlyError } from '../lib/api'
import { Button, Spinner } from './ui'
import { fmtBytes } from '../lib/format'
import {
  playAt,
  refreshMusic,
  removeMusic,
  skipMusic,
  toggleMusic,
  useMusicState,
  type MusicTrack
} from '../lib/music'
import {
  IconMusic, IconPlay, IconPause, IconSkipBack, IconSkipForward,
  IconShuffle, IconRepeat, IconTrash, IconPlus, IconVolume, IconFolder
} from './icons'

/* ------------------------------ local library ------------------------------ */

function LocalPlayer() {
  const { settings, updateSettings, notify } = useApp()
  const { tracks, idx, playing } = useMusicState()
  const [loading, setLoading] = useState(true)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  /* refreshMusic never throws — it reports the library state internally. */
  const refresh = useCallback(async () => {
    await refreshMusic()
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const add = async () => {
    try {
      await api.music.add()
      await refresh()
      notify('success', 'Music added', 'Your tracks were added to the background library.')
    } catch (err) {
      notify('error', 'Could not add music', friendlyError(err))
    }
  }

  /* v1.0.99 — drag & drop: drop audio files anywhere on the player to import
   * them. Depth counting keeps the highlight stable while dragging over
   * children (dragenter fires per nested element). */
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    dragDepth.current++
    setDragging(true)
  }
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    const paths: string[] = []
    for (const f of Array.from(e.dataTransfer.files)) {
      const p = api.filePath(f)
      if (p) paths.push(p)
    }
    if (paths.length === 0) return
    try {
      await api.music.import(paths)
      await refresh()
      notify('success', 'Music added', `${paths.length} track(s) added to the background library.`)
    } catch (err) {
      notify('error', 'Could not add music', friendlyError(err))
    }
  }

  const openFolder = async () => {
    try {
      await api.music.openFolder()
    } catch (err) {
      notify('error', 'Could not open the music folder', friendlyError(err))
    }
  }

  const remove = async (t: MusicTrack) => {
    try {
      await removeMusic(t.id)
    } catch (err) {
      notify('error', 'Could not remove track', friendlyError(err))
    }
  }

  const current = tracks[idx]
  const shuffle = settings.audioMusicShuffle ?? false
  const repeat = settings.audioMusicRepeat ?? 'all'
  const volume = settings.audioMusicVolume ?? 0.35

  return (
    <div
      className={'music-player' + (dragging ? ' dragging' : '')}
      style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={(e) => void onDrop(e)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="music-now-art"><IconMusic style={{ width: 18, height: 18 }} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b style={{ fontSize: 13, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {current ? current.name : 'No music added yet'}
          </b>
          <small style={{ color: 'var(--text-3)', fontSize: 11 }}>
            {current ? `${fmtBytes(current.size)} · ${shuffle ? 'shuffle' : 'playlist'}` : 'Drop your own .mp3 files here (or click Add) to play them as background music'}
          </small>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void add()} title="Add audio files">
          <IconPlus style={{ width: 13, height: 13 }} /> Add
        </Button>
        {/* v1.0.99 — open the library folder so the user can see exactly where
            their files live (and drop more in directly). */}
        <Button size="sm" variant="ghost" onClick={() => void openFolder()} title="Open the music folder">
          <IconFolder style={{ width: 13, height: 13 }} /> Folder
        </Button>
      </div>

      <div className="music-controls">
        <button className="music-btn" onClick={() => skipMusic(-1)} disabled={tracks.length === 0} title="Previous track">
          <IconSkipBack style={{ width: 15, height: 15 }} />
        </button>
        <button className="music-btn music-btn-primary" onClick={toggleMusic} disabled={tracks.length === 0 && !playing} title={playing ? 'Pause' : 'Play'}>
          {playing ? <IconPause style={{ width: 16, height: 16 }} /> : <IconPlay style={{ width: 16, height: 16 }} />}
        </button>
        <button className="music-btn" onClick={() => skipMusic(1)} disabled={tracks.length === 0} title="Next track">
          <IconSkipForward style={{ width: 15, height: 15 }} />
        </button>
        <span className="music-spacer" />
        <button
          className={'music-btn' + (shuffle ? ' active' : '')}
          onClick={() => void updateSettings({ audioMusicShuffle: !shuffle })}
          title="Shuffle"
        >
          <IconShuffle style={{ width: 14, height: 14 }} />
        </button>
        <button
          className={'music-btn' + (repeat !== 'off' ? ' active' : '')}
          onClick={() => void updateSettings({ audioMusicRepeat: repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off' })}
          title={repeat === 'off' ? 'Repeat: off' : repeat === 'all' ? 'Repeat: all' : 'Repeat: one'}
        >
          <IconRepeat style={{ width: 14, height: 14 }} />
        </button>
      </div>

      {/* v1.0.99 — music volume, fully independent from the UI sound volume
          (writes audioMusicVolume, never audioVolume). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <IconVolume style={{ width: 13, height: 13, color: 'var(--text-3)' }} />
        <input
          type="range"
          className="slider"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          aria-label="Background music volume"
          title="Background music volume (independent from UI sounds)"
          onChange={(e) => {
            const v = Number(e.target.value)
            void updateSettings({ audioMusicVolume: v })
            sound.setMusicVolume(v)
          }}
        />
        <span style={{ fontSize: 11, color: 'var(--text-3)', minWidth: 34, textAlign: 'right' }}>
          {Math.round(volume * 100)}%
        </span>
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-3)', fontSize: 12.5 }}>
          <Spinner /> Loading your music…
        </div>
      ) : tracks.length === 0 ? (
        <p style={{ color: 'var(--text-3)', fontSize: 12.5, lineHeight: 1.5 }}>
          No tracks yet. Click <b>Add</b> to pick audio files — they play in the background while you
          browse the launcher, and the mini player at the top of the window controls them from anywhere.
        </p>
      ) : (
        <div className="music-tracklist">
          {tracks.map((t, i) => (
            <div key={t.id} className={'music-track' + (i === idx ? ' current' : '')} onClick={() => playAt(i)}>
              <span className="music-track-play">
                {i === idx && playing ? <IconPause style={{ width: 12, height: 12 }} /> : <IconPlay style={{ width: 12, height: 12 }} />}
              </span>
              <span className="music-track-name" title={t.name}>{t.name}</span>
              <button
                className="icon-danger-btn"
                title="Remove from library"
                aria-label="Remove track"
                onClick={(e) => {
                  e.stopPropagation()
                  void remove(t)
                }}
              >
                <IconTrash style={{ width: 12, height: 12 }} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Settings Audio panel — local library (Spotify removed in v1.0.87). */
export function MusicSection() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
      <div>
        <div className="panel-title">Local library</div>
        <p className="panel-sub">Your own audio files, played in the background while you use the launcher.</p>
        <LocalPlayer />
      </div>
    </div>
  )
}
