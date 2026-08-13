/**
 * Shared benchmark world generation.
 *
 * Extracted from the CLI bench harness (v1.0.92) so both the headless
 * `--bench` flow AND the user-facing "Run a FPS Test" (Account) reuse the
 * exact same deterministic world builder: a dedicated `reimagined-bench`
 * save generated once via the bundled dedicated server, never touching any
 * real user world.
 */
import type { Profile } from '@shared/types'
import { instancePath } from '../instances/paths'

/**
 * Generates a deterministic benchmark world for a profile (one-time).
 *
 * A usable world has both the level data AND the world-gen settings the
 * client needs to build its dimensions (missing settings = "Overworld
 * settings missing" when the client tries to open the world).
 */
export async function ensureBenchWorld(profile: Profile, worldName: string, say: (s: string) => void): Promise<void> {
  const pathMod = await import('node:path')
  const fsMod = await import('node:fs')
  const gameDir = instancePath(profile)
  const savesDir = pathMod.join(gameDir, 'saves')
  const worldDir = pathMod.join(savesDir, worldName)

  // A usable world has both the level data AND the world-gen settings the
  // client needs to build its dimensions (missing settings = "Overworld
  // settings missing" when the client tries to open the world).
  const worldReady = (): boolean =>
    fsMod.existsSync(pathMod.join(worldDir, 'level.dat')) &&
    fsMod.existsSync(pathMod.join(worldDir, 'data', 'minecraft', 'world_gen_settings.dat'))

  if (worldReady()) {
    say(`  Reusing existing benchmark world "${worldName}"`)
    return
  }

  say(`  Generating benchmark world "${worldName}" (headless dedicated server, one-time)…`)
  const versionId = `${profile.minecraftVersion}-fabric-${profile.loader.version}`
  const { versionManager } = await import('../minecraft/version-manager')
  const { classpath } = await versionManager.ensureLibraries(versionId, () => undefined)
  const clientJar = await versionManager.ensureClient(versionId)
  const { pickJava } = await import('../minecraft/java')
  const java = (await pickJava(25)) ?? (await pickJava(21)) ?? (await pickJava(17))
  if (!java) throw new Error('no Java runtime found for world generation')

  const sep = process.platform === 'win32' ? ';' : ':'
  const cp = [...classpath, clientJar].join(sep)
  const { spawn } = await import('node:child_process')

  // Two attempts — a partial world from an interrupted run is wiped and retried.
  for (let attempt = 1; attempt <= 2; attempt++) {
    fsMod.rmSync(worldDir, { recursive: true, force: true })
    fsMod.mkdirSync(savesDir, { recursive: true })
    fsMod.writeFileSync(pathMod.join(savesDir, 'eula.txt'), 'eula=true\n')
    fsMod.writeFileSync(
      pathMod.join(savesDir, 'server.properties'),
      [
        `level-name=${worldName}`,
        'level-seed=42',
        'online-mode=false',
        'max-tick-time=-1',
        'view-distance=8',
        'simulation-distance=6',
        'gamemode=creative',
        'spawn-protection=0',
        'sync-chunk-writes=false',
        'server-port=25599'
      ].join('\n') + '\n'
    )

    const child = spawn(java.path, ['-Xmx2G', '-cp', cp, 'net.minecraft.server.Main', '--nogui'], {
      cwd: savesDir,
      windowsHide: true,
      env: { ...process.env }
    })
    try {
      const done = await new Promise<boolean>((resolve) => {
        let out = ''
        const timer = setTimeout(() => resolve(false), 240_000)
        const check = (): void => {
          if (out.includes('Done')) {
            clearTimeout(timer)
            resolve(true)
          }
        }
        child.stdout?.on('data', (d: Buffer) => {
          out += d.toString('utf-8')
          check()
        })
        child.stderr?.on('data', (d: Buffer) => {
          out += d.toString('utf-8')
          check()
        })
        child.on('close', () => {
          clearTimeout(timer)
          resolve(out.includes('Done'))
        })
      })
      if (!done) {
        if (attempt === 2) throw new Error('world generation did not complete ("Done" never appeared)')
        continue
      }

      // Let the server flush its chunk/world writes before killing it — on
      // Windows a process kill is forced (no shutdown hooks), so the settle
      // window is what guarantees world_gen_settings.dat + spawn regions exist.
      say(`  Attempt ${attempt}: spawn area generated — flushing chunks…`)
      await new Promise((r) => setTimeout(r, 25_000))
    } finally {
      // Never leave a world-gen server running, whatever happened above.
      if (child.exitCode === null) {
        try {
          child.kill('SIGTERM')
        } catch {
          /* already dead */
        }
      }
    }

    if (worldReady()) {
      // Windows can briefly hold handles to the server's log files after the
      // process dies — cleanup is best-effort and must never crash the bench.
      await new Promise((r) => setTimeout(r, 2000))
      const tryClean = (p: string): void => {
        try {
          fsMod.rmSync(p, { recursive: true, force: true })
        } catch {
          /* locked by the dying process — harmless */
        }
      }
      tryClean(pathMod.join(savesDir, 'eula.txt'))
      tryClean(pathMod.join(savesDir, 'server.properties'))
      tryClean(pathMod.join(savesDir, 'logs'))
      say(`  World ready at saves/${worldName}`)
      return
    }

    say('  World incomplete — retrying generation…')
  }
  throw new Error(`world generation produced an incomplete world after 2 attempts (missing world_gen_settings.dat)`)
}
