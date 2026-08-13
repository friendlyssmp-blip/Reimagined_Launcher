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

  // v1.0.95 — schema marker: v2 pre-generates the spawn area at view-distance
  // 16 so a RD-10 client NEVER generates chunks live during the benchmark
  // (the v1 world at view-distance 8 caused the whole test to measure the
  // chunk-generation storm: "Preparing spawn area: 16%" for minutes, 4s GC
  // pauses, 3-24 FPS in-world while the settled world runs at 90+). A bench
  // world missing the marker is regenerated once with the new settings.
  const marker = 'bench-gen-v2.json'
  // Structurally complete world (independent of the schema marker).
  const worldComplete = (): boolean =>
    fsMod.existsSync(pathMod.join(worldDir, 'level.dat')) &&
    fsMod.existsSync(pathMod.join(worldDir, 'data', 'minecraft', 'world_gen_settings.dat'))
  // v2 world — safe to reuse as-is.
  const worldV2 = (): boolean => worldComplete() && fsMod.existsSync(pathMod.join(worldDir, marker))

  if (worldV2()) {
    say(`  Reusing existing benchmark world "${worldName}"`)
    return
  }
  if (worldComplete()) {
    say(`  Benchmark world "${worldName}" was generated with old settings — regenerating with the v2 layout…`)
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
        // v1.0.95 — pre-generate a 16-chunk radius around spawn (covers the
        // client's RD-10 view + margin) so chunk generation never happens
        // while the benchmark measures.
        'view-distance=16',
        'simulation-distance=8',
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
        // v1.0.95 — view-distance=16 spawn pre-gen is ~4x the vd-8 area; on
        // slow 2-core machines "Done" can take several minutes. 480s budget.
        const timer = setTimeout(() => resolve(false), 480_000)
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
      // v1.0.95 — a vd-16 spawn needs a longer flush than the old vd-8 world.
      say(`  Attempt ${attempt}: spawn area generated — flushing chunks…`)
      await new Promise((r) => setTimeout(r, 40_000))
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

    if (worldComplete()) {
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
      // v1.0.95 — mark the world as v2-generated so it is reused on future runs.
      try {
        fsMod.writeFileSync(pathMod.join(worldDir, marker), JSON.stringify({ v: 2 }, null, 2))
      } catch {
        /* best-effort */
      }
      say(`  World ready at saves/${worldName}`)
      return
    }

    say('  World incomplete — retrying generation…')
  }
  throw new Error(`world generation produced an incomplete world after 2 attempts (missing world_gen_settings.dat)`)
}
