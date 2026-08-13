/**
 * Minecraft servers (v1.0.88) — the Servers page backend.
 *
 * pingServer() speaks the modern (1.7+) server-list protocol over raw TCP:
 * handshake packet → status request → JSON status (MOTD, player counts,
 * version). Latency is measured against the status response. Fails fast and
 * reports offline — never blocks the UI (IPC is async).
 */
import net from 'node:net'
import { instancePath } from '../instances/paths'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import zlib from 'node:zlib'
import path from 'node:path'
import { settingsManager } from '../settings/settings-manager'
import { launcher } from '../minecraft/launcher'
import { paths } from '../paths'
import { profileManager } from '../profiles/profile-manager'
import type { ServerFavorite, RecentServer, DirectoryServer, InstallServerResult, Profile } from '@shared/types'

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

/* ------------------------------ server directory ------------------------------ */

/**
 * Curated directory of real public Java servers (v1.0.89). Addresses are each
 * server's official public endpoint; live status (ping / players / MOTD) is
 * fetched per card on demand. Categories map to the kind of gameplay.
 */
export const SERVER_DIRECTORY: DirectoryServer[] = [
  { id: 'hypixel', name: 'Hypixel', address: 'mc.hypixel.net', category: 'Minigames',
    description: 'The largest Minecraft server in the world - BedWars, SkyWars, Build Battle, The Pit and hundreds of minigames.',
    tags: ['bedwars', 'skywars', 'minigames', 'pvp', 'games'] },
  { id: 'cubecraft', name: 'CubeCraft', address: 'play.cubecraft.net', category: 'Minigames',
    description: 'Big European minigame network - EggWars, SkyWars, Lucky Islands and more.',
    tags: ['eggwars', 'skywars', 'minigames', 'pvp'] },
  { id: 'mineville', name: 'Mineville', address: 'play.mineville.org', category: 'Minigames',
    description: 'Social survival and minigames network with a huge casual community.',
    tags: ['survival', 'minigames', 'social', 'games'] },
  { id: 'gommehd', name: 'GommeHD', address: 'gommehd.net', category: 'Minigames',
    description: 'German minigame network - BedWars, Build Battle, SkyWars and classic games.',
    tags: ['bedwars', 'build', 'minigames'] },
  { id: 'jartex', name: 'JartexNetwork', address: 'mc.jartexnetwork.com', category: 'Minigames',
    description: 'Factions, Prison, Skyblock and minigames on a large network.',
    tags: ['factions', 'prison', 'skyblock', 'minigames', 'pvp'] },
  { id: 'skyblocknet', name: 'Skyblock.net', address: 'play.skyblock.net', category: 'Skyblock',
    description: 'One of the oldest dedicated Skyblock networks - vanilla and custom Skyblock.',
    tags: ['skyblock', 'island', 'survival'] },
  { id: 'munchy', name: 'MunchyMC', address: 'munchymc.com', category: 'Skyblock',
    description: 'Skyblock and Prison with a fast, active community and frequent events.',
    tags: ['skyblock', 'prison', 'events'] },
  { id: 'pika', name: 'PikaNetwork', address: 'pika-network.net', category: 'Skyblock',
    description: 'Skyblock, Survival and minigames network with a friendly global community.',
    tags: ['skyblock', 'survival', 'minigames'] },
  { id: '2b2t', name: '2b2t', address: '2b2t.org', category: 'Anarchy',
    description: 'The oldest anarchy server in Minecraft - no rules, no map resets, a legend.',
    tags: ['anarchy', 'no-rules', 'queue', 'history'] },
  { id: 'constantiam', name: 'Constantiam', address: 'constantiam.net', category: 'Anarchy',
    description: 'Long-running anarchy server - vanilla survival with no rules and no resets.',
    tags: ['anarchy', 'vanilla', 'no-rules'] },
  { id: 'wynncraft', name: 'Wynncraft', address: 'play.wynncraft.com', category: 'MMORPG',
    description: 'A fully custom MMORPG inside Minecraft - classes, quests, dungeons and raids.',
    tags: ['mmorpg', 'rpg', 'quests', 'dungeons', 'pve'] },
  { id: 'manacube', name: 'ManaCube', address: 'play.manacube.net', category: 'Creative',
    description: 'Creative plots, Skyblock and a huge builder community since 2012.',
    tags: ['creative', 'build', 'plots', 'skyblock'] },
  { id: 'stonehollow', name: 'StoneHollow', address: 'mc.stonehollow.net', category: 'Survival',
    description: 'Classic survival multiplayer - towns, economy and a chill community.',
    tags: ['survival', 'towny', 'economy', 'smp'] },
  { id: 'minesuperior', name: 'MineSuperior', address: 'play.minesuperior.com', category: 'Survival',
    description: 'OneBlock, Skyblock and Survival with custom ranks and competitions.',
    tags: ['survival', 'oneblock', 'skyblock', 'ranks'] },
  { id: 'autumn', name: 'AutumnMC', address: 'play.autumnmc.com', category: 'Survival',
    description: 'Semi-vanilla survival with land claims, player shops and events.',
    tags: ['survival', 'smp', 'claims', 'vanilla'] }
]

export function discoverServers(query?: string, category?: string): DirectoryServer[] {
  const q = (query ?? '').trim().toLowerCase()
  const cat = (category ?? '').trim()
  let list = SERVER_DIRECTORY
  if (cat) list = list.filter((s) => s.category === cat)
  if (q) {
    list = list.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.address.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        s.tags.some((t) => t.includes(q))
    )
  }
  return list
}

const CATEGORY_KEYWORDS: [DirectoryServer['category'], string[]][] = [
  ['Skyblock', ['skyblock', 'island', 'oneblock']],
  ['Anarchy', ['anarchy', '2b2t', 'constantiam', 'no-rules']],
  ['MMORPG', ['wynn', 'rpg', 'mmo', 'quest', 'dungeon']],
  ['Minigames', ['bedwars', 'skywars', 'minigame', 'kitpvp', 'practice', 'eggwars', 'lifesteal']],
  ['Prison', ['prison', 'cells', 'factions']],
  ['Creative', ['creative', 'build', 'plots']],
  ['Survival', ['survival', 'smp', 'towny', 'vanilla', 'claims']]
]

/**
 * "Recommended for you" - ranks the directory by how well it matches the mods
 * installed in a profile (Skyblock mods suggest Skyblock servers, etc.).
 * Always returns a useful subset even with no mods installed.
 */
export function recommendServers(profile: Profile | null): DirectoryServer[] {
  if (!profile) {
    return SERVER_DIRECTORY.filter((s) => s.category === 'Minigames' || s.category === 'Survival').slice(0, 6)
  }
  const hay = (profile.mods ?? []).map((m) => `${m.title} ${m.slug} ${m.filename}`.toLowerCase()).join(' ')
  const score = new Map<DirectoryServer['category'], number>()
  for (const [cat, kws] of CATEGORY_KEYWORDS) {
    for (const kw of kws) {
      if (hay.includes(kw)) score.set(cat, (score.get(cat) ?? 0) + 1)
    }
  }
  const ranked = [...SERVER_DIRECTORY].sort((a, b) => (score.get(b.category) ?? 0) - (score.get(a.category) ?? 0))
  const picked = ranked.slice(0, 6)
  return picked.length >= 3 ? picked : SERVER_DIRECTORY.filter((s) => s.category === 'Minigames' || s.category === 'Survival').slice(0, 6)
}

/* ------------------------------ servers.dat (NBT) ------------------------------ */
/* Minecraft stores the multiplayer server list in <gameDir>/servers.dat as a
 * gzip-compressed big-endian NBT file. We read + merge + rewrite it so servers
 * installed from the launcher appear in the in-game server list. */

const TAG_END = 0
const TAG_BYTE = 1
const TAG_STRING = 8
const TAG_LIST = 9
const TAG_COMPOUND = 10

function nbtString(name: string, value: string): Buffer {
  const nameBuf = Buffer.from(name, 'utf8')
  const valBuf = Buffer.from(value, 'utf8')
  const out = Buffer.alloc(1 + 2 + nameBuf.length + 2 + valBuf.length)
  let o = 0
  out[o++] = TAG_STRING
  out.writeUInt16BE(nameBuf.length, o); o += 2
  nameBuf.copy(out, o); o += nameBuf.length
  out.writeUInt16BE(valBuf.length, o); o += 2
  valBuf.copy(out, o)
  return out
}

function nbtByte(name: string, value: number): Buffer {
  const nameBuf = Buffer.from(name, 'utf8')
  const out = Buffer.alloc(1 + 2 + nameBuf.length + 1)
  let o = 0
  out[o++] = TAG_BYTE
  out.writeUInt16BE(nameBuf.length, o); o += 2
  nameBuf.copy(out, o); o += nameBuf.length
  out[o] = value & 0xff
  return out
}

function nbtCompound(name: string, body: Buffer[]): Buffer {
  const nameBuf = Buffer.from(name, 'utf8')
  const bodyBuf = Buffer.concat(body)
  const out = Buffer.alloc(1 + 2 + nameBuf.length + bodyBuf.length + 1)
  let o = 0
  out[o++] = TAG_COMPOUND
  out.writeUInt16BE(nameBuf.length, o); o += 2
  nameBuf.copy(out, o); o += nameBuf.length
  bodyBuf.copy(out, o); o += bodyBuf.length
  out[o] = TAG_END
  return out
}

function skipNbtValue(data: Buffer, pos: number, type: number): number {
  switch (type) {
    case TAG_BYTE: return pos + 1
    case 2: return pos + 2 // short
    case 3: return pos + 4 // int
    case 4: return pos + 8 // long
    case 5: return pos + 4 // float
    case 6: return pos + 8 // double
    case 7: { const l = data.readInt32BE(pos); return pos + 4 + l } // byte array
    case TAG_STRING: { const l = data.readUInt16BE(pos); return pos + 2 + l }
    case TAG_LIST: {
      const et = data[pos]
      const cnt = data.readInt32BE(pos + 1)
      let p = pos + 5
      for (let i = 0; i < cnt; i++) p = skipNbtValue(data, p, et)
      return p
    }
    case TAG_COMPOUND: {
      let p = pos
      while (data[p] !== TAG_END) {
        const t = data[p++]
        const nl = data.readUInt16BE(p); p += 2 + nl
        p = skipNbtValue(data, p, t)
      }
      return p + 1
    }
    case 11: { const l = data.readInt32BE(pos); return pos + 4 + l * 4 } // int array
    case 12: { const l = data.readInt32BE(pos); return pos + 4 + l * 8 } // long array
    default: return pos
  }
}

export interface InstalledServerEntry {
  name: string
  address: string
}

/** Serialize the server list to a gzip NBT servers.dat. */
export function buildServersDat(servers: InstalledServerEntry[]): Buffer {
  const entries = servers.map((s) =>
    nbtCompound('', [nbtString('name', s.name), nbtString('ip', s.address), nbtByte('acceptTextures', 1)])
  )
  const listBody = Buffer.concat(entries)
  const nameBuf = Buffer.from('servers', 'utf8')
  const list = Buffer.alloc(1 + 2 + nameBuf.length + 1 + 4 + listBody.length)
  let o = 0
  list[o++] = TAG_LIST
  list.writeUInt16BE(nameBuf.length, o); o += 2
  nameBuf.copy(list, o); o += nameBuf.length
  list[o++] = TAG_COMPOUND
  list.writeInt32BE(entries.length, o); o += 4
  listBody.copy(list, o)
  return zlib.gzipSync(nbtCompound('', [list]))
}

/** Parse a (possibly gzip) servers.dat into name/address entries. */
export function readServersDat(buf: Buffer): InstalledServerEntry[] {
  const out: InstalledServerEntry[] = []
  try {
    let data = buf
    if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) data = zlib.gunzipSync(buf)
    if (data.length < 3 || data[0] !== TAG_COMPOUND) return out
    let pos = 1
    const readName = (): string => {
      const len = data.readUInt16BE(pos); pos += 2
      const s = data.toString('utf8', pos, pos + len); pos += len
      return s
    }
    pos += 2; readName() // skip root name
    while (pos < data.length && data[pos] !== TAG_END) {
      const type = data[pos++]
      const name = readName()
      if (type === TAG_LIST && name === 'servers') {
        const elemType = data[pos++]
        const count = data.readInt32BE(pos); pos += 4
        if (elemType !== TAG_COMPOUND) break
        for (let i = 0; i < count && pos < data.length; i++) {
          const eNameLen = data.readUInt16BE(pos); pos += 2 + eNameLen
          let entry: InstalledServerEntry = { name: '', address: '' }
          while (pos < data.length && data[pos] !== TAG_END) {
            const ft = data[pos++]
            const fn = readName()
            if (ft === TAG_STRING && fn === 'name') {
              const sl = data.readUInt16BE(pos); pos += 2
              entry.name = data.toString('utf8', pos, pos + sl); pos += sl
            } else if (ft === TAG_STRING && fn === 'ip') {
              const sl = data.readUInt16BE(pos); pos += 2
              entry.address = data.toString('utf8', pos, pos + sl); pos += sl
            } else if (ft === TAG_BYTE) {
              pos += 1
            } else if (ft === TAG_STRING) {
              const sl = data.readUInt16BE(pos); pos += 2 + sl
            } else {
              pos = skipNbtValue(data, pos, ft)
            }
          }
          pos++ // entry TAG_END
          if (entry.address) out.push(entry)
        }
      } else {
        pos = skipNbtValue(data, pos, type)
      }
    }
  } catch {
    /* corrupt file - return whatever parsed */
  }
  return out
}

/** Write a server into an instance's servers.dat so it appears in-game. */
export async function installToInstance(profileId: string, address: string, name?: string): Promise<InstallServerResult> {
  const profile = await profileManager.get(profileId)
  if (!profile) throw new Error('Profile not found.')
  const clean = String(address ?? '').trim()
  if (!clean) throw new Error('Enter a server address, e.g. play.example.com:25565.')
  const serversDat = path.join(instancePath(profile), 'servers.dat')
  let servers: InstalledServerEntry[] = []
  try {
    if (fs.existsSync(serversDat)) servers = readServersDat(fs.readFileSync(serversDat))
  } catch {
    servers = []
  }
  let installed = 0
  if (!servers.some((s) => s.address === clean)) {
    servers.push({ name: (name ?? clean).trim(), address: clean })
    fs.mkdirSync(path.dirname(serversDat), { recursive: true })
    fs.writeFileSync(serversDat, buildServersDat(servers))
    installed = 1
  }
  return { installed, total: servers.length, gameDir: profile.gameDir }
}

export const serversService = { pingServer, addFavorite, removeFavorite, recordRecent, joinServer, parseAddress, discoverServers, recommendServers, installToInstance, buildServersDat, readServersDat }
