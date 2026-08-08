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
