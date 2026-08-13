/**
 * Shared background-music controller (v1.0.87).
 *
 * The local music library (Settings → Audio → Music) and the mini player in
 * the window title bar both drive the SAME state through this tiny store, so
 * play/pause/skip from either place always stays in sync. Track sources stream
 * over the privileged reimagined-music:// protocol handled by the main process.
 */
import { useSyncExternalStore } from 'react'
import { api } from './api'
import { sound } from './sound'

export interface MusicTrack {
  id: string
  name: string
  size: number
  addedAt: string
}

export interface MusicState {
  tracks: MusicTrack[]
  idx: number
  playing: boolean
  /** True once the library has been listed at least once. */
  ready: boolean
}

let state: MusicState = { tracks: [], idx: 0, playing: false, ready: false }
const listeners = new Set<() => void>()

let shuffle = false
let repeat: 'off' | 'all' | 'one' = 'all'
/** Registered by the app shell — enables the music setting right before play. */
let ensureEnabled: (() => void) | null = null

function emit(): void {
  listeners.forEach((l) => l())
}

export function getMusic(): MusicState {
  return state
}

export function subscribeMusic(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** React hook — re-renders the consumer whenever the player state changes. */
export function useMusicState(): MusicState {
  return useSyncExternalStore(subscribeMusic, getMusic, getMusic)
}

/** Keep the play-mode (shuffle/repeat) in sync with the persisted settings. */
export function setMusicMode(shuffleOn: boolean, repeatMode: 'off' | 'all' | 'one'): void {
  shuffle = shuffleOn
  repeat = repeatMode
}

/** Let the app shell enable the music setting just before a track starts. */
export function setMusicEnsureEnabled(fn: (() => void) | null): void {
  ensureEnabled = fn
}

function trackUrl(id: string): string {
  return 'reimagined-music://music/' + encodeURIComponent(id)
}

/** Reload the library from disk and repair the current position. */
export async function refreshMusic(): Promise<MusicTrack[]> {
  try {
    const list = await api.music.list()
    const currentId = state.tracks[state.idx]?.id
    let idx = state.idx
    if (list.length === 0) {
      sound.musicStop()
      sound.clearMusicUrl()
      idx = 0
      state = { ...state, tracks: [], idx, playing: false, ready: true }
      emit()
      return []
    }
    idx = Math.min(state.idx, list.length - 1)
    if (currentId && !list.some((t) => t.id === currentId)) {
      /* The current track was removed from the library → stop cleanly and
       * report the real playing state (nothing is playing anymore). */
      sound.musicStop()
      state = { ...state, tracks: list, idx, playing: false, ready: true }
      emit()
      return list
    }
    state = { ...state, tracks: list, idx, ready: true }
    emit()
    return list
  } catch {
    state = { ...state, ready: true }
    emit()
    return state.tracks
  }
}

/** Start playing the track at index i (enables the music setting if needed). */
export function playAt(i: number): void {
  const t = state.tracks[i]
  if (!t) return
  const sameTrack = i === state.idx
  state = { ...state, idx: i }
  ensureEnabled?.()
  if (sameTrack && (sound.isMusicPlaying() || sound.isMusicPaused())) {
    /* Re-selecting the current track (or "next" with no next one) restarts
     * it from the beginning — even when it was paused. */
    sound.musicRestart()
    state = { ...state, playing: sound.isMusicPlaying() }
    emit()
    return
  }
  sound.setMusicUrl(trackUrl(t.id))
  if (!sound.isMusicPlaying() && !sound.isMusicPaused()) sound.musicStart()
  state = { ...state, playing: sound.isMusicPlaying() }
  emit()
}

/** Play / pause the current track (resumes where it stopped). */
export function toggleMusic(): void {
  if (state.tracks.length === 0) return
  if (sound.isMusicPlaying()) {
    sound.musicPause()
    state = { ...state, playing: false }
  } else if (sound.isMusicPaused()) {
    sound.musicResume()
    state = { ...state, playing: true }
  } else {
    playAt(state.idx)
  }
  emit()
}

/**
 * Skip forward/backward. When there is no next track (repeat off, at the end
 * of the list) the SAME track plays again — the music never just dies.
 */
export function skipMusic(dir: 1 | -1): void {
  const n = state.tracks.length
  if (n === 0) return
  let next: number
  if (shuffle) {
    next = Math.floor(Math.random() * n)
  } else if (repeat === 'one') {
    next = state.idx
  } else {
    next = state.idx + dir
    if (next < 0) next = n - 1
    else if (next >= n) next = repeat === 'off' ? state.idx : 0
  }
  playAt(next)
}

/** Remove a track from the library (deletes its copied file). */
export async function removeMusic(id: string): Promise<void> {
  try {
    await api.music.remove(id)
  } catch {
    /* ignore — the refresh below reports the real state */
  }
  await refreshMusic()
}

/* Auto-advance when a custom track finishes: repeat-one replays it, shuffle
 * picks a random track, repeat-all wraps to the top, and repeat-off replays
 * the last track when there is no next one (never stops on its own). */
sound.onMusicEnded(() => {
  const n = state.tracks.length
  if (n === 0) return
  sound.musicStop()
  if (repeat === 'one') {
    playAt(state.idx)
    return
  }
  if (shuffle) {
    playAt(Math.floor(Math.random() * n))
    return
  }
  const next = state.idx + 1
  playAt(next < n ? next : repeat === 'off' ? state.idx : 0)
})
