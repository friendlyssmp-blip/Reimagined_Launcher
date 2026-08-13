/**
 * Streaming / recording state (v1.0.88) — mirrors the main-process detector.
 * Used to suppress non-critical toasts and avoid jarring changes mid-recording.
 */
import { useSyncExternalStore } from 'react'

export interface StreamingState {
  active: boolean
  tools: string[]
}

let state: StreamingState = { active: false, tools: [] }
const listeners = new Set<() => void>()

export function setStreaming(next: Partial<StreamingState>): void {
  state = { active: Boolean(next?.active), tools: next?.tools ?? [] }
  listeners.forEach((l) => l())
}

export function getStreaming(): StreamingState {
  return state
}

export function subscribeStreaming(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useStreaming(): StreamingState {
  return useSyncExternalStore(subscribeStreaming, getStreaming, getStreaming)
}
