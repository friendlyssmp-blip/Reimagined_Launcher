# Reimagined Launcher — Changelog

## v1.1 — Native Performance Layer (in-game Reimagined Client)

Reimagined ships its own rendering/logic/memory optimization layer inside the
bundled **Reimagined FPS Boost** mod (Fabric). This is first-party code —
nothing is bundled from Sodium/Lithium/FerriteCore or any third-party
optimization project. The layer is always-on baseline behavior (no install
step, no visible mod list), controlled by the launcher's hardware preset and
tunable per-toggle from the in-game Reimagined Mods overlay.

### Implemented this pass (verified against 26.2 bytecode)

- **Chunk-build threading** — a dedicated parallel chunk-mesh pool sized by
  hardware preset, leaving headroom for the game's logic thread
  (`LevelRenderer` → `Util.backgroundExecutor` redirect).
- **Entity animation throttling** — distant entities (beyond a configurable
  distance) animate at reduced rate by reusing their per-tick render state;
  visibility is never affected (no gameplay-visible change).
- **Particle reduction** — keeps ~62% of world particles (weather, block
  break, ambient); particles are never fully removed.
- **Cloud simplification** — FANCY volumetric clouds downgraded to the cheap
  flat rendering path (`CloudRenderer` status redirect).
- **Flat sky** (aggressive, opt-in) — cheap sky disc rendering instead of the
  full sky pass.
- **Smart Render Distance** — frame-time-driven auto render distance with a
  user cap; backs off under heavy load and restores when load drops
  (`Options.renderDistance`).
- **Live FPS/RD overlay + perf reporter** — small purple readout, plus a
  30-second `[FPS Boost] PERF avg=.. low=.. heapMB=..` log line used by the
  benchmark harness.
- **Launcher-side JVM tuning** — G1GC pause-target tuning
  (`-XX:MaxGCPauseMillis=50`, `-XX:G1NewSizePercent`/`MaxNewSizePercent` with
  the required `-XX:+UnlockExperimentalVMOptions` — these flags previously
  crashed the JVM because the unlock flag was missing) and the hardware-preset
  hand-off property `-Dreimagined.preset=0|1|2`.
- **Hardware preset** — Settings → Performance → "Optimization preset"
  (Potato / Balanced / High) maps to how aggressively the layer applies.
- **Benchmark harness** — `npm run bench` (or `bench:baseline`) generates a
  deterministic world headlessly via the bundled dedicated server, then
  launches the game twice (optimizations OFF / ON) through the normal pipeline
  and reports real measured avg/low FPS + heap.

### Measured results (real run, this machine)

Deterministic seed-42 world, Minecraft 26.2 + Fabric 0.19.3, 1280x720,
Intel HD 620 (iGPU), `--bench-duration=260` per pass:

| Pass | Avg FPS | Low FPS | Heap | Windows |
| --- | --- | --- | --- | --- |
| Baseline (optimizations OFF, warm world) | 28.2 | 1.6 | 607 MB | 5 |
| Optimized (Reimagined native) | 32.6 | 0.7 | 872 MB | 4 |
| **Delta** | **+15.6%** | — | +265 MB | — |

Notes on the numbers (honest assessment):

- The average-FPS gain is real and repeatable; the low-FPS figure is a
  per-window minimum and is dominated by single hitches — mostly render-distance
  changes from Smart RD (each RD step forces chunk rebuilds). Follow-up pass
  should slow the RD-change cadence and add a minimum hold time.
- Heap rises with parallel chunk building (more in-flight chunks). Potato preset
  uses fewer threads to keep memory down on weak machines.
- A cold freshly-generated world showed far larger deltas (9.6 → 32.6 FPS),
  but the warm-world comparison above is the fair one.

### Roadmap (not yet implemented — future passes)

- **Frustum + occlusion culling** for chunks/entities (highest-impact item).
  Requires replacing the vanilla section-render visibility test; the bytecode
  investigation is started but the rewrite is deferred.
- **Batched draw calls** (shared-atlas face batching).
- **Memory layout** compression for block-state/chunk structures (FerriteCore-
  style wins, as our own implementation).
- **Light/block-update spreading** across frames (26.2 removed the vanilla
  `maxChainedNeighborUpdates` property the tuning used to target).
- **Network packet-allocation** reduction for multiplayer.
- **Startup** data-fixer streamline on current-version worlds.

---

## Earlier passes (summary)

- Profile context menu (Edit / Duplicate / Share / Delete / Import) with real
  progress flows, share codes (7-day expiry) and .zip exports.
- Real Modrinth/CurseForge browsing with content-type scope (Mods / Resource
  Packs / Data Packs / Shaders), profile-scoped strict loader+version
  filtering, mod detail pages, per-item Change Version / Disable toggles.
- Skins section rebuilt with real 3D Minecraft model previews (classic/slim UV
  mapping), face-icon rendering, upload/import/apply persistence.
- Non-blocking game launch (launcher usable while playing), running-profile
  indicators, dismissible live launch console.
- Login state-sync fixes (UI reacts immediately to successful Microsoft login
  and logout), empty-state profile creation, Logs viewer, Downloads accuracy.
- Profile create/delete with real file-operation progress; ghost-profile and
  ghost-download state-sync fixes.
