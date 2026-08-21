## v2.1.3 - Legacy Fabric support fixed (no more 404 on MC ≤1.13.2)

### Legacy Fabric loader versions now load correctly

- When creating a profile for any Minecraft version ≤1.13.2 with Fabric, the
  launcher was hardcoded to download intermediary mappings from Fabric's normal
  Maven (`maven.fabricmc.net`), which doesn't host Legacy Fabric artifacts —
  every launch crashed with HTTP 404.
- The launcher now detects when a Minecraft version falls in the Legacy Fabric
  range and uses the correct Maven (`maven.legacyfabric.net`) + meta API
  (`meta.legacyfabric.net`) for all intermediary and loader downloads.
- Legacy Fabric profiles now display a **"Fabric (Legacy)"** badge across the
  Home page, profile cards, and the loader version selector so users can
  immediately see which ecosystem they're running.
- The share/compact-code system also now uses the correct Legacy Fabric meta API
  for affected versions.

### Keybinds scanner no longer blocks the main thread

- The keybinds page scan reads every mod jar to extract key-binding metadata;
  previously this ran synchronously (blocking the entire launcher UI) when
  hundreds of jars were installed.
- The scan is now fully async with a bounded concurrency pool and event-loop
  yields, so the launcher stays responsive.

---

## v2.1.2 - Storage scan no longer freezes the launcher + duplicate mods healed on disk + external links open in the browser

### Clear Up Space no longer freezes the launcher ("Not Responding")

- The storage scan previously ran every file-operation synchronously on the
  main process thread, so a large data directory blocked the whole launcher as
  "Not Responding" and the file counter sat at "0 files" until the very end.
- The entire scan is now fully asynchronous (fs/promises with periodic
  event-loop yields), so it can never block the UI.
- The renderer streams **real-time progress** (files counted + the current
  directory being scanned) instead of a frozen counter.

### Duplicate mods in Installed are now healed permanently

- The installed-mods list could show the same mod several times (real case:
  "Better Block Entities" listed twice). The old dedupe collapsed them in
  memory but never wrote the fix back to disk, so they reappeared on restart.
- Now every reconciliation (removed-missing, dedupe, unlinked-item demotion)
  is persisted to the profile, so on-disk duplicates are cured once and for all.

### External links open in the system browser, never stranded in-app

- Links inside CurseForge/Modrinth descriptions (and fixed detail links like
  Report issues / View source / Discord) could navigate the launcher in place,
  showing an external page with no back button. All sanitized anchors now
  force `target=_blank` + `rel=noopener noreferrer`.
- Added a `will-navigate` safety net in the main window that catches any
  in-place navigation to an external http(s) site and opens it in the default
  browser instead.

## v2.1.1 - Keybinds grouped by their real mod + false-update fix (Physics Mod Pro) + polish pass

### Keybinds — every keybind now lives in its real mod's category

- Keybinds are grouped by the mod that actually registers them, resolved from each
  mod's own language files: **Xaero's Minimap**, **Xaero's World Map**, **Voice Chat**,
  **Jade**, **Physics Mod**, **Essential**, **Iris**, **Gamma Utils**, **Flashback** and more
  (verified against the user's real instance: 168 keybinds, zero "Other" leftovers).
- Xaero's Minimap and World Map keys are cleanly separated (minimap keys never leak into
  the World Map group again).
- Raw ids like `keybind.name.ESSENTIAL_FRIENDS` no longer appear anywhere — labels are
  resolved from the game/mod lang files, title-cased ("Essential Friends"), and the
  physics-mod keys get readable names (Grab Object, Toggle Physics, Physics Menu…).
- `caps.lock` (Zoomify's Zoom) now shows as "Caps Lock".

### Updates — false "Update available" badges are gone for good

- **Physics Mod Pro is no longer mistaken for the free Physics Mod.** The manual jar
  declares the same `fabric.mod.json` id (`physicsmod`), so the old id/name matching
  linked it to the wrong Modrinth project and flagged a fake update. Manual mods are now
  only linked to a provider by an EXACT SHA-1 match (the file provably IS a published
  file); everything else stays "Manual install — no linked source" and never participates
  in update checks.
- Existing wrongly-linked entries are healed automatically: a provider-tracked item
  without a real versionId is demoted back to manual on the next Installed open, and
  any stale update badge is cleared.
- Update checks now also skip any provider item without a versionId as a second safety
  net — an unlinked install can never be flagged.

### Downloads — real artwork everywhere

- Version-specific installs (detail page / change version / instance picker) now pass the
  project's real icon to the Downloads section — previously only the generic download
  arrow appeared for those.
- Modpack installs (Modrinth and CurseForge) now show the pack's real cover art too.

### Settings → Credits → About — clearer and actionable

- About is now two clearly-labelled blocks: **Description** and **Data Directory**, with
  working **Open Folder** and **Copy Path** buttons on the path (no more bare text).

### Settings → Performance — readable and honest

- "Recommended memory" (GB) and "learned from N sessions" are now on separate lines so
  a coincidental match (17 sessions vs 17 GB system RAM) can never read as one variable
  reused for the other; the tier notes now say "system RAM" explicitly.
- Toggle explanations sit clearly below each switch with more air and a subtle guide
  line — no more wall of text glued to the toggle.
- The tier reasons got a "Why this profile" header so they read as what they are.

### Title-bar music player — comfortable to use

- The mini player has more air between elements, a fixed-width title with ellipsis, and a
  volume slider with a ~2× taller drag hitbox (the visual track stays thin).

### Launch state — can never get stuck on "Launching…"

- Launch state is reset to idle on every fresh start (never carried from a previous
  session) — a real running game is re-detected and shows "Running", never a stale
  "Launching…".
- New 3-minute watchdog: if the UI is stuck in a pre-launch phase without a game process
  appearing, it auto-returns to idle with a clear notice and a log line.

## v2.1.0 - Keybinds manager (System) + Update All fixes + bigger server directory

### Keybinds — a new System section that manages your REAL in-game keybinds

- New **Keybinds** entry in the sidebar's System section. It reads the ACTIVE instance's
own `options.txt` — the exact file Minecraft reads at startup — so every keybind appears
there: vanilla controls AND keybinds added by mods (Xaero's, Jade, Physics Mod, MobVolume…
55 mod keybinds detected in the Fabric -26.2- instance alone).
- Names and categories are resolved from the game's language files: the built-in vanilla
dictionary plus each installed mod's `assets/<modid>/lang/en_us.json` (unresolved keys get
a clean prettified fallback — never a raw id).
- Click any key to rebind it — press the new key (Esc clears it). Changes write straight
into that instance's options.txt, so they survive restarts and apply the next time you play.
- **Apply to all instances** copies the layout of the selected instance into every other one
(one confirmation, since it overwrites their keybind lines).
- **Save as default for new instances** stores the layout as the template every freshly
created instance is seeded with — create a new instance and your keybinds are already there.
- A search box filters across names, categories and bound keys; rows group by category with
vanilla sections first (Movement, Gameplay, Inventory, Creative, Multiplayer, Miscellaneous).

### Servers — the big networks are here + favorites follow you into new instances

- Directory now includes **Minemen Club, PvP HQ, MCTiers, BlocksMC, Lunar Network, Hoplite,
VeltPvP and Purple Prison** (plus PvP/practice keywords so Recommended matches PvP setups).
- **Favorites auto-seed**: every new instance you create is born with your favorite servers
already written into its servers.dat — they show up in the in-game multiplayer list without
any extra step.

### Update All / Update button — fixed for real

- **Downloads cover art**: Update and Change Version downloads were the only paths that
forgot to pass the mod's icon — the Downloads page showed a bare name with no cover. Now
the real artwork follows every update, exactly like installs.
- **No more pre-release trap**: update checks used the newest-by-date version, which could
flag (and "Update All" would install) an alpha over the installed stable — e.g. Sodium
offering mc26.2-0.9.2-alpha.4. Checks now prefer the newest stable release, then beta, and
only fall back to an alpha when nothing else exists for that Minecraft version.
- **Stale badge eliminated**: update sweeps are cached per instance (5 min) and the cache is
validated against the installed mods' signatures — any install/update/remove invalidates it
instantly, so "Update All" can never leave a phantom "6 mods to update" count behind.
- **Skip is a real checkbox**: the per-row Skip in the Update All preview is now a proper
click-to-mark checkbox (no more toggle switch), so it reads at a glance what stays behind.

### Settings polish

- Removed the fake "Clear download cache" button (it only showed a toast — it never cleared
anything) and pointed users to the real **Storage → Clear Up Space** scanner.
- Version/loader pickers are unified through i18n — "Any Minecraft version" / "Any loader"
read the same in English, Spanish and French across Mods and Modpacks.

## v2.0.3 - Stutter Guard can't silently break FPS anymore (safety ceiling 144 FPS on weak tiers)

Diagnosis from REAL data after a report of "FPS dropped to 50": the game was running at
78-94 FPS average (PROF avg, live) — NOT 50 — and the pre-update session averaged 70.2 FPS,
so the v2.0.2 update did NOT lower FPS. The actual cause: settings.json had been changed to
stutterGuard:false + memory:8192 (the pre-v2.0.1 bad config, via the Settings toggle), which
makes the launcher launch uncapped (maxFps=260) — an uncapped render thread on this 2C/4T
iGPU laptop spins at maximum load and generates the garbage behind the low=9.9-25.9 FPS dips.

The user's setting was restored (stutterGuard:true, memory:4096 — the v2.0.1 known-good
config). To make this impossible to repeat, v2.0.3 adds a SAFETY CEILING:

- With Stutter Guard OFF on weak tiers (potato/turbo), the launcher now caps at 144 FPS
  instead of fully uncapped 260. 144 exceeds every 60/120 Hz screen refresh, so the user
  loses nothing visible, but the render thread can no longer spin at 200+ FPS and create the
  GC dips. The toggle still means something (120 vs 144); it just can't silently degrade the
  machine anymore. Strong tiers keep 260 when the guard is off.
- Clear launch log line when the safety ceiling engages.

Also answered definitively: the launcher does NOT run inside the game — the FPS Boost mod
(which the launcher auto-installs into every instance and seeds with safe settings) is what
does the in-game FPS work. The launcher's job is the install + safe launch settings (cap,
memory ceiling, GC flags, vsync, async chunk writes).

Validated: typechecks 0 errors, build OK, smoke 13/14 (game-boot test blocked by the user's
open launcher lock, same env issue as before).

## v2.0.2 - Save-freeze fix: autosaves no longer freeze the game (async chunk writes + save-aware mod)

Real PROF data from the user's hardcore session showed the recurring "chest opens seconds later"
freeze was caused by AUTOSAVES: each "Saving and pausing game..." serializes all chunks of all
dimensions synchronously on the server thread, flooding memory so ParallelGC full collections
stop the world for 1.5-3s (measured gcMs up to 5199, maxMs 2900, "Can't keep up" 10.5s behind).
The v2.0.1 GC fix removed the old 1-5s GC freezes but the save stalls remained.

Launcher (v2.0.2 final):
- syncChunkWrites:false now applies on EVERY tier (never a toggle) -> chunk writes move to
  background threads on all machines; the server thread no longer blocks during saves. Data safety
  is unchanged (the game waits for pending writes on quit). Rewritten every launch like the FPS cap.
- FPS Boost bundle bumped to v1.0.36 (jars renamed Reimagined FPS Boost-1.0.36-mc26.x.jar).

FPS Boost mod v1.0.35 -> v1.0.36:
- New ServerSaveMixin on MinecraftServer.saveAllChunks + SaveDetector: the client now KNOWS when
  a save is in flight, and the async chunk-decode pipeline stands down during saves instead of
  compounding the memory flood.
- NEW v1.0.36 ReloadCap: while a resource pack / shader reload is in flight the render FPS is
  temporarily capped to 30 (loading screen doesn't need more). Real data: a pack switch caused a
  77,926 ms reload with a 6,834 ms full GC. Cutting render work ~4x during the window drops the
  heap churn proportionally, so reloads finish sooner and never trigger multi-second freezes.
  Fully reversible - previous limit restored the first tick after the reload completes.
- PROF line now marks save-coincident spike frames with a lowercase 's' in spkTasks (distinct from
  'S' stabilizer) and reload-window frames with 'r' - both stutter sources are measurable.

Validated: typechecks 0 errors, build OK, smoke 13/14 (game-boot test blocked by the user's open
launcher single-instance lock, same env issue as v2.0.1), jars 26.1+26.2 rebuilt with ReloadCap +
SaveDetector verified inside. Nothing touched in physics-mod or Xaero's mods.

## v2.0.1 - UI (chests/inventory) opens instantly again: no more 1-3s freezes

Opening a chest, inventory or any screen could take SECONDS on weak PCs. Real PROF
data from the game log showed the cause: frame freezes of up to 2.9s (maxMs=2911),
garbage-collection pauses of over 1 second (gcMs=1063), game ticks of 200-320ms,
and "Can't keep up" 2.7 seconds behind - exactly the "chest opens seconds later"
feeling.

### Why it happened
- The Stutter Guard cap (120 FPS on weak tiers, added in v1.0.98) had been turned
  OFF in the launcher settings, so the game ran uncapped at 200+ FPS on a 60 Hz
  panel - pure garbage-collector churn on a 2-core iGPU laptop, producing the 1-3
  second freezes.
- The memory setting was 8 GB (the launcher already caps this to 4 GB on weak
  tiers, but the oversized reservation lengthened stop-the-world GC pauses).
- After respawn/teleport the async chunk pipeline applied up to 48 chunks per
  game tick (teleport boost) - on a 2-core CPU that stalls the tick loop for
  hundreds of ms (spike correlation spkTasks=P).

### What changed
- Launcher: Stutter Guard re-enabled and memory set to 4 GB in the settings.
- FPS Boost mod v1.0.34: the teleport/respawn chunk boost is now gentler on weak
  CPUs (24 chunks/tick instead of 48 on <=4 threads) so the screen still fills
  fast but the game thread never freezes - input/UI stay responsive.
- Rebuilt mod jars for 26.1 and 26.2 (verified the new code is inside).

### To apply
Close the launcher and the game completely, update to v2.0.1, and relaunch - the
launcher re-seeds the new mod jar and the frame cap applies on the next game start.

## v2.0.0 — Servers rebuilt: real icons, live status that actually resolves, full i18n, proper dark styling

### BUG 1 — raw translation keys leaking in the Servers page (FIXED)
The Servers section was built after the i18n sweep, so it referenced 14 keys
that never existed — the UI showed literal "srv.discover", "srv.recommended",
"srv.allCategories" instead of real text. Added all missing keys in English,
Spanish and French (tab labels, category dropdown, search placeholder,
Join/Install labels, empty states, toasts), translated category names, and
ran an automated audit across the whole renderer: 0 missing keys remain.

### BUG 2 — server status stuck on "Loading…" forever (FIXED)
The ping ran once on mount, but the Discover/Recommended lists load AFTER
mount — so those cards never got a status and never left "Loading…". The page
now re-pings whenever the server set changes (data arrival, favorites edits)
and refreshes automatically in the background every 60 s. Ping genuinely
failing now shows "Unreachable" instead of an eternal spinner.

### BUG 3 — plain white cards with a letter avatar (FIXED + upgraded)
- Real server icons: the server-list protocol returns each server's favicon
  (base64 PNG) — it is now parsed and shown as the card icon. Servers without
  one fall back to a clean on-brand globe tile (no more raw letter boxes).
- Full restyle to the Reimagined dark/purple language: dark panels, hover
  lift, purple Join buttons, category pills, players/max + ping rows,
  styled tabs, search field and category dropdown, empty states.
- Consistent layout: icon left, name + category + address, description,
  status, Join / Install / favorite per row — same style on Favorites,
  Discover, Recommended and the preview + install modals.

### ALSO SHIPPED (v1.0.100 work, rolled into 2.0.0)
- Music progress bar in the title bar mini-player (click to seek) and a
  small "now playing" menu next to the instance (progress, pause, ±10 s).

## v1.0.99 — Background music actually plays now (was silent) + independent music volume

Your imported mp3 never made a sound. Three things were breaking it: (1) the audio
element is routed through WebAudio for ducking/limiting, and WebAudio outputs
SILENCE for media fetched cross-origin without CORS approval — the custom
reimagined-music:// protocol served the file but never allowed the renderer to
read it, so the track "played" in silence; (2) the music volume setting could be
0 and its slider was wired to the wrong volume; (3) your mp3 was never actually
imported into the library folder.

### What changed
- **Playback fixed for real**: the music protocol now serves every response with
  Access-Control-Allow-Origin, the audio element fetches in CORS mode
  (crossOrigin), and the CSP explicitly allows the reimagined-music:// scheme as
  a media source. Your tracks now actually play in the background.
- **Independent music volume**: background music has its OWN volume (audioMusicVolume),
  completely separate from the UI sound volume — raising/lowering UI sounds never
  touches the music and vice-versa. Live slider right in the title-bar mini player
  (next to the logo) + in Settings → Audio, both stay in sync and persist.
- **Music is no longer tied to the "UI sounds" toggle**: turning UI sounds off no
  longer kills your background music (it has its own volume control).
- **Easier importing — drag & drop**: drop mp3/flac/ogg files directly onto the
  music player to import them, plus a "Folder" button that opens the library
  folder so you can always see exactly where your files live.
- Your Hatsune Miku track was imported into the library and the music volume was
  set to a sane 35% so it is audible on first play.

## v1.0.98 — OBS no longer tanks your FPS + Stutter Guard stops the multi-second freezes

### OBS / recording: 90 FPS no longer swings to 30
Root cause: on a 2-core laptop with an iGPU, OBS's x264 encoder competes with
Minecraft for the same 4 threads — uncapped game FPS makes it worse (the encoder
falls behind and the game swings hard). Also, the v1.0.88 "streaming-aware" hand-off
never actually reached the game: the launcher wrote `streamingActive` into the mod's
config JSON, but the mod had no such field and never read it, so AFK Mode could still
throttle mid-recording.
- **The mod now really detects recording** (OBS / Streamlabs / XSplit / Bandicam /
  Medal / …): while a recording is active it caps FPS to a stable 60 (configurable,
  `streamFpsCap`) — a flat 60 records far better than 90 swinging to 30, and it frees
  CPU/GPU for the encoder. Restored the moment the recording stops; never written to
  options.txt.
- **AFK Mode never engages while recording** — no jarring FPS/render-distance drop
  mid-stream.
- Discord/Steam overlays are treated as overlays (borderless enforcement only), so
  having Discord open does NOT cap your FPS.
- In-game log now states exactly what is happening when OBS is detected.
- Tip: in OBS use Game Capture (not Display Capture) and hardware encoding
  (Intel QuickSync on this laptop) instead of x264 for the biggest FPS win.

### Freeze spikes at 200 FPS: Stutter Guard
Root cause: potato-tier hardware (2C/4T iGPU laptop) was running at *Unlimited* FPS on
a 60 Hz screen — 200 FPS of pure garbage-collection churn on a 2-core CPU produces the
multi-second freezes (the engine's own PROF data measured this exact pattern). 
- Potato/turbo tiers now cap FPS at 120 by default (still double the refresh rate,
  visually identical, but halves allocation/heat) — the freezes disappear.
- New Settings > Performance toggle "Stutter Guard (weak PCs)" (default ON) to
  restore uncapped behavior; "Unlimited FPS" still overrides everything.
## v1.0.97 — Update fixed: no more EBUSY (file locked) + frees ~3.5 GB of old installers

Clicking Update could fail with "EBUSY: resource busy or locked" — the launcher tried to
delete the previously downloaded installer while Windows Defender (or OneDrive) was still
scanning/locking it, and the failure was not handled. Also, every installer ever downloaded
(since v1.0.47!) was kept forever in the updates folder — about 3.5 GB of stale files.

### What changed
- **Lock-safe update cleanup**: deleting the old update file now retries briefly (a scanner
  usually releases the handle within a moment) and, if it stays locked, quarantines the file
  aside instead of failing — the update always proceeds.
- **Friendly error instead of a raw crash** if the file is locked so hard it cannot even be
  moved aside.
- **Download stream hardened**: a write error during the download can no longer crash the
  launcher with an unhandled exception — it surfaces as a normal update failure.
- **Old installers are pruned**: after a successful download, every previous
  Reimagined-Setup-*.exe in the updates folder is deleted (recovering gigabytes), keeping
  only the version being installed.

## v1.0.96 — Game Mode: the launcher goes quiet while you play (fixes high in-game ping)

Your launcher was silently working against you during gameplay: it polled GitHub for
updates every 15 seconds all day, kept the animated living background running on the
same GPU as Minecraft, and pinged the CurseForge proxy every 5 minutes — on a laptop
that CPU/GPU/network contention shows up directly as inflated in-game ping.

### What changed
- **Update checks paused during gameplay**: while any game is running (multi-instance
  safe), the launcher makes zero update-check requests. The old default polled GitHub
  every 15 s — now the default is 5 minutes, and it is skipped entirely during a session.
- **Living background freezes while a game runs**: the ambient orbs/dust animations stop
  so the shared iGPU/CPU on laptops is reserved for Minecraft (no more compositing two
  windows at 60 fps while you play).
- **CurseForge keep-warm pings suspended during gameplay**: the proxy warm-up loop
  (every 5 min) is skipped while a game session is active, and resumes afterwards.
- All of it is automatic — no new settings, nothing to configure. The launcher simply
  goes fully quiet the moment a game starts and wakes up when you close it.

## v1.0.95 — FPS Test now measures real gameplay (was measuring the chunk-generation storm)

The first FPS Test results (3-24 FPS in-world, 18 ms world load, 69 ms respawn) were absurd
because the benchmark was measuring the wrong thing:

- The `reimagined-bench` world was only pre-generated to view-distance 8 while the client
  plays at render distance 10 — the whole test ran while Minecraft generated the missing
  chunk ring live ("Preparing spawn area: 16%" for minutes, 4s GC pauses, 0.5 FPS lows).
- The FPS Boost **AFK Mode** engaged mid-benchmark (180s without input) and capped FPS to
  12 while dropping render distance to 4.
- Smart Render Distance kept ratcheting the render distance down under load.
- "New World Load Time" measured ~1 tick (18 ms) instead of menu → world.
- "Minecraft Startup Time" measured the whole benchmark duration, not the boot.
- "Respawn Time" started timing before the async /kill registered (69 ms).
- The entity test collapsed at 40 entities because the base FPS was already ~24.

### Fixed
- Bench world pre-generates at **view-distance 16** (covers RD 10 + margin) with a
  `bench-gen-v2.json` marker so existing v1 bench worlds regenerate once; generation
  timeout raised to 480s for slow machines.
- Driver **warm-up**: teleports through the spawn, ocean and RTP zones (generous dwells)
  so their chunks exist BEFORE any measurement, then waits for FPS ≥ 30 sustained 5s.
- **AFK + Smart RD disabled for the whole benchmark** via in-memory field assignment
  (never written to disk — a crash can't persist afkMode=false) and restored after.
- `worldLoadMs` = menu → world join; `startupMs` = game start → main menu (both real now).
- Respawn waits for actual death, calls `LocalPlayer.respawn()`, times death → alive.
- Entity test: 40 per batch with a 3s settle window measuring the lowest FPS (no more
  instant collapse at 40 entities).
- Jars rebuilt for 26.1 + 26.2 with the fixed driver; auto-copied to instances by the
  existing hash-check on launch.

## v1.0.94 — Music player fixed (imported songs actually play) + "Menu music" toggle removed

### The music player finally works
- **Root cause found**: the local-music protocol (`reimagined-music://`) served files
  through Electron's `net.fetch(file://...)`, which cannot fetch `file://` URLs — so the
  audio element never received any data. The song stayed silent and the progress bar
  never moved. The protocol now serves files directly with a buffer + full **Range**
  support (206/200/416, `Accept-Ranges`), which also makes seeking and the progress bar
  work. The screenshots viewer (`reimagined-shot://`) had the exact same bug and is fixed
  the same way.
- **Second cause**: starting a track required the "Menu music" toggle to be ON. Custom
  imported tracks now always play — the bundled menu loop is the only thing that stays
  gated (and it is off, see below).

### "Menu music" removed from Settings
- The toggle is gone from Settings → Audio. The bundled menu loop is **always off**.
- Imported tracks play through the music player (title bar mini-player and the Settings
  music section), regardless of any toggle.
- The app no longer kills the music when the old setting was off (that was the third bug:
  every settings change silently stopped playback).

**Validation**: typechecks 0 errors, build OK, smoke 14/14, Range-handling unit test 10/10.

## v1.0.93 — CRITICAL FIX: FPS Boost crash on 26.2 (unexpanded mixin compatibility level)

### The bug
After the v1.0.92 rebuild of the FPS Boost mod, existing 26.2 instances crashed at launch with:
```
Mixin config fpsboost.mixins.26_2.json specifies compatibility level ${COMPAT_LEVEL} which is not recognised
```
### Root cause
The mod build's resource expansion (`processResources`) matched mixins files with the glob
`*.mixins.json` — which matches `fpsboost.mixins.json` but NOT `fpsboost.mixins.26_2.json`
(that file ends in `.mixins.26_2.json`). The `${compat_level}` placeholder in the 26.2-only
mixin config was therefore never replaced, and Fabric's Mixin bootstrap rejected the literal
placeholder. The v1.0.92 hash-based jar refresh then copied that broken jar into existing
instances, surfacing the crash everywhere.

### The fix
- `FpsBoost-source/build.gradle`: the resource glob now matches `*mixins*.json`, so every
  mixins file (including `fpsboost.mixins.26_2.json`) gets `compat_level` expanded to the real
  value (`JAVA_25`). Verified: both 26.1 and 26.2 jars now ship
  `"compatibilityLevel": "JAVA_25"`.
- The fixed jars were copied into the launcher bundle AND directly into the affected instance,
  so it launches correctly right now — no reinstall needed.
- The v1.0.92 hash-based auto-refresh means every existing instance picks up the fixed jar on
  its next launch automatically.

---

## v1.0.92 — Instances reorganized, Clear Up Space, Copy PC Specs & Run a FPS Test

### 1. Instance directory reorganization (safe migration)
- Instances now live in readable folders: `data/Instances/<Instance Name>/` (e.g. `Instances/Survival 1.21.11/`) instead of cryptic `data/games/<slug>-<id8>/` folders.
- A central `instancePath()` resolver is the single source of truth for every system (launching, mods, packs, worlds, screenshots, sharing, backups, logs).
- **Safe, non-destructive migration on first start:** every instance is moved with its `mods`, `config`, `saves`, `resourcepacks`, `shaderpacks`, `screenshots` and `logs` intact. Internal IDs never change; duplicate names get a `(2)` suffix; a manifest records every move; verification runs before the old folder is released. If anything fails, the original data is left untouched and the instance keeps working from its legacy location.
- Renaming an instance now safely renames its physical folder too.

### 2. Clear Up Space (Settings → Storage)
- A safe storage analyzer: it proves data is unnecessary BEFORE offering deletion. Scans launcher caches, temporary/`*.part` files, obsolete update packages, failed-install leftovers, and SHA-256-confirmed duplicate downloads.
- Every item has a confidence score; only ≥90% confidence is auto-selected. Instance folders (`mods/`, `config/`, `saves/`, `resourcepacks/`, `shaderpacks/`, `screenshots/`) are NEVER touched. Deletion re-verifies every file immediately before removing it.
- Visual storage breakdown + progress during scanning; cleanup report after.

### 3. Copy PC Specs (Settings → Performance → Your Hardware)
- `[ Copy All PC Specs ]` copies a clean, privacy-safe plain-text block (CPU/GPU/RAM/display/storage/Java/OS/launcher) to the clipboard — no usernames, emails, tokens, IP/MAC, serials or product keys. Button shows `✓ Copied!` for 2s.
- `[ Copy Minimal Specs ]` copies just CPU/GPU/RAM/OS/Java/Minecraft version/loader.

### 4. Run a FPS Test (Account)
- Pick any Fabric instance with FPS Boost → the launcher generates a dedicated `reimagined-bench` world (never touches your real worlds), launches straight into it, and the FPS Boost mod's new BenchmarkDriver runs the full real-measurement suite.
- **Every FPS is REAL** — sampled once per second, and the reported value is always the LOWEST FPS recorded during that test. Anything not measured reports `N/A`; nothing is invented. The client thread never blocks (tick-driven).
- Tests: Normal Walking, Fast Flying, New World First FPS, New World Load Time, Ocean Chunk Loading, 27/125 TNT Explosions, Old Chunk Loading, Maximum Entities Before Lag, Respawn Time, Fast Block Breaking, 2-Minute Survival, Fast Entity Loading, Creeper Explosion, AFK, New World Camera Loading, Inventory Opening, Fast F5, RTP Chunk Loading, Minecraft Main Menu, Minecraft Startup Time + Miniature Shader when active.
- Live UI while running (current test, progress bar, lowest FPS so far) + `Reimagined_FPS_Test_<date>.txt` report in the exact plain-text template (with your PC specs) → Open Report / Copy Results / Open Folder / Run Again.
- FPS Boost bundled jars rebuilt with the driver (26.1 + 26.2); existing instances pick up the new jar automatically (hash-verified on launch).

---

## v1.0.91 - the update bridge: any old version can now upgrade to the latest

### Why this release exists
The v1.0.90 fix made updates work **once you are on 1.0.90** — but users still
on v1.0.88/v1.0.89 could not get there: their launcher (older updater) spawned
the new installer, and the new installer had to run their OLD broken
uninstaller first, which popped the fake "uninstall" dialog and aborted the
update (the exact bug you hit).

### The fix (works for EVERYONE, no launcher dependency)
The installer itself now removes a stale old uninstaller **in its own startup
routine** before it ever tries to run it. So clicking Update from v1.0.88,
v1.0.89 or anything older now upgrades cleanly to v1.0.91 — the launcher that
triggers it no longer matters. A fresh, fixed uninstaller is written by the
install itself.

## v1.0.90 - CRITICAL: silent updates fixed for real (the "update wants to uninstall" bug)

### What was actually breaking every update
Reproduced and fixed end-to-end. Two bugs in the custom branded installer:

1. **The startup splash hung the installer.** The splash plugin hangs this NSIS
   build (both interactive and silent runs), and the bitmap was also extracted
   under the wrong file name, so the splash window could never load it. The
   installer got stuck in its startup routine forever — the app was never
   replaced, so the version stayed on 1.0.88 no matter how many times you
   clicked Update. The splash is now removed; the custom wizard pages remain.
2. **The old uninstaller aborted the upgrade.** To replace the app, the new
   installer first invokes the OLD uninstaller. Uninstallers from v1.0.88/1.0.89
   carried a custom "Reimagined is still running — close it before
   uninstalling" check with NO silent-mode guard, so during an update it could
   pop a dialog that looked exactly like an uninstall and abort the whole
   upgrade (installer exit code 2).

### The fixes
- Installer/uninstaller: the running-app refusal only applies to interactive
  manual uninstalls now (never during silent updates), and the broken splash
  is gone. Future uninstallers are safe.
- Updater hardening: before spawning the new installer, the launcher now
  removes a stale old uninstaller it detects, so the very next update skips
  the broken old component entirely and installs a fresh, fixed one.
- Verified: a full silent install + silent update cycle was run in an isolated
  sandbox with the real installers — both complete cleanly now (they hung
  before). Your installed launcher, profiles and data were untouched.

## v1.0.89 - Real server browser + Reimagined "R" nametag in-game

### Real server browser (Games > Servers) - not just "add a server"
- Discover: a curated directory of 15 real public Java servers (Hypixel, CubeCraft, Wynncraft, 2b2t, ManaCube, StoneHollow and more), searchable by name/address/tag and filterable by category (Minigames, Skyblock, Survival, Anarchy, MMORPG, Creative).
- Previews: click any server to open a detail panel with live MOTD, player count, version and latency (real ping over the Minecraft protocol - no blocking, manual refresh button too).
- Recommended for you: ranks the directory by what your active profile actually has installed (Skyblock mods suggest Skyblock servers, etc).
- INSTALL INTO INSTANCES: pick any directory server and install it into one of your instances (searchable picker with clean UI) - the launcher writes it into that instance's servers.dat (hand-rolled NBT), so when you enter Minecraft and open Multiplayer, the server is right there.
- Join launches the active profile directly into the server; favorites and recently-played history kept.

### Reimagined "R" nametag branding (FPS Boost 1.0.33, 26.2)
- The official fragmented Reimagined "R" now renders right next to player nametags in-game, drawn at texture resolution with a soft glow on hover, smooth fade in/out on appear/disappear - same brand identity as the launcher logo and startup animation.
- Toggle in the FPS Boost screen: Nametag R (on by default).
- Built only for 26.2 (the version whose render API supports it); 26.1 keeps the previous build - no behavior change for other targets.
- Rendered through the official render pipeline with a dedicated texture, negligible performance cost, and no conflict with Sodium/Iris/Xaero's/Essential/Mod Menu - it layers under nametag rendering.

## v1.0.88 - Big update: Discord status, Servers, i18n, Screenshots, custom installer & more

### Discord Rich Presence (Settings > Show Discord Status, ON by default)
- Your Discord status now shows what you're doing in Reimagined: browsing the launcher, or
  playing with a live playtime timer ("Playing Minecraft - <profile>, <version>") using the
  Reimagined logo as the card image. If Discord isn't running it fails silently.

### Servers (new Games > Servers section)
- Favorite servers with name + address, live ping / player count / MOTD (async, never blocks
  the UI), recently played history, and a Join action that launches the selected profile
  straight into the server.

### Screenshots (Instances > Screenshots, next to Worlds)
- Thumbnail grid of that instance's F2 screenshots, fullscreen lightbox with scroll-wheel
  zoom, export one or many at once, delete with confirmation.

### Multi-language support (Account > Language)
- Real i18n: English (default), Spanish and French across the whole launcher, applying
  instantly and persisting. Missing translations fall back to English.

### Account upgrades
- Accessibility: UI font scale, high-contrast mode, colorblind-friendly status colors and
  keyboard navigation.
- Statistics: a real playtime chart (hours per day, most-played profiles, total) built from
  the playtime data already tracked per profile.

### Streaming & recording awareness
- Detects OBS/recording while the game runs and automatically behaves: non-critical toasts
  are suppressed and AFK throttling is paused while you're being watched. Toggle in Settings.

### New startup sound
- The launcher's opening sequence was completely redesigned from scratch: a soft, premium
  "system coming online" sound that follows the logo animation, plays exactly once, and
  respects the master volume.

### Custom installer & uninstaller
- The Windows setup is now a fully branded Reimagined wizard: animated splash intro,
  explained step-by-step pages (install location, desktop shortcut / Start Menu / launch
  options), real progress, and a completion screen with Launch.
- The uninstaller asks "Remove application only" (keeps profiles, settings, skins, logs -
  safe default) or "Remove everything" (extra confirmation, then a thorough cleanup of
  files, caches, registry keys and scheduled tasks). It refuses to run while Reimagined
  or a game launched from it is still open.

## v1.0.87 — Spotify removed, your MP3s everywhere & a mini player in the title bar

### Spotify is gone
- The Spotify connection was removed entirely: UI, login flow, Web Playback
  SDK, stored tokens and settings. No Spotify code ships in the launcher
  anymore — your music library is 100% local.

### Your own music, at max
- The local MP3 library (Settings → Audio → Music) runs on a single shared
  player engine: true pause/resume (keeps your position), previous/next,
  shuffle, repeat (off / all / one) and volume — your own files only.
- When a track finishes it auto-advances; if there is no next track it plays
  the same one again — the music never just stops.
- Re-selecting the current track (or pressing Next with a single track)
  restarts it from the beginning.

### Mini player in the title bar
- Right next to the Reimagined logo at the top of the window there are now
  Play/Pause and Next buttons plus the current track name — control your
  background music from anywhere in the launcher.
- The title-bar player and the Settings panel share the same state, so they
  always stay in sync (and the track name hides on narrow windows so the
  window controls never get crowded).

## v1.0.86 — Creator profiles, browser-like navigation & a new startup sound

### Clickable creators everywhere
- Every author name on any project (mods, modpacks, resource packs, data
  packs, shaders, worlds, maps) is now clickable and opens a native in-app
  creator profile — no external browser.
- New premium profile page: real avatar, bio, role, project counts, dynamic
  category tabs (only the types the creator actually has), instant project
  search, and clean project cards with type / MC versions / loaders /
  downloads. Loading uses skeletons; failures show a friendly retry state.

### Browser-like navigation (back arrow everywhere)
- A universal back arrow now lives in the top bar and reverses the REAL
  navigation path — project -> author -> another project -> back returns
  exactly where you came from, at arbitrary depth.
- Pages under the stack stay mounted, so scroll position, filters and search
  survive going back. Top-level pages also restore their scroll position.
- Modpacks and Mods already share the same version-browsing preview, so the
  version menus behave identically in both sections.

### No more duplicate installs
- The duplicate-install flow is gone: an item already present in an instance
  simply cannot be installed again — no Shift-click re-arm, no "install
  duplicate?" confirmation, install buttons are disabled.

### Credits use real YouTube avatars
- The creator and contributor cards now load the actual YouTube channel
  profile pictures (with the letter badge as fallback).

### New startup sound
- The startup audio is one continuous ~4.5s cinematic piece mapped to the
  splash animation: the system wakes, components activate, the ring draws,
  the logo lands its own short sonic signature, and everything resolves into
  a warm chord — then settles. Fixed a bug where a duplicated phase shadowed
  the finale.

## v1.0.85 — Portable share codes, tray keep-alive, Music & Spotify, UI rebuilds

### Share codes now work on ANY PC (no server needed)
- Share codes are now **self-contained**: the full profile snapshot is compressed into the code itself, so it resolves offline on any machine — no more "code doesn't work on another PC".
- The Share dialog shows the portable code plus the short link; both import the same profile.

### The launcher never dies while you play
- New system tray: closing the window (or a renderer crash) hides to the tray instead of quitting, and the app stays alive while a game is running — no more losing the console/game because the launcher closed itself.
- Quit only happens deliberately from the tray menu.

### Music & Spotify (Settings → Audio)
- **Local library**: drop your own .mp3/.flac/.ogg files into the launcher and play them as background music (play/pause/next/prev, shuffle, repeat, volume) — streamed over a locked-down local protocol.
- **Spotify**: full connection via Authorization Code + PKCE — paste a free Client ID, authorize inside Spotify's own page, stream through the Web Playback SDK (Premium required). Tokens stored encrypted. Your IP is only ever visible to Spotify.
- New **startup song** composed to match the splash animation (soft attack, no harsh frequencies).

### Performance & fixes
- **Xaero's Minimap/World Map** now get a performance-first seed at launch (lighting & biome blending off) — the 110→88 fps map drop is gone.
- **Mod descriptions** render properly: badges inside links become clean images, raw markdown no longer dumps into the page.
- **Duplicate-install confirm** now renders above every modal (was hidden behind the UI).

### Settings reorganized + Credits page
- Sections reordered to make sense (General / Audio / Downloads / Gameplay / Java & Performance / Credits).
- "Advanced" is now a proper **Credits** page: creator @MoustachePetit and contributor @Fasticraft_MC with their channels, animated and styled.

### UI rebuilds (same colors, same actions — cleaner)
- **Downloads**: single live hero with real artwork, byte-level progress, speed & ETA; grouped history (In progress / Failed / Completed); friendly empty state.
- **Home**: glass hero with a glowing player portrait, refined profile panel.
- **Play**: big glowing play card, cleaner instance picker and progress panel.
- **Account**: new actions — Refresh session, Copy UUID, Microsoft account link; status badges and a secure-session note.

## v1.0.84 — Shader crash fixed for real (shadow-safe recovery) + FPS Boost 1.0.32 (faster respawn/teleport + entity crowd fix)

### The Miniature-shader crash is fixed — surgically
- Root-caused from FIVE identical real crash reports (Aug 8-12): `Cannot wait on a fence for the current submit` in Sodium's `MappedStagingBuffer.delete` during Iris's SHADOW pass — a known Sodium↔Iris bug that crashes deterministically on older Intel iGPUs (HD 620).
- New **shadow-safe recovery**: the launcher now disables ONLY shadows (`enableShadows=false`) instead of the whole shader pack. The pack keeps working and runs much faster — the shadow pass is the single most expensive (and crashing) part for a weak GPU.
- Fixed the recovery pipeline bugs that let this crash loop forever: Iris writes `shaderPack=` (capital P) but the guard matched `shaderpack=`; in-game-enabled shader crashes were never recorded because the launch-time crash flag was never armed. Recording now triggers on the crash report content, classifies the fence signature, and recovery triggers on a fresh (24h) record even without the flag.

### FPS Boost 1.0.32 (26.1 + 26.2)
- **Teleport/respawn boost**: after a >=6-chunk camera jump (respawn, RTP, dimension travel) the chunk-apply budget rises 12→48/tick for ~1s — the 8-second respawn becomes a quick fill.
- **Entity crowd budget tiered** (240 potato / 420 balanced / 800 high) so the entity-animation throttle actually engages at realistic crowds (e.g. a 355-zombie stress test) — less render-thread CPU on crowded scenes. Legacy configs with the old flat 700 are reconciled on next launch.
- Build system: the 26.x build was broken (`Configuration 'mappings' has no dependencies`) — the plugin ID is now chosen per Minecraft generation (`net.fabricmc.fabric-loom` for unobfuscated 26.x, `fabric-loom` for obfuscated 1.21.x), dependencies switch to `implementation`, and `build-all.sh` passes the correct Loom version per target.

### Instance hygiene
- Removed a duplicated c2me jar (two alpha versions fighting over the chunk pipeline); the newer one stays.

---

## v1.0.83 — Duplicate-aware installs (Shift + confirm) + Mods version menu matches Modpacks + fixed the instance "…" overflow menu

### Intentional duplicate installs (no accidental ones)
- The Mods browse rows now detect when an item is **already installed** in the
  instance: the Install button is disabled and labeled "Installed" (with a hint
  tooltip). Holding **Shift** re-arms it — the button turns into "Install
  Duplicate" and clicking shows an explicit confirmation dialog
  ("Install a duplicate?") before anything downloads. All copy in English.
- The backend now accepts an `allowDuplicate` flag for installs: the duplicate
  file gets its own unique name (`Name (duplicate).jar`, then numbered) so it
  **never overwrites the original**, and the tracked entry keeps a distinct
  slug so Remove / Update / Change Version act on exactly one copy.
- The Games → Mods instance picker does the same per-instance: instances that
  already have the item show an "Installed" badge and need Shift + confirmation
  to be selected (worlds are exempt — they always install into saves/).
- Worlds browsing already works from the picker (install into saves/, infinite
  scroll, search) — unchanged, just verified end-to-end.

### Version menu matches the Modpacks section
- The Mods global browser's Minecraft version filter is now the same
  `SearchableSelect` the Modpacks section uses (live filter, pinned
  "Any Minecraft version") instead of the plain dropdown.

### Fixed the instance "…" overflow menu (Open Folder / Repair / Duplicate / Delete)
- The menu was rendering as plain unstyled boxes, misaligned under the button.
  It now uses the shared, properly-styled `ctx-menu` dropdown (dark surface,
  purple hover, danger-red Delete, icons, anchored below the button) — the same
  component the mod detail page already uses. This was the only leftover
  instance of the old unstyled class, so there is nothing else to consolidate.

## v1.0.82 — Installed list in real time (no more ghost duplicates) + new Games → Mods global browser (any version/loader, worlds included) + faster CurseForge

### Installed list is now REAL-TIME (no restart, no stale cache)
- **Ghost duplicates fixed**: the Installed panel used to show repeated rows of the
  same file (e.g. seven "Reimagined FPS Boost" entries) that only cleared after a
  launcher restart. The reconcile now deduplicates by installed file, keeping the
  entry with the most complete tracking data.
- **Live refresh**: while the Installed panel is open, every window focus re-checks
  the real files on disk — a mod deleted externally disappears immediately, a jar
  dropped into the folder appears immediately. No delays, no cache to clear.

### New Games → Mods section (global browser)
- Browse **Modrinth AND CurseForge** for **any Minecraft version** with a loader
  filter (Any / Fabric / Forge) — mods, resource packs, data packs, shader packs
  and **Worlds** (1-block, skyblocks, adventure maps…).
- Clicking Install/Download opens a clean **instance picker**: search your
  instances by name, see each one's icon/version/loader, and the picker shows the
  **exact version that will be installed** for that instance's Minecraft version.
  A **Forge item can never be dropped into a Fabric instance** (and vice versa);
  Vanilla instances can't take mods at all. Worlds install straight into saves/.
- The picker has a **"Use current instance" shortcut** — one click installs into
  the instance you're already working on, skipping the list entirely.
- **Worlds have a full detail page** too: gallery (screenshots with lightbox),
  description, stats and the download size — then Download routes through the
  instance picker like everything else.
- Library now holds **Instances + Downloads**; Games holds **Mods + Modpacks**.

### Instance controls inside the mods screen
- The per-instance Mods screen now has **Play/Stop, Edit, Share** and a **3-dot
  menu** (open folder / repair Fabric / duplicate / delete) — no more leaving the
  screen just to launch the game.

### CurseForge is fast again
- The CurseForge proxy (free-tier host) slept after ~15 min idle, so every first
  request paid a 30–60 s cold boot and the screen could "think" for minutes.
  Response caching (search/detail/versions) + a keep-warm ping every 5 min + a
  warm-up on launcher start make repeat visits instant and first visits snappy.

### Right-click menu fixed
- The instance context menu used to appear in the middle of the launcher instead
  of under the cursor (a `position:fixed`-inside-transformed-page bug). It's now
  rendered at the document root and clamped to the screen edge.

## v1.0.81 — Share codes now REALLY work (server-backed) + .zip exports with your worlds, mods and configs

### Share codes work across launchers
- Codes were previously stored only on the generating machine — a code sent to a
  friend could never resolve on their launcher. Now every code is published to the
  Reimagined share server (the same backend as the CurseForge proxy) with the usual
  7-day expiry, so it imports on ANY launcher. The generating device keeps a local
  mirror, so codes still resolve instantly and offline on the same machine.
- If the share server is unreachable, the launcher falls back to a local-only code
  and says so (toast: “Share code generated (offline)”). Resolving a code from
  another machine shows a clean “could not reach the share server” message when the
  network is the problem — never a confusing “invalid code”.
- The backend (backend/cf-proxy/server.js) gained `POST /api/share` (publish a
  snapshot → code) and `GET /api/share/:code` (resolve), with per-IP rate limits,
  payload caps, sanitization and 7-day expiry pruning. Codes generated on one
  machine resolve on any other once this backend is deployed (one Render redeploy).

### Universal modpack format: import from ANY launcher, export for EVERY launcher
- **Import auto-detects the format** — one Import button handles them all:
  Modrinth App / Lunar Client / Prism exports (**Modrinth .mrpack**,
  `modrinth.index.json`), CurseForge modpacks (`manifest.json` + overrides) and
  Reimagined exports (`reimagined-manifest.json`). No format picker, no separate
  buttons.
- **Export is now a standard Modrinth .mrpack** — the format the Modrinth App,
  Lunar Client, Prism and ATLauncher all import. “Export .zip” became “Export
  .mrpack”. The picker still lets you choose the folders that travel as real
  files (mods, resource packs, shaders, data packs, worlds pre-checked; config,
  game settings, screenshots, logs available). Everything ships under
  `overrides/`, which every mrpack importer restores straight into the instance —
  fully offline, no remote-download dependency. The Reimagined manifest is
  embedded too, so Reimagined↔Reimagined keeps exact version pinning.
- mrpack import downloads every client-compatible `files[]` entry to its exact
  path (server-only files are skipped), applies `overrides/` and registers the
  result by its real metadata. Downloads show live progress and are cancellable.
- The zip writer now compresses (DEFLATE), so packages carrying worlds stay small.
  Exports cap at ~1 GB with a clear “uncheck some folders” message; the import cap
  grew to match. Import preview shows which folders the package carries
  (“Restored from this package: saves · config …”).
- The share manifest format is now v2 (`folders` field, whitelisted on import).

## v1.0.80 — THE REAL Fabric 1.21.x fix: the launcher was missing the intermediary mappings jar

### The actual root cause (found with real evidence)
- v1.0.79 stopped the crash from mod-version mismatches, but 1.21.11 was STILL
  crashing on EVERY mod with a classTweaker (architectury, cloth-config,
  fabric-biome-api-v1…). The game log showed the smoking gun: "Mappings not
  present!" — and the install metadata confirmed it: the Fabric version JSON
  for 1.21.11 listed 114 libraries but NOT ONE was
  `net.fabricmc:intermediary`, and the jar did not exist on disk for any
  version.
- Minecraft 1.21.11 is the LAST OBFUSCATED release; 26.1 is the first
  unobfuscated one. Modern Fabric Loader runs the game in the `official`
  namespace and remaps every mod's intermediary classTweaker entries to it —
  that remap REQUIRES the `net.fabricmc:intermediary:<mc>` mappings jar on the
  classpath. The launcher's `installFabric` never added that library (the
  official fabric-installer always does). 26.x works because it ships
  unobfuscated and needs no intermediary at all — which is why the SAME launcher
  code ran 26.2 perfectly and crashed every 1.21.x profile.

### What changed
- `installFabric` now adds `net.fabricmc:intermediary:<mc>` (from the official
  meta `intermediary.maven`) to the download batch AND the patched version JSON
  — only for obfuscated versions (`needsIntermediary` = major < 26; 26.1+
  stays untouched, no intermediary exists for it). The launch classpath picks
  it up automatically.
- **Self-heal for existing broken installs**: on every launch, if a cached
  Fabric install for an obfuscated version is missing the intermediary library
  or its jar, the launcher patches the version JSON and downloads the jar in
  place — no reinstall, no data loss. So the 1.21.11 profile that was crashing
  fixes itself on next launch.
- The user's live PVP Practice instance was also patched directly (JSON +
  jar + stale remap cache cleared) so it launches correctly even before
  updating.
- Verified: `intermediary-1.21.11.jar` exists on maven.fabricmc.net (797 KB,
  HTTP 200); `intermediary-26.2.jar` does NOT exist (302) — confirming the
  major<26 gate; tsc 0 errors; build ✓.

## v1.0.79 — Fabric environment fixed for real: no more "Namespace (intermediary) does not match current runtime namespace (official)" crashes

### Root cause (found with real evidence)
- The crash is a RUNTIME-ENVIRONMENT mismatch, not a broken mod: modern Fabric
  Loader runs Minecraft in the Mojang-mapped `official` namespace and remaps
  every mod's `intermediary` classTweaker entries at load time using the
  mappings for THAT Minecraft version. When a jar was built for a DIFFERENT
  Minecraft version (or a stale loader pin from another MC version is on the
  profile), the intermediary names don't exist in the current mappings, the
  remap fails, and the loader hard-crashes with the namespace error — which is
  why different mods (fabric-biome-api-v1, cloth-config…) kept producing the
  same message.

### What the launcher now does
- **Pre-launch environment validation**: before Minecraft starts, every jar in
  the profile's mods/ folder is checked — its `fabric.mod.json` is parsed and
  `depends.minecraft` / `depends.fabricloader` are matched against the
  profile's exact Minecraft version and the loader that will ACTUALLY run
  (Fabric's real range semantics: ANDed clauses, `.x` branches, `~` fuzzy
  upper bound, `^` caret on the first non-zero component). A mismatched jar
  blocks the launch with a clean message + Repair option instead of a crash.
- **Stale loader pins are dropped**: `resolveFabricLoader` only honors a
  profile-pinned loader version when meta.fabricmc.net actually lists it FOR
  that Minecraft version; otherwise it uses the latest valid loader (and the
  corrected pin is persisted back to the profile on edit/prepare).
- **Repair instance** (Profiles → ⋯ → Repair, and offered automatically on the
  crash): re-checks the loader, MOVES incompatible jars to `mods.incompatible/`
  (recoverable — never deleted), clears the stale `.fabric/processedMods`
  remap cache, and never touches saves/screenshots/config.
- **Version change isolation**: editing a Fabric profile's Minecraft version
  automatically quarantines jars built for the old version.
- **In-game crash detector**: if the game output ever shows the classTweaker/
  namespace pattern again, the launcher surfaces the clean repair dialog
  instead of a raw Java stack trace.
- **Fast**: validation results are cached per profile (keyed by MC version +
  loader pin + every jar's name/size/mtime), so normal launches skip the
  jar scan and the meta network call entirely.
- Verified against the real instance: 87 jars all compatible on 26.2 (zero
  false positives), 74 correctly flagged for a hypothetical 1.21.11 profile.

## v1.0.78 — FPS Boost MULTI-VERSION: now installable on x1.8, x1.21, x26.1 and x26.2 (FPS Boost 1.0.31)

### The big one: FPS Boost is no longer 26.2-only
- The mod source is now compiled per Minecraft branch through a new multi-target
  build system (`FpsBoost-source/targets/*.properties` + `build-all.sh`). Each
  branch gets its own jar whose `fabric.mod.json` declares exactly the
  Minecraft range it supports, and the launcher picks the right jar per profile.
- **Shipped today: x26.1 and x26.2.** Both branches build from ONE source tree —
  the rename/moved-class differences between branches (e.g. the chunk compile
  task, `NativeImage` pixel access) are bridged by a tiny runtime
  compatibility layer (`NativeImagePixels`, reflection-resolved mixin targets)
  instead of duplicated files.
- **Future branches (x1.8 Legacy Fabric, x1.21) are documented as deep ports**
  in `FpsBoost-source/README.md` with the exact compatibility work each needs.
  They drop in as new `targets/<branch>.properties` entries + one bundled jar
  each — the launcher side (version→jar map) already handles any number of
  branches.

### How the launcher installs per version
- `fps-boost.ts` holds the **version → jar map** (`FPS_BOOST_JARS`): 26.1.x →
  `-mc26.1.jar`, 26.2.x → `-mc26.2.jar`. Auto-install, manual Install, stale
  cleanup and version upgrades all use the branch-appropriate filename.
- Profiles on unsupported versions still skip the mod cleanly (launcher-side
  JVM flags + frame cap still apply) — never a crash, never a wrong jar.
- `ensureFpsBoost` now also swaps the jar when a profile's Minecraft version
  changes between branches (not just when the version number bumps).
- The in-app version gate (`Install FPS Booster` button) now covers every
  bundled branch, including bare `26.1` / `26.2` versions.

### What this means for you
- Want to test on 26.1? Create a Fabric 26.1 profile → the launcher injects the
  mc26.1 build automatically (same 1.0.31 engine, same FPS features).
- **Every future FPS Boost update re-ships on ALL built branches automatically**
  — one source change → build-all → bundle each jar → the launcher map already
  points at them. No per-version maintenance.
- 1.8.x and 1.21.x will land as dedicated ports in a later update (they are
  deep ports: Legacy Fabric and a different render pipeline, not a recompile).

## v1.0.77 — FIX: "always 10 chunks, now stuck at 4" + the post-update FPS drop (FPS Boost 1.0.30)

### Root cause 1: the render distance got STUCK below your preference and the mod forgot what you actually want
- Real session logs showed the exact chain: your stored preference is **10**, but a
  throttled render distance of 4 leaked in and the Smart RD heal only covered
  `current <= 3`, so 4 was adopted as the ceiling — and then the mod
  **overwrote your stored preference with 4** (`remembered player render distance 4`
  in the log). The AFK restore did the same: it put the throttled 4 back and the
  smart tick read it as a "manual lower".
- **Fix:** the player's stored preference is now the single source of truth. On
  world entry, ANY render distance below your preference is restored to it
  (10 stays 10; a genuine manual 4-5 is still respected because manual changes
  are remembered). The ceiling is never seeded from a throttled value, and a
  healed value can never overwrite your preference. AFK no longer writes the
  throttled render distance / FPS cap to options.txt either.

### Root cause 2: the chunk-build pool stole CPU from the integrated server
- On your dual-core iGPU laptop (4 logical threads), the render thread AND the
  integrated server share the same cores. A 2-thread mesh pool stole time from
  server chunk generation — your log shows `Can't keep up! 115-206 ticks behind`
  repeatedly, which drags frame rate down with it.
- **Fix:** weak CPUs (≤4 threads) now use **1 mesh thread** unless you explicitly
  set a custom chunk-thread limit. The storm governor and the (now rarer) Smart
  RD drops were also retuned: normal exploration bursts no longer yank your
  render distance down (240+ queued for 6s sustained before it acts), and
  recovery is much faster once the burst is over.

### Verification
- Gradle build (mod **1.0.30**) ✅ · tsc node+web 0 errors ✅ · build launcher ✅ · reviewer ✅.
- After updating, you should see `Smart RD: restored render distance to your preference 10`
  in the log on your next world entry, and the adaptive RD should hold 10 through
  normal play instead of dropping to 4.

## v1.0.76 — "Update All" live countdown: the number ticks down as each mod finishes

### Real-time progress while the batch runs
- The Update All modal now **stays open while updates run** and shows live
  state per item: the current mod shows a spinner ("Updating"), finished mods
  get a green border + "Updated" badge with a check, and pending ones say
  "Queued".
- The count in the modal title and the confirm button **ticks down in real
  time** — `Update All (4)` becomes `3 → 2 → 1 → 0` as each mod downloads and
  installs. A header line reports "N of M done".
- If an individual update fails, that row shows a red **Failed** state (never
  a fake "Updated") and the summary reports "N updated, M failed, K skipped".
- The row list is frozen for the duration of the batch, so Done/Failed states
  stay accurate even if the installed list refreshes mid-run.
- Skip toggles and Cancel are disabled while the batch is running; the modal
  closes itself when everything is processed.

## v1.0.75 — "Update All" with per-mod exclusion (skip what you don't want to update)

### New: skip any mod in the Update All preview
- The Update All preview list now has a **Skip** toggle on every row. Flip it on
  for anything you want to leave on its current version — that row dims and gets
  a "Skipped" badge so the choice is visible at a glance.
- The confirm button now shows the actionable count (`Update All (N of M)` once
  something is skipped) and is disabled if everything is skipped. A small summary
  line reports how many are skipped vs. to-be-updated.
- The preview no longer caps at 40 rows — every outdated item is shown, so any
  mod can be excluded (the list stays scrollable).
- Confirming updates all non-skipped items and skips the rest for real; the
  success notification reports "N updated, M skipped".
- Hold-Shift fast path is unchanged (updates everything immediately).

## v1.0.74 — CRITICAL: fixes the "super laggy" session (dead async chunk decode + multi-second GC) + FPS Boost 1.0.29

### Root cause 1: the async chunk decode was silently DEAD — Mixin rejected the whole mixin
- Real session logs showed the launcher in the worst state possible: the
  launcher's biggest client optimization (async server-chunk decode) was
  NEVER running. `ClientChunkCacheMixin` declared `accessOk()` as a
  `public static @Unique` method with a nested public static `Access`
  class — Mixin's own rule forbids non-private static members in a mixin
  and it DISCARDED THE ENTIRE MIXIN at apply time
  ("contains non-private static method accessOk()Z").
- Result: every network chunk decode ran back on the game thread,
  synchronously — the exact stutter/freeze the async pipeline was built
  to eliminate (PROF data: tickMs=694, spikes=265, "Can't keep up!
  2589ms behind").
- Fix: the private-member access layer moved out of the mixin into a
  regular helper class (`perf/ClientChunkCacheAccess`) using cached
  MethodHandles with graceful fallback; the mixin and ChunkPipeline now
  reference it. If the handles ever fail to initialize, `accessOk()`
  reports it and the module falls back to vanilla — never a crash.

### Root cause 2: an 8 GB heap with ParallelGC froze the machine for SECONDS
- v1.0.68 switched low-core machines to ParallelGC. On a 2-core/4-thread
  iGPU laptop an oversized heap makes every full GC stop-the-world for
  seconds (measured in real data: -Xmx8192M -> gcMs=3607, tickMs=5165,
  102 ticks behind).
- Fix: `recommendedHeapFor()` caps the heap to 4 GB for the ParallelGC
  tiers (potato / turbo / balanced with <=4 threads) — real usage is
  ~1-2 GB, so 4 GB keeps the worst-case pause short. Strong G1 machines
  keep whatever the user configured.

### Notes for this release
- Both fixes are validated: gradle build (mod 1.0.29), tsc node+web 0
  errors, launcher build, reviewer pass (2 adjustments applied).
- First session after updating should show `[FPS Boost] Chunk-decode
  pipeline ready` in the log — proof the async pipeline initialized.

## v1.0.73 — CRITICAL: fixes the "can't move, feels like crashing" FPS bug + FPS Boost 1.0.28

### Root cause: the explosion-debris cap was throwing on EVERY debris spawn
- Real session logs showed 126+ "debrisCap failed in the render path"
  exceptions, second after second, in the SERVER thread. The cap counts
  falling blocks (TNT/gravel/sand debris) with an infinite AABB
  (-INF..+INF); on MC 26.2 EntitySectionStorage converts that AABB into a
  section range and with infinity the start becomes LARGER than the end, so
  subSet() threw IllegalArgumentException every time a block fell.
- The SafetyGate logged "falling back to vanilla" but had NO "debrisCap"
  case in its switch — so the module was never actually disabled and the
  exception repeated for the whole session.
- Because the mixin threw BEFORE counting, the cap NEVER worked: every TNT
  chain spawned UNBOUNDED falling blocks (each ticked + rendered as its own
  model), ballooning the integrated-server tick to 846ms per tick
  (tickMs=846.7) — the world barely moved, felt like a crash.

### Fix
- FallingBlockDebrisMixin now uses the bounded getEntities(EntityTypeTest,
  Predicate, List, cap) overload — no AABB math, capped collection, no
  crash. The cap finally works: the first cap-worth of debris flies, the
  overflow is trimmed (gameplay identical, only the flying animation of the
  overflow is skipped).
- SafetyGate now has a "debrisCap" case (disables the module) so any future
  failure degrades instead of spamming forever.
- (This also explains the old V2 test: "Explose 5x5 TNT = 6-53 fps" — the
  cap has been broken since the 26.2 port.)



### Root cause: throttled render distance was being PERSISTED into options.txt
- The v1.0.26 queue-pressure branch (mesh queue >= 120 AND fpsEma < 60) fired
  almost constantly on 60Hz vsync displays (fpsEma hovers just under 60), so
  any chunk burst ratcheted the render distance down 1 per 2s. Every drop
  called options.save(), writing the throttled RD (2) into options.txt. The
  next launch then SEEDED the restore ceiling from that persisted 2, so the
  adaptive chunks never came back and the game started fogged at 2 instead
  of your real 10.

### Fix
- Smart RD drops are now IN-MEMORY ONLY — a throttled RD is never written to
  options.txt.
- The queue signal requires 2 CONSECUTIVE deep evals (4+ seconds sustained)
  before dropping, so a single transient spike no longer punishes you.
- Leaving the world and closing the game now restore the player's own render
  distance (and persist it) before anything is saved.
- Session-start HEAL: if options.txt was left at the throttle floor (2-3) by
  an older version, the first world join raises it back to the player's own
  saved render distance (default 10) before the restore ceiling is seeded.
- Restore no longer requires fps > 45 — it only needs the mesh queue drained
  and fps above 20, so shader sessions (29-44 fps on the HD 620) recover too.
- AFK mode also restores its cap/RD when the game closes, so closing while
  AFK can't leak the ~12 fps cap or RD 4 into the next session.



### Root cause: thread oversubscription + Smart RD never firing at moderate FPS
- Diagnosed from the test-PC FPS report (i3-2120 2C/4T, GTX 1650 SUPER 4GB,
  9GB DDR3-1333, HDD): the GPU is NOT the problem (shaders run 66-140 fps).
  The machine scores "balanced", which used 3 chunk-mesh threads + the game
  thread + the integrated server + 2-3 GC threads = 7 work streams on 4
  logical threads — the render thread starves during chunk streaming
  (sustained 54-60 fps while flying fast, vs 90-180 walking). Smart RD also
  never fired: it only dropped the render distance below 22 fps, so the RD
  stayed high while the mesh queue backed up.

### Chunk-build pool capped at 2 threads on <=4-thread CPUs (FPS Boost 1.0.26)
- `chunkBuildThreads()` now caps the mesh pool at 2 threads (was cores-1 = 3)
  on 4-thread machines, regardless of preset: game thread + integrated server
  already take 2 logical threads, so 3 mesh threads on top oversubscribe the
  CPU. The pool still scales with bursts up to that max; user-set
  `chunkThreadsMax` overrides still win. Machines with >4 cores unchanged.

### Smart Render Distance now reacts to a backed-up mesh queue (FPS Boost 1.0.26)
- New trigger: when the chunk-mesh queue is deep (>=120 pending) AND the fps
  is stuck near display rate (<60), Smart RD drops the render distance by 1
  every 2s until the queue drains — the exact "outrunning the chunk loader"
  case that the old <22fps trigger never caught (54-60 fps while flying).
- Restore now also waits for the queue to drain below 60 before raising the
  distance back, so it doesn't fight the streaming.

### ParallelGC capped at 2 threads on all low-core tiers (launcher)
- `jvmFlagsFor`: the ParallelGC path now uses Math.min(2, cores) for every
  low-core tier (was 3 for balanced-on-weak). 2 physical cores get no
  parallel-GC speedup beyond 2 workers; 3 just spreads the same work thinner
  while the game + integrated server sit stopped. G1/strong machines unchanged.
- FPS Boost 1.0.25 → 1.0.26; existing profiles auto-upgrade (stale jar sweep).
- NOTE: the V1 test ran an OLDER launcher version. Re-run the test on that PC
  with this build to validate; the launcher downloads its own Java 25 (the
  system Java 8 reported can't run Minecraft 26.2 at all).

Verified: gradle build (mod, JDK 25, Minecraft 26.2), tsc node+web clean,
launcher build clean.

## v1.0.70 — chunk-pipeline deep audit: async decode can't self-disable on a rare null slot + stale-mesh protection follows the build pool + FPS Boost 1.0.25

### Async chunk decode can no longer silently disable itself (FPS Boost 1.0.25)
- `applyDecodedChunk` read the target slot with `chunks.get(index)` and called
  `isValidChunk(existing, …)` on it. On the rare case where the slot was never
  installed (a first-time chunk, or a view-ring pre-fill miss) `existing` is
  null → NPE → and 3 NPEs in 30s made the SafetyGate silently disable the
  whole async decode module — the exact ghost-failure pattern this pipeline
  must never have.
- A null/absent slot now simply installs the decoded chunk (matching vanilla's
  "no valid chunk → create + set" flow); the re-apply empty-sections path is
  preserved.

### Stale-mesh protection now follows the chunk-build pool (FPS Boost 1.0.25)
- The stale-mesh skip (don't finish compiling a section whose chunk already
  left the loaded area) was gated on `asyncChunkDecode` — but the tuned
  chunk-build pool is used whenever the mod is active without Sodium, even
  with async decode OFF in the K menu. Fast movement with decode off kept
  re-compiling stale sections and backlogged the mesh queue exactly when it
  needed to catch up. The skip now matches the pool's own gate
  (active && !Sodium).

### Micro: no per-tick allocation when nothing was decoded (FPS Boost 1.0.25)
- `applyReady` allocated a batch list every game tick even when the ready
  queue was empty; it now peeks first (O(1)) and allocates only when there is
  something to apply.
- The rest of the pipeline (last-wins dedup, bounded drop-least-relevant
  queue, nearest-first apply budget, world-change flush, stale-apply
  rejection, never-CallerRuns decode pool) re-verified — coordination correct.
- FPS Boost 1.0.24 → 1.0.25; existing profiles auto-upgrade (stale jar sweep).

Verified: gradle build (mod, JDK 25, Minecraft 26.2), tsc node+web clean,
launcher build clean.

## v1.0.69 — your in-game FPS Boost toggles finally persist + AFK can't break Smart RD + texture-cache eviction no longer O(n²) + FPS Boost 1.0.24

### The launcher no longer resets your K-menu toggles on every launch (launcher)
- `seedFpsBoostConfig` overwrote `config/reimagined-fps-boost.json` with the tier
  defaults on EVERY launch — so any toggle you changed in-game (K menu:
  Reduce Particles, Simplify Clouds, AFK, Flat GUI, …) was silently reset back
  to the tier default on the next start.
- It now MERGES: the existing config file wins for every key it defines (your
  overrides survive), and tier values only fill in keys the file doesn't have.
- Frame-rate safety stays the launcher's call: `maxFps` is excluded from the
  user-wins merge on purpose (no user control writes it, and an old config from
  the v1.0.13-v1.0.44 era could persist a forced 60/120 cap — keeping it would
  re-trigger the exact v1.0.41 FPS regression through the in-game watchdog).

### AFK can no longer break Smart Render Distance (FPS Boost 1.0.24)
- The AFK frame cap (~10 FPS) collapsed Smart RD's frame-time average to ~10,
  so Smart RD ratcheted the render distance all the way down to 2 during AFK
  (and wrote options.txt every 2s), and after input returned the stale-low
  average kept dropping the freshly-restored render distance for seconds —
  visible fog right after coming back.
- Smart RD now stands fully down while AFK is active (AFK owns the render
  distance), and when AFK disengages the controller resets (fpsEma/lastEval/
  rdDropped) so it never fights the restored settings.

### Texture-cache eviction no longer scans the whole cache per write (FPS Boost 1.0.24)
- Every disk write ran a FULL directory listing to check the budget — O(n²)
  during big pack reloads writing thousands of cache files, backing up the
  writer thread and thrashing the disk. Eviction is now throttled to at most
  one scan per 2s (best-effort budget enforcement, first write of a session
  still reconciles).
- FPS Boost 1.0.23 → 1.0.24; existing profiles auto-upgrade (stale jar sweep).

Verified: gradle build (mod, JDK 25, Minecraft 26.2), tsc node+web clean,
launcher build clean.

## v1.0.68 — GC by core count (measured data) + chunk-storm detector finally fires on RTP teleports + FPS Boost 1.0.23

### The garbage collector is now chosen from REAL measured data (launcher)
- Analysis of 379 real PROF windows from your sessions found the #1 gameplay
  stutter source: the JVM GC. On the 4-thread iGPU laptop G1 spent up to
  2.8s of a 10s window collecting (gcMs=2778 — 28% frozen) with visible
  100-137ms pauses. G1's concurrent marking phase contends with the game AND
  the integrated server on few threads.
- `jvmFlagsFor` now picks the collector by core count: potato/turbo tiers and
  balanced-on-≤4-core machines launch with **ParallelGC** (parallel STW,
  no concurrent marking phase, soft pause goal via the adaptive size
  policy, GC threads capped to 2-3 so cores stay on the game). Strong
  machines keep G1 unchanged; balanced G1 additionally gets 1MB regions
  (cheaper, more targeted young collections) and an earlier mixed-GC start
  (IHOP 45) to avoid the big full GC that showed up as 100-137ms pauses.
- High tier keeps the exact proven flag set — nothing changed for beefy PCs.
- Both flag sets smoke-tested against the bundled Java 25 (no rejected
  options).

### ChunkStabilizer finally detects RTP/teleport chunk storms (FPS Boost 1.0.23)
- The storm detector required CONSECUTIVE slow frames (5 in a row) and
  NEVER fired during your 19s RTP loads: a single long meshing hitch (up to
  1.7s) is ONE slow frame, then fast catch-up frames reset the counter —
  zero 'S' correlation across all 379 windows.
- Replaced with an exponentially decaying pressure gauge (0.95/frame): slow
  frames (>50ms) add pressure, a genuine freeze (>=400ms) adds a strong
  nudge, and intermittent fast frames are tolerated. Throttle fires around
  7 slow frames or ~2 hitches; recovery still needs 40 calm frames.
- Storm threshold raised to 50ms so sustained 29-32fps shader sessions
  (GPU-bound, iGPU) don't read as a storm and throttle chunk threads for
  zero gain — the real RTP/meshing hitches (244-1741ms) are still caught.
- FPS Boost 1.0.22 → 1.0.23; existing profiles auto-upgrade (stale jar sweep).

Verified: gradle build (mod, JDK 25, Minecraft 26.2), tsc node+web clean,
launcher build clean, Java 25 flag acceptance smoke test.

## v1.0.67 — chunk-pipeline audit: spike correlation now tells the truth + reload windows can't overlap-cancel + FPS Boost 1.0.22

### Spike correlation actually identifies the stutter source now (FPS Boost 1.0.22)
- The PROF line reports which periodic system coincided with each spike frame
  (spkTasks=C/A/P/S). It was meaningless: the stabilizer bit was never set
  anywhere, and AFK + the chunk pipeline were marked UNCONDITIONALLY every
  tick (their per-tick polling is cheap and always runs) — so every spike
  showed 'A' and 'P' and 'S' never appeared. You could not tell what caused
  a hitch.
- Now each bit is set only when that system is ACTUALLY doing work: AFK only
  while AFK throttling is active, the pipeline only when it really applied
  chunks (it is suspended during resource reloads), and the stabilizer while
  a chunk storm is throttling. The correlation data is finally honest.

### Overlapping reloads can no longer end the window early (FPS Boost 1.0.22)
- LoadingBoost used a boolean "reloading" flag: if a shader pack reload
  started while a resource pack reload was mid-flight, the first one to
  finish cleared the flag while the second was still loading — background
  systems resumed mid-load and the window could show "Not Responding".
- The window is now a depth counter: it only closes when the LAST reload
  finishes. Start (client thread) and end (future-completion thread) are
  synchronized, and the measured reload durations stay correct for
  overlapping loads.

### Hardening
- `ChunkStabilizer.throttling` is now volatile (written on the render thread,
  read on the game thread for the correlation mask).
- Deep audit of the chunk pipeline (LevelRendererMixin pool hand-off,
  ClientChunkCacheMixin async decode, ChunkPipeline bounded/last-wins/stale-
  rejected apply, CompileTaskMixin stale-mesh skip, world-change flush) —
  all coordination correct; no further changes needed there.
- FPS Boost 1.0.21 → 1.0.22; existing profiles auto-upgrade (stale jar sweep).

Verified: gradle build (mod, JDK 25, Minecraft 26.2), tsc node+web clean,
launcher build clean.

## v1.0.66 — Smart Render Distance respects your settings + particle distance culling + FPS Boost 1.0.21

### Smart Render Distance no longer fights your render distance (FPS Boost 1.0.21)
- The old logic oscillated between RD 2 and the auto cap regardless of your
  choice: it permanently dropped a manually-raised render distance (e.g. 32 →
  the 10-chunk cap, forever) and re-raised one you deliberately lowered.
- Now it tracks YOUR ceiling (session start + any change you make — a raise
  or a lower while it is mid-drop is adopted instantly) and only ever restores
  what it dropped itself, never above your setting. It still lowers RD under
  real load (below ~22 FPS) and returns it when the load clears — the FPS
  protection is unchanged, the fighting is gone.
- The now-meaningless "Smart RD Cap" cycle button was removed from the
  in-game screen (K menu).

### Particle distance culling — storm rain and far-away particles cost nothing
- In dense scenes (120+ particles in a group), particles farther than 128
  blocks from you are sub-pixel dust (storm rain at the horizon, distant
  farm ambient) — they are now dropped before ticking and rendering, with
  the same per-type particle-limit accounting as occlusion.
- New in-game toggle "Particle Distance Cull (128+ blocks)", on by default,
  fully independent from the occlusion toggle. Rain storms on integrated
  GPUs are the biggest visible win.

### FPS Boost 1.0.20 → 1.0.21
- Smart RD state machine (above), distance cull, dead button removed.
- Existing profiles auto-upgrade (stale jar sweep) — nothing to reinstall.

Verified: gradle build (mod, JDK 25, Minecraft 26.2), tsc node+web clean,
launcher build clean.

## v1.0.65 — the Performance profiler actually parses the game's real data (fixes the rich stutter metrics) + FPS Boost 1.0.20

### The rich frame-time telemetry is finally read (launcher)
- The in-game mod emits a PROF line every ~10 s with REAL frame statistics
  (avg / low / p95 / p99 / 1% low / 0.1% low / max frame ms / tick ms /
  GC ms / spikes / frames / heap). The launcher's parser regex skipped the
  p95/p99 fields, so it NEVER matched the real line — the 1% and 0.1% lows,
  the max frame time, tick time and GC time were silently never recorded
  (basic sessions still worked through the legacy PERF line).
- The regex now matches the real format and maps every field to its correct
  position (verified against a simulated line). From this release on, the
  Performance tab's session history carries the real stutter metrics — the
  data the RPE self-learning needs to actually act on hitches, not just
  averages.

### "Low FPS" is the real minimum again (FPS Boost 1.0.20)
- The PROF line computed its "low" from the FASTEST frame in the window
  (sorted[0]) — it reported the session's PEAK fps as the low, silently
  flattering the worst-case number. Now it reads the SLOWEST frame
  (sorted[last]): the low is the genuine minimum, matching what the legacy
  PERF line already reported.
- Existing profiles auto-upgrade (stale jar sweep) — nothing to reinstall.

Verified: gradle build (mod, JDK 25), tsc node+web clean, launcher build
clean, regex validated against the exact emitted line format.

## v1.0.64 — more CPU FPS everywhere: particle occlusion culling, entity-animation limits back on, GC thread caps for weak CPUs, FPS Boost 1.0.19

### Particle Occlusion Culling — particles hidden inside blocks no longer cost anything (FPS Boost 1.0.19)
- Cull-Particles-style sweep: every particle whose position is inside a solid
  block is removed BEFORE it ticks and renders. You can never see a particle
  inside a full cube, so it was pure CPU + GPU waste — the exact cost behind
  explosion/TNT smoke billowing through terrain and block-break debris buried
  in solid ground.
- Density-gated: the sweep only runs when a particle group holds 120+ particles
  (TNT chains, packed farms) — ordinary scenes pay literally nothing, and
  block-break particles (which spawn at a solid block's face) are never culled
  by accident.
- The MC 26.2 per-type particle-limit counters are decremented on removal
  (mirroring vanilla's own death path via the engine accessor), so the new
  particle-limit system can never drift out of sync. Any hiccup falls back to
  vanilla through the SafetyGate.
- New in-game toggle "Particle Occlusion" (K menu), on by default.

### Entity-animation limits are back on — big win for packed farms (launcher)
- The launcher was seeding `limitEntityAnimations: false` on every launch — a
  stale override from the OLD v1.0.1 cache (which had a glint artifact). The
  bundled mod's cache is the modern rewrite (per-tick cleared, near-distance
  exempt, crowd-aware), and this flag being off also silently disabled the
  whole entity-crowd density system.
- It now ships ON: distant entities (beyond ~48 blocks) reuse their extracted
  render state within a tick instead of re-extracting every frame — real CPU
  savings when hundreds of entities are around (the 500-entity farm test).
  Entities near you are never throttled; toggleable in-game ("Limit Entity
  Animations").

### GC thread caps — fewer hitches on weak CPUs (launcher)
- On a 4-thread CPU, G1 defaults to ~4 parallel GC threads, so a collection
  pause pre-empted the game AND the integrated server at once — the micro-
  hitches seen in chunk-heavy moments (ocean/world load, TNT chains).
- The JVM args now cap GC threads per hardware tier (2 parallel + 1 concurrent
  on potato/turbo, 4 + 2 on balanced/high, always min real cores) so the game
  keeps cores during collections. Generous caps on strong machines — nothing
  is lost there.

### FPS Boost 1.0.18 → 1.0.19
- New ParticleGroupMixin + ParticleAccessor + ParticleEngineAccessor (all API
  names verified against the 26.2 deobf jar before writing: ArrayDeque queue,
  protected updateCount, cached no-arg isSolidRender()).
- Existing profiles auto-upgrade (stale jar sweep) — nothing to reinstall.

Verified: gradle build (mod, JDK 25, Minecraft 26.2), tsc node+web clean,
launcher build clean.

## v1.0.63 — shaders that crashed on your PC are flagged, update checks stop hammering the API, FPS Boost 1.0.18

### Shaders that already crashed are now marked "Crashed on this PC"
- When a shader crash is recorded (v1.0.62), the ACTIVE pack is now captured
  too — read from iris.properties (shaderpack=), with a fallback to the lone
  pack in the shaderpacks/ folder.
- The hardware-fit badge on shader cards (Mods browse) and the shader detail
  page gains a level that wins over every GPU guess: if that exact pack
  crashed on this machine before, the badge shows a red "Crashed on this PC"
  with an honest hint — you can still install it, at your own risk, and the
  v1.0.62 auto-recovery protects the next launch if it crashes again.
- Matching is fuzzy but safe: pack names are normalized and compared in both
  directions with a 4+ character guard, so a folder named "lite" can never
  flag "BSL Lite" by mistake (no false-positive red badges).

### Update checks stop bursting the API (launcher)
- The Installed panel re-ran the full update check on EVERY sub-tab switch
  (Mods → Resource Packs → Data Packs → Shaders): one provider lookup per
  installed item per switch, so a 100-mod profile fired ~100-200 requests
  every time — a burst that could trip Modrinth's rate limit (the 429 family)
  and made the panel feel slow.
- The check now runs once when the panel opens or the profile changes;
  sub-tab switches re-render the stored badges, which stay fresh because the
  check persists its results before returning.

### FPS Boost 1.0.17 → 1.0.18 (four real bugs fixed)
- AFK Mode and the chunk-storm stabilizer both adjusted the same chunk-build
  pool maximum and overwrote each other (AFK→1, storm→baseMax−2), oscillating
  every tick when both were active. They are now ONE state machine — AFK wins
  the floor, storm pressure only applies when not AFK.
- The texture decode cache now scopes its key by decode format: the same bytes
  read as RGBA and as RGB are different outputs, and restoring the wrong one
  would corrupt textures. A format mismatch is a clean miss, never a wrong
  image.
- Cache stores snapshot the FULL pixel buffer position-independently (the old
  read from the buffer's current position could truncate entries), and
  validation now uses each format's real bytes-per-pixel, so RGB and
  luminance textures cache correctly too.
- The in-game settings screen's four cycle buttons (RD cap, AFK threshold,
  crowd budget, debris cap) used a hardcoded two-column grid — on narrow
  windows two of them rendered off-screen and were unreachable. They now
  follow the same column layout as the toggles.
- Hardening: the on-disk cache key separator is '_' (the old ':' is invalid in
  filenames on Linux/macOS), and the chunk-build pool honors a governor state
  already set before the pool was created.
- Existing profiles auto-upgrade (stale jar sweep) — nothing to reinstall.

Verified: gradle build (mod, JDK 25), tsc node+web clean, launcher build clean.

## v1.0.62 — Direct shader crashes (GPU hang) now trigger auto-recovery

### The gap
- The crash assistant only ran its check when the game exited with a NON-ZERO
  code. A hard shader crash (GPU hang / TDR — like the Sodium/Iris "Cannot wait
  on a fence" failure on Intel HD iGPUs) can kill the process with exit code 0,
  so nothing was recorded: no entry in shader-crashes.json, and the armed
  shader-crash flag was cleared on exit — the auto-recovery that disables
  shaders on the next launch never armed, letting the crash loop forever.

### The fix
- Crash detection now runs on EVERY game exit, using the fresh crash-report
  file as the ground truth (the exit code is not reliable for GPU-hang kills).
  When a crash is detected it is recorded in shader-crashes.json and the
  shader auto-recovery flag stays armed — so the next launch starts with
  shaders disabled and a clear message ("Minecraft crashed last time while
  shaders were enabled…"), and you can simply re-enable them in the game.
- A clean exit or a manual Stop still clears the flag exactly as before; only
  a confirmed crash (or an uncertain detection) keeps recovery armed — no
  false positives, and a "Direct Crash" can never silently slip past again.

Verified: tsc node clean, launcher build clean.

## v1.0.61 — FPS recovery: chunk-loading GC stutter killed + smoother combat/explosion particles

### Why this exists — the V2→V3 FPS dips
- Between the V2 and V3 benchmark sessions, six scenarios moved down (ocean
  chunks, breaking blocks, survival, creeper, camera across a new world,
  walking). Two of them had a REAL, addressable root cause; the rest of the
  difference was session variance (different world density, seed, thermals).
  This release fixes the two real ones.

### Chunk-heavy scenes no longer stutter (GC heap-resize fix)
- The launcher started Minecraft with `-Xms256M` — the JVM had to GROW the heap
  during gameplay, and every growth step can pause the game thread. That is the
  exact micro-stutter behind the dips in ocean chunks, world loading, survival
  and panning the camera through new terrain.
- The initial heap is now pre-tuned to ~50% of the profile's Xmx (min 1G,
  clamped to never exceed Xmx so low-memory profiles stay valid). G1 runs
  stable young-gen collections instead of resizing mid-game — noticeably
  smoother chunk generation and world loading.

### Sustained particle bursts are now governed (FPS Boost 1.0.17)
- The particle governor only reacted to TNT-chain bursts (>400 adds per 750 ms,
  keep 2/8). Fast block breaking, creeper blasts and combat produce a steady
  200-400 adds per 750 ms — under the old threshold, so they rendered at full
  density and stole frames on integrated GPUs.
- New tier: beyond 240 adds/750 ms the engine keeps 3/8 of particles until the
  scene settles. TNT chains keep the existing 2/8, and normal scenes are
  unchanged. No gameplay or visual-feel changes outside heavy particle scenes.
- Bundled Reimagined FPS Boost updated 1.0.16 → 1.0.17; existing profiles
  upgrade automatically on next launch (stale jars are swept).

Verified: tsc node+web clean, launcher build clean, mod built with Gradle
(JAVA 25, Minecraft 26.2).

## v1.0.60 — Full UI polish pass + the entire launcher in English

### A premium visual pass across every screen
- **Home hero**: the hero title/description had zero vertical rhythm (the global
  reset collapsed them together) — now proper spacing and typography, panel
  depth, and the Play button is the signature moment: a soft purple halo
  breathes around it (GPU-cheap transform/opacity, stops on hover/disabled).
- **Consistent surface depth**: stats, profile cards, share actions and the
  category sidebars (Mods / Modpacks) now sit on the same subtle panel surface
  as the rest of the app instead of floating as flat text.
- **Settings**: the theme picker was rendering as raw unstyled OS buttons —
  now proper cards with hover and a purple glow on the selected theme. The
  performance preset row (Auto/Potato/Balanced/High/Turbo) finally shows which
  tier is active and each preset has its label. Session rows unified with the
  rest of the list styling.
- **Logs**: the search bar icon floated outside the input — now a real search
  box with a purple focus ring; the active level filter pill was losing its
  accent background (specificity) — fixed.
- **Account**: the "Not signed in" state used the spinning progress ring
  (looked like it was loading forever) — now a clean static badge.
- **Game console**: status dot was always green even when idle (ghost state) —
  now grey when idle, pulsing green only while the game runs; the whole window
  switched from mono font to the UI font (only log lines stay mono), got the
  signature purple hairline and a consistent minimize icon.
- **Empty states** everywhere (no mods, no results, no downloads) now render as
  a polished circular badge with a soft glow instead of a bare icon.
- **Color discipline**: all hardcoded greens/reds/yellows replaced with the
  real theme tokens (--success/--warn/--danger); removed the blocky
  Minecraft-style text-shadow on Play/Account titles in favor of a soft
  elevation shadow.

### The entire UI is now in English
- Shader hardware-fit badges were the only remaining Spanish strings ("Apto
  para tu PC", "Limitado", "Sin verificar" + their risk hints) — all
  translated to "Suitable for your PC" / "Limited" / "Unverified" with clean
  English hints. Audited the whole renderer, main process and game console for
  any other non-English user-facing text — none left.

Verified: tsc node+web clean, build clean.

### You no longer have to sign in again after every update
- **Root cause**: after an update the launcher restarts and THREE things try to
  refresh the Microsoft session at once (startup, the account status check, and
  Play). Microsoft rotates the refresh token on every refresh, so the concurrent
  requests raced: one won and the others got rejected (invalid_grant), which
  marked the session as "expired" and left the game unable to authenticate —
  forcing a logout + re-login almost every update.
- **Fix**: token refresh is now single-flight — every caller shares ONE refresh,
  so no two requests ever use the same refresh token. Transient hiccups (network
  blips, rate limits) are retried with a short timeout and never mark the session
  as dead; only a genuine Microsoft rejection does. A dead session is reported
  once (with a 2-minute cooldown), not spammed by the account re-check loop.
- **Cleaner launches**: if a session genuinely can't be refreshed anymore, the
  launcher now stops BEFORE starting Minecraft with a clear message ("Your
  Microsoft session has expired — sign in again") instead of letting the game
  fail mid-boot with a cryptic "cannot authenticate".

## v1.0.58 — Mods that delete themselves are fixed + install dialog centers on screen + CurseForge infinite scroll

### Mods were disappearing on their own (root cause fixed)
- **Root cause**: updating a mod removed the installed file FIRST and downloaded
  the new one after. If that download failed (Modrinth/CurseForge rate limit,
  network drop, proxy waking up), the mod was permanently gone — "mods delete
  themselves" with nothing touched.
- **Fix**: updates (per-item, Update All, Change Version) now download the new
  file to a temporary name and only swap it into place AFTER the download
  succeeds. A failed update leaves the installed mod completely untouched.
  Applies to every content type (mods, resource packs, data packs, shaders).

### Install confirmation now appears in the middle of your screen
- **Root cause**: the page wrapper animates with a transform (page-enter),
  which breaks position:fixed — the install dialog rendered anchored to the
  top of the page content, forcing you to scroll back up to accept it.
- **Fix**: the Install confirmation and the Update All preview are now portaled
  to the document body, so they center on the viewport no matter how far down
  you scrolled. The "..." overflow menu in the detail page keeps its own
  screen-edge-aware positioning.

### CurseForge finally has infinite scroll (like Modrinth)
- **Root cause**: CurseForge's search hardcoded `index: 0`, and the browser tab
  never wired up pagination — you could only ever see the first page.
- **Fix**: real offset/limit pagination flows end-to-end (proxy → main → IPC →
  renderer), with the same scroll-to-load-more sentinel Modrinth already had,
  a stale-response guard so slow proxy answers never clobber a newer search,
  and proper reset on error.

### Downloads cover art shows again
- **Root cause**: download cards used a direct <img> to remote CDNs, which the
  renderer CSP blocks — covers intermittently didn't load.
- **Fix**: artwork now renders through the same reliable image proxy as
  everywhere else (with a clean fallback), so covers always appear.

### Launcher feels lighter / less janky while browsing
- Removed the per-row entrance animation that replayed on every load-more
  batch (24+ rows animating at once = visible jank while scrolling results).
- Icon images now decode asynchronously and lazy-load offscreen, keeping the
  main thread free while scrolling long lists.

## v1.0.57 — Modrinth icons render at full resolution again

### Installed / browse / detail icons (Modrinth)
- **Root cause**: Modrinth's API started returning 96x96 `_96.webp` thumbnails
  as `icon_url`, so installed items, browse cards and detail headers showed
  blurry logos (CurseForge avatars stayed sharp, which made Modrinth look
  broken in comparison).
- **Fix**: the image proxy now upgrades any Modrinth thumbnail URL to the
  project's full-res `icon.png` (512x512, e.g. sodium, c2me, cloth-config,
  bobby) with a one-time probe per URL, falling back to the thumbnail for
  projects that have no full-res icon (advancement-plaques, chat-animation).
  Applies everywhere icons render: Installed rows, Modrinth/CurseForge
  results, project detail, install confirm, update-all preview, downloads.

## v1.0.56 — TNT/inventory frame-rate fixes + per-shader hardware-fit badges

### FPS Boost mod 1.0.16 — the two dips from the FPS test V2
- **Explosion Debris Cap (TNT 5×5)**: a big TNT chain turns hundreds of
  destroyed blocks into falling-block entities — each one ticked (gravity +
  collision) AND rendered as its own block model, the exact spike behind the
  6 FPS dips. The cap (48 by default, 32 on the potato preset) stops the
  overflow from animating: the blocks are still destroyed by the blast
  (gameplay identical), only the flying debris of the extra bulk is skipped.
  Singleplayer-only (the remote server controls multiplayer spawns).
  New "Explosion Debris Cap" cycle button in the in-game menu (K).
- **Flat GUI Background (inventory)**: skips the full-screen Gaussian blur
  that translucent screens (inventory, pause) run over the world behind
  them — the single most expensive frame on integrated GPUs (29 FPS opening
  the inventory on an HD 620). The background stays dark/flat instead of
  blurred. New "Flat GUI Background" toggle in the in-game menu (K).
- Both are on by default and live-toggleable; entity post-effects (portals,
  spyglass) are untouched.

### Per-shader hardware-fit badge
- While browsing shader packs, every card AND the detail page now show a
  badge telling you whether THIS machine can realistically run that pack:
  green "Apto para tu PC", amber "Limitado", or red "No apto para tu PC".
  You can always install it — the red badge is your "instalar bajo tu
  propio riesgo" warning up front, with the reason visible on the detail
  page. Based on the real Shader Guard assessment (VRAM / driver);
  lightweight packs (Lite/Potato/Performance) get a one-step mercy on
  low-VRAM machines.

## v1.0.55 — Update All persistence fix (single source of truth)

### Update All no longer re-flags updated mods as outdated
- Root cause: the update re-check (`checkUpdates`) compared against a
  DIFFERENT source than the install/update path. Installs resolved the
  newest file with `curseforge.latestFile` / `modrinth.latestVersionFor`
  (filtered by MC version + loader), but the re-check used an unfiltered
  `listVersions` pass whose compatibility check accepted loader-less or
  other-loader files — so it could find a different, newer-dated file
  that Update would never install and flag freshly-updated mods as
  outdated again, forever (observed with YetAnotherConfigLib being
  "updated" repeatedly to the same jar: 09:59 / 10:01 / 11:09).
- Fix: `checkUpdates` now resolves the newest file with the EXACT same
  resolvers the install/update path uses (single source of truth). If
  that resolver returns the version already installed, the mod is up to
  date — no date heuristics that can disagree with what Update installs.
- The check is also bounded to 6 concurrent provider lookups instead of
  firing one per mod (100+ simultaneous calls caused HTTP 429
  rate-limits that left stale update badges behind).
- Applies uniformly to mods, resource packs, data packs, shaders and
  hash-matched manual items.

## v1.0.54 — hover audio pool, crisp transitions, gallery zoom + bug sweep

### 1) Hover audio pool (every interaction is heard)
- `sound.ts` now runs a small voice pool with priorities instead of
  aggressive cooldowns: important feedback (0) > clicks/tabs/panels (1) >
  hover ticks (2). Up to ~8 hovers can play at once; when the pool fills,
  the OLDEST lowest-priority voice is faded out — a hover never interrupts
  a click or an important cue, and an important cue can always claim a slot.
- Hover no longer has a suppressing cooldown (only a 1ms same-event dedupe),
  so sweeping the mouse across 10–20 buttons now sounds EVERY hover. When
  many hovers overlap, their individual gain eases down automatically — a
  soft roll, never a machine-gun or a volume spike.
- Startup atmosphere is a more developed intro bed (deep sub pad + warm pad
  + fifth shimmer + faint air — all soft, nothing piercing), and the whole
  cue still respects master volume and the mixer/limiter.

### 2) Startup fixes
- The redundant REIMAGINED wordmark below the splash logo was removed — the
  logo itself carries the branding; the scene now settles on the logo as the
  single hero before the signature beat.
- The startup sound could play TWICE (a parent re-render re-fired the inline
  splash callbacks). Splash callbacks now use stable identities + refs and
  the splash effect runs exactly once; all beat timers are cleared on
  unmount.

### 3) Crisp, GPU-clean transitions (no more blur/lag feel)
- Page transitions no longer scale text mid-flight: `pageIn` is a pure
  translate + opacity, and the between-page "dip" is opacity-only (the old
  `scale(0.998)` on the gradient+text layer was the blurry/laggy look).
- `.page-enter` is promoted to its own compositor layer during the entrance;
  `prefers-reduced-motion` now disables the ambient layer and all decorative
  entrance animations (including splash children).

### 4) Gallery sharp + full-screen zoom
- Screenshots use the provider's highest-resolution source (`raw` original
  from Modrinth) in the hero and the lightbox — verified the image proxy
  never downscales, so zooming reveals real detail.
- The full-screen lightbox adds scroll-wheel zoom (1x–6x, centred on the
  cursor), with the zoom % in the counter and a reset on navigating between
  screenshots.

### 5) Update dialog: no more stale flash
- The moment the download completes, the dialog switches to a final
  "Closing launcher…" state — the old Cancel/Remind Me Later/Close buttons
  can never flash back during the ~1.5s before the app exits. If the
  automatic relaunch hasn't happened within ~3s, a "Relaunch Reimagined"
  fallback appears instead of a silently dead screen.

### 6) Redundant search bar removed
- The global top-bar search hides on the Mods and Modpacks screens, where a
  page-specific search already sits directly below it — no more confusing
  double search input.

### 7) Sweep + polish
- Checkboxes (confirm dialogs, toggle rows) now use the Reimagined accent
  instead of the raw OS widget.
- "Update All" preview's confirm button shows the REAL total count (not the
  40-row preview cap) with a clear note that the cap is only the preview.

## v1.0.53 — premium audio system + living UI motion

### 1) Premium audio system (same sounds, totally new soundscape)
- `sound.ts` rebuilt as a real mixer: SFX + music buses flow into a master gain
  through a DynamicsCompressor limiter, so rapid interactions can never clip or
  spike the volume.
- Every tone now has a natural envelope: tiny attack, body, release step and a
  60–300ms micro-tail with a faint harmonic resonance — no more hard `click →
  STOP`, sounds now feel like they live in a small acoustic space.
- Automatic ducking: when an important cue plays (notification, download,
  install complete, update available, error) the music/ambient bus dips ~45%
  for a third of a second and glides back.
- Intelligent layering: per-cue cooldowns (hover 55ms, click 28ms), a cap on
  simultaneous voices, graceful termination of old instances and ±1.5% pitch
  jitter so rapid clicks never sound robotic.
- New context cues: tab switches, panel open/close, menu open — with a soft
  "expanding" feel instead of isolated SFX.
- Startup sync: the cinematic splash now has per-phase audio beats
  (atmosphere → ring → logo → typography → signature → transition) scheduled
  with 30–80ms offsets against the visuals, so the intro is one composition.
- Startup sound + ambient music route through the mixer (music plays under a
  gentle bus fade); the "Music on first open" toggle still works.

### 2) UI motion, depth & living background
- Page transitions: a premium fade+rise switch (220ms) between every major
  page — the sidebar stays put while content transforms, with a purple
  signature sweep on the active nav item.
- Subtle depth system: background < panels < interactive elements, with
  restrained shadows, tiny contrast steps and a soft glow only on active
  controls — no glassmorphism, no heavy blur.
- Living background: a near-imperceptible animated layer (two slow drifting
  purple orbs + sparse dust particles, all GPU-friendly CSS transforms). On
  weak hardware (`data-bg-lite`) the layer drops to a single static gradient
  and zero animation to protect Minecraft performance.
- Unified motion language via CSS variables (easing, durations) so every
  modal, tab, card and button animates with the same feel; signature thin
  purple light line on nav activation as the launcher's visual mark.
- The golden rule applied: any animation without a purpose was left out —
  everything moves fast (≤450ms), communicates state, and stays lightweight.

## v1.0.52 — cinematic startup + 8 reliability/UI fixes

### 1) Premium startup animation (rebuilt from scratch)
- The old 2.6s fade-in splash is gone. The new ~4.3s cinematic sequence is a
  five-stage intro: dark atmosphere with faint purple particles and a breathing
  radial glow → an energy line draws a luminous ring around the centre → the
  Reimagined logo is physically CONSTRUCTED (clip-path wipe + light sweep +
  converging glow, no plain fade) → REIMAGINED typography locks in letter by
  letter → a signature moment (one final ring sweep, a soft purple light pass
  and a tiny outward particle burst) → the scene dissolves into the launcher.
- Pure CSS transforms/opacity + one SVG — GPU-cheap, skippable by click or any
  key, never blocks initialization, and the whole sequence stays under 5s.

### 2) No more raw HTTP 429 HTML dumps (root cause, fixes the recurring
    "Could not load this project" / "Could not load versions" errors)
- `http.ts` errors no longer embed the raw response body (often an HTML error
  page) in the message — it stays on `.bodyText` for logs only. `getJson`
  retries 4× with exponential backoff and honours a `Retry-After` header.
- Modrinth traffic is now globally paced (2 concurrent + a 40ms gap) so normal
  use stops triggering rate limits in the first place.
- `friendlyError` scrubs any raw HTML/XML that slips through and maps 429 to a
  clean "rate-limiting requests right now — try again" message.

### 3) Downloads can no longer get stuck at 100% (fixed for real)
- Progress emits in the downloader now carry the stable entry id, and terminal
  states are STICKY in the tracker: a late progress event can never resurrect a
  finished download as a ghost 'downloading' entry at 100% while the real one
  sits in History. The 30s late-duplicate guard only fires for >=99% progress.
- When nothing is downloading, the in-progress area says so instead of
  looking broken.

### 4) "Update All" is now a real preview list
- Clicking Update All opens a lightweight list — one row per mod with its icon,
  name and "current → new" where the new version sits on a green pill — plus a
  single confirm. Holding Shift still updates everything immediately.

### 5) Modpack .zip import preview: icons + remove-per-mod
- The import preview shows the same clean list style (icon, name, version).
  Each item has a Remove action (confirmation unless you hold Shift) so you can
  drop content before importing; removed items are excluded from the install.

### 6) The "..." overflow menu never cuts off at the screen edge
- The menu is now properly anchored below the button (dark, purple hover) and
  flips direction when it would run past the viewport edge.

### 7) Descriptions and changelogs render as real markdown
- Images render inline, ordered/unordered lists, blockquotes, tables, rules,
  fenced/inline code, bold/italic/strikethrough and links all work; malformed
  syntax degrades gracefully instead of dumping raw markdown.

### 8) Settings → Storage shows real disk space
- The storage row now reports the live free/used space of the drive that holds
  launcher data (queried from the filesystem), e.g. "59 GB free · 197 GB used",
  instead of the media-type label.

## v1.0.51 — versions you can see + cross-provider dedupe + searchable pickers

### 1) The "undefined" version bug (root cause found)
- Installing/updating a mod showed "Mod updated: X → undefined" and download
  labels like "[Bookshelf — undefined]". Root cause: the install/update paths
  read `version.versionNumber`, but the raw Modrinth payload uses snake_case
  (`version_number`), so the field was always undefined. The raw versions are
  now normalized into the camelCase shape in every path (latest version,
  SHA1 hash lookup, enrich), so installed/updated mods always carry their real
  version number.

### 2) CurseForge timeouts + Modrinth rate-limits
- CurseForge requests now allow 60 s (the Render free tier sleeps after ~15 min
  idle and the first request after a pause can take 30–60 s to wake the proxy;
  25 s used to abort before it answered) with a bounded retry, and the proxy
  itself uses a 45 s upstream timeout (redeploy backend/cf-proxy).
- Modrinth throttles bursts (HTTP 429) — JSON requests now retry with backoff,
  and the startup enrich of manually-installed mods is paced (4 workers +
  stagger) so a 100-mod folder can never trip the rate limit again.
- CurseForge files that omit downloadUrl now fall back to alternateDownloadUrl
  (fixes "CF_NO_URL" on some shaders).

### 3) Cross-provider "already installed" (Modrinth ↔ CurseForge)
- Browsing CurseForge while a mod is installed from Modrinth (or vice versa)
  now shows "Installed" and blocks a duplicate install — matched by real
  id/slug first, then by normalized title (same content type). Dependencies
  are deduped the same way, and the install dialog shows a clear "Already
  installed with Modrinth/CurseForge" state instead of offering Install.

### 4) Descriptions/changelogs render cleanly (no raw <p><strong>)
- CurseForge changelogs (HTML) and Modrinth changelogs that embed HTML are now
  sanitized with an allowlist renderer (scripts/event handlers/javascript:
  URLs stripped) instead of showing literal tags.

### 5) Content-type correctness + default A–Z
- Installed → Resource Packs → CurseForge now opens CurseForge on Resource
  Packs (the type used to stay "mods" there), with the category sidebar scoped
  per content type (pack categories for packs, shader categories for shaders).
- Browse results (mods, resource packs, modpacks) default to Name A–Z.

### 6) UI fixes
- Minecraft version / loader pickers are now a searchable, dark/purple
  dropdown (shared component used by profile creation/edit and modpack
  filtering) with arrow-key navigation.
- The "…" overflow menu on the detail page uses the app's dark context-menu
  styling and anchors cleanly under the button.
- "Update Available" no longer shows when already up to date: the detail page
  now compares against the newest version COMPATIBLE with the profile's
  Minecraft version + loader (the raw list used to trigger false positives).

## v1.0.50 — 5 launcher fixes + Legacy Fabric support

### 1) Installed list: real icons + real updates for manual mods
- Root cause: manual mods tracked as source "local" (registered before/while the
  matching pipeline ran) never re-matched, so they showed the Reimagined "R"
  placeholder and had no Update / Change Version / Update All.
- New enrich pass: already-tracked local items are re-matched against Modrinth
  (exact SHA1 of the jar -> exact version) and CurseForge (exact name), then
  upgraded to full provider tracking (real icon, versionId, version number) —
  the same capability as anything installed through Browse. Verified live on a
  real profile: Bobby's jar SHA1 resolves to its Modrinth version.
- Items with no provider match still get a real icon extracted from the file
  itself (fabric.mod.json "icon" for mods, pack.png for packs) instead of the
  generic placeholder. Provider identity is never guessed: packs now carry the
  exact platform that matched (Modrinth first, CurseForge fallback).

### 2) Downloads: no more stuck-at-100% spinner; Cancel only while active
- A completion could land on a NEWER entry with the same label while the one
  the user watched stayed "downloading" at 100% forever. Terminal updates
  (done/failed) now carry the exact download entry id, so the bar the user
  sees transitions to Complete/Failed in place and moves to History — and its
  Cancel button disappears the instant it finishes.

### 3) CurseForge tab fully functional
- Real category sidebar for CurseForge (new /api/cf/categories route on the
  proxy; derives from search hits if the deployed proxy is older).
- Category clicks now filter CurseForge results (categoryId via the real
  categories list, name fallback), and mods get the profile's loader filter
  (modLoaderType) — parity with Modrinth's sidebar/facets.

### 4) Legacy Fabric (Minecraft 1.13.2 and below)
- Creating a Fabric profile for old versions (1.8.9, 1.12.2...) used to fail:
  mainline Fabric Loader meta rejects them (HTTP 400). The launcher now
  detects the Legacy Fabric range automatically and resolves loader versions
  from meta.legacyfabric.net (loader dropdown included) — verified live for
  1.8.9 (0.19.3, artifacts on maven.fabricmc.net).
- Fabric API auto-install fixed for legacy versions: the Legacy Fabric API
  project tags its current builds with the "ornithe" loader, so the old strict
  fabric-loader filter returned zero versions for every legacy MC version.
  Legacy lookups filter on the game version only (26 builds for 1.8.9), and
  mod browsing relaxes the loader facet so ornith builds are visible.

Verified: tsc node+web clean, build clean, smoke 12/12, live checksum + manifest
verification after publishing.

## v1.0.34 — 3-option update prompt (no silent auto-update) + bundled FPS Boost 1.0.10
## v1.0.49 — Smarter install dialog (adapts to dependencies)

The install confirmation now adapts its actions to the item's real dependency
state instead of always showing the same two buttons:

- No dependencies at all -> a single clean "Install" button.
- Missing dependencies -> "Install with Dependencies (N)" as the primary action
  plus "Install Only" for just the item.
- Every dependency already installed -> "Install Only" as the only action, and
  the dialog still lists exactly which dependency the item needs (marked
  "Already installed"), so you always know what you are getting.
- The hint line on the left matches the case: no deps / required missing /
  optional missing / all already installed.

CurseForge items keep their single "Install" button (no dependency tree is
exposed through the proxy). Verified: tsc clean, build clean, smoke 12/12.
## v1.0.48 — CurseForge installs fixed (no more Modrinth errors)

### 1) The bug
CurseForge search results showed up fine, but clicking Install mentioned Modrinth
and failed. The install confirmation modal was hardcoded to Modrinth: it loaded
project details, versions and dependencies through Modrinth and called the
Modrinth-only install paths with the CurseForge numeric project id — so every
CurseForge install broke before anything downloaded.

### 2) The fix (renderer only — the backend was already correct)
- InstallConfirmModal is now provider-aware: detail/versions load through the
  real provider (CurseForge via the proxy), dependencies are skipped for
  CurseForge (its API exposes no dependency tree through the proxy — the item
  installs alone, with an honest note), and both install actions route through
  installVersion with the real provider. CurseForge gets a single "Install"
  button instead of the Modrinth-only dependency buttons.
- ProjectDetail: the CurseForge branch now runs BEFORE the shift-click
  install-with-dependencies fast path (which is Modrinth-only and was being
  called with CurseForge project ids). Shift-click on a CurseForge item now
  installs the item correctly instead of erroring.
- Tooltips and hint text are provider-aware so nothing promises Modrinth-style
  dependency behavior for CurseForge items.

### 3) Verification
- Live E2E against the CurseForge proxy: search -> files -> download-url ->
  real jar download with a valid zip header (Sodium, project 394468).
- tsc clean, build clean, smoke 12/12.

### 4) Note
Modrinth behavior is unchanged — the Modrinth code paths are byte-identical;
only CurseForge routing was added.
## v1.0.47 — Update pipeline self-healing (v1.0.46 failed-update fix)

### 1) The v1.0.46 update failure (fixed)
- The v1.0.46 manifest was generated with the OLD url (it still pointed at the
  1.0.45 installer) while version/sha256/size described 1.0.46. Every client that
  clicked Update downloaded the 1.0.45 exe, failed SHA-256 verification and showed
  "failed". The launcher behaved correctly (it refused the tampered/mismatched file);
  the manifest itself was wrong.
- The manifest has been corrected to point at Reimagined-Setup-1.0.46.exe and is
  verified end-to-end (url -> file -> sha256 match). If you saw the failure, click
  Check for Updates again (or wait for the auto re-check) and Update will now work.

### 2) Updater hardening so this class of failure self-heals (bundled in 1.0.47)
- When the downloaded update fails SHA-256 verification, the launcher now refetches
  the manifest FRESH (bypassing the 30-minute cache) and retries the download once.
  This covers a manifest that was just fixed/published and stale CDN copies of
  latest.json — the two real-world causes of "failed" updates.
- Only if the refetched manifest still mismatches is the failure reported (the file
  is deleted first so a later retry always downloads from scratch).
- Future release tooling now derives the manifest url from the version number, so a
  version/sha256/url mismatch like v1.0.46 cannot be generated again.

### 3) Verification
- tsc (node + web) clean, electron-vite build clean, smoke 12/12.
- Live end-to-end check after publish: manifest 1.0.47, url -> installer, sha256 match.
## v1.0.46 — Extended View removed + Settings cleanup

### 1) Extended View removed completely (launcher + bundled FPS Boost 1.0.15)
- The Extended View ghost-terrain system is gone: the persistent chunk-snapshot cache,
  the "ED: X/Y" HUD chip, the in-game capture hook and the Settings panel are all removed.
  It did not deliver the cached distant terrain it promised and added perceived lag, so it
  was deleted end to end rather than kept half-working.
- Launcher: extendedView / extendedViewDistance / extendedCacheLimitMB settings removed,
  IPC clear-cache handler removed, seeding/engine references removed (0 references left).
- Mod: extview package deleted, chunk-capture mixin removed, EXT HUD chip removed,
  config fields cleaned. Bundled FPS Boost is now 1.0.15 and auto-upgrades profiles.
- Any cache folders written by older versions are simply no longer read or written.

### 2) Settings reorganized — duplicates removed
- Danger Zone "Clear all logs" removed (it was an exact duplicate of General -> Logs
  -> "Clear Logs"; both clear the on-disk launcher log). Danger Zone keeps Clean Release
  Reset, which double-confirms.
- Appearance "Performance preset" picker removed — the Performance tab tier picker is the
  single control (it applies the preset together with the engine profile).
- Updates panel: removed the explanatory paragraph about the 3-option update prompt —
  the panel now keeps only the re-check frequency selector and the Check for Updates
  button (plus the installed/latest status line).
- Fixed a corrupted sentence in the Recommendations panel ("you decide what t\no apply"
  -> "you decide what to apply").

### 3) Verification
- Extended View: 0 references in launcher and mod sources.
- tsc (node + web) clean, electron-vite build clean, smoke 12/12.
- Bundled FPS Boost 1.0.15 (82 KB, was 107 KB with Extended View).

### Update prompt replaces silent auto-update
- The launcher NEVER downloads or installs an update without the user choosing
  "Update" — the old auto-install-on-start behavior is removed entirely.
- Every detected release now shows a 3-option prompt:
  - **Update** — download, SHA-256 verify, install, relaunch (one click).
  - **Cancel** — dismiss now; the next periodic check re-prompts (lighter).
  - **Remind me later** — no auto-prompts for the rest of this session; it
    returns on the next app launch.
- The prompt shows once per session by default; a manual "Check for updates"
  in Settings always asks. `autoInstallUpdates` setting removed.

### Bundled FPS Boost 1.0.10 (auto-upgrades every profile on next launch)
- **Extended View cache fixed**: chunks are now captured at the real eviction
  point (a Storage.drop HEAD mixin) BEFORE vanilla tears the chunk data down —
  the old hook left the persistent cache nearly empty ("ED 4/120") despite real
  exploration.
- **Periodic stutter source removed**: the ghost sweep now iterates the real
  cache index instead of calling Files.exists() on every cell (was 66k+ syscalls
  per second with a large extended distance).
- **Renderer budget**: Extended View computes at most 1x/s, ≤12 meshes and ≤4 ms
  per tick; a big warm cache can never hitch a tick.
- **Real spike correlation**: PerfProfiler now reports WHICH periodic system
  (watchdog/AFK/extview/pipeline/stabilizer) coincided with each spike frame
  (spkTasks=...) — recurring stutters are identified from data, not guesses.
- **Launcher gate fixed**: profiles carrying an old bundled jar (e.g. 1.0.4) were
  never upgraded because ensureFpsBoost only ran when the mod was absent — it
  now always runs (no-op when current, upgrades otherwise).

### GC tuning (measured)
- Tightened G1 MaxGCPauseMillis per real PROF data (balanced 45 / high 60, was
  60 / 80) — smaller, more frequent young collections instead of one visible
  large pause during calm gameplay.

---

## v1.0.12 — Anti-Crash System (Shader Guard) + FPS Boost pushed further

### Shader Guard — real anti-crash for the shader rendering path
- GPU/driver capability assessment BEFORE shader sessions: the launcher checks the detected GPU (vendor, VRAM, driver version) and refuses to launch a shader session on hardware that genuinely cannot run shaders — clear explanation instead of a crash.
- VRAM-aware safety: on low-VRAM GPUs the engine auto-reduces render distance when shaders are enabled, and warns the user.
- Auto-recovery: a crash while shaders were armed writes a flag; the next launch automatically disables shaders (real Iris config write) and tells the user why — no endless crash loop.
- Crash Assistant now recognizes shader-pipeline failures (Iris / GLSL / shader compile) plus resource-pack and world-loading crashes, with specific suggestions.
- New Stability section in Settings: shows the real hardware verdict, recent shader crashes, and the two safety toggles (auto-reduce render distance, auto-disable after crash). Manual "disable shaders now" per profile.
- Every shader decision is logged with full detail.

### Native FPS Boost — pushed further (always-on, tier-tuned)
- LOD for distant chunks: simplified merged geometry beyond a tier-tuned distance (smooth blend, no pop).
- Async chunk upload: mesh upload off the main render thread.
- Overdraw reduction: early-Z / depth-sorted opaque pass.
- Texture-atlas batching: fewer texture swaps per frame.
- NEW "Turbo" preset (beyond Potato): maximum FPS trade-off — aggressive LOD (32 chunks), quarter-density particles, fog-assisted distance cutoff, entity-animation reduction at 24 chunks. Never the default; clearly labeled.

### Measurement note (ongoing target: 100+ FPS on 2017-era hardware)
- The RPE profiler (real PERF lines from the game, never fake numbers) continues to record every session and self-learn render-distance caps. Before/after numbers for the LOD/overdraw layer require a real session on target hardware; the measurement pipeline is in place and results are tracked in data/perf/sessions.json.
- Roadmap for the next pass: per-chunk LOD baking, GPU-side occlusion queries, and startup data-fixer streaming.

## v1.0.14 — Shaders fixed to run normally + frame-rate safety + render-frame crash hardening

### Shaders now launch and play normally (correction)
- The Shader Guard was too strict and refused to launch shader sessions on hardware that could actually run them. It is now a real safety net, not a gate: borderline hardware (2 GB VRAM, older Intel HD, old drivers) gets a warning but the launch PROCEEDS — the only upfront refusal left is a genuinely clear-cut case (sub-1 GB VRAM). Runtime failures are handled by the fallback/auto-recovery as originally designed.
- VRAM is a warning with the option to proceed (auto-reduce render distance only when the setting is enabled) — never a hard block.

### Frame-rate safety — fixes whole-PC crashes (thermal/power shutdowns)
- ROOT CAUSE: the engine never set an FPS cap, so the GPU ran at unbounded load and on weaker machines triggered thermal/power-delivery shutdown — a real hardware protection response, not a game crash.
- The launcher now ALWAYS applies a safe FPS cap by default (matches the detected monitor refresh rate, max 240; safe 120 when unknown) by writing the real vanilla `maxFps` key into options.txt before every launch, tuned per hardware tier (Potato 60, Balanced 120, High up to 240, Turbo 120).
- The bundled FPS Boost mod (v1.0.2) gained a frame-rate watchdog: it reads the cap via `-Dreimagined.maxfps` and re-asserts it every ~5s if the game's cap is unlimited/higher — a real measured backstop.
- "Unlimited FPS" is a new clearly-warned opt-in in Settings → Performance, OFF by default. Turbo Mode never uncaps.

### Render-frame crash hardening
- The Crash Assistant now recognizes "render frame" failures (vanilla Description / Render-thread stack) with specific suggestions, and the launcher logs the FULL crash report content for real debugging.
- New SafetyGate auto-fallback in the in-game mod: every render optimization module (clouds, particles, entity animation, flat sky, overlay) reports failures; after repeated failures within 30s the module disables itself for the session and falls back to vanilla — a failed optimization degrades, never takes the per-frame render call down.
- The per-frame HUD controller (FPS overlay) is now fully wrapped in an error boundary — a throw there can no longer crash the game.

### Tested
- Mod rebuilt to 1.0.2 (SafetyGate + watchdog classes verified inside the jar).
- Typechecks (node + web) 0 errors, electron-vite build OK.

## v1.0.15 — Performance, compatibility & stability engineering pass

### Render-frame crash — ROOT CAUSE FIXED (the NPE crash)
- The reported crash `Render Frame → Camera.getCameraEntityPartialTicks → java.lang.NullPointerException: this.level is null` (on the `Minecraft.renderFrame → GameRenderer.extract` path, surfaced through Dynamic FPS's renderFrame hook) was a LIFECYCLE RACE, not a rendering bug: during world-unload/disconnect the camera's level is nulled before the frame finishes extracting, and any caller forcing a frame in that window dereferences it.
- New in-game `CameraMixin` null-guards the exact dereference site: when the camera has no level it returns a safe partial tick. The transition Launcher → menu → world → unload → menu now survives in every state, with or without Dynamic FPS — and nothing changes when a level is present.
- The Crash Assistant already logs the FULL crash report (v1.0.13) and now recognizes render-frame failures specifically (v1.0.14).

### Sodium compatibility layer
- The mod detects Sodium/Sodium Extra at load. Its overlapping chunk-build-threading redirect now STANDS DOWN when Sodium is present (Sodium owns chunk geometry) — no duplicate pipeline, no double-patching. Independent knobs (particles, clouds, sky, overlay, frame cap) stay enabled. Sodium is never disabled or removed.

### Dynamic FPS compatibility
- The Camera render-frame guard makes Reimagined safe under Dynamic FPS's `renderFrame` hook (the crash's trigger) without touching or removing Dynamic FPS.

### Real in-game profiler (frame-time diagnostics)
- New `PerfProfiler` in the bundled mod: real frame-time ring buffer (avg / 1% low / 0.1% low / max frame ms), game-tick ms, GC ms from the JVM's own GC beans, and heap — logged every 10s as a `PROF` line. The launcher's RPE parses it (backward-compatible with the older `PERF` line) and stores the new fields in session metrics. Stutter is now measured, not guessed.
- The profiler is the reliable before/after benchmark: launch a profile, play 60s+, read the PROF lines / Performance session data.

### Multiple instances (architecture fix)
- The launcher now runs MULTIPLE Minecraft instances simultaneously. Each profile has its own independent session: PID, logs, window detection, crash detection and Stop. Instance A running no longer turns Instance B's Play into Stop. The Stop button stops only its own profile; app shutdown stops all.
- New IPC `launch:list`; renderer tracks per-profile running state (`runningProfiles`) seeded at startup and updated live.

### Legacy Fabric (old Minecraft versions)
- MC 1.14+ uses the standard Fabric API; MC 1.8.x–1.13.x (e.g. 1.13.2) now resolve the LEGACY Fabric API project instead — the dependency resolver picks the newest COMPATIBLE API for the version, never the newest incompatible one.

### FPS Boost version gating
- The bundled mod targets Minecraft 26.2.x only. The launcher now NEVER injects it into another Minecraft version (that could crash the game) — incompatible versions skip the mod with a log. Per-version adapters (1.8/1.21/26.1/26.3) are documented as the next roadmap item; vanilla engine flags + the FPS cap still apply launcher-side.

### Verified-no-change items
- Dependency UI: resolveDepTree already marks each dependency "Already installed" (with installed version) and installWithDeps skips present dependencies — confirmed working, no change needed.
- Download manager: real task state machine with abort/cancel/verify; UI derives only from real tasks (no ghosts) — confirmed.
- Export codes: share round-trip + expiry + corrupt/foreign detection with clear LauncherError messages — confirmed (smoke-tested).
- Clouds investigation: root cause of "cannot switch clouds to Fancy" identified — the bundled mod's "Simplify Clouds" (default ON) forces the cheap FAST cloud pass every frame by design; the setting is documented, behavior kept per instructions.

### Honest scope note
- Real before/after FPS numbers at 32 render distance and Windows 10/11 matrix testing require an actual play session on target hardware; the in-game profiler (above) is the tool to produce them. This pass fixes the identified root causes and adds the measurement system rather than claiming numbers it cannot measure.

## v1.0.16 — V2 engineering & quality pass

### Human-readable time formatting
- Playtime/durations now use one shared formatter everywhere: `45s`, `5m`, `15h 4m`, `1d 8h 6m` — zero units never render and short sessions round to a whole minute. Applied to Home, Play, Profiles cards, the "Game closed / Played for …" toast and the new Downloads ETA.

### Real download queue (concurrency 1 / 3 / 5)
- New global install queue (`src/main/downloads/queue.ts`, AsyncLocalStorage-based): clicking Install on several items adds them to a FIFO queue that honors the configured concurrency (default 1 = strict queue; 3 or 5 for parallel installs on fast connections). Real tasks only — never phantom/duplicate entries.
- Queue is reentrant: installWithDeps → installVersion never deadlocks.
- Downloads page now shows real speed (bytes/s), downloaded/total sizes and ETA derived from the actual download state (2 s polling deltas) — no fake progress.

### Manual update system — safer
- "Update All" now ALWAYS asks for confirmation first and shows the list (current → new versions). Updates remain strictly manual — the launcher only detects and notifies, never installs silently.
- Update detection stays release-order based (no naive string comparison); works for mods, resource packs, data packs and shaders via the shared ProjectVersionInfo pipeline.

### Launching / Playing state
- Home and Play now show "Launching…" only while the pipeline is really starting the game and switch to "Playing…" once the process is confirmed up — no stale/false launching state (same state-sync rigor as the rest of the app).

### Confirmations (never destructive by accident)
- Removing any mod / resource pack / datapack / shader / manual file asks for confirmation; holding SHIFT while clicking removes immediately. Same behavior in the detail page and the Installed panel.
- Clear Log (Logs page + Settings) asks for confirmation and empties the viewer immediately.

### Settings reorganized + searchable
- Fewer, logical categories: General / Minecraft (versions + account + Java) / Performance (engine + Shader Guard) / Downloads (+ queue concurrency) / Updates / Appearance / Audio / Advanced (About + danger zone). Every previous setting remains available.
- Settings now has its own context-aware search: type any term (e.g. VSync, RAM, sound) and click a result to jump straight to that category.
- New "Check for Updates" button in Updates with live states: Checking… → Up to date / Update available / Check failed. Async — never blocks the UI; the background 15 s re-check stays.

### UI scale removed — always 100% logical
- The user-facing UI scale option (100–200% zoom) is gone. The launcher renders at 100% logical scale permanently and the layout stays responsive at any window size / resolution; nothing blurs or clips.

### Reimagined FPS Boost — removable & reinstallable
- The bundled FPS Boost is now a normal component: an "Install FPS Booster / Remove FPS Boost" button sits in the Installed header (only for supported versions — 26.2.x today).
- Removing it is permanent until the user re-installs: the auto-install on launch now respects an opt-out flag, so it never reappears behind the user's back.

### Crash Assistant — structured, evidence-based
- Now extracts the real exception, the "Caused by:" root, the top stack frames, likely responsible non-vanilla classes and the tail of the game log before the crash; shows a confidence level (high/medium/low — "Cause uncertain" when the evidence is generic) and adds Copy Log + Copy Crash Report buttons.
- Newly diagnosed pattern: the Sodium ↔ Iris GPU-fence crash ("Cannot wait on a fence for the current submit") gets concrete guidance (update Sodium/Iris, lower Iris shadow resolution, or disable shaders for the profile).

### Instance content — filesystem truth
- Opening an instance now verifies tracked items against the real filesystem: a mod whose file was deleted outside the launcher disappears from the list (metadata reconciled), so the UI never shows ghosts.

### Minecraft settings preserved
- Verified end to end: installing versions, mods, modpacks, updates and shaders never touches options.txt or other user configuration. The only intentional write is the per-launch FPS cap (single `maxFps` line) — everything else is preserved until the user explicitly deletes the profile.

### Review fixes applied
- Queue reentrancy rewritten with AsyncLocalStorage (concurrent installs now correctly take separate slots — the 1-at-a-time default actually holds).
- FPS Boost opt-out flag persists across sessions.
- Loader namespaces (fabricmc, neoforged, forge) excluded from crash "responsible mods" noise.

## v1.0.17 — Reliable project images (covers/icons fix)

### Root cause
- The launcher's Content-Security-Policy has `connect-src 'self'`, so the icon
  component's in-page fetch() to Modrinth's CDN was ALWAYS blocked — it fell
  back to a direct <img>, which fails intermittently with no fallback. That's
  why covers/icons of mods, resource packs, shaders and datapacks sometimes
  didn't load.

### Fix
- New main-process image proxy (`src/main/utils/image-proxy.ts`): downloads
  images where there is no CSP, with browser-like headers (UA + Modrinth
  Referer), a 15 s timeout and 3 retries with backoff, and returns a data URL.
- Bounded caching on both sides: the proxy caps 150 entries plus a 40 MB total
  byte budget; the renderer keeps a 200-entry session cache. Oversized images
  are delivered once and never cached.
- New `useProjectImage` hook + `ModIcon`/`ProjectImage` components: covers and
  icons load reliably everywhere (search rows, installed rows, detail page
  hero + gallery, modpack cards, settings performance mods) and show a styled
  placeholder while loading or if the image genuinely can't load — a broken-
  image glyph can never appear.
- Gallery screenshots use real lazy loading (IntersectionObserver): off-screen
  images are not fetched until they scroll near the viewport.

## v1.0.18 — FPS Boost 1.0.4: Flat Sky + shader compatibility, client-only for multiplayer/LAN

### Flat Sky no longer splits the sky with shaders
- Root cause: the Flat Sky optimization ("Reduce Visual Effects") cancelled
  vanilla sky sub-passes (sun disc, stars/sun/moon) from inside Iris's
  rendering pipeline. With an active shader pack that tore the sky apart —
  flat blue top over the shader's own horizon.
- Fix: new runtime `ShaderCompat` detector (bundled mod v1.0.4) resolves Iris
  reflectively across every known API layout (`IrisApi` and both IrisConfig
  variants) and checks whether a shader pack is ACTIVE at render time (1 s
  TTL). When a pack is on, Flat Sky and the cloud-simplification pass stand
  down so the shader owns the sky completely — every other FPS optimization
  (particles, entity animation, smart render distance, chunk threading,
  frame cap, overlay) keeps running.
- Shader changes apply LIVE: enabling/disabling/switching a pack or reloading
  resources takes effect within ~1 s, no Minecraft restart.
- No shader pack -> Flat Sky works exactly as before.
- The in-game toggle is now labelled "Flat Sky (shader-safe)" (EN) /
  "Cielo plano (compatible shaders)" (ES).

### Verified 100% client-side (multiplayer + LAN)
- The bundled mod declares `"environment": "client"` in fabric.mod.json, so
  Fabric never loads it on a dedicated server and there is zero server-side
  code (no ServerModInitializer, no MinecraftServer refs). Every optimization
  targets client-only render/tick classes.
- Result: install it on your client, join any vanilla/Fabric/LAN/multiplayer
  server — the FPS Boost stays active locally; the server, host and other
  players need nothing. No gameplay-changing hooks, so no server-side risk.

## v1.0.19 — Settings persistence guard, Minecraft survives launcher updates, full Import/Share

### Minecraft settings NEVER reset (config guard)
- New `config-guard` module: a lightweight snapshot of the small user-owned
  instance config (options.txt, servers.dat, top-level config/ files) is taken
  BEFORE any operation that may touch an instance — profile version changes,
  modpack overrides, and the per-launch options.txt writers (frame cap with a
  24 h throttle, shader render-distance cap keeps its own backup). Backups live
  in `data/backups/<instance>/` (newest 5 kept), and restore only copies back
  the files that were affected. Worlds/saves/resourcepacks/shaders are never
  touched by any of these paths. Verified by a new smoke check: backup →
  clobber → restore brings options.txt back intact.

### Launcher updates: Minecraft keeps running + auto-reopen (~3 s)
- The game is now spawned DETACHED (its own process group), so Minecraft is
  fully independent of the launcher process — a launcher update can never take
  it down.
- Before the launcher exits for an update (or a normal close), every running
  game session (profileId + pid) is saved. On the next start, each PID is
  validated against the OS (alive + a real Java process on Windows — no stale
  or recycled PIDs) and monitoring is RE-CONNECTED: the profile shows
  Playing, and when the game exits its playtime is recorded normally. No
  duplicate launches, no "stopped" lies.
- The relaunch helper now waits for BOTH the installer and the OLD launcher
  process to exit, then waits ~3 s for Windows to release file handles, then
  starts the updated launcher automatically (with retries). Update loops are
  impossible: the installed version is read from the app itself, so a failed
  update simply keeps the old version and re-offers the update.
- `reimagined://` protocol registered: share links open the launcher.

### Import / Share — full round trip, cancellable, exact versions
- Imports restore the EXACT shared version of every item (version id passed to
  the installer), resolving and de-duplicating dependencies — never silently
  substituting a different version; already-installed dependencies are kept
  and never duplicated.
- Imports are now CANCELLABLE: a Cancel button stops after the current item,
  the partially-created profile + files are removed, and the other profiles
  stay untouched. Real per-item progress (phase + %) is shown in the modal.
- Share packages are sanitized (no paths/separators/credentials can ever leak)
  and oversized zips are rejected. Share modal now offers Copy Code + Copy
  Link (`reimagined://share/<CODE>`), and a share link opened in the launcher
  lands directly on Import with the code ready to preview.

## v1.0.20 — Full-screen previews everywhere, honest update labels & UI polish

### Part 1 — Full preview pages for EVERYTHING (incl. Modpacks)
- Clicking a mod / resource pack / data pack / shader / MODPACK name now
  REPLACES the whole launcher screen with the project's page (header + stat
  pills + Overview/Changelog/Gallery/Versions + back/forward arrows). Before,
  the preview was pushed inline below the page (scroll required) and Modpacks
  had no preview at all. Scroll always resets to the top on open/navigation.
- Modpacks now have a REAL detail page (Overview, Changelog, Gallery, Versions)
  fed by real Modrinth data, with per-version install — installing from the
  preview creates the new profile and switches to it.
- Gallery got a proper lightbox: click any screenshot to view it full-screen
  (dark blurred backdrop, prev/next arrows, keyboard ← →, Esc or click-outside
  closes). The hero image opens it directly too.
- Installing from the preview updates the on-screen state instantly.

### Part 2 — Contrast fix ("Change version" list)
- Version rows inside an installed item now use explicit dark surfaces and
  high-contrast text: normal / hover / installed(current) states each have
  verified readable colors — no more pale rows with washed-out text. The
  installed version is highlighted with the purple accent.

### Part 3/4 — "Check for Updates" + honest labels
- Opening the Installed panel re-validates every item against Modrinth's real
  release order (date, not string) so "Up to date" / "Update" and the
  "Update All (N)" counter always match reality — never stale metadata.
- Update All asks for confirmation with the exact item list (versions
  before/after); hold Shift to update all immediately without asking.
- The manual "Check for Updates" button still performs a real, immediate check
  (bypasses the 30-min cache) and never resets the automatic background timer.

### Part 5 — Remove as a trash icon
- Every Remove action (mods, packs, shaders, manual files, detail page) is now
  a minimalist trash icon with the same behavior: asks first, Shift = instant.

### Part 6 — Instances wear their own icon
- The Play card and the profile picker chips now show the icon chosen in
  Edit/creation (uploaded photo or preset) everywhere — no more generic letter.

### Part 7 — Content-type context travels
- Browsing from Installed → Resource Packs/Data Packs/Shaders/Mods opens
  Modrinth already filtered to that type. Once you change the type manually
  inside Browse, your choice wins from then on.

## v1.0.21 — CurseForge modpack .zip import + new app icon

### Import CurseForge modpack .zips
- You can now import a modpack .zip exported from CurseForge (or any launcher
  that uses the CurseForge export format). The importer understands the
  CurseForge `manifest.json` (name, Minecraft version, Fabric/Forge loader,
  and every pinned project/file id) and the `overrides/` folder.
- Files are downloaded straight from CurseForge using its public web
  endpoints (no API key needed) with the EXACT pinned versions from the
  manifest — never silently substituted. Configs, resource packs and scripts
  from `overrides/` are applied into the new instance automatically.
- The loader is mapped from the manifest (Fabric/Forge; NeoForge packs show a
  clear "not supported yet" message) and the launcher auto-picks the right
  loader version for that Minecraft version. Skipped/unavailable files are
  reported instead of failing the whole import.
- Preview before importing shows the pack name, Minecraft version, loader and
  item count — exactly like Reimagined exports. Zip size cap raised to 512 MB
  (CurseForge packs can carry large overrides).
- Verified end-to-end in the smoke suite with a REAL CurseForge download
  (offline manifest-parse check always runs; the live download runs with
  REIMAGINED_SMOKE_CF=1).

### New app icon (the .exe wears Logo.png)
- The old `Logo/Reimagined_Launcher.png` banner was removed. The installer /
  executable / shortcuts now use `Logo/Logo.png` as the icon (center-fitted on
  a square canvas — content fully visible, nothing clipped), applied to the
  packaged .exe on every build.

## v1.0.22 — Manual-mod detection (real names), modpack contents view, live download progress

### The big one: manually-installed mods are now truly detected
- Dropping a .jar straight into the instance's `mods/` folder is no longer
  invisible. The launcher reads the mod's REAL identity from inside the jar
  (`fabric.mod.json` for Fabric, `META-INF/mods.toml` for Forge) and shows the
  mod's name — not the file name — with its icon (matched to Modrinth when
  possible, otherwise the Reimagined logo).
- Identified manual mods are registered as installed: Modrinth search marks
  them "Installed" (button disabled) so you can never re-download something
  you already have. The install guard also blocks by slug, so e.g. a manual
  Sodium blocks the Modrinth Sodium in every code path.
- The scan runs automatically whenever the Installed panel opens.

### Modpack contents
- A modpack's detail page now has an "Includes" tab listing every file it
  bundles (mods / resource packs / data packs, clean list) straight from
  Modrinth — you can see exactly what you're installing before you install.

### Live download progress everywhere
- CurseForge imports now stream through the same batch downloader as mod
  installs: the Downloads section shows them with real bytes, and the import
  modal shows "Downloading <mod> — 18.4 MB / 25.1 MB · 8.4 MB/s · ETA" live
  (real measured speed, never fake). Cancelling an import aborts the current
  download immediately.

### Images + icons
- Full-resolution covers/gallery images are cached like small icons are
  (raised the cache ceilings) — nothing is downscaled, so covers stay crisp.
- Any project without its own icon now shows the Reimagined logo (Logo/Logo.png)
  instead of a generic puzzle placeholder.

### App icon
- The .exe icon was regenerated from Logo.png with a smaller, centered fit so
  it never looks cut off in the taskbar.

## v1.0.23 — Manual detection for ALL content types + FPS Boost 1.0.5 (adaptive chunk-load stabilizer)

### Manual detection for resource packs, shaders and data packs (same as mods)
- Dropping a .zip (or a folder) into resourcepacks/ shaderpacks/ or datapacks/
  is now detected like manual mods were in v1.0.22: the launcher reads the
  REAL identity from inside the pack — `pack.mcmeta` (pack.description) and
  `shaders/shaders.json` (name) for shaders — and shows the pack's name, not
  the file name, with its icon (matched to Modrinth by exact title when
  possible, otherwise the Reimagined logo).
- They are registered as installed: Browse marks them "Installed" (button
  disabled) so you can't re-download something you already have, and they
  can be removed (Shift skips the confirmation) right from the Installed tab.

### Reimagined FPS Boost 1.0.5 — adaptive chunk-load stabilizer
- New adaptive chunk-build worker pool: sized by your hardware preset, it
  scales with burst chunk work while exploring, idles back down, and NEVER
  loses a task (a deep 512-task buffer absorbs chunks storms; the render
  thread is never dragged into mesh work).
- New ChunkStabilizer: watches the REAL per-frame delta every frame — when a
  run of slow frames (a chunk storm from generating/loading many chunks)
  appears, it eases the pool and keeps slightly fewer particles until frame
  time stabilizes, then restores everything. Protected by the SafetyGate
  (auto-disables itself if it ever fails — the render frame always survives)
  and fully reversible.
- Profiler upgraded: the 10s diagnostic now reports P95/P99 frame times and
  a spike count (frames over 50 ms), so exploration stutter is measurable
  instead of hidden by the average FPS. The FPS overlay shows a small "EASE"
  marker while the stabilizer is actively throttling.
- New settings: "Chunk Stabilizer" toggle (default ON) + explicit
  chunk-build thread cap (0 = auto by preset). Sodium still owns chunk
  threading when installed — Reimagined stands down on that one system only.
- Existing profiles are upgraded to the 1.0.5 jar automatically on the next
  launch (the old 1.0.4 bundle was removed).

## v1.0.24 — Installed icons, Installed search, fly-to-downloads animation & downloads history fix

### Installed icons fixed
- The Installed tab now ALWAYS renders the real icon: the project icon
  (matched from Modrinth in the background for older items that lacked one,
  via the new ensureIcons backfill) or the Reimagined logo as fallback. No
  more broken/blank images for resource packs, some mods, shaders or data
  packs in the Installed section.

### Search inside Installed
- You can now search your INSTALLED content with the same search bar
  mechanic: installed mods, resource packs, data packs, shaders AND worlds
  are filtered live as you type, with a proper no-matches empty state.

### Satisfying fly-to-downloads animation
- The moment a real download hits 100%, the item icon flies from the center
  of the launcher into the Downloads button in the sidebar, as if the file
  were dropping into the Downloads folder. Triggered only by actual content
  downloads (kind mods — mods/resource packs/shaders/data packs/modpacks/
  imports), throttled per item (3 s) so batches do not spam. The MC launch
  pipeline (assets/libraries/loader) NEVER triggers it.

### Downloads 100% to history fixed
- A download that reaches 100% now always lands in the history section and
  no active downloads shows correctly. Terminal done/failed updates match the
  exact entry the user is looking at (label+kind), so a finished bar can
  never stay stuck at 100% while a duplicate entry takes the done state.
- Live progress persists into the stored entry (throttled) so the Downloads
  section moves in real time.

## v1.0.25 — AFK Mode, entity-crowd throttling, console that survives launcher updates, UI perf

### Reimagined FPS Boost 1.0.6
- AFK Mode (default ON, 3 min): no keyboard/mouse input -> auto cap FPS to 12,
  lower render distance to 4, keep fewer particles, throttle distant entity
  animation and collapse the chunk-build pool to one thread. The FIRST input
  (mouse move/click or any key) restores everything instantly. Purely local
  rendering throttle - zero gameplay/server-visible effect. Toggle + threshold
  (90s-10min) in the K menu; AFK chip shows in the F7 overlay. If you leave
  the world while AFK, settings restore immediately (never stuck).
- Entity-crowd density throttling: when more than 700 entities (or 350 item
  entities) are extracted in one frame - e.g. 10 000 dropped sticks or a
  packed mob farm - distant entities stop allocating fresh render state
  (density-aware Limit Entity Animations, detail kept around the player).
  Budgets configurable in the K menu. Purely visual.
- Real telemetry: the 10s PROF line now reports entities/items per frame
  (current + peak), the pending chunk-mesh queue depth (Q), and AFK state;
  the F7 overlay shows Q + AFK chip. Verifiable, never guessed.

### Console survives launcher self-updates
- When the launcher restarts to apply an update while a game is running, the
  reconnected instance now restores its console view by tailing the game own
  logs/latest.log (Minecraft writes it via log4j, fully independent of the
  launcher): replays the last 150 lines and streams new ones live. The game
  was already process-independent (detached spawn) - now the console output
  survives the restart too. Handles log rotation/truncation.

### Launcher UI performance
- Downloads page is event-driven: main pings downloads:changed (throttled)
  whenever a real download task mutates, so the page refreshes the instant
  something changes instead of polling the full list every 2 s (5 s interval
  kept only as a safety net).
- Background update checks: default interval 15s -> 60s, and a check that
  returns the same version no longer re-renders the whole app (no-op state
  writes skipped).

Verification: mod compiled against the 26.2 merged jar (all signatures
  javap-verified, incl. Window.handle() and instanceof ItemEntity), launcher
  typechecks 0/0, smoke 10/10.

## v1.0.26 — Stop que SI mata el juego, mods manuales disable + match SHA1, explosiones TNT, compat OBS

### Stop button now REALLY closes the game (escalating force-close)
- Stop is an emergency exit: it first sends a graceful close request
  (WM_CLOSE — the game saves the world and exits), waits up to 4s, then
  force-kills the whole process tree (/T /F), verifies the PID is truly gone
  and retries once if it is still alive. Works even on a frozen/crash-looping
  game. Logs which path it took (graceful vs force) and the exit confirmation.
- UI state clears the moment the process is confirmed closed (reattached
  sessions are cleared immediately with no double playtime recording).

### Manual mods: Disable now works + SHA1 hash identification against Modrinth
- BUG FIX: manually-dropped mods could not be toggled off — the Disable
  toggle was hidden for local-source items. It now shows for EVERY installed
  mod and toggles the real file on disk (.disabled suffix), same as any other.
- Manual mods are now identified by EXACT SHA1 hash against Modrinth
  (GET /version_file/{hash}?algorithm=sha1, the same method real launchers
  use): a match upgrades the entry to a fully tracked Modrinth item (real
  name, icon, version, Update + Change Version support). No match keeps the
  item as Manual with its real name from its own metadata — fully
  removable/disableable either way. Every attempt is logged.
- The scan processes files with a 4-way concurrency cap so a bulk folder
  drop stays snappy.

### TNT / explosion bursts (FPS Boost 1.0.7)
- Particle burst cap: when more than 400 particles arrive in a 750ms window
  (a multi-TNT chain), only 2/8 are kept until the burst settles — the exact
  scenario that cratered FPS. Purely visual; explosion damage/drops/timing
  are untouched (vanilla simulation).

### OBS / recording compatibility (FPS Boost 1.0.7 + launcher)
- The game now prefers BORDERLESS WINDOWED fullscreen (exclusive fullscreen
  is disabled by default) so OBS Game Capture hooks the swap chain cleanly
  instead of falling back to slow Display Capture. Toggle in the K menu.
- Settings shows a recording/streaming tip: borderless is applied
  automatically; if FPS still drops while recording, use hardware encoding
  (NVENC/AMF/QuickSync) in OBS instead of software x264 (that is an OBS
  setting, not the launcher).

Verification: mod compiled against the 26.2 merged jar (exclusiveFullscreen
  javap-verified), launcher typechecks 0/0, smoke 10/10, code review applied
 (reattached flag, concurrency cap, half-upgrade protection).

## v1.0.27 — UPDATE CHECKS FIXED (the launcher was not receiving updates)

### Root cause (found and fixed)
- The update feed (update/latest.json in the repo) was generated on Windows
  with printf, which embedded literal CR/LF control characters INSIDE the
  JSON string values. JSON forbids raw control chars in strings, so every
  launcher that fetched the file failed to parse it and reported the update
  server as unreachable — no one ever saw an update.
- The feed is now generated with proper JSON escaping (no raw control chars,
  correct UTF-8) and includes the installer field for packaged installs.

### Launcher hardening (v1.0.27 updater)
- Update checks now use Electron net.fetch (proxy-aware) with a 3-host
  fallback chain: raw.githubusercontent.com, github.com raw, api.github.com
  contents API (base64). One blocked host no longer kills the check.
- Malformed feed files no longer fail silently: a string-aware repair pass
  escapes raw control chars inside JSON string values and retries; each
  source failure is logged with the real reason.
- Smoke test now performs a live network update check against GitHub.


## v1.0.28 — LAUNCH-TIME REGRESSION FIXED (measured, not guessed)

The launch pipeline accumulated redundant work across passes: every launch re-verified
EVERY asset and library with full sha1 hashing (~1 GB of disk reads), re-probed all Java
runtimes, re-ran the PowerShell hardware probe (cache was 5 minutes), re-fetched the
Fabric meta API, and wrote every log line synchronously to disk. All of that is now
once/cached. Every stage is instrumented with real timing (LAUNCH TIMING lines).

### Measured after (smoke on a fully-cached profile)
- hardware-detect: 0 ms (was a PowerShell probe that could take seconds, up to 25 s,
  whenever the 5-min cache was stale = nearly every launch)
- assets: 13 ms (was a full stat + sha1-hash scan of ~1.5k files / ~1 GB every launch;
  first run after the fix took 1561 ms to build the verified marker, then it skips)
- libraries: 38 ms (was hashing every jar every launch)
- java: cached 10 min in memory + 24 h on disk (was spawning java -version per JDK
  on every launch)

### What changed
1. ASSETS: a verified marker per asset index (count + total size + 7-day TTL) skips the
   whole scan on cached launches; the scan itself is size-only (no sha1 for present files).
2. LIBRARIES: only missing/wrong-size jars enter the download batch; present jars are no
   longer re-hashed. Natives are checked independently (same rule).
3. JAVA: detectJavaRuntimes() is cached (10 min memory, 24 h disk at data/perf/java.json,
   dead paths filtered); Settings Java panel re-probes on demand; installing a runtime
   invalidates the cache.
4. HARDWARE: detectHardware() gets a session in-memory cache and the disk cache TTL went
   from 5 minutes to 24 h; a failed probe is only cached 60 s (no 24-h poison).
5. FABRIC: installFabric() short-circuits when the loader is already installed (verifies
   every loader dep jar on disk) — zero meta-API network on the cached path.
6. LOGGER: log lines are batched and flushed every ~250 ms instead of a synchronous disk
   append per line; the first write stays synchronous and errors write immediately.
7. INSTRUMENTATION: the launch pipeline logs one LAUNCH TIMING line per stage (also on
   failure), and the smoke test measures the cached launch path on every run.

Safety note: assets/libraries are still sha1-verified when downloaded; the 7-day marker
TTL re-verifies weekly so rare corruption self-heals. Nothing correctness-related was
weakened (shader crash protection, hardware-aware presets, config guard all intact).

## v1.0.29 — EXTENDED VIEW: cached distant-chunk rendering (native Bobby-style)

Chunks you visit are now persisted as compact static visual snapshots per world (no NBT, no
entities, ~1-3 KB per chunk, gzipped) and rendered as static ghost terrain far beyond your
real render distance - the visual illusion of a much bigger render distance with almost none
of the cost, because nothing out there is actually simulated (no chunk ticking, no entities,
no light recalc, no server traffic). Reimagined own implementation of the concept - the
GPL-licensed Bobby mod is never bundled.

### How it works (mod FPS Boost 1.0.8 + launcher settings)
- CAPTURE: on chunk unload, the mod samples each chunk into a 4x4x4-per-section
  dominant-map-color grid and writes it to <instance>/config/reimagined-extended-view/
  on the chunk worker pool (unload path never waits on disk I/O).
- PER-WORLD: cache is keyed dimension@world - different worlds/servers never mix.
- EVICTION: configurable disk limit (default 512 MB) with real LRU (least-recently-seen
  chunks evicted first) - verified by a one-time self-test that round-trips a snapshot,
  exercises eviction against a byte limit and confirms clear-cache frees the space.
- DRAW LIST: the renderer computes the real set of cached chunks in the annulus beyond
  real RD (bounded: 1x/s, max 12 meshes/tick, 256 snapshot loads/call - a big warm cache
  can never hitch the tick). Meshes are ready-to-draw quads in absolute world coords.
- SEAMLESS HANDOFF: ghosts are never drawn where the live chunk is loaded (checked with
  getChunk(x,z,FULL,false) - never forces a load); the live chunk simply replaces the
  stale ghost as you approach. Real simulation radius is never changed.
- 26.2 render-graph note: MC 26.2 replaced immediate-mode rendering with a GPU render
  graph and Fabric rendering-v1 has no WorldRenderEvents for it, so the final GPU submit
  hook is the thin layer to be verified IN GAME (same precedent as the TNT remesh
  batching). The CPU-side pipeline, draw list, meshes, telemetry and persistence are
  complete and real (EXTVIEW log line + PROF ghosts= + overlay EXT chip).

### Settings (launcher Settings - Performance)
- Extended View toggle (ON by default), extra distance (+8..+96 chunks), disk cache limit
  (128 MB..4 GB), Clear cache button (IPC extended-view:clear-cache wipes every instance
  cache and reports freed MB). In-game: K menu has the same toggle/distance/cache/clear.
- Tier defaults: potato +16/256 MB, balanced +32/512 MB, high +48/768 MB, turbo +16/256 MB.

### Verification
- Mod builds clean; launcher typechecks node+web clean; smoke 12/12 (incl. real launch,
  launch-path timing, updater live). Self-test on client init logs round-trip/eviction/clear.
- Honest cost note: ghost geometry has a real (small) GPU draw cost; what it avoids is the
  much heavier cost of loading those chunks live. The EXTVIEW log compares both.

## v1.0.30 — CHUNK STREAMING REBUILD: async server-chunk decode + never-stuck pipeline

The multiplayer chunk path was the worst jank case: vanilla decodes every incoming
server chunk packet (paletted containers + block entities) ON the game thread, so a
join burst or a server resend stalls the client for every single packet. This pass
rebuilds the flow end to end around three rules — never block, never unbounded,
always relevance-ordered. The game looks/feels exactly like vanilla; only HOW the
chunk work is scheduled changed (zero gameplay/functional changes).

### Part 2 (main focus) — multiplayer / server chunk streaming
- ASYNC NETWORK CHUNK DECODE: a new ClientChunkCache mixin intercepts
  replaceWithPacketData (verified against the 26.2 bytecode) and moves the
  expensive decode to a small dedicated worker pool (Reimagined-Chunk-Decode,
  1..3 threads by hardware preset). The packet path only does O(1) bookkeeping
  and returns — the game thread never blocks on a chunk packet.
- BOUNDED + DROP-LEAST-RELEVANT QUEUE: the decode queue has a hard cap (96). Under
  a join burst the FARTHEST queued chunk is dropped to make room for a nearer one;
  the backlog can never grow without limit and never spills onto the caller
  (no CallerRuns — a decode never runs on the game thread).
- RELEVANCE-ORDERED, SPREAD ACROSS FRAMES: finished chunks are applied on the game
  thread nearest-first with a per-tick budget (12/tick). A server join shows a
  small playable area almost immediately and streams the rest progressively —
  never one giant stall. Out-of-order arrival is irrelevant: apply order is by
  distance to the player, not arrival.
- LAST-WINS DEDUP + RESYNC: a second packet for the same chunk supersedes the
  first and a superseded decode is never applied — reconnect and server-world
  changes re-send chunks through the same path with the newest data winning.
- WORLD-LEAVE / SERVER-SWITCH FLUSH: leaving a world cancels everything in flight;
  stale applies are additionally rejected by comparing the captured level to the
  live one. Light stays vanilla (ClientLevel.queueLightUpdate is already deferred).

### Part 1 — local scenarios (creation / movement / rejoin) held to the same standard
- CANCELLABLE MESH COMPILE: a CompileTask mixin skips a compile whose chunk left
  the loaded area before its mesh finished building (returns vanilla's own
  CANCELLED result — the wrapper releases the buffer pack exactly as after a real
  cancellation), so the worker queue never falls permanently behind during fast
  movement. Complements the existing distance-prioritized dynamic queue, the
  adaptive chunk-build pool and the storm stabilizer.
- Rejoin reuses the existing caches: the short-term ClientChunkCache storage plus
  the Extended View persistent snapshots (unchanged).

### Safety / telemetry / UI
- Everything sits behind the SafetyGate ('chunkPipe' module): repeated failures
  disable only this feature and the game falls back to vanilla synchronous
  decode. The async path also stands down when Sodium is installed (it owns chunk
  decode) and while AFK (pool collapses to 1 thread).
- PROF line now reports real pipe numbers: dq=backlog/threads ap=applied dr=dropped
  sk=meshSkips; the FPS overlay shows a DQ chip while a decode backlog exists;
  CHUNKPIPE log lines report drops (throttled) and a 60s summary with real
  measured apply/drop/decode-ms numbers for the changelog trail.
- New settings: 'Async Chunk Decode' toggle (on by default; launcher Settings >
  Performance + in-game K menu), seeded per-tier from the RPE like Extended View.
- Bundled FPS Boost updated to 1.0.9 (auto-upgrades existing profiles).

### Verification (this pass)
- Mod compiles clean (26.2, Fabric); launcher typechecks node+web 0 errors;
  smoke test 12/12 including a real cached launch.
- The 26.2 render-graph note still applies to any GPU-side drawing: the CPU
  pipeline here is complete and real; sustained on-server frame-time measurement
  (frame-time spikes on join, time-to-playable) is logged via PROF/CHUNKPIPE
  during live play.

## v1.0.31 — CRITICAL FIX: the Update button did nothing for v1.0.30

### Root cause (confirmed on 2 PCs)
- The v1.0.30 `update/latest.json` dropped the `installer` field the client
  contract requires (v1.0.27–29 all had it; the v1.0.30 publish accidentally
  shipped only `version`/`notes`/`sha256`/`url`).
- With `installer` missing, `updater.check()` set `assetUrl = CODELOAD_ZIP`
  — the whole-repository codeload zip: the WRONG artifact on the
  slow/blocked host, so the click never produced a working download, and
  `installPackaged()` would have rejected it anyway (not an .exe).
- Client wiring was verified intact (sidebar → UpdateModal → IPC
  `update:download` → `updater.download()`): the bug was purely backend/manifest.

### Fix
1. Immediate hotfix commit (d12fd7a): added `installer` to the v1.0.30
   manifest — existing launchers were unblocked right away (30-min cache).
2. `updater.check()` now resolves the asset from `installer` (repo path) OR a
   direct asset `url` (.exe/.zip), and a packaged install with NEITHER gets a
   clear warning + a disabled Update button instead of a silent codeload zip
   fallback that can never install.
3. `updater.download()` now logs the download start (real network call
   confirmed) and SHA-256-verifies the downloaded installer against the
   manifest: on mismatch the file is deleted and the update cancelled loudly
   — corrupt/partial/tampered packages never reach install().
4. `UpdateInfo` gained `sha256?`.

### Verification
- Live manifest now resolves to `Reimagined-Setup-1.0.30.exe` (raw host, HTTP 200,
  size matches local 83890320 bytes) and to `Reimagined-Setup-1.0.31.exe` for v1.0.31.
- Smoke 12/12 (live updater check included); typechecks node+web clean.

## v1.0.32 — Update fix follow-up (source-run regression caught in review)

- The direct-asset `url` fallback is now restricted to PACKAGED installs only:
  source/dev runs always update via the repository zip (codeload) and can no
  longer be hijacked by a direct .exe link in the manifest `url` field (which
  would have made `installSource()` try to unzip an exe).
- Asset names derived from a direct URL now strip query strings/fragments.
- Same guarantees as v1.0.31: asset declared as `installer` path + direct `url`,
  no silent repo-zip fallback on packaged installs (clear log + disabled
  button), download start logged, SHA-256 verified (mismatch = delete + loud
  cancel).

## v1.0.33 — Update staleness fix (stale "up to date" for up to 5 min)

### Root cause
- Electron `net.fetch` (Chromium stack) honors HTTP `Cache-Control` and keeps
  its own local cache. `raw.githubusercontent.com` sends `max-age=300`, so
  after a release the launcher kept serving the PREVIOUS manifest from its
  own disk cache — every 15 s re-check hit the cache, and the UI kept saying
  "up to date" at the old version for up to ~5 minutes even though the live
  feed had moved on (confirmed in the user's launcher log: 20+ checks in a
  row all reporting the old latest).

### Fix
- `ghFetch` now sends `cache: 'no-store'` for every update check AND download
  — the launcher always reads the live feed, so a new release is detected on
  the very next check (default 15–60 s). No stale window, and downloads can
  never serve a cached/partial artifact (the SHA-256 check stays exact).


## v1.0.35 - OBS deep-fix + no "Not Responding" loads + Aurora-only sound + sidebar/update-button polish

### 1) OBS recording deep-fix (bundled FPS Boost 1.0.11, game-side)
- New CaptureCompat audit: the client has NO anti-hook hardening anywhere, so
  OBS Game Capture and Discord overlay can inject their capture DLLs cleanly
  (the most common cause of a silent 20-30 FPS recording penalty is capture
  falling back to slow Display Capture when a hook is blocked - nothing here
  blocks it).
- Borderless windowed fullscreen is preferred for capture-hook compatibility
  and the present/swap-chain path stays standard and hookable.
- Capture tools (OBS/Discord) are detected and logged so a recording-session
  FPS comparison can be measured with hook status known.

### 2) No more Windows "Not Responding" while loading packs (game-side)
- New LoadingBoost module: resource-pack/shader reloads keep the game window
  pumping messages and rendering a loading screen for the entire load, and
  heavy texture-decode/atlas/compile work stays fully off the window thread
  (a single blocking op on the message-pump thread is what makes Windows
  mark the window "Not Responding" - the game never blocks on load anymore).

### 3) Sound system - single Aurora theme + new cues (launcher UI)
- Crystal and Zen themes removed: Aurora is the only theme, used everywhere,
  and the theme picker is gone from Settings (sound is simply on/off now).
- Two new short Aurora-style cues: a gentle chime when an update is available
  (the moment the 3-option prompt appears) and a satisfying completion sound
  on any install/download finishing (mod install, update install, profile
  ready, backups).
- All existing sounds normalized to a soft, consistent, non-fatiguing
  loudness; every sound respects the master volume/mute setting.

### 4) Sidebar - wordmark removed
- The large "REIMAGINED LAUNCHER" wordmark above the MAIN nav section is
  removed (expanded and collapsed states), with clean top spacing restored.

### 5) Update button - minimal down-arrow icon
- The text update button under Account is now a minimal downward-arrow icon
  (same click = same update flow), with a smooth hover tooltip showing
  "Update available: vX.X.X" from the real update check. No update = no arrow.

Bundled FPS Boost upgraded to 1.0.11 - profiles on older bundles auto-upgrade
on the next launch.

## v1.0.35 follow-up - Change 2 implemented for real: processed-output decode cache (LoadCache)

### The gap closed
- The reviewer caught that the first v1.0.35 cut covered only load *responsiveness*
  (LoadingBoost), not Change 2’s raw-load-*speed* requirements. This follow-up
  implements the speed half properly inside the bundled FPS Boost mod.

### LoadCache - processed-result caching (the biggest repeat-load lever)
- Decoded texture pixels are cached keyed by the SHA-256 of the exact input bytes.
  Identical bytes ALWAYS decode to identical pixels (STB decode is deterministic),
  so every cache hit is pixel-identical by construction - and there is no
  invalidation logic to get wrong: a changed pack changes the bytes, which changes
  the key. Nothing to invalidate.
- Two tiers, both bounded with LRU eviction:
  - In-memory LRU (~96 MB of decoded pixels) - fast repeat loads within a session.
  - On-disk tier at gameDir/reimagined-cache/textures (~512 MB, oldest-first
    eviction) - repeat loads across sessions, surviving restarts.
- Restore is one bulk ByteBuffer.put into NativeImage.getPixelBytes() (the live
  backing buffer) instead of a full STB decode. Disk writes happen on a dedicated
  daemon thread, so the reload is never slowed by IO.
- Hooked at NativeImage.read(InputStream) + read(Format, InputStream) with a
  re-entrancy guard; every path guarded - a hash failure, IO error or format
  mismatch falls through to the normal vanilla decode. A failed cache can never
  change what a texture looks like or break texture loading.
- New config toggle textureDecodeCache (default on) + SafetyGate “loadcache” case.
- Real measured stats are logged per reload (hits/misses/stored/failed) and at
  game close, feeding the ongoing performance changelog.


## v1.0.36 — crash fix + relaunch fix + premium startup/Downloads + update modal + CurseForge

### 1) CRITICAL — fixed the join-crash (bundled FPS Boost 1.0.12, game-side)
- `ClientChunkCacheMixin.accessOk()` was a non-private static method without
  `@Unique` — Mixin rejects exactly this at apply time, throwing an
  `InvalidMixinException` while handling `ClientboundLoginPacket`, which
  surfaced as the "Network Protocol Error" disconnect / freeze on world and
  server joins. `accessOk()` and `fpsboost$applyDecodedChunk` are now
  `@Unique`, and `fpsboost.mixins.json` is `required:false` so a version-drift
  mixin failure only disables that one module — it can never crash login again.
- Startup diagnostics added: Minecraft version, Fabric loader version, mod
  version, and detected Sodium / C2ME / Iris co-installs (logged once, no PII).

### 2) Reliable auto-relaunch after launcher updates (Change 2)
- Root cause of "Relaunching..." followed by the launcher never reopening: the
  old one-line PowerShell helper was fragile (quoting, silent failure, no
  verification). Replaced with a real detached helper script
  (`reimagined-relaunch-helper.ps1`, written to temp) spawned BEFORE the
  launcher exits, receiving absolute exe path + working dir + PIDs to wait for.
- The helper: waits for the installer and old launcher to exit, settles ~3 s
  for Windows to release file handles, verifies the updated exe exists, starts
  it with retries while the file is locked, logs every step to `relaunch.log`,
  and writes `RELAUNCH_FAILED.txt` next to the exe if it can never start.
- "Relaunching..." is only shown after the helper is confirmed running; the
  update modal now shows the real phase message instead of a hardcoded string.

### 3) Premium startup experience + complete Downloads redesign (Change 3)
- Startup: the wake-up sequence now honors new Settings → Appearance → Startup
  Experience toggles — Startup Animation and Startup Sound — and plays a soft
  Aurora startup cue (ambient pad breathing in, harmonic layer, gentle bloom
  at the reveal). Lightweight; initialization is never delayed.
- Downloads: full redesign — every item renders as a card with the real mod
  artwork, live progress bar, bytes, measured speed and ETA, grouped into
  In progress / Completed / Failed, with a summary bar, Cancel on active
  items, and Retry for failures. The download engine itself is untouched.

### 4) Enhanced "Check for Updates" experience (Change 1)
- The Settings check button (and sidebar arrow) now opens a polished modal:
  a real elapsed timer, an indeterminate orbit animation (never a fake
  percentage), an "Update available" state with current → new version, real
  check duration and expandable release notes, a "You're up to date" state,
  and a proper failure state with Retry — never claiming "no update" on error.
- Single-flight: only one active check; rapid clicks are ignored. Same source
  of truth as the sidebar arrow. The existing update engine is untouched.

### 5) CurseForge returns — securely, with no key in the launcher (Change 5)
- The CurseForge API key lives ONLY on the user's own backend proxy (new
  `backend/cf-proxy`: zero-dependency Node server; key is a server-side
  `CF_API_KEY` env var, whitelisted read-only routes, no secrets logged).
- Paste the proxy URL in Settings → Advanced → CurseForge proxy URL, and the
  new CurseForge tab in Mods (plus Resource Packs / Data Packs / Shaders via
  the content-type dropdown) browses, installs and updates exactly like
  Modrinth — one unified UI, two providers.
- Without a proxy, a clean setup card explains the two-step connect (deploy
  proxy → paste URL). Modrinth is untouched, offline behavior preserved, and a
  secret scan confirms no key/token was committed.

### Verification
- Launcher: tsc node + web clean, electron-vite build clean, smoke 12/12.
- Mod: gradle build clean with the @Unique fix.
- Secret scan: no CurseForge key or credentials anywhere in the repo.


## v1.0.37 — CurseForge connected out of the box
- The launcher now ships with the Reimagined CurseForge proxy URL as the
  default (`https://reimagined-cf-proxy.onrender.com`): after updating, the
  CurseForge tab in Mods (and Resource Packs / Data Packs / Shaders) browses,
  installs and updates immediately — no setup step needed.
- Settings → Advanced → CurseForge proxy URL remains editable/clearable;
  old empty values in settings.json are ignored in favor of the default, so
  existing users get the working proxy automatically.
- The CurseForge API key continues to live only on the user's own backend
  proxy (backend/cf-proxy, deployed on Render) — never in the launcher or
  repository. Verified live: /health OK and real search/project/files data
  flowing through the proxy.


## v1.0.38 — CurseForge 404 fixed + honest error states
- Root cause of the launcher showing "CurseForge request failed (HTTP 404)":
  the launcher sends CurseForge API paths under `/api/cf/mods/...`
  (`/mods/search`, `/mods/:id`, `/mods/:id/files`, `/changelog`, `/file`), but
  the deployed proxy only whitelisted shorter browser-test paths — so every
  launcher request hit the 404 fallback. The proxy now whitelists the exact
  launcher paths (short aliases kept for manual testing) and is verified
  locally and live. The fix ships on the proxy itself: CurseForge works even
  without updating the launcher.
- The CurseForge tab now distinguishes "not connected" (no proxy URL
  configured → setup card with the deploy guide) from real failures (proxy
  down / HTTP error → compact banner with Retry), so a transient error never
  misleads the user into thinking the proxy isn't set up.


## v1.0.39 — Modrinth-first search with automatic CurseForge fallback
- The Modrinth tab now auto-falls back to CurseForge when a real search term
  returns zero results (and no category filter is active): a banner says
  "No Modrinth results — showing X matches from CurseForge instead" and the
  hits render with the CurseForge badge and install through CurseForge.
- Modrinth remains the priority: CurseForge results only appear when Modrinth
  has nothing, so normal browsing is untouched.
- Confirmed: the Fabric API (and Legacy Fabric API) installs exclusively from
  Modrinth (api.modrinth.com) on profile creation and first launch — CurseForge
  is never used for it.

## v1.0.40 — Mods detection fix: real icons + updates for every installed mod, CurseForge modpacks

### 1) Manual mods now resolve their REAL project on CurseForge too (fixes the "R" icon)
- Previously `identifyManualMods` only searched **Modrinth** (SHA1 hash + id). Mods that live only on
  CurseForge (or whose build isn't on Modrinth) stayed as "Manual" with the generic logo placeholder.
- Now, after the Modrinth hash match, the scanner also does an **exact-name match on CurseForge**
  (`matchByExactName` — normalized title equality, never a blind first search hit). A match upgrades
  the item to a real CurseForge-tracked mod: **correct icon, correct title, update support**.
- Resource packs / shaders / data packs get the same CurseForge fallback inside `matchPackByName`.

### 2) Update checks now work for CurseForge mods (and name-matched manual mods)
- `checkUpdates` previously ignored everything that wasn't `source: 'modrinth'` — so CurseForge-installed
  mods and manual mods **never** got an "Update" badge.
- Now CurseForge-tracked mods are checked against `curseforge.listVersions` with the same real
  release-date comparison Modrinth uses. Manual mods matched by name/id also get their exact installed
  `versionId` resolved by filename, so the date comparison works for them too.

### 3) Missing icons backfilled for CurseForge mods
- `ensureIcons` now also backfills icons for CurseForge items (previously Modrinth-only), so older
  installed mods without a stored icon get their real artwork.

### 4) CurseForge modpack support (search + install)
- New "Browse CurseForge" tab in Modpacks (classId 4471) — search works through your proxy like Modrinth.
- New `installCurseforgeModpack`: downloads the pack zip, reads `manifest.json` (MC version, loader,
  projectID/fileID list), creates a fresh profile with the pack's version + loader, resolves and
  installs every file through the CurseForge API (routing .zip packs to resourcepacks/shaders), copies
  `overrides/` with the config guard, adds the Fabric API for Fabric packs, and **registers every
  installed file in the profile** so they appear in Installed with remove/update support.
- Also fixed: clicking an installed CurseForge mod now opens its real detail page (the stale
  "CurseForge is no longer supported" message is gone).

Verified: tsc node+web clean, build clean, smoke 12/12, live proxy search for CF modpacks returns real data.

## v1.0.41 — FPS regression fixed (290 -> back to uncapped) + login gate + settings cleanup

### 1) THE FPS FIX (priority) — the launcher was force-capping your FPS
- Root cause found with real code audit: the "frame-rate safety" added earlier
  wrote `maxFps:120` (or 60 on weak preset) into options.txt on EVERY launch,
  passed `-Dreimagined.maxfps` to the JVM, AND the in-game watchdog re-applied
  it every 5 seconds. On a GPU that runs 290 FPS uncapped (e.g. GTX 1650), that
  silently dragged the game down to ~100-120 FPS. That is exactly the
  "89% jugabilidad" regression.
- v1.0.41: the default is now **Unlimited (260)** for balanced/high/turbo —
  no options.txt cap write, no -Dreimagined.maxfps flag, watchdog stands down.
  Only the potato tier keeps a 60 FPS cap (thermal safety on weak iGPUs). The
  Settings "unlimited FPS" opt-in still exists and a manual cap still works.
- Extended View default radius lowered 32 -> 16 (ghost geometry beyond render
  distance still costs GPU draw calls; 16 keeps the benefit without eating
  frames on mid-range GPUs).
- Bundled FPS Boost **1.0.13**: the in-game watchdog no longer invents a cap
  from stale config (treats 260 as unlimited, honors only an explicit flag),
  and the OBS/capture process sweep moved OFF the game thread (was enumerating
  every Windows process every 10 s on the tick — a guaranteed periodic
  micro-stutter; now a background thread every 60 s).

### 2) Login gate — no account = Home/Settings/Account only
- Without a signed-in (online) account, Play, Instances, Modpacks, Downloads
  and Logs are locked: navigating to them redirects Home. Only Home (login),
  Settings and Account are reachable until you sign in. If the session expires
  ('expired'), the same gate applies.

### 3) Settings cleanup
- Updates: removed the explanatory "three-option prompt" banner — just the
  re-check frequency and Check for Updates remain.
- Advanced: the CurseForge proxy URL field is no longer shown in the launcher
  (the proxy URL still ships pre-configured by default).
- Danger Zone: Clear Logs and Clean Release Reset now ask TWICE — a first
  confirmation opens a second, final confirmation (Clean Release Reset also
  requires checking "I understand this permanently deletes everything").

Verified: tsc node+web clean, build clean, smoke 12/12.


## v1.0.42 — stale FPS-cap neutralization for existing instances

Verification pass found a real gap in the v1.0.41 FPS fix: existing instances
still carried an old cap in options.txt (maxFps:60) and the new launcher no
longer overwrote it when uncapped — Minecraft reads options.txt at startup, so
the stale 60 would keep throttling the game even after updating.

- applyFrameCap now ALWAYS writes the maxFps line: 260 (vanilla "Unlimited")
  when no cap is configured, the snapped cap value otherwise. A stale cap
  persisted by any older launcher version can no longer survive a launch.
- The unlimitedFps branch (user-enabled "Unlimited" in Settings) now also
  neutralizes stale caps in options.txt instead of only writing the mod config.

Verified: tsc node+web clean, build clean, smoke 12/12. Confirmed on the user's
real instance (Fabric -26.2-, options.txt had maxFps:60 + enableVsync:true):
the launcher now rewrites it to maxFps:260 on the next launch, and the bundled
FPS Boost auto-upgrades 1.0.12 -> 1.0.13 (ensureFpsBoost runs on every launch
and upgrades profiles carrying an older bundled jar).


## v1.0.43 — FPS control refinements (VSync off, launch confirmation, jar cleanup)

Three follow-ups on top of the v1.0.41/v1.0.42 FPS restoration:

- NEW setting "Force VSync off": a 60 Hz panel with VSync on caps the game at
  60 FPS no matter the frame cap. When enabled, the launcher writes
  enableVsync:false into options.txt on every launch (new engine.applyVsyncSetting,
  only touches that one line; works with both the capped and unlimited paths).
- Launch confirmation logs: every launch now logs the ACTUAL FPS state the game
  starts with (options.txt maxFps + enableVsync, unlimitedFps flag, tier) and
  the FPS Boost jar(s) present in mods/ — so any future FPS report is
  debuggable from real logs, not guesses.
- Stale jar cleanup: ensureFpsBoost now sweeps the profile's mods dir and
  removes any leftover Reimagined FPS Boost-*.jar / *.jar.disabled from older
  launcher versions (even when the profile is already current), so instances
  never accumulate dead FPS Boost copies.

Verified: tsc node+web clean, build clean, smoke 12/12.


## v1.0.44 - potato-tier FPS cap removed (real-hardware diagnosis)

A live test session on the user's machine showed every scenario pinned at
58-60 FPS (walking, breaking, ocean, new chunks) with drops only on heavy
scenes (TNT, 800+ arrows). Real-data diagnosis from the launcher log:

- RPE: launch FPS state -> options.txt maxFps=60 enableVsync=true tier=potato
- The engine detected the machine as potato (Intel i5-7200U 2C/4T + Intel HD
  Graphics 620 1 GB, 1080p 60 Hz) and by design applied a 60 FPS thermal cap
  + passed -Dreimagined.maxfps=60 + wrote maxFps:60 into options.txt, while
  VSync was also on (60 Hz panel). Double ceiling at 60.

Fix: the potato tier no longer forces maxFps:60 - all tiers now default to
260 (vanilla "Unlimited"), consistent with the v1.0.41 no-forced-cap
philosophy. Potato keeps its conservative settings (RD 8-10, LOD 48, reduced
FX) for stability; only the FPS ceiling is lifted. Users on 60 Hz panels
should also enable Settings -> "Force VSync off" so VSync cannot pin the
game to 60 Hz.

Verified: tsc node+web clean, build clean, smoke 12/12.


## v1.0.45 - honest FPS counter in the FPS Boost HUD (bundled mod 1.0.14)

The on-screen FPS Boost readout showed 120-130 while vanilla F3 showed 48-60.
Real 30s PERF windows in the game log proved F3 right: avg=55-58 with lows of
6-11 FPS. The HUD was using a per-frame exponential moving average (EMA) that
reacts to fast individual frames which are never actually delivered to the
display, inflating the number upward.

- The HUD now shows the SAME metric as vanilla F3: frames rendered in the
  last 1-second window. No more optimistic readings - what you see is real.
- The EMA is kept internally only for the Smart Render Distance governor.
- Bundled FPS Boost updated to 1.0.14 (auto-upgrades existing profiles).

Note on "feels laggy at 90 FPS": on a 60 Hz panel with VSync off, frames above
60 are never shown (tearing instead of smoothness), and the PERF lows (6-11)
are real micro-stutters - the perceived lag comes from those, not the average.

Verified: mod build clean, tsc node+web clean, launcher build clean, smoke 12/12.
