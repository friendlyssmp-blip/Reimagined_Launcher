/**
 * Global install/download queue (V2 pass).
 *
 * Every install operation (mods, resource packs, data packs, shaders,
 * modpacks) runs through `runQueued`, which limits how many operations may
 * download AT THE SAME TIME per the user's `downloadConcurrency` setting
 * (1 / 3 / 5, default 1 = strict queue).
 *
 * Nesting detection uses AsyncLocalStorage: a `runQueued` call made inside
 * the SAME async context as an already-queued task (e.g. installWithDeps →
 * installVersion) runs inline, while genuinely concurrent calls from
 * different IPC invocations each acquire their own slot — so the queue
 * guarantee holds even for parallel installs.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { settingsManager } from '../settings/settings-manager'

/** Currently executing operations (outermost queued calls only). */
let active = 0
/** FIFO of waiters: calling it starts the next queued operation. */
const waiters: (() => void)[] = []
/** Marks the async context that is currently inside a queued task. */
const taskStore = new AsyncLocalStorage<boolean>()

/** Current concurrency the queue enforces (live from settings). */
export function currentConcurrency(): number {
  const v = settingsManager.get().downloadConcurrency
  return v === 3 || v === 5 ? v : 1
}

function acquire(): Promise<() => void> {
  const limit = currentConcurrency()
  if (active < limit) {
    active++
    return Promise.resolve(() => {
      active--
      release()
    })
  }
  return new Promise<() => void>((resolve) => {
    waiters.push(() => {
      active++
      resolve(() => {
        active--
        release()
      })
    })
  })
}

/** Hand the slot to the next waiter (FIFO) or leave it free. */
function release(): void {
  const next = waiters.shift()
  if (next) next()
}

/**
 * Run `fn` inside the global queue. Nested calls within the same queued
 * task run inline (no deadlock); independent calls each take a slot.
 */
export async function runQueued<T>(fn: () => Promise<T>): Promise<T> {
  if (taskStore.getStore()) return fn()
  return taskStore.run(true, async () => {
    const releaseSlot = await acquire()
    try {
      return await fn()
    } finally {
      releaseSlot()
    }
  })
}
