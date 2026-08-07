/**
 * Running-game session persistence (v1.0.19).
 *
 * Minecraft is a fully independent process (detached spawn) and must survive
 * launcher updates/restarts. Before the launcher exits (update install,
 * normal quit) we record which game processes are running; on the next
 * startup we validate each PID against the real OS and reconnect monitoring
 * to the ones still alive — never trusting a stale PID, never relaunching a
 * game, never marking a running instance as stopped.
 */
import path from 'node:path'
import fsp from 'node:fs/promises'
import { paths } from '../paths'
import { logger } from '../logs/logger'
import { mkdirp, readJson, remove } from '../utils/fs'
import { pidAlive } from './launcher'

interface SavedSession {
  profileId: string
  pid: number
  startedAt: number
}

function stateFile(): string {
  return path.join(paths.data, 'state', 'sessions.json')
}

/** Record every currently-running game session so the next start can reconnect. */
export async function saveRunningSessions(): Promise<void> {
  try {
    const { launcher } = await import('./launcher')
    const running: SavedSession[] = launcher.handles
      .filter((h) => h.running && h.pid && h.profileId)
      .map((h) => ({
        profileId: h.profileId,
        pid: h.pid as number,
        startedAt: h.startedAt ? new Date(h.startedAt).getTime() : Date.now()
      }))
    if (running.length === 0) {
      await remove(stateFile()).catch(() => {})
      return
    }
    mkdirp(path.dirname(stateFile()))
    await fsp.writeFile(stateFile(), JSON.stringify({ at: new Date().toISOString(), sessions: running }, null, 2), 'utf-8')
    logger.info(`Session state: saved ${running.length} running Minecraft process(es) for reconnect after restart.`)
  } catch (err) {
    logger.warn(`Session state: could not save running sessions: ${(err as Error).message}`)
  }
}

/**
 * Reconnect to game processes that survived a launcher restart.
 * Every PID is validated against the real OS; dead/stale entries are dropped.
 * The state file is consumed once (removed) so a normal launch is unaffected.
 */
export async function restoreRunningSessions(): Promise<void> {
  let data: { sessions?: SavedSession[] } | null = null
  try {
    data = await readJson<{ sessions?: SavedSession[] } | null>(stateFile(), null)
  } catch {
    data = null
  }
  if (!data?.sessions?.length) return

  const { launcher } = await import('./launcher')
  let reconnected = 0
  for (const s of data.sessions) {
    if (!s.profileId || !Number.isFinite(s.pid) || s.pid === process.pid) continue
    if (!pidAlive(s.pid)) {
      logger.info(`Session state: pid ${s.pid} (${s.profileId}) is gone — marking stopped.`)
      continue
    }
    // Windows PIDs can be recycled — only reconnect when the PID really is a
    // Java game process, so we never attach monitoring to an unrelated app.
    if (process.platform === 'win32' && !(await isJavaProcess(s.pid))) {
      logger.info(`Session state: pid ${s.pid} (${s.profileId}) is not a Java process — marking stopped.`)
      continue
    }
    try {
      const ok = await launcher.reattach(s.profileId, s.pid, s.startedAt)
      if (ok) reconnected++
    } catch (err) {
      logger.warn(`Session state: could not reconnect ${s.profileId}: ${(err as Error).message}`)
    }
  }
  if (reconnected > 0) {
    logger.info(`Session state: reconnected to ${reconnected} running Minecraft instance(s).`)
  }
  await remove(stateFile()).catch(() => {})
}

/** Best-effort Windows check that a PID belongs to a Java game process. */
async function isJavaProcess(pid: number): Promise<boolean> {
  try {
    const { execFile } = await import('node:child_process')
    const out = await new Promise<string>((resolve) => {
      execFile(
        'tasklist',
        ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
        { windowsHide: true, timeout: 8000 },
        (_err, stdout) => resolve(String(stdout))
      )
    })
    return /(java|javaw)\.exe/i.test(out)
  } catch {
    // Unknown — trust the alive check rather than dropping a valid session.
    return true
  }
}
