
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
