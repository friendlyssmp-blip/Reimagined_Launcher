/** Lightweight inline SVG icon set (stroke style, 24×24 viewBox). */
import type { SVGProps, CSSProperties } from 'react'

type P = SVGProps<SVGSVGElement>

function base(props: P) {
  return {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...props
  }
}

export const IconHome = (p: P) => (
  <svg {...base(p)}>
    <path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    <path d="M9 22V12h6v10" />
  </svg>
)

export const IconGrid = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
)

export const IconPuzzle = (p: P) => (
  <svg {...base(p)}>
    <path d="M10.5 3h3a1.5 1.5 0 0 1 1.5 1.5v.3a2 2 0 0 0 4 0V4a1.5 1.5 0 0 1 1.5-1.5h0a1.5 1.5 0 0 1 1.5 1.5v2.2A2.5 2.5 0 0 1 19.5 9.7 2.5 2.5 0 0 1 22 12.2V21a1.5 1.5 0 0 1-1.5 1.5H9A6.5 6.5 0 0 1 2.5 16V10.5a2 2 0 0 1 2-2h3" />
  </svg>
)

export const IconSettings = (p: P) => (
  <svg {...base(p)}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

export const IconPlay = (p: P) => (
  <svg {...base(p)}>
    <path d="m6 4 14 8-14 8Z" />
  </svg>
)

export const IconStop = (p: P) => (
  <svg {...base(p)}>
    <rect x="5" y="5" width="14" height="14" rx="2" />
  </svg>
)

export const IconTrash = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14ZM10 11v6M14 11v6" />
  </svg>
)

export const IconCopy = (p: P) => (
  <svg {...base(p)}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
)

export const IconRefresh = (p: P) => (
  <svg {...base(p)}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
  </svg>
)

export const IconDownload = (p: P) => (
  <svg {...base(p)}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
  </svg>
)

export const IconSearch = (p: P) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
)

export const IconUser = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
)

export const IconLog = (p: P) => (
  <svg {...base(p)}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    <path d="M14 2v6h6M9 13h6M9 17h6" />
  </svg>
)

export const IconFolder = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </svg>
)

export const IconExternal = (p: P) => (
  <svg {...base(p)}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" />
  </svg>
)

export const IconStar = (p: P) => (
  <svg {...base(p)}>
    <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
  </svg>
)

export const IconX = (p: P) => (
  <svg {...base(p)}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
)

export const IconChevronDown = (p: P) => (
  <svg {...base(p)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
)

export const IconGamepad = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 11h4M8 9v4M15 12h.01M18 10h.01" />
    <path d="M17.32 5H6.68a4 4 0 0 0-3.98 3.6L2 17a3 3 0 0 0 5.2 2.2l.6-.6A2 2 0 0 1 9.2 18h5.6a2 2 0 0 1 1.4.6l.6.6A3 3 0 0 0 22 17l-.7-8.4A4 4 0 0 0 17.32 5Z" />
  </svg>
)

export const IconShield = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
)

export const IconSparkle = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
  </svg>
)

export const IconImage = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="m21 15-5-5L5 21" />
  </svg>
)

export const IconGlobe = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14.5 14.5 0 0 1 0 18 14.5 14.5 0 0 1 0-18Z" />
  </svg>
)

export const IconTerminal = (p: P) => (
  <svg {...base(p)}>
    <path d="m4 17 6-6-6-6M12 19h8" />
  </svg>
)

export const IconVolume = (p: P) => (
  <svg {...base(p)}>
    <path d="M11 5 6 9H2v6h4l5 4V5Z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M18.5 5.5a9 9 0 0 1 0 13" />
  </svg>
)

export const IconBell = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
)

export const IconChevronLeft = (p: P) => (
  <svg {...base(p)}>
    <path d="m15 18-6-6 6-6" />
  </svg>
)

export const IconChevronRight = (p: P) => (
  <svg {...base(p)}>
    <path d="m9 18 6-6-6-6" />
  </svg>
)

export const IconClock = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
)

export const IconArchive = (p: P) => (
  <svg {...base(p)}>
    <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" />
  </svg>
)

export const IconGauge = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 15l3.5-3.5M20.3 18a10 10 0 1 0-16.6 0" />
  </svg>
)

export const IconCheck = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

export const IconDots = (p: P) => (
  <svg {...base(p)}>
    <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
  </svg>
)

export const IconShare = (p: P) => (
  <svg {...base(p)}>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <path d="m8.6 10.7 6.8-4.4M8.6 13.3l6.8 4.4" />
  </svg>
)

export const IconPencil = (p: P) => (
  <svg {...base(p)}>
    <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    <path d="m15 5 4 4" />
  </svg>
)

/* ---------------------- profile preset icons (Part 1) ---------------------- */

export const IconPickaxe = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 15a8 8 0 0 1 8-8" />
    <path d="m12 7 3-3 5 5-3 3-5-5Z" />
    <path d="M17.5 10.5V21" />
  </svg>
)

export const IconCastle = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 21V9l4 4V6l4 4 4-4v7l4-4v12" />
    <path d="M2 21h20" />
    <path d="M10 21v-5h4v5" />
  </svg>
)

export const IconSword = (p: P) => (
  <svg {...base(p)}>
    <path d="m4 20 8-8" />
    <path d="m20 4-8 8" />
    <path d="m8.5 8.5 3-3M15.5 15.5l-3 3" />
    <path d="m4 20-2.5 2.5M20 4l2.5-2.5" />
  </svg>
)

export const IconDragon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3c4 1.5 6 5 5.5 9-.3 2.5-2.2 4.6-4.5 5.5L14.6 21h-5.2l-1.4-3.5C5.7 16.6 4 14.5 3.7 12c-.5-4 1.5-7.5 5.5-9l1.3 3.2L12 3Z" />
    <circle cx="8.8" cy="11.5" r="1.1" fill="currentColor" stroke="none" />
  </svg>
)

export const IconTree = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3 6.5 10h3L5 17h14l-4.5-7h3L12 3Z" />
    <path d="M12 17v4" />
  </svg>
)

export const IconTent = (p: P) => (
  <svg {...base(p)}>
    <path d="m2 20 10-16 10 16" />
    <path d="M4 20 12 8l8 12" />
    <path d="M2 20h20" />
    <path d="m9.5 14 2.5 3 2.5-3" />
  </svg>
)

export const IconCrystal = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3 7 9l5 12 5-12-5-6Z" />
    <path d="M12 3v18" />
  </svg>
)

export const IconBolt = (p: P) => (
  <svg {...base(p)}>
    <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
  </svg>
)

export const IconMap = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" />
    <path d="M9 3v15M15 6v15" />
  </svg>
)

export const IconRocket = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 2c3 1.5 5 4.5 5 8l-1 5-4 3-4-3-1-5c0-3.5 2-6.5 5-8Z" />
    <circle cx="12" cy="10" r="2" />
    <path d="M8 17l-3 4M12 18v4M16 17l3 4" />
  </svg>
)

export const IconLeaf = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 20C4 10 10 4 20 4c0 10-6 16-16 16Z" />
    <path d="M4 20c4-6 8-10 12-12" />
  </svg>
)

export const IconMoon = (p: P) => (
  <svg {...base(p)}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />
    <path d="M17 3.5v4M15 5.5h4" />
  </svg>
)

export const IconPotato = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 8.5c7-4 13 2 12.5 8.5C16.9 21.6 11.5 22 8.5 18.5 6.5 16.2 4 12.5 5 8.5Z" />
    <circle cx="9" cy="12.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="13.5" cy="15.5" r="1" fill="currentColor" stroke="none" />
    <path d="M9.5 7.5c-.4-1.5.4-2.8 1.8-3.4" />
  </svg>
)

export const IconHourglass = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 3h12M6 21h12" />
    <path d="M7 3v3.5L12 12l-5 5.5V21M17 3v3.5L12 12l5 5.5V21" />
  </svg>
)

/* ------------------- profile preset icon registry ------------------- */

/** Preset profile icons shown in the create/edit picker (replaces the old
 *  emoji choices — these render identically on every OS/font config). */
export const PROFILE_ICONS = [
  { id: 'pickaxe', Icon: IconPickaxe },
  { id: 'castle', Icon: IconCastle },
  { id: 'sword', Icon: IconSword },
  { id: 'dragon', Icon: IconDragon },
  { id: 'tree', Icon: IconTree },
  { id: 'tent', Icon: IconTent },
  { id: 'crystal', Icon: IconCrystal },
  { id: 'bolt', Icon: IconBolt },
  { id: 'gamepad', Icon: IconGamepad },
  { id: 'map', Icon: IconMap },
  { id: 'star', Icon: IconStar },
  { id: 'shield', Icon: IconShield }
] as const

export type ProfileIconId = (typeof PROFILE_ICONS)[number]['id']

/** Maps the legacy emoji icons (stored by older launcher versions) to the new
 *  custom icon ids so existing profiles keep their visual identity without
 *  any reliance on the OS emoji font. */
const LEGACY_EMOJI: Record<string, string> = {
  '⛏️': 'pickaxe', '⛏': 'pickaxe',
  '🏰': 'castle',
  '⚔️': 'sword', '⚔': 'sword',
  '🐉': 'dragon',
  '🌲': 'tree',
  '⛺': 'tent',
  '🔮': 'crystal',
  '⚡': 'bolt',
  '🎮': 'gamepad',
  '🗺️': 'map', '🗺': 'map',
  '🌟': 'star',
  '🛡️': 'shield', '🛡': 'shield'
}

/** Resolves any stored profile icon value to a preset icon id, or null when
 *  it is a photo (data URL) / unknown — callers fall back to a letter then. */
export function profileIconId(icon?: string | null): ProfileIconId | null {
  if (!icon || icon.startsWith('data:')) return null
  if (LEGACY_EMOJI[icon]) return LEGACY_EMOJI[icon] as ProfileIconId
  return PROFILE_ICONS.some((p) => p.id === icon) ? (icon as ProfileIconId) : null
}

/** Renders one of the preset profile icons by id (used by the picker, the
 *  profile cards and ProfileGlyph). */
export function ProfileIcon({ id, size = 20, style }: { id: string; size?: number; style?: CSSProperties }) {
  const entry = PROFILE_ICONS.find((p) => p.id === id)
  if (!entry) return null
  const I = entry.Icon
  return <I style={{ width: size, height: size, ...style }} />
}