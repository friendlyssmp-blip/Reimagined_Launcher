/**
 * Discord Rich Presence (v1.0.88).
 *
 * A minimal, dependency-free client for Discord's local IPC pipe
 * (\\\\.\\pipe\\discord-ipc-N). The protocol is a length-prefixed JSON frame
 * stream: 8-byte header (opcode:uint32 LE, length:uint32 LE) + JSON body.
 * If Discord is not running (or the app has no client id) everything fails
 * silently — the user never sees an error.
 */
import net from 'node:net'
import { logger } from '../logs/logger'

const OP_HANDSHAKE = 0
const OP_FRAME = 1
const OP_CLOSE = 2
const OP_PING = 3
const OP_PONG = 4

let sock: net.Socket | null = null
let connected = false
let clientId = ''
let connecting: Promise<void> | null = null
let buf = Buffer.alloc(0)
let nonceSeq = 0

function encode(op: number, data: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(data), 'utf-8')
  const header = Buffer.alloc(8)
  header.writeUInt32LE(op, 0)
  header.writeUInt32LE(payload.length, 4)
  return Buffer.concat([header, payload])
}

function send(op: number, data: unknown): void {
  if (!sock || sock.destroyed || !connected) return
  try {
    sock.write(encode(op, data))
  } catch {
    /* pipe vanished */
  }
}

/** Try every discord-ipc pipe in order; resolves when connected or all failed. */
function tryConnect(): Promise<void> {
  if (connecting) return connecting
  if (connected && sock) return Promise.resolve()
  const pipes: string[] = []
  for (let i = 0; i < 10; i++) pipes.push(`\\\\?\\pipe\\discord-ipc-${i}`)
  connecting = new Promise<void>((resolve) => {
    let idx = 0
    const attempt = (): void => {
      if (idx >= pipes.length) {
        sock = null
        connected = false
        connecting = null
        resolve()
        return
      }
      const pipe = pipes[idx++]
      const s = net.connect(pipe)
      s.setTimeout(1200)
      const fail = (): void => {
        s.destroy()
        attempt()
      }
      s.once('connect', () => {
        s.setTimeout(0)
        sock = s
        connected = true
        connecting = null
        buf = Buffer.alloc(0)
        s.on('data', onData)
        s.on('error', () => {
          connected = false
          sock = null
        })
        s.on('close', () => {
          connected = false
          sock = null
        })
        send(OP_HANDSHAKE, { v: 1, client_id: clientId })
        resolve()
      })
      s.once('error', fail)
      s.once('timeout', fail)
    }
    attempt()
  })
  return connecting
}

function onData(chunk: Buffer): void {
  buf = Buffer.concat([buf, chunk])
  while (buf.length >= 8) {
    const op = buf.readUInt32LE(0)
    const len = buf.readUInt32LE(4)
    if (buf.length < 8 + len) break
    const payload = buf.subarray(8, 8 + len).toString('utf-8')
    buf = buf.subarray(8 + len)
    handleFrame(op, payload)
  }
}

function handleFrame(op: number, payload: string): void {
  if (op === OP_PING) {
    send(OP_PONG, {})
    return
  }
  if (op === OP_CLOSE) {
    connected = false
    sock?.destroy()
    sock = null
    return
  }
  try {
    const msg = JSON.parse(payload) as { cmd?: string; evt?: string }
    /* SET_ACTIVITY replies come back as ERROR when the payload is invalid —
       ignore them quietly (missing image keys etc). */
  } catch {
    /* malformed frame — ignore */
  }
}

export interface PresenceStatus {
  details?: string
  state?: string
  largeImageKey?: string
  smallImageKey?: string
  startTimestamp?: number | null
  endTimestamp?: number | null
  /** When true the status shows as idle (e.g. AFK in game). */
  idle?: boolean
}

/** Set (or update) the activity card. */
export async function setPresence(status: PresenceStatus): Promise<void> {
  if (!clientId) return
  await tryConnect()
  if (!connected) return
  const activity: Record<string, unknown> = {
    type: status.idle ? 3 : 0,
    details: status.details ?? undefined,
    state: status.state ?? undefined,
    timestamps: {}
  }
  if (status.startTimestamp) activity.timestamps = { start: status.startTimestamp }
  if (status.endTimestamp) activity.timestamps = { ...(activity.timestamps as object), end: status.endTimestamp }
  const images: Record<string, string> = {}
  if (status.largeImageKey) images.large_image = status.largeImageKey
  if (status.smallImageKey) images.small_image = status.smallImageKey
  if (Object.keys(images).length) activity.assets = images
  send(OP_FRAME, {
    cmd: 'SET_ACTIVITY',
    args: { pid: process.pid, activity },
    nonce: `reimagined-${++nonceSeq}`
  })
}

/** Clear the status entirely (toggle off). */
export async function clearPresence(): Promise<void> {
  if (!connected || !sock) return
  send(OP_FRAME, {
    cmd: 'SET_ACTIVITY',
    args: { pid: process.pid, activity: null },
    nonce: `reimagined-${++nonceSeq}`
  })
}

/** Reconfigure with a client id and try to (re)connect. */
export async function configure(newClientId: string, enabled: boolean): Promise<void> {
  clientId = String(newClientId ?? '').trim()
  if (!enabled || !clientId) {
    await clearPresence()
    return
  }
  await tryConnect()
}

export function shutdown(): void {
  connected = false
  sock?.destroy()
  sock = null
}

export const presence = { setPresence, clearPresence, configure, shutdown }
