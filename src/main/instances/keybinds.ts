/**
 * Keybinds (v2.1.0) — the instance's real in-game keybindings.
 *
 * Minecraft stores every keybinding (vanilla AND mod-added ones registered
 * through Fabric's KeyBindingHelper / Forge's KeyMapping) in the instance's
 * options.txt as lines of the form:
 *
 *   key_<translation-key>:<bound-key>
 *
 * e.g. key_key.forward:key.keyboard.w (vanilla) or
 *      key_flashback.keybind.create_marker_1:key.keyboard.unknown (mods).
 *
 * The Keybinds section in the launcher reads those lines, resolves readable
 * names/categories from the game's own language files (vanilla dictionary +
 * each installed mod's assets/<modid>/lang/en_us.json), lets the user rebind them
 * (writing straight back into options.txt — the same file the game reads at
 * startup), and can copy a profile's layout to every other instance or save
 * it as the default template new instances are seeded with.
 */
import path from 'node:path'
import fs from 'node:fs'
import { paths } from '../paths'
import { logger } from '../logs/logger'
import { profileManager } from '../profiles/profile-manager'
import { instancePath } from './paths'
import { zipListEntries, zipReadEntry } from '../utils/zip'
import type { KeybindEntry } from '@shared/types'

/* ------------------------- vanilla keybind dictionary ------------------------- */

/** Vanilla translation key → human label (subset of the game's en_us.json). */
const VANILLA_KEY_LABELS: Record<string, string> = {
  'key.attack': 'Attack / Destroy',
  'key.use': 'Use Item / Place Block',
  'key.forward': 'Forward',
  'key.left': 'Left',
  'key.back': 'Back',
  'key.right': 'Right',
  'key.jump': 'Jump',
  'key.sneak': 'Sneak',
  'key.sprint': 'Sprint',
  'key.drop': 'Drop Selected Item',
  'key.inventory': 'Open/Close Inventory',
  'key.chat': 'Open Chat',
  'key.playerlist': 'List Players',
  'key.pickItem': 'Pick Block',
  'key.command': 'Command',
  'key.friends': 'Open Friends',
  'key.socialInteractions': 'Social Interactions',
  'key.toggleGui': 'Hide GUI',
  'key.toggleSpectatorShaderEffects': 'Toggle Spectator Shader Effects',
  'key.screenshot': 'Screenshot',
  'key.togglePerspective': 'Toggle Perspective',
  'key.smoothCamera': 'Toggle Cinematic Camera',
  'key.fullscreen': 'Toggle Fullscreen',
  'key.spectatorOutlines': 'Highlight Players (Spectator)',
  'key.spectatorHotbar': 'Use Spectator Hotbar',
  'key.swapOffhand': 'Swap Item in Hands',
  'key.saveToolbarActivator': 'Save Toolbar Activator',
  'key.loadToolbarActivator': 'Load Toolbar Activator',
  'key.advancements': 'Advancements',
  'key.quickActions': 'Quick Actions',
  'key.debug.overlay': 'Debug Screen',
  'key.debug.modifier': 'Debug Modifier'
}

const VANILLA_HOTBAR: Record<string, string> = {
  'key.hotbar.1': 'Hotbar Slot 1',
  'key.hotbar.2': 'Hotbar Slot 2',
  'key.hotbar.3': 'Hotbar Slot 3',
  'key.hotbar.4': 'Hotbar Slot 4',
  'key.hotbar.5': 'Hotbar Slot 5',
  'key.hotbar.6': 'Hotbar Slot 6',
  'key.hotbar.7': 'Hotbar Slot 7',
  'key.hotbar.8': 'Hotbar Slot 8',
  'key.hotbar.9': 'Hotbar Slot 9'
}

/** Vanilla translation key → vanilla category label. */
const VANILLA_CATEGORY: Record<string, string> = {
  'key.forward': 'Movement',
  'key.back': 'Movement',
  'key.left': 'Movement',
  'key.right': 'Movement',
  'key.jump': 'Movement',
  'key.sneak': 'Movement',
  'key.sprint': 'Movement',
  'key.inventory': 'Inventory',
  'key.swapOffhand': 'Inventory',
  'key.drop': 'Inventory',
  'key.hotbar.1': 'Inventory',
  'key.hotbar.2': 'Inventory',
  'key.hotbar.3': 'Inventory',
  'key.hotbar.4': 'Inventory',
  'key.hotbar.5': 'Inventory',
  'key.hotbar.6': 'Inventory',
  'key.hotbar.7': 'Inventory',
  'key.hotbar.8': 'Inventory',
  'key.hotbar.9': 'Inventory',
  'key.attack': 'Gameplay',
  'key.use': 'Gameplay',
  'key.pickItem': 'Gameplay',
  'key.chat': 'Multiplayer',
  'key.command': 'Multiplayer',
  'key.playerlist': 'Multiplayer',
  'key.friends': 'Multiplayer',
  'key.socialInteractions': 'Multiplayer',
  'key.screenshot': 'Miscellaneous',
  'key.togglePerspective': 'Miscellaneous',
  'key.smoothCamera': 'Miscellaneous',
  'key.fullscreen': 'Miscellaneous',
  'key.toggleGui': 'Miscellaneous',
  'key.toggleSpectatorShaderEffects': 'Miscellaneous',
  'key.spectatorOutlines': 'Miscellaneous',
  'key.spectatorHotbar': 'Miscellaneous',
  'key.saveToolbarActivator': 'Miscellaneous',
  'key.loadToolbarActivator': 'Miscellaneous',
  'key.advancements': 'Miscellaneous',
  'key.quickActions': 'Miscellaneous',
  'key.debug.overlay': 'Miscellaneous',
  'key.debug.modifier': 'Miscellaneous'
}

/* ----------------------------- key value formatting ----------------------------- */

/** Format a raw bound value (e.g. key.keyboard.left.shift) into a readable label. */
export function formatBoundKey(raw: string): string {
  const v = (raw ?? '').trim()
  if (!v || v === 'key.keyboard.unknown') return 'Unbound'
  if (v.startsWith('key.mouse.')) {
    const n = v.slice('key.mouse.'.length)
    const map: Record<string, string> = { left: 'Left Click', right: 'Right Click', middle: 'Middle Click', '4': 'Mouse 4', '5': 'Mouse 5' }
    return map[n] ?? `Mouse ${n}`
  }
  if (v.startsWith('key.keyboard.')) {
    const k = v.slice('key.keyboard.'.length)
    const map: Record<string, string> = {
      space: 'Space', enter: 'Enter', backspace: 'Backspace', tab: 'Tab', escape: 'Esc',
      'left.shift': 'Left Shift', 'right.shift': 'Right Shift', 'left.control': 'Left Ctrl', 'right.control': 'Right Ctrl',
      'left.alt': 'Left Alt', 'right.alt': 'Right Alt', capslock: 'Caps Lock', unknown: 'Unbound',
      left: 'Left', right: 'Right', up: 'Up', down: 'Down', slash: '/', backslash: '\\',
      period: '.', comma: ',', minus: '-', equal: '=', semicolon: ';', quote: "'", backquote: '`',
      'left.bracket': '[', 'right.bracket': ']', delete: 'Delete', insert: 'Insert', home: 'Home',
      end: 'End', pageup: 'Page Up', pagedown: 'Page Down', 'num.lock': 'Num Lock', 'print.screen': 'Print Screen'
    }
    if (map[k]) return map[k]
    if (/^f\d{1,2}$/i.test(k)) return k.toUpperCase()
    if (/^numpad\d$/.test(k)) return k.slice(6)
    return k.charAt(0).toUpperCase() + k.slice(1)
  }
  return v
}

/** Prettify an unresolved translation key into a readable fallback label. */
function prettifyKeyName(content: string): string {
  const last = content.split('.').pop() ?? content
  return last
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/* ------------------------------- lang dictionary ------------------------------- */

interface LangDict {
  keys: Map<string, string>
  categories: Map<string, string>
}

const langCache = new Map<string, { at: number; dirMtime: number; dict: LangDict }>()
const LANG_TTL = 10 * 60_000

/** Collect `key.*` + `category.*` translations from every installed mod jar. */
function loadLangDict(instanceRoot: string): LangDict {
  const modsDir = path.join(instanceRoot, 'mods')
  let dirMtime = 0
  try {
    dirMtime = fs.statSync(modsDir).mtimeMs
  } catch {
    dirMtime = 0
  }
  const cached = langCache.get(instanceRoot)
  if (cached && Date.now() - cached.at < LANG_TTL && cached.dirMtime === dirMtime) return cached.dict

  const keys = new Map<string, string>()
  const categories = new Map<string, string>()
  let jars: string[] = []
  try {
    jars = fs.readdirSync(modsDir).filter((f) => f.endsWith('.jar'))
  } catch {
    jars = []
  }
  for (const jar of jars) {
    try {
      const buf = fs.readFileSync(path.join(modsDir, jar))
      const entries = zipListEntries(buf)
      const langEntry = entries.find((e) => /^assets\/[^/]+\/lang\/en_us\.json$/i.test(e))
      if (!langEntry) continue
      const raw = zipReadEntry(buf, langEntry)
      if (!raw) continue
      let json: Record<string, unknown>
      try {
        json = JSON.parse(raw.toString('utf-8'))
      } catch {
        continue
      }
      for (const [k, v] of Object.entries(json)) {
        if (typeof v !== 'string') continue
        if (k.startsWith('key.')) keys.set(k, v)
        else if (k.startsWith('category.')) categories.set(k, v)
      }
    } catch {
      /* skip unreadable jar */
    }
  }
  const dict: LangDict = { keys, categories }
  langCache.set(instanceRoot, { at: Date.now(), dirMtime, dict })
  return dict
}

/* --------------------------------- options.txt --------------------------------- */

/** Parse every `key_*` line from options.txt → { content, value }. */
function readKeyLines(gameDir: string): { content: string; value: string }[] {
  let content = ''
  try {
    content = fs.readFileSync(path.join(gameDir, 'options.txt'), 'utf-8')
  } catch {
    return []
  }
  const out: { content: string; value: string }[] = []
  for (const line of content.split(/\r?\n/)) {
    if (!line.startsWith('key_')) continue
    const idx = line.indexOf(':')
    if (idx <= 4) continue
    out.push({ content: line.slice(4, idx), value: line.slice(idx + 1) })
  }
  return out
}

/** Merge keybind lines into an options.txt (replace same-key lines, append new). */
export function writeKeyLines(gameDir: string, lines: { content: string; value: string }[]): number {
  if (!lines.length) return 0
  const file = path.join(gameDir, 'options.txt')
  let content = ''
  try {
    content = fs.readFileSync(file, 'utf-8')
  } catch {
    content = ''
  }
  let written = 0
  for (const { content: k, value } of lines) {
    const newLine = `key_${k}:${value}`
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`^key_${escaped}:.*$`, 'm')
    if (re.test(content)) {
      content = content.replace(re, newLine)
    } else {
      const sep = content && !content.endsWith('\n') ? '\n' : ''
      content = content + `${sep}${newLine}\n`
    }
    written++
  }
  try {
    fs.mkdirSync(gameDir, { recursive: true })
    fs.writeFileSync(file, content, 'utf-8')
  } catch (err) {
    logger.warn('Keybinds: could not write options.txt: ' + (err as Error).message)
    return 0
  }
  return written
}

/* ---------------------------------- service ---------------------------------- */

/** Build a full keybind listing for one instance (names + categories resolved). */
export async function listKeybinds(profileId: string): Promise<KeybindEntry[]> {
  const profile = await profileManager.get(profileId)
  if (!profile) return []
  const gameDir = instancePath(profile)
  const raw = readKeyLines(gameDir)
  const dict = loadLangDict(gameDir)
  return raw.map(({ content, value }) => {
    const lookup = content.startsWith('key.') ? content : `key.${content}`
    const label =
      VANILLA_KEY_LABELS[content] ?? VANILLA_HOTBAR[content] ?? dict.keys.get(lookup) ?? dict.keys.get(content) ?? prettifyKeyName(content)
    let category = VANILLA_CATEGORY[content] ?? 'Other'
    if (category === 'Other') {
      const modid = content.replace(/^key\./, '').split('.')[0] ?? content
      const fromDict = dict.categories.get(`category.${modid}`)
      if (fromDict) category = fromDict
    }
    return { key: content, label, category, raw: value, bound: formatBoundKey(value) }
  })
}

/** Rebind a single key (value = raw bound key like `key.keyboard.g`). */
export async function setKeybind(profileId: string, content: string, value: string): Promise<KeybindEntry[]> {
  const profile = await profileManager.get(profileId)
  if (!profile) return []
  const gameDir = instancePath(profile)
  const clean = (value ?? '').trim() || 'key.keyboard.unknown'
  writeKeyLines(gameDir, [{ content, value: clean }])
  logger.info(`Keybinds: ${content} → ${clean} (${profile.name})`)
  return listKeybinds(profileId)
}

/** Copy the active profile's keybind layout to every other instance. */
export async function applyKeybindsToAll(profileId: string): Promise<{ applied: string[] }> {
  const profile = await profileManager.get(profileId)
  if (!profile) return { applied: [] }
  const srcLines = readKeyLines(instancePath(profile))
  const applied: string[] = []
  for (const p of await profileManager.list()) {
    if (p.id === profileId) continue
    const dir = instancePath(p)
    const n = writeKeyLines(dir, srcLines)
    if (n > 0) applied.push(p.name)
  }
  logger.info(`Keybinds: layout of "${profile.name}" applied to ${applied.length} other instance(s)`)
  return { applied }
}

/* ------------------------------ default template ------------------------------ */

const TEMPLATE_FILE = () => path.join(paths.data, 'keybinds', 'default.json')

/** Save the active profile's keybinds as the default for new instances. */
export async function saveTemplate(profileId: string): Promise<{ count: number }> {
  const profile = await profileManager.get(profileId)
  if (!profile) return { count: 0 }
  const lines = readKeyLines(instancePath(profile))
  try {
    fs.mkdirSync(path.dirname(TEMPLATE_FILE()), { recursive: true })
    fs.writeFileSync(TEMPLATE_FILE(), JSON.stringify(lines, null, 2), 'utf-8')
  } catch (err) {
    logger.warn('Keybinds: could not save default template: ' + (err as Error).message)
  }
  logger.info(`Keybinds: default template saved with ${lines.length} binding(s)`)
  return { count: lines.length }
}

/** Read the saved default template (if any). */
export function readTemplate(): { content: string; value: string }[] {
  try {
    const raw = fs.readFileSync(TEMPLATE_FILE(), 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Seed a freshly-created instance with the saved default keybinds (no-op when
 *  no template exists — the game then uses its own defaults). */
export function seedKeybindTemplate(gameDir: string): number {
  const tpl = readTemplate()
  if (!tpl.length) return 0
  const n = writeKeyLines(gameDir, tpl)
  if (n > 0) logger.info(`Keybinds: seeded ${n} default binding(s) into new instance`)
  return n
}

export const keybindsService = { listKeybinds, setKeybind, applyKeybindsToAll, saveTemplate, readTemplate, seedKeybindTemplate, formatBoundKey }
