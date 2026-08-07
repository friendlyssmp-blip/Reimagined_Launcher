/**
 * Minimal ZIP archive support (no external dependencies).
 *
 * `zipCreate` writes STORE (uncompressed) entries with UTF-8 names — more
 * than enough for the small profile-manifest packages Reimagined exports.
 * `zipReadEntry` parses the central directory and supports STORE and DEFLATE
 * methods, so it can also read archives produced by other tools.
 */
import { crc32, inflateRawSync } from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50

interface Entry {
  name: string
  data: Buffer
}

/** Build a ZIP archive buffer from a list of named entries. */
export function zipCreate(files: { name: string; data: Buffer | string }[]): Buffer {
  const entries: Entry[] = files.map((f) => ({
        name: f.name.split(String.fromCharCode(92)).join('/'),
    data: Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf-8')
  }))

  const chunks: Buffer[] = []
  const central: Buffer[] = []
  const centralSizes: number[] = []
  let offset = 0

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf-8')
    const crc = crc32(e.data) >>> 0
    const size = e.data.length

    // Local file header
    const local = Buffer.alloc(30)
    local.writeUInt32LE(SIG_LOCAL, 0)
    local.writeUInt16LE(20, 4) // version needed to extract
    local.writeUInt16LE(0x0800, 6) // general purpose flag: UTF-8 names
    local.writeUInt16LE(0, 8) // method: store
    local.writeUInt16LE(0, 10) // mod time
    local.writeUInt16LE(0, 12) // mod date
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(size, 18) // compressed size
    local.writeUInt32LE(size, 22) // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // extra len
    chunks.push(local, nameBuf, e.data)

    // Central directory entry
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(SIG_CENTRAL, 0)
    cd.writeUInt16LE(20, 4) // version made by
    cd.writeUInt16LE(20, 6) // version needed
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(0, 10) // method: store
    cd.writeUInt16LE(0, 12)
    cd.writeUInt16LE(0, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(size, 20)
    cd.writeUInt32LE(size, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt16LE(0, 30) // extra len
    cd.writeUInt16LE(0, 32) // comment len
    cd.writeUInt16LE(0, 34) // disk start
    cd.writeUInt16LE(0, 36) // internal attrs
    cd.writeUInt32LE(0, 38) // external attrs
    cd.writeUInt32LE(offset, 42) // local header offset
    central.push(cd, nameBuf)
    centralSizes.push(46 + nameBuf.length)

    offset += 30 + nameBuf.length + size
  }

  const cdSize = centralSizes.reduce((a, b) => a + b, 0)
  const cdOffset = offset
  chunks.push(...central)

  // End of central directory
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(SIG_EOCD, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cdSize, 12)
  eocd.writeUInt32LE(cdOffset, 16)
  eocd.writeUInt16LE(0, 20)
  chunks.push(eocd)

  return Buffer.concat(chunks)
}

/** Read a single named entry out of a ZIP archive buffer. */
export function zipReadEntry(archive: Buffer, wanted: string): Buffer | null {
  if (archive.length < 22) return null

  // Locate the end-of-central-directory record (scan the tail).
  const tailStart = Math.max(0, archive.length - 65557)
  let eocdAt = -1
  for (let i = archive.length - 22; i >= tailStart; i--) {
    if (archive.readUInt32LE(i) === SIG_EOCD) {
      eocdAt = i
      break
    }
  }
  if (eocdAt < 0) return null

  const entryCount = archive.readUInt16LE(eocdAt + 10)
  let cdOffset = archive.readUInt32LE(eocdAt + 16)
  if (cdOffset >= archive.length) return null

  for (let i = 0; i < entryCount; i++) {
    if (cdOffset + 46 > archive.length) return null
    if (archive.readUInt32LE(cdOffset) !== SIG_CENTRAL) return null

    const method = archive.readUInt16LE(cdOffset + 10)
    const csize = archive.readUInt32LE(cdOffset + 20)
    const usize = archive.readUInt32LE(cdOffset + 24)
    const nameLen = archive.readUInt16LE(cdOffset + 28)
    const extraLen = archive.readUInt16LE(cdOffset + 30)
    const commentLen = archive.readUInt16LE(cdOffset + 32)
    const localOffset = archive.readUInt32LE(cdOffset + 42)
    const name = archive.subarray(cdOffset + 46, cdOffset + 46 + nameLen).toString('utf-8')

    if (name === wanted) {
      if (localOffset + 30 > archive.length) return null
      const lNameLen = archive.readUInt16LE(localOffset + 26)
      const lExtraLen = archive.readUInt16LE(localOffset + 28)
      const dataStart = localOffset + 30 + lNameLen + lExtraLen
      const data = archive.subarray(dataStart, dataStart + csize)
      if (method === 0) return Buffer.from(data)
      if (method === 8) {
        try {
          return inflateRawSync(data, { maxOutputLength: Math.max(usize, 1_048_576) })
        } catch {
          return null
        }
      }
      return null // unsupported method
    }

    cdOffset += 46 + nameLen + extraLen + commentLen
  }
  return null
}

/**
 * Extract every entry of a ZIP archive into `destDir`.
 * Path traversal is blocked (absolute paths, drive letters, `..` segments), so
 * an archive from an untrusted source can never write outside the target.
 * Returns the list of files written.
 */
export function zipExtractAll(archive: Buffer, destDir: string): string[] {
  const written: string[] = []
  if (archive.length < 22) return written

  const tailStart = Math.max(0, archive.length - 65557)
  let eocdAt = -1
  for (let i = archive.length - 22; i >= tailStart; i--) {
    if (archive.readUInt32LE(i) === SIG_EOCD) {
      eocdAt = i
      break
    }
  }
  if (eocdAt < 0) return written

  const entryCount = archive.readUInt16LE(eocdAt + 10)
  let cdOffset = archive.readUInt32LE(eocdAt + 16)

  for (let i = 0; i < entryCount && cdOffset + 46 <= archive.length; i++) {
    if (archive.readUInt32LE(cdOffset) !== SIG_CENTRAL) break
    const method = archive.readUInt16LE(cdOffset + 10)
    const csize = archive.readUInt32LE(cdOffset + 20)
    const usize = archive.readUInt32LE(cdOffset + 24)
    const nameLen = archive.readUInt16LE(cdOffset + 28)
    const extraLen = archive.readUInt16LE(cdOffset + 30)
    const commentLen = archive.readUInt16LE(cdOffset + 32)
    const localOffset = archive.readUInt32LE(cdOffset + 42)
    const name = archive.subarray(cdOffset + 46, cdOffset + 46 + nameLen).toString('utf-8')
    cdOffset += 46 + nameLen + extraLen + commentLen

    const clean = name.replace(/\\/g, '/')
    if (!clean || clean.startsWith('/') || /^[a-zA-Z]:/.test(clean)) continue
    if (clean.split('/').includes('..')) continue

    const dest = path.join(destDir, clean)
    if (clean.endsWith('/')) {
      fs.mkdirSync(dest, { recursive: true })
      continue
    }
    if (localOffset + 30 > archive.length) continue

    const lNameLen = archive.readUInt16LE(localOffset + 26)
    const lExtraLen = archive.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + lNameLen + lExtraLen
    const data = archive.subarray(dataStart, dataStart + csize)
    let out: Buffer | null = null
    if (method === 0) out = Buffer.from(data)
    else if (method === 8) {
      try {
        // The whole archive is already in memory, so cap at the declared
        // uncompressed size (no silent drops of large assets).
        out = inflateRawSync(data, { maxOutputLength: Math.max(usize, 64 * 1024) })
      } catch {
        out = null
      }
    }
    if (!out) continue

    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, out)
      written.push(dest)
    } catch {
      /* skip entries that fail to write */
    }
  }
  return written
}

/**
 * Extract only the entries under `prefix/` of a ZIP archive into `destDir`,
 * stripping the prefix from each path (used to apply a CurseForge modpack's
 * `overrides/` folder into an instance). Path traversal is blocked the same
 * way as `zipExtractAll`. Returns the list of files written.
 */
export function zipExtractPrefix(archive: Buffer, prefix: string, destDir: string): string[] {
  const written: string[] = []
  const pre = prefix.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!pre || archive.length < 22) return written

  const tailStart = Math.max(0, archive.length - 65557)
  let eocdAt = -1
  for (let i = archive.length - 22; i >= tailStart; i--) {
    if (archive.readUInt32LE(i) === SIG_EOCD) {
      eocdAt = i
      break
    }
  }
  if (eocdAt < 0) return written

  const entryCount = archive.readUInt16LE(eocdAt + 10)
  let cdOffset = archive.readUInt32LE(eocdAt + 16)

  for (let i = 0; i < entryCount && cdOffset + 46 <= archive.length; i++) {
    if (archive.readUInt32LE(cdOffset) !== SIG_CENTRAL) break
    const method = archive.readUInt16LE(cdOffset + 10)
    const csize = archive.readUInt32LE(cdOffset + 20)
    const usize = archive.readUInt32LE(cdOffset + 24)
    const nameLen = archive.readUInt16LE(cdOffset + 28)
    const extraLen = archive.readUInt16LE(cdOffset + 30)
    const commentLen = archive.readUInt16LE(cdOffset + 32)
    const localOffset = archive.readUInt32LE(cdOffset + 42)
    const name = archive.subarray(cdOffset + 46, cdOffset + 46 + nameLen).toString('utf-8')
    cdOffset += 46 + nameLen + extraLen + commentLen

    const clean = name.replace(/\\/g, '/')
    if (!clean.startsWith(pre + '/')) continue
    const rel = clean.slice(pre.length + 1)
    if (!rel || rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) continue
    if (rel.split('/').includes('..')) continue

    const dest = path.join(destDir, rel)
    if (clean.endsWith('/')) {
      fs.mkdirSync(dest, { recursive: true })
      continue
    }
    if (localOffset + 30 > archive.length) continue

    const lNameLen = archive.readUInt16LE(localOffset + 26)
    const lExtraLen = archive.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + lNameLen + lExtraLen
    const data = archive.subarray(dataStart, dataStart + csize)
    let out: Buffer | null = null
    if (method === 0) out = Buffer.from(data)
    else if (method === 8) {
      try {
        out = inflateRawSync(data, { maxOutputLength: Math.max(usize, 64 * 1024) })
      } catch {
        out = null
      }
    }
    if (!out) continue

    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, out)
      written.push(dest)
    } catch {
      /* skip entries that fail to write */
    }
  }
  return written
}
