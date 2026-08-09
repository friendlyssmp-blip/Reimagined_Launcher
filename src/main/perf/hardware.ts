/**
 * Reimagined Performance Engine — hardware detection.
 *
 * Builds a complete, real hardware profile of the user's machine: CPU
 * (model/cores/threads/clock/cache), GPU (model/vendor/VRAM/integrated),
 * RAM (capacity/speed), storage type (SSD/HDD/NVMe), OS, display resolution
 * and refresh rate, and the best detected Java runtime.
 *
 * Everything is best-effort: a single PowerShell CIM query collects the
 * Windows-specific values; any failure degrades gracefully to `os`-module
 * data and never crashes the launcher. The profile is cached to
 * data/perf/hardware.json so the Settings page loads instantly.
 */
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { execFile } from 'node:child_process'
import { paths } from '../paths'
import { logger } from '../logs/logger'
import { detectJavaRuntimes } from '../minecraft/java'
import type { HardwareProfile } from '@shared/types'

// v1.0.28 — launch-time regression fix: the PowerShell CIM probe (which can
// take seconds and up to 25 s) used to re-run whenever the disk cache was
// older than 5 MINUTES — i.e. on every launch for anyone who didn't launch
// within the last 5 minutes. Hardware (CPU/GPU/RAM/driver) changes daily at
// most, so the disk cache now lives 24 h and a session-scoped in-memory
// cache makes all three per-launch detectHardware() calls free.
const CACHE_MS = 24 * 60 * 60_000
// A FAILED probe is cached only briefly (60 s) — one transient WMI/PowerShell
// hiccup must never poison every detectHardware() call for a whole day (the
// next call retries, exactly like before this pass).
const FAIL_CACHE_MS = 60_000

let memCache: { at: number; hw: HardwareProfile | null } | null = null

function cacheFile(): string {
  return path.join(paths.data, 'perf', 'hardware.json')
}

/** One batched PowerShell query for CPU/GPU/RAM/disks/chassis/OS. */
// Each command uses -ErrorAction SilentlyContinue: some WMI classes are
// missing or restricted on certain machines (e.g. Win32_PhysicalDisk on
// older Windows) — the rest of the profile must still be detected.
const PS_QUERY = `
$ErrorActionPreference = 'SilentlyContinue'
$o = @{}
$o.cpu = Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed,L2CacheSize,L3CacheSize
$o.gpu = Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | Select-Object Name,AdapterRAM,CurrentHorizontalResolution,CurrentVerticalResolution,CurrentRefreshRate,DriverVersion
$o.ram = Get-CimInstance Win32_PhysicalMemory -ErrorAction SilentlyContinue | Select-Object Capacity,Speed
$o.disk = Get-CimInstance Win32_PhysicalDisk -ErrorAction SilentlyContinue | Select-Object MediaType,Size
$o.chassis = Get-CimInstance Win32_SystemEnclosure -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ChassisTypes
$o.os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue | Select-Object Caption,Version
$o | ConvertTo-Json -Depth 4 -Compress
`.trim()

function psOnce(): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', PS_QUERY],
      { timeout: 25_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout) {
          resolve({})
          return
        }
        try {
          const parsed = JSON.parse(stdout)
          resolve(Array.isArray(parsed) ? (parsed[0] as Record<string, unknown>) ?? {} : (parsed as Record<string, unknown>))
        } catch {
          resolve({})
        }
      }
    )
  })
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** PowerShell returns a bare object when a query yields a single row — normalize to a list. */
function asArray(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v as Record<string, unknown>[]
  if (v && typeof v === 'object') return [v as Record<string, unknown>]
  return []
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function gpuVendor(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('nvidia')) return 'NVIDIA'
  if (n.includes('radeon') || n.includes('amd')) return 'AMD'
  if (n.includes('intel')) return 'Intel'
  if (n.includes('qualcomm')) return 'Qualcomm'
  return 'Unknown'
}

function gpuIntegrated(name: string): boolean {
  const n = name.toLowerCase()
  return n.includes('intel') || n.includes('amd') || n.includes('radeon') || n.includes('qualcomm')
}

function storageLabel(mediaType: unknown, sizeBytes: number): { type: string; totalGB: number } {
  const type = str(mediaType)
  if (type === 'SSD') return { type: 'SSD', totalGB: Math.round(sizeBytes / 1e9) }
  if (type === 'HDD') return { type: 'HDD', totalGB: Math.round(sizeBytes / 1e9) }
  if (type === 'Unspecified') return { type: 'SSD', totalGB: Math.round(sizeBytes / 1e9) }
  return { type: type || 'Unknown', totalGB: Math.round(sizeBytes / 1e9) }
}

function isLaptop(chassisTypes: unknown): boolean {
  if (!Array.isArray(chassisTypes)) {
    return chassisTypes === 8 || chassisTypes === 9 || chassisTypes === 10 || chassisTypes === 14
  }
  return chassisTypes.some((t) => t === 8 || t === 9 || t === 10 || t === 14)
}

/** Detect the full hardware profile (cached 5 min in memory + on disk). */
export async function detectHardware(force = false): Promise<HardwareProfile | null> {
  if (!force && memCache) {
    const ttl = memCache.hw ? CACHE_MS : FAIL_CACHE_MS
    if (Date.now() - memCache.at < ttl) return memCache.hw
  }
  try {
    if (!force) {
      try {
        const cached = JSON.parse(fs.readFileSync(cacheFile(), 'utf-8')) as HardwareProfile & { _at?: number }
        if (cached && cached.cpu && cached._at && Date.now() - cached._at < CACHE_MS) {
          memCache = { at: Date.now(), hw: cached }
          return cached
        }
      } catch {
        /* no cache yet */
      }
    }

    const wmi = await psOnce()
    const cpuList = asArray(wmi.cpu)
    const gpuList = asArray(wmi.gpu)
    const ramList = asArray(wmi.ram)
    const diskList = asArray(wmi.disk)
    const osInfo = asArray(wmi.os)[0] ?? {}

    // CPU — prefer the WMI core count; fall back to os.cpus().
    const cpus = os.cpus()
    const firstCpu = cpuList[0] ?? {}
    const cpuModel = str(firstCpu.Name) || (cpus[0]?.model ?? 'Unknown CPU')
    const cpuCores = num(firstCpu.NumberOfCores) || cpus.length
    const cpuThreads = num(firstCpu.NumberOfLogicalProcessors) || cpus.length
    const cpuSpeed = num(firstCpu.MaxClockSpeed) ? num(firstCpu.MaxClockSpeed) / 1000 : Number((cpus[0]?.speed ?? 2000) / 1000)
    const l2 = firstCpu.L2CacheSize !== undefined ? `${Math.round(num(firstCpu.L2CacheSize) / 1024)} MB` : 'n/a'
    const l3 = firstCpu.L3CacheSize !== undefined ? `${Math.round(num(firstCpu.L3CacheSize) / 1024)} MB` : 'n/a'

    // GPU — one or more controllers; sorted so the discrete one comes first.
    const gpus = gpuList
      .map((g) => {
        const name = str(g.Name) || 'Unknown GPU'
        const driverVersion = str(g.DriverVersion) || undefined
        return {
          name,
          vendor: gpuVendor(name),
          // AdapterRAM is a 32-bit field and wraps above 4 GB — cap at 24.
          vramGB: Math.min(24, Math.round(num(g.AdapterRAM) / 1024 / 1024 / 1024)),
          integrated: gpuIntegrated(name),
          driverVersion,
          resolution: `${num(g.CurrentHorizontalResolution)}×${num(g.CurrentVerticalResolution)}`,
          refreshHz: num(g.CurrentRefreshRate) || null
        }
      })
      .sort((a, b) => Number(a.integrated) - Number(b.integrated))

    const mainGpu = gpus[0]

    // RAM
    let ramTotalGB = Math.round(os.totalmem() / 1024 / 1024 / 1024)
    let ramSpeed: number | null = null
    if (ramList.length > 0) {
      ramTotalGB = Math.round(ramList.reduce((s, r) => s + num(r.Capacity), 0) / 1e9)
      ramSpeed = num(ramList[0].Speed) || null
    }

    // Storage — label from WMI plus REAL free/used space from the filesystem
    // for the drive that actually holds launcher data (v1.0.52, Bug 8).
    let storage: { type: string; totalGB: number; freeGB?: number; usedGB?: number; drive?: string } = { type: 'Unknown', totalGB: 0 }
    for (const d of diskList) {
      const st = storageLabel(d.MediaType, num(d.Size))
      // Prefer a real SSD/HDD label over Unspecified.
      if (st.type === 'SSD' || st.type === 'HDD') {
        storage = { ...st, totalGB: storage.totalGB + st.totalGB }
      }
    }
    if (storage.totalGB === 0 && diskList[0]) {
      storage = storageLabel(diskList[0].MediaType, num(diskList[0].Size))
    }
    try {
      const driveRoot = path.parse(paths.data).root || (process.platform === 'win32' ? 'C:\\' : '/')
      const st = fs.statfsSync(driveRoot)
      const total = st.blocks * st.bsize
      storage.freeGB = Math.round((st.bavail * st.bsize) / 1e9)
      storage.usedGB = Math.round((total - st.bfree * st.bsize) / 1e9)
      storage.drive = driveRoot
    } catch {
      /* non-fatal — the Settings row falls back to the label + total */
    }

    // Java (best detected runtime)
    let java: HardwareProfile['java'] = null
    try {
      const runtimes = detectJavaRuntimes()
      if (runtimes.length > 0) {
        java = { major: runtimes[0].major, version: runtimes[0].version }
      }
    } catch {
      /* non-fatal */
    }

    const hw: HardwareProfile = {
      detectedAt: new Date().toISOString(),
      cpu: { model: cpuModel, cores: cpuCores, threads: cpuThreads, speedGHz: Math.round(cpuSpeed * 10) / 10, cache: `L2 ${l2} · L3 ${l3}` },
      gpu: gpus.map(({ name, vendor, vramGB, integrated, driverVersion }) => ({ name, vendor, vramGB, integrated, driverVersion })),
      memory: { totalGB: ramTotalGB, speedMHz: ramSpeed },
      storage,
      os: `${str(osInfo.Caption) || os.type()} ${str(osInfo.Version) || os.release()}`,
      display: { resolution: mainGpu?.resolution ?? 'Unknown', refreshHz: mainGpu?.refreshHz ?? null },
      java,
      laptop: isLaptop(wmi.chassis)
    }

    try {
      fs.mkdirSync(path.dirname(cacheFile()), { recursive: true })
      fs.writeFileSync(cacheFile(), JSON.stringify({ ...hw, _at: Date.now() }, null, 2), 'utf-8')
    } catch {
      /* cache is best-effort */
    }
    memCache = { at: Date.now(), hw }

    logger.info(`RPE hardware: ${hw.cpu.threads}T/${hw.cpu.cores}C ${hw.cpu.model.split('@')[0].trim().slice(0, 40)} · ${hw.gpu.map((g) => g.name.slice(0, 30)).join(' + ') || 'no GPU'} · ${hw.memory.totalGB} GB RAM · ${hw.storage.type} · ${hw.laptop ? 'laptop' : 'desktop'}`)
    return hw
  } catch (err) {
    memCache = { at: Date.now(), hw: null }
    logger.warn(`RPE hardware detection failed: ${(err as Error).message}`)
    return null
  }
}
