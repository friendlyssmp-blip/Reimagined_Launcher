import pathlib

EM = '\u2014'  # em dash used in TS comments/strings

# ---------------- 1) shared/types.ts: new setting field ----------------
p = pathlib.Path('src/shared/types.ts')
s = p.read_text(encoding='utf-8')
old = """  unlimitedFps: boolean
  /** Recently performed activities shown on the Home page. */"""
new = """  unlimitedFps: boolean
  /** v1.0.43 %s force VSync off in options.txt on launch (uncaps 60 Hz panels). */
  forceVsyncOff: boolean
  /** Recently performed activities shown on the Home page. */""" % EM
assert old in s, 'types anchor'
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8', newline='')
print('shared/types.ts patched')

# ---------------- 2) settings-manager.ts: default ----------------
p = pathlib.Path('src/main/settings/settings-manager.ts')
s = p.read_text(encoding='utf-8')
old = """  unlimitedFps: false,
  // v1.0.29 %s Extended View: on by default (genuinely low-cost, purely additive""" % EM
new = """  unlimitedFps: false,
  // v1.0.43 %s force VSync off in options.txt on launch: with VSync on a
  // 60 Hz panel caps FPS at 60 no matter the frame cap. Opt-in, off by default.
  forceVsyncOff: false,
  // v1.0.29 %s Extended View: on by default (genuinely low-cost, purely additive""" % (EM, EM)
assert old in s, 'settings-manager anchor'
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8', newline='')
print('settings-manager.ts patched')

# ---------------- 3) engine.ts: applyVsyncSetting helper ----------------
p = pathlib.Path('src/main/perf/engine.ts')
s = p.read_text(encoding='utf-8')
old = """    logger.info(`RPE: frame-rate cap ${cap} FPS applied for this session.`)
  } catch (err) {
    logger.warn('RPE: could not apply frame-rate cap: ' + (err as Error).message)
  }
}"""
new = """    logger.info(`RPE: frame-rate cap ${cap} FPS applied for this session.`)
  } catch (err) {
    logger.warn('RPE: could not apply frame-rate cap: ' + (err as Error).message)
  }
}

/**
 * v1.0.43 %s force VSync off in an instance's real options.txt. A 60 Hz panel
 * with VSync on caps the game at 60 FPS regardless of the frame cap, so when
 * the user enables "force VSync off" the launcher rewrites the enableVsync
 * line on every launch. Never touches any other setting.
 */""" % EM
assert old in s, 'engine applyFrameCap end anchor'
s = s.replace(old, new, 1)

helper = """
export function applyVsyncSetting(gameDir: string, forceOff: boolean): void {
  if (!forceOff) return
  try {
    const file = path.join(gameDir, 'options.txt')
    let content = ''
    try {
      content = fs.readFileSync(file, 'utf-8')
    } catch {
      content = ''
    }
    const patched = content.replace(/^enableVsync:.*$/m, 'enableVsync:false')
    if (patched === content) {
      fs.writeFileSync(file, content + '\\nenableVsync:false\\n', 'utf-8')
    } else {
      fs.writeFileSync(file, patched, 'utf-8')
    }
    logger.info('RPE: VSync forced off for this session (user setting).')
  } catch (err) {
    logger.warn('RPE: could not force VSync off: ' + (err as Error).message)
  }
}"""
# insert helper right after the applyFrameCap closing brace
marker = "}\n\n/* ------------------------------ sessions & learning ------------------------------ */"
assert marker in s, 'engine helper insertion marker'
s = s.replace(marker, helper + "\n\n" + marker, 1)
p.write_text(s, encoding='utf-8', newline='')
print('engine.ts patched')

# ---------------- 4) launcher.ts: apply vsync + confirmation logs ----------------
p = pathlib.Path('src/main/minecraft/launcher.ts')
s = p.read_text(encoding='utf-8')
old = """      } else {
        fs.writeFileSync(path.join(dir, 'reimagined-fps-boost.json'), JSON.stringify(config, null, 2))
        rpe.applyFrameCap(gameDir, Number(config.maxFps) || 120)
        logger.info(`RPE: seeded FPS Boost config for tier "${tier}" (render cap ${String(config.smartRdCap)}, fps cap ${String(config.maxFps)})`)
      }"""
new = """      } else {
        fs.writeFileSync(path.join(dir, 'reimagined-fps-boost.json'), JSON.stringify(config, null, 2))
        rpe.applyFrameCap(gameDir, Number(config.maxFps) || 120)
        logger.info(`RPE: seeded FPS Boost config for tier "${tier}" (render cap ${String(config.smartRdCap)}, fps cap ${String(config.maxFps)})`)
      }
      // v1.0.43 %s VSync: a 60 Hz panel with VSync on caps FPS at 60 no matter
      // the frame cap. When the user enables "force VSync off" the launcher
      // rewrites the enableVsync line so the game runs at the unlocked rate.
      rpe.applyVsyncSetting(gameDir, s.forceVsyncOff ?? false)
      // v1.0.43 %s launch confirmation log: the ACTUAL state the game will
      // start with (options.txt maxFps + vsync) and the FPS Boost jar present.
      try {
        const opt = fs.readFileSync(path.join(gameDir, 'options.txt'), 'utf-8')
        const mf = opt.match(/^maxFps:(\\d+)/m)
        const vs = opt.match(/^enableVsync:(\\w+)/m)
        logger.info(`RPE: launch FPS state -> options.txt maxFps=${mf ? mf[1] : 'n/a'} enableVsync=${vs ? vs[1] : 'n/a'} unlimitedFps=${String(settingsManager.get().unlimitedFps)} tier=${tier}`)
      } catch {
        logger.info('RPE: launch FPS state -> options.txt not readable yet')
      }
      try {
        const mdir = path.join(gameDir, 'mods')
        const jars = fs.existsSync(mdir)
          ? fs.readdirSync(mdir).filter((f) => f.startsWith('Reimagined FPS Boost-') && f.endsWith('.jar'))
          : []
        logger.info(`RPE: FPS Boost jars in mods/ -> ${jars.length ? jars.join(', ') : 'none'}`)
      } catch {
        /* best-effort */
      }""" % (EM, EM)
assert old in s, 'launcher seed block anchor'
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8', newline='')
print('launcher.ts patched')

# ---------------- 5) fps-boost.ts: stale jar sweep ----------------
p = pathlib.Path('src/main/mods/fps-boost.ts')
s = p.read_text(encoding='utf-8')
old = """  try {
    // Re-read the store so concurrent writers (e.g. ensureFabricApi) never
    // clobber each other's mods list.
    const fresh = await profileManager.get(profile.id)"""
new = """  try {
    // v1.0.43 %s sweep stale bundled jars (older versions left on disk by
    // previous launcher versions or lost profile entries) so instances never
    // accumulate dead FPS Boost copies.
    try {
      if (fs.existsSync(modsDir)) {
        for (const f of fs.readdirSync(modsDir)) {
          if (f.startsWith('Reimagined FPS Boost-') && f !== FPS_BOOST_FILENAME) {
            fs.rmSync(path.join(modsDir, f), { force: true })
            logger.info(`Reimagined FPS Boost: removed stale jar ${f}`)
          }
        }
      }
    } catch {
      /* best-effort: a locked or missing mods dir is not an error */
    }
    // Re-read the store so concurrent writers (e.g. ensureFabricApi) never
    // clobber each other's mods list.
    const fresh = await profileManager.get(profile.id)""" % EM
assert old in s, 'fps-boost sweep anchor'
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8', newline='')
print('fps-boost.ts patched')

# ---------------- 6) SettingsPage.tsx: VSync toggle ----------------
p = pathlib.Path('src/renderer/src/pages/SettingsPage.tsx')
s = p.read_text(encoding='utf-8')
old = """        {/* v1.0.26 %s recording/streaming guidance (borderless fullscreen is""" % EM
new = """        {/* v1.0.43 %s VSync: a 60 Hz panel with VSync on caps FPS at 60 no
            matter the frame cap; this forces it off for unlocked frames. */}
        <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <Toggle
            checked={settings.forceVsyncOff ?? false}
            onChange={(v) => {
              void updateSettings({ forceVsyncOff: v })
              notify('success', v ? 'VSync forced off' : 'VSync left to the game', v ? 'The launcher will write enableVsync:false into options.txt on the next launch so your monitor refresh rate cannot cap the FPS.' : 'VSync is left exactly as you set it in the game.')
            }}
            label="Force VSync off (unlock to your monitor-free FPS)"
          />
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.5 }}>
            With VSync on, a 60 Hz monitor caps the game at 60 FPS no matter the frame cap. Enabling this makes the launcher write enableVsync:false on every launch %s useful on high-refresh panels with unlocked FPS.
          </div>
        </div>

        {/* v1.0.26 %s recording/streaming guidance (borderless fullscreen is""" % (EM, EM, EM)
assert old in s, 'SettingsPage anchor'
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8', newline='')
print('SettingsPage.tsx patched')
print('ALL PATCHES APPLIED')
