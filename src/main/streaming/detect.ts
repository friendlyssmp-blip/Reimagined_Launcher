/**
 * Streaming / recording detection (v1.0.88).
 *
 * Polls the process list for known capture/streaming tools (OBS, Streamlabs,
 * Twitch Studio, XSplit, Bandicam, Fraps, Medal, …). When a capture tool is
 * running while the game is up, the launcher adjusts NON-essential background
 * behavior so nothing jars the stream — it never touches the FPS-preserving
 * capture-hook work, this is a separate smart-behavior layer on top.
 */
import { execFile } from 'node:child_process'

/* Executable names (without .exe) of common capture/streaming tools. */
const CAPTURE_TOOLS = [
  'obs64', 'obs32', 'obs',
  'streamlabsdesktop', 'twitchstudio', 'xsplit',
  'bandicam', 'fraps64', 'fraps',
  'action', 'mirillis',
  'medal', 'medalservice',
  'plays_tv', 'd3dgear', 'replay_converter'
]

let active = false
let lastTools: string[] = []
let timer: NodeJS.Timeout | null = null

export function isCapturing(): boolean {
  return active
}

export function lastCaptureTools(): string[] {
  return lastTools
}

export async function checkOnce(): Promise<{ active: boolean; tools: string[] }> {
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 4000 }, (err, out) =>
        err ? reject(err) : resolve(out)
      )
    })
    const lower = stdout.toLowerCase()
    const tools = CAPTURE_TOOLS.filter((t) => lower.includes(`${t}.exe`) || lower.includes(`"${t}"`))
    return { active: tools.length > 0, tools }
  } catch {
    return { active: false, tools: [] }
  }
}

/** Poll periodically; calls onChange only when the state actually flips. */
export function startDetection(onChange: (state: { active: boolean; tools: string[] }) => void, intervalMs = 5000): void {
  if (timer) return
  const tick = async (): Promise<void> => {
    const r = await checkOnce()
    if (r.active !== active) {
      active = r.active
      lastTools = r.tools
      onChange(r)
    }
  }
  void tick()
  timer = setInterval(() => void tick(), intervalMs)
  if (typeof timer.unref === 'function') timer.unref()
}

export function stopDetection(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
