/**
 * Forge support.
 *
 * Forge does not publish a simple meta API. Modern Forge (1.13+) is
 * installed by running its official installer with `--installClient`,
 * which generates a proper version JSON and libraries inside the shared
 * games folder. That JSON is then launched like a vanilla version.
 */
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { paths } from '../../paths'
import { exists, mkdirp, sizeOf, remove } from '../../utils/fs'
import { getJson } from '../../utils/http'
import { logger } from '../../logs/logger'
import { runDownloadBatch } from '../downloader'
import { pickJava } from '../java'

const PROMOTIONS_URL = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json'
const MAVEN_BASE = 'https://maven.minecraftforge.net'
const INSTALLER_DIR = () => path.join(paths.runtime, 'installers')

interface Promotions {
  promos: Record<string, string>
}

/** List Forge build numbers available for a Minecraft version, newest first. */
export async function getForgeVersions(mcVersion: string): Promise<string[]> {
  const promotions = await getJson<Promotions>(PROMOTIONS_URL, { timeoutMs: 20_000 })
  const versions = new Set<string>()
  for (const [key, value] of Object.entries(promotions.promos)) {
    if (key.startsWith(`${mcVersion}-`)) versions.add(value)
  }
  return [...versions].sort((a, b) => Number(b) - Number(a)).slice(0, 40)
}

export async function recommendedForgeVersion(mcVersion: string): Promise<string | null> {
  const promotions = await getJson<Promotions>(PROMOTIONS_URL, { timeoutMs: 20_000 })
  return promotions.promos[`${mcVersion}-recommended`] ?? promotions.promos[`${mcVersion}-latest`] ?? null
}

export interface InstalledForge {
  versionId: string
  forgeVersion: string
}

/**
 * Install Forge for a Minecraft version by running the official installer.
 * Returns the version id created by the installer, e.g. `1.21.4-forge-52.0.25`.
 */
export async function installForge(mcVersion: string, forgeVersion: string): Promise<InstalledForge> {
  const versionId = `${mcVersion}-forge-${forgeVersion}`
  const targetDir = path.join(paths.versions, versionId)
  if (exists(path.join(targetDir, `${versionId}.json`))) {
    logger.info(`Forge ${forgeVersion} already installed (${versionId})`)
    return { versionId, forgeVersion }
  }

  // Required Java: modern Forge (MC 1.13+ / generations 13+) needs 17+, older versions 8.
  const genMatch = mcVersion.match(/^(?:1\.)?(\d+)/)
  const generation = genMatch ? parseInt(genMatch[1], 10) : 0
  const requiredMajor = generation >= 13 ? 17 : 8
  const java = pickJava(requiredMajor)
  if (!java) throw new Error(`No Java ${requiredMajor}+ found to run the Forge installer`)

  const installerUrl = `${MAVEN_BASE}/net/minecraftforge/forge/${mcVersion}-${forgeVersion}/forge-${mcVersion}-${forgeVersion}-installer.jar`
  const installerFile = path.join(INSTALLER_DIR(), `forge-${mcVersion}-${forgeVersion}-installer.jar`)

  mkdirp(INSTALLER_DIR())
  if ((await sizeOf(installerFile)) < 1_000_000) {
    logger.info(`Downloading Forge installer for ${mcVersion}-${forgeVersion}`)
    await runDownloadBatch(
      [{ url: installerUrl, dest: installerFile }],
      { kind: 'installer', label: `Forge ${forgeVersion} installer` }
    )
  }

  // The Forge installer refuses to run when the target directory has no
  // launcher_profiles.json ("you need to run the launcher first!"). Provide a
  // minimal valid profile file before installing.
  const launcherProfiles = path.join(paths.games, 'launcher_profiles.json')
  if (!exists(launcherProfiles)) {
    fs.writeFileSync(
      launcherProfiles,
      JSON.stringify(
        {
          profiles: {},
          selectedProfile: '(Default)',
          clientToken: randomUUID(),
          version: 3
        },
        null,
        2
      ),
      'utf-8'
    )
    logger.info('Created launcher_profiles.json for the Forge installer')
  }

  // Run the installer headlessly. It writes libraries/ + versions/ itself.
  logger.info(`Running Forge installer (java ${java.major}) for ${versionId}`)
  const output = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(
      java.path,
      ['-jar', installerFile, '--installClient', paths.games],
      { cwd: paths.games, timeout: 0, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const combined = `${String(stdout)}\n${String(stderr)}`
        if (err) {
          reject(new Error(`Forge installer failed: ${err.message}\n${combined.slice(-800)}`))
          return
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) })
      }
    )
  })

  // The installer prints "There was an error during installation" to stdout
  // even with exit code 0 — treat that as a failure with the real reason.
  const combined = `${output.stdout}\n${output.stderr}`
  if (combined.includes('There was an error during installation')) {
    const reason = output.stderr.split('\n').filter(Boolean).slice(-6).join('\n') || output.stdout.split('\n').filter(Boolean).slice(-6).join('\n')
    logger.error(`Forge installer reported an error:\n${combined.slice(-2000)}`)
    throw new Error(`Forge installer failed. ${reason}`)
  }

  if (!exists(path.join(targetDir, `${versionId}.json`))) {
    throw new Error(`Forge installer completed but version ${versionId} was not created`)
  }

  logger.info(`Forge ${forgeVersion} installed (${versionId})`)
  return { versionId, forgeVersion }
}
