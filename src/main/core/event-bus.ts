/**
 * Minimal typed event bus.
 *
 * Lets decoupled modules (auth, launcher, downloads…) publish events that
 * the IPC bridge forwards to the renderer. No external dependency.
 */
import type { AppEvent, AppEventType } from '@shared/ipc'

type Handler = (event: AppEvent) => void

class EventBus {
  private handlers = new Map<AppEventType, Set<Handler>>()

  on(type: AppEventType, handler: Handler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set())
    this.handlers.get(type)!.add(handler)
    return () => this.off(type, handler)
  }

  off(type: AppEventType, handler: Handler): void {
    this.handlers.get(type)?.delete(handler)
  }

  emit(type: AppEventType, payload?: unknown): void {
    const event: AppEvent = { type, payload }
    this.handlers.get(type)?.forEach((h) => {
      try {
        h(event)
      } catch (err) {
        // A broken listener must never break the emitter.
        console.error('[event-bus] listener error:', err)
      }
    })
  }

  /** Emit on every registered channel — used by the IPC forwarder. */
  subscribeAll(handler: Handler): () => void {
    const subscriptions = (Object.keys(this.events()) as AppEventType[]).map((t) => this.on(t, handler))
    return () => subscriptions.forEach((off) => off())
  }

  private events(): Record<AppEventType, boolean> {
    // Purely for subscribeAll bookkeeping — every possible type is listed here.
    return {
      'auth:code': true,
      'auth:state': true,
      'auth:error': true,
      'launch:progress': true,
      'launch:log': true,
      'launch:status': true,
      'launch:exit': true,
      'launch:window-open': true,
      'download:progress': true,
      'settings:changed': true,
      'profile:changed': true,
      'profile:progress': true,
      'mods:changed': true,
      'update:progress': true,
      'crash:detected': true,
      'shaders:auto-disabled': true,
      'system:info': true
    }
  }
}

export const eventBus = new EventBus()
