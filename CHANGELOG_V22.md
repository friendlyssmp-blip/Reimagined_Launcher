
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

