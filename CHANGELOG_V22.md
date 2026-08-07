
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
