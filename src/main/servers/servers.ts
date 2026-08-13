/**
 * Minecraft servers (v1.0.88) — the Servers page backend.
 *
 * pingServer() speaks the modern (1.7+) server-list protocol over raw TCP:
 * handshake packet → status request → JSON status (MOTD, player counts,
 * version). Latency is measured against the status response. Fails fast and
 * reports offline — never blocks the UI (IPC is async).
 */
import net from 'node:net'
import { randomUUID } from 'node:crypto'
import { settingsManager } from '../settings/settings-manager'
import { launcher } from '../minecraft/launcher'
import type { ServerFavorite, RecentServer } from '@shared/types'

export interface ServerStatus {
  address: string
  online: boolean
  latencyMs: number | null
  motd?: string
  players?: { online: number; max: number }
  version?: string
}

export function parseAddress(input: string): { host: string; port: number } {
  const addr = String(input ?? '').trim()
  if (!addr) return { host: '', port: 25565 }
  /* IPv6 literal: [::1]:25565 */
  const bracket = addr.match(/^\[([^\]]+)\](?::(\d+))?$/)
  if (bracket) return { host: bracket[1], port: bracket[2] ? Number(bracket[2]) : 25565 }
  const lastColon = addr.lastIndexOf(':')
  if (lastColon > 0 && !addr.includes('::') && /^\d+$/.test(addr.slice(lastColon + 1))) {
    return { host: addr.slice(0, lastColon), port: Number(addr.slice(lastColon + 1)) }
  }
  return { host: addr, port: 25565 }
}

/* ------------------------------- varint utils ------------------------------- */

function writeVarInt(n: number): Buffer {
  const out: number[] = []
  let v = n
  do {
    let b = v & 0x7f
    v >>>= 7
    if (v !== 0) b |= 0x80
    out.push(b)
  } while (v !== 0)
  return Buffer.from(out)
}

function readVarInt(buf: Buffer, offset: number): { value: number; bytes: number } {
  let value = 0
  let bytes = 0
  let shift = 0
  for (let i = offset; i < buf.length; i++) {
    const b = buf[i]
    value |= (b & 0x7f) << shift
    bytes++
    if ((b & 0x80) === 0) break
    shift += 7
    if (shift > 35) break
  }
  return { value, bytes }
}

function writeString(s: string): Buffer {
  const raw = Buffer.from(s, 'utf-8')
  return Buffer.concat([writeVarInt(raw.length), raw])
}

function cleanMotd(raw: string): string {
  return String(raw ?? '')
    .replace(/§./g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/* ---------------------------------- ping ---------------------------------- */

export function pingServer(address: string, timeoutMs = 3500): Promise<ServerStatus> {
  const { host, port } = parseAddress(address)
  const status: ServerStatus = { address, online: false, latencyMs: null }
  if (!host) return Promise.resolve(status)

  return new Promise((resolve) => {
    const sock = net.connect({ host, port })
    let buffer = Buffer.alloc(0)
    let t0 = 0
    let settled = false
    const done = (): void => {
      if (settled) return
      settled = true
      sock.destroy()
      resolve(status)
    }
    sock.setTimeout(timeoutMs)
    sock.once('connect', () => {
      t0 = Date.now()
      /* Handshake: protocol -1 (any), host, port, next state 1 (status). */
      const handshake = Buffer.concat([
        writeVarInt(-1),
        writeString(host),
        (() => {
          const b = Buffer.alloc(2)
          b.writeUInt16BE(port)
          return b
        })(),
        writeVarInt(1)
      ])
      sock.write(encodePacket(0x00, handshake))
      /* Status request. */
      sock.write(encodePacket(0x00, Buffer.alloc(0)))
    })
    sock.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      try {
        const parsed = tryParseStatus(buffer)
        if (parsed) {
          status.online = true
          status.latencyMs = Date.now() - t0
          const d = parsed
          if (d.description) {
            status.motd = typeof d.description === 'string' ? cleanMotd(d.description) : cleanMotd(d.description?.text ?? JSON.stringify(d.description))
          }
          if (d.players) status.players = { online: d.players.online ?? 0, max: d.players.max ?? 0 }
          if (d.version?.name) status.version = String(d.version.name)
          done()
        }
      } catch {
        done() // protocol mismatch — just report latency-based reachability
      }
    })
    sock.on('error', done)
    sock.on('timeout', done)
  })
}

function encodePacket(id: number, body: Buffer): Buffer {
  return Buffer.concat([writeVarInt(body.length + 1), writeVarInt(id), body])
}

function tryParseStatus(buf: Buffer): { description?: any; players?: any; version?: any } | null {
  /* Frame: varint length, varint packet id (0x00), varint json length, json. */
  const { value: frameLen, bytes: frameBytes } = readVarInt(buf, 0)
  if (buf.length < frameBytes + frameLen) return null
  const frameStart = frameBytes
  const { value: packetId, bytes: idBytes } = readVarInt(buf, frameStart)
  if (packetId !== 0x00) return null
  const jsonStart = frameStart + idBytes
  const { value: jsonLen, bytes: jsonBytes } = readVarInt(buf, jsonStart)
  if (jsonLen <= 0 || jsonLen > 1_000_000) return null
  const dataStart = jsonStart + jsonBytes
  if (buf.length < dataStart + jsonLen) return null
  try {
    return JSON.parse(buf.subarray(dataStart, dataStart + jsonLen).toString('utf-8'))
  } catch {
    return null
  }
}

/* ------------------------------ favorites / recents ------------------------------ */

export async function addFavorite(name: string, address: string): Promise<ServerFavorite[]> {
  const favs = [...settingsManager.get().servers]
  if (!favs.some((f) => f.address === address)) {
    favs.push({ id: randomUUID(), name: name || address, address, addedAt: new Date().toISOString() })
    await settingsManager.update({ servers: favs })
  }
  return favs
}

export async function removeFavorite(id: string): Promise<ServerFavorite[]> {
  const favs = settingsManager.get().servers.filter((f) => f.id !== id)
  await settingsManager.update({ servers: favs })
  return favs
}

export async function recordRecent(address: string, name?: string): Promise<RecentServer[]> {
  const list = settingsManager.get().recentServers.filter((r) => r.address !== address)
  list.unshift({ address, name: name || address, at: new Date().toISOString() })
  const recent = list.slice(0, 12)
  await settingsManager.update({ recentServers: recent })
  return recent
}

/** Launch the profile directly into the server (--server / --port). */
export async function joinServer(profileId: string, address: string, name?: string): Promise<RecentServer[]> {
  const { host, port } = parseAddress(address)
  if (!host) throw new Error('That server address looks empty — add a host like play.example.com.')
  await launcher.launch(profileId, { server: { host, port } })
  await recordRecent(address, name)
  await settingsManager.addRecent('launch', `Joined ${address}`)
  return settingsManager.get().recentServers
}

export const serversService = { pingServer, addFavorite, removeFavorite, recordRecent, joinServer, parseAddress }
