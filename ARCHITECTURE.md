# Reimagined Launcher — Architecture

Electron + React (electron-vite) launcher for Minecraft with a built-in mod
platform, profile system, Microsoft auth and a self-update pipeline.

## Process model

- **Main process** (`src/main/`) — Node. Owns data, downloads, Minecraft
  launching, auth, updates and the game console window.
- **Renderer** (`src/renderer/src/`) — React UI. Talks to main only through
  the typed IPC layer in `src/shared/`; never touches the filesystem.
- **Shared** (`src/shared/`) — types + IPC event contracts used by both sides.

## Main process modules (grouped by domain)

| Path | Responsibility |
|---|---|
| `auth/` | Microsoft device-code sign-in, account store, secure credential storage |
| `profiles/` | Profile CRUD, duplicate/import, instance folders |
| `minecraft/` | Version manifests, downloads, assets, Java detection, game launch |
| `minecraft/loaders/` | Fabric + Forge installers |
| `mods/` | Modrinth/CurseForge clients, mod manager, Fabric API, modpacks |
| `perf/` | Hardware detection + Reimagined Performance Engine |
| `share/` | Profile share codes + .zip export/import snapshots |
| `updater/` | GitHub release check + apply (official repo only) |
| `game/` | Content listing (worlds/resourcepacks) + Crash Assistant |
| `settings/` `logs/` `core/` `utils/` | Settings, logger, event bus, helpers |

## Renderer layout

- `pages/` — one screen per destination (Home, Profiles, Mods, Settings…).
- `components/` — shared UI kit (`ui.tsx`), icon set (`icons.tsx`), modals,
  project detail page, splash/branding.
- `state/AppContext.tsx` — the single source of truth (settings, account,
  profiles, launch state, toasts, modals).
- `lib/` — typed IPC client (`api.ts`) and the sound engine.
- `styles/global.css` — the full design system (tokens, motion, components).

## Data (never committed)

All user data lives under `data/` (profiles, games, logs, accounts, caches) and
is excluded by `.gitignore` — the repository contains only source + assets.

## Animation & memory conventions

- Motion: one shared timing/easing system (`--dur`, `--ease`, keyframes in
  `global.css`); JS-driven animations (`AnimatedNumber`, `TabBar`) respect
  `prefers-reduced-motion`.
- Long lists use `content-visibility: auto` (no JS windowing needed).
- Remote mod icons go through the bounded, evicting `ModIcon` cache.
- Every `setInterval`/`addEventListener` has a matching cleanup in its effect.

## Cleanup pass (local, non-destructive)

- Removed 8 unused icon exports; consolidated preset profile icons into
  `PROFILE_ICONS` (custom SVGs + legacy-emoji mapping).
- Replaced every OS emoji in the UI with custom vector icons.
- Removed the dead `setPage` stub from AppContext; removed an unused import.
- Added the `ModIcon` bounded cache and `content-visibility` list
  virtualization; audited listener/timer cleanup (all already paired).
- No functionality changed: same screens, same flows, same IPC contracts.
