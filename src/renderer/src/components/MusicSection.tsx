/**
 * Music & Spotify (v1.0.85).
 *
 * LOCAL LIBRARY — drop your own mp3/flac/ogg files into the launcher; they
 * play in the background through the same premium mixer as the menu music
 * (ducking + limiter apply), with play/pause/next/prev, shuffle, repeat and
 * volume. Sources stream over the locked-down reimagined-music:// protocol.
 *
 * SPOTIFY — Authorization Code with PKCE. You paste a free Client ID from
 * developer.spotify.com, authorize inside Spotify's own page, and the
 * Web Playback SDK streams directly from Spotify (Premium required). Tokens
 * are stored encrypted; the launcher never sees your password.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../state/AppContext'
import { sound } from '../lib/sound'
import { api, friendlyError } from '../lib/api'
import { Button, Toggle, Spinner } from './ui'
import { fmtBytes } from '../lib/format'
import {
  IconMusic, IconPlay, IconPause, IconSkipBack, IconSkipForward,
  IconShuffle, IconRepeat, IconTrash, IconPlus, IconSpotify, IconExternal, IconVolume
} from './icons'

type Track = { id: string; name: string; size: number; addedAt: string }

function trackUrl(t: Track): string {
  return 'reimagined-music://music/' + encodeURIComponent(t.id)
}

/* ------------------------------ local library ------------------------------ */

function LocalPlayer() {
  const { settings, updateSettings, notify } = useApp()
  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const endedRef = useRef(false)

  const enabled = settings.audioMusic ?? false
  const shuffle = settings.audioMusicShuffle ?? false
  const repeat = settings.audioMusicRepeat ?? 'all'

  const refresh = useCallback(async () => {
    try {
      const list = await api.music.list()
      setTracks(list)
      setIdx((i) => (list.length === 0 ? 0 : Math.min(i, list.length - 1)))
    } catch (err) {
      notify('error', 'Could not load music', friendlyError(err))
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /* Keep the play/pause state in sync with the mixer. */
  useEffect(() => {
    setPlaying(sound.isMusicPlaying())
  }, [idx, enabled])

  const startTrack = useCallback((i: number, force = false) => {
    const t = tracks[i]
    if (!t) return
    setIdx(i)
    sound.setMusicUrl(trackUrl(t))
    if (!enabled || force) void updateSettings({ audioMusic: true })
    /* The first user gesture unlocked the context; start right away. */
    sound.musicStart()
    setPlaying(true)
  }, [tracks, enabled, updateSettings])

  const stop = useCallback(() => {
    sound.musicStop()
    setPlaying(false)
  }, [])

  const toggle = useCallback(() => {
    if (playing) {
      stop()
      return
    }
    const t = tracks[idx]
    if (!t) return
    startTrack(idx)
  }, [playing, tracks, idx, startTrack, stop])

  /* Auto-advance when a track finishes (repeat-all / shuffle). */
  useEffect(() => {
    sound.onMusicEnded(() => {
      if (tracks.length === 0) return
      if (repeat === 'one') {
        sound.musicStart()
        return
      }
      const next =
        shuffle
          ? Math.floor(Math.random() * tracks.length)
          : (idx + 1) % tracks.length
      const t = tracks[next]
      sound.setMusicUrl(trackUrl(t))
      sound.musicStart()
      setIdx(next)
      endedRef.current = true
    })
    return () => sound.onMusicEnded(null)
  }, [tracks, idx, shuffle, repeat])

  const skip = (dir: 1 | -1) => {
    if (tracks.length === 0) return
    const next = shuffle
      ? Math.floor(Math.random() * tracks.length)
      : (idx + dir + tracks.length) % tracks.length
    startTrack(next, true)
  }

  const add = async () => {
    try {
      await api.music.add()
      await refresh()
      notify('success', 'Music added', 'Your tracks were added to the background library.')
    } catch (err) {
      notify('error', 'Could not add music', friendlyError(err))
    }
  }

  const remove = async (t: Track) => {
    try {
      await api.music.remove(t.id)
      const wasCurrent = tracks[idx]?.id === t.id
      await refresh()
      if (wasCurrent) stop()
    } catch (err) {
      notify('error', 'Could not remove track', friendlyError(err))
    }
  }

  const current = tracks[idx]
  const volume = settings.audioMusicVolume ?? 0.35

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="music-now-art"><IconMusic style={{ width: 18, height: 18 }} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b style={{ fontSize: 13, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {current ? current.name : 'No music added yet'}
          </b>
          <small style={{ color: 'var(--text-3)', fontSize: 11 }}>
            {current ? `${fmtBytes(current.size)} · ${shuffle ? 'shuffle' : 'playlist'}` : 'Drop your own .mp3 files to play them as background music'}
          </small>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void add()} title="Add audio files">
          <IconPlus style={{ width: 13, height: 13 }} /> Add
        </Button>
      </div>

      <div className="music-controls">
        <button className="music-btn" onClick={() => skip(-1)} disabled={tracks.length === 0} title="Previous track">
          <IconSkipBack style={{ width: 15, height: 15 }} />
        </button>
        <button className="music-btn music-btn-primary" onClick={toggle} disabled={tracks.length === 0 && !playing} title={playing ? 'Pause' : 'Play'}>
          {playing ? <IconPause style={{ width: 16, height: 16 }} /> : <IconPlay style={{ width: 16, height: 16 }} />}
        </button>
        <button className="music-btn" onClick={() => skip(1)} disabled={tracks.length === 0} title="Next track">
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

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <IconVolume style={{ width: 13, height: 13, color: 'var(--text-3)' }} />
        <input
          type="range"
          className="slider"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => {
            const v = Number(e.target.value)
            void updateSettings({ audioMusicVolume: v })
            sound.setMusicVolume(v)
          }}
        />
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-3)', fontSize: 12.5 }}>
          <Spinner /> Loading your music…
        </div>
      ) : tracks.length === 0 ? (
        <p style={{ color: 'var(--text-3)', fontSize: 12.5, lineHeight: 1.5 }}>
          No tracks yet. Click <b>Add</b> to pick audio files — they play in the background while you
          browse the launcher, and the menu-music toggle above also plays them.
        </p>
      ) : (
        <div className="music-tracklist">
          {tracks.map((t, i) => (
            <div key={t.id} className={'music-track' + (i === idx ? ' current' : '')} onClick={() => startTrack(i)}>
 
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
/* ------------------------------ spotify (v1.0.85) ------------------------------ */

declare global {
  interface Window {
    Spotify?: {
      Player: new (opts: {
        name: string
        getOAuthToken: (cb: (token: string) => void) => void
        volume?: number
      }) => SpotifyPlayer
    }
    onSpotifyWebPlaybackSDKReady?: () => void
  }
}

interface SpotifyPlayer {
  connect: () => Promise<boolean>
  disconnect: () => Promise<void>
  togglePlay: () => Promise<void>
  nextTrack: () => Promise<void>
  previousTrack: () => Promise<void>
  setVolume: (v: number) => Promise<void>
  addListener: (ev: string, cb: (state: any) => void) => void
}

function SpotifyPlayerSection() {
  const { settings, updateSettings, notify } = useApp()
  const [connected, setConnected] = useState(false)
  const [displayName, setDisplayName] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [playerReady, setPlayerReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [track, setTrack] = useState<{ title: string; artist: string; albumArt?: string } | null>(null)
  const [volume, setVolume] = useState(0.5)
  const [clientId, setClientId] = useState(settings.spotifyClientId ?? '')
  const playerRef = useRef<SpotifyPlayer | null>(null)

  const refreshStatus = useCallback(async () => {
    try {
      const s = await api.spotify.status()
      setConnected(s.connected)
      setDisplayName(s.displayName)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const loadSdk = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      if (window.Spotify || document.getElementById('spotify-sdk')) {
        resolve()
        return
      }
      const script = document.createElement('script')
      script.id = 'spotify-sdk'
      script.src = 'https://sdk.scdn.co/spotify-player.js'
      script.onload = () => resolve()
      script.onerror = () => resolve()
      document.head.appendChild(script)
    })
  }, [])

  const initPlayer = useCallback(async () => {
    const tok = await api.spotify.token()
    if (!tok.ok || !tok.token) {
      notify('error', 'Spotify', tok.error ?? 'Could not get a token.')
      return
    }
    const player = new window.Spotify!.Player({
      name: 'Reimagined Launcher',
      getOAuthToken: (cb) => cb(tok.token ?? ''),
      volume
    })
    player.addListener('player_state_changed', (state: any) => {
      if (!state) return
      setPlaying(!state.paused)
      const cur = state.track_window?.current_track
      setTrack(
        cur
          ? {
              title: cur.name,
              artist: (cur.artists ?? []).map((a: any) => a.name).join(', '),
              albumArt: cur.album?.images?.[0]?.url
            }
          : null
      )
    })
    player.addListener('ready', () => setPlayerReady(true))
    player.addListener('not_ready', () => setPlayerReady(false))
    player.addListener('authentication_error', ({ message }: { message: string }) =>
      notify('error', 'Spotify', message)
    )
    player.addListener('account_error', () =>
      notify('error', 'Spotify', 'Playback requires a Spotify Premium account.')
    )
    await player.connect()
    playerRef.current = player
  }, [notify, volume])

  const connect = async () => {
    const id = clientId.trim()
    if (!id) {
      notify('error', 'Spotify', 'Enter your Client ID first (create a free app at developer.spotify.com).')
      return
    }
    setBusy(true)
    try {
      await updateSettings({ spotifyClientId: id })
      const res = await api.spotify.begin(id)
      if (!res.ok) {
        notify('error', 'Spotify', res.error ?? 'Could not connect.')
        return
      }
      await refreshStatus()
      await loadSdk()
      window.onSpotifyWebPlaybackSDKReady = () => {
        void initPlayer()
      }
      if (window.Spotify) void initPlayer()
      notify('success', 'Spotify connected', 'Your music will play in the background while you use the launcher.')
    } catch (err) {
      notify('error', 'Spotify', friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    await playerRef.current?.disconnect().catch(() => {})
    playerRef.current = null
    setPlayerReady(false)
    setPlaying(false)
    setTrack(null)
    await api.spotify.disconnect().catch(() => {})
    setConnected(false)
    setDisplayName(undefined)
  }

  const cmd = (fn: () => Promise<unknown>, fail: string) => {
    if (!playerRef.current) return
    void fn().catch(() => notify('error', 'Spotify', fail))
  }

  const doVolume = (v: number) => {
    setVolume(v)
    void playerRef.current?.setVolume(v).catch(() => {})
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {connected ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="music-now-art spotify">
              {track?.albumArt ? (
                <img src={track.albumArt} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <IconSpotify style={{ width: 18, height: 18 }} />
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b style={{ fontSize: 13, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {track ? track.title : 'Spotify is ready'}
              </b>
              <small style={{ color: 'var(--text-3)', fontSize: 11 }}>
                {track ? track.artist : `Connected${displayName ? ` as ${displayName}` : ''} · pick a song on any device`}
              </small>
            </div>
            <Button size="sm" variant="ghost" onClick={() => void disconnect()} title="Disconnect Spotify">
              Disconnect
            </Button>
          </div>

          <div className="music-controls">
            <button className="music-btn" disabled={!playerReady} onClick={() => cmd(() => playerRef.current?.previousTrack() ?? Promise.resolve(), 'Could not go back')} title="Previous">
              <IconSkipBack style={{ width: 15, height: 15 }} />
            </button>
            <button
              className="music-btn music-btn-primary"
              disabled={!playerReady}
              onClick={() => cmd(() => playerRef.current?.togglePlay() ?? Promise.resolve(), 'Could not toggle playback')}
              title={playing ? 'Pause' : 'Play'}
            >
              {playing ? <IconPause style={{ width: 16, height: 16 }} /> : <IconPlay style={{ width: 16, height: 16 }} />}
            </button>
            <button className="music-btn" disabled={!playerReady} onClick={() => cmd(() => playerRef.current?.nextTrack() ?? Promise.resolve(), 'Could not skip')} title="Next">
              <IconSkipForward style={{ width: 15, height: 15 }} />
            </button>
            <span className="music-spacer" />
            <span className="music-status">
              <IconSpotify style={{ width: 13, height: 13 }} />
              {playerReady ? 'Live' : 'Connecting…'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <IconVolume style={{ width: 13, height: 13, color: 'var(--text-3)' }} />
            <input
              type="range"
              className="slider"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => doVolume(Number(e.target.value))}
            />
          </div>
        </>
      ) : (
        <>
          <p style={{ color: 'var(--text-3)', fontSize: 12.5, lineHeight: 1.55 }}>
            Play your Spotify favorites as launcher background music. You authorize inside Spotify's own
            page — the launcher never sees your password, and tokens are stored encrypted on your PC.
            Requires a <b>Spotify Premium</b> account.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 420 }}>
            <input
              className="input"
              placeholder="Your Spotify Client ID (developer.spotify.com)"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              spellCheck={false}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button variant="primary" onClick={() => void connect()} disabled={busy}>
                {busy ? <><Spinner /> Connecting…</> : <><IconSpotify style={{ width: 14, height: 14 }} /> Connect Spotify</>}
              </Button>
              <Button
                variant="ghost"
                onClick={() => window.open('https://developer.spotify.com/dashboard', '_blank')}
              >
                <IconExternal style={{ width: 13, height: 13 }} /> Get a Client ID
              </Button>
            </div>
            <p style={{ color: 'var(--text-3)', fontSize: 11.5, lineHeight: 1.5 }}>
              In the Spotify dashboard create a new app, then add
              <code className="mono" style={{ margin: '0 6px' }}>http://127.0.0.1</code>
              as a redirect URI. No IP is ever exposed to Reimagined — playback streams directly
              between Spotify and your machine.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

/** Settings Audio panel — local library + Spotify. */
export function MusicSection() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
      <div>
        <div className="panel-title">Local library</div>
        <p className="panel-sub">Your own audio files, played in the background while you use the launcher.</p>
        <LocalPlayer />
      </div>
      <div className="divider" />
      <div>
        <div className="panel-title">Spotify</div>
        <p className="panel-sub">Connect your account and play your favorites as background music.</p>
        <SpotifyPlayerSection />
      </div>
    </div>
  )
}
