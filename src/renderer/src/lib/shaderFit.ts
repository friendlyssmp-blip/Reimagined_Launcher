/**
 * v1.0.56 — per-shader hardware-fit badge.
 *
 * When browsing shader packs, every card (and the detail page) shows a badge
 * telling the user whether THIS machine can realistically run that pack:
 * green "Suitable for your PC", amber "Limited", or red "Not suitable for your PC"
 * (always installable — it is their call, but they know the risk up front).
 *
 * v1.0.63 — a pack that has ALREADY crashed on this machine overrides every
 * hardware guess: the crash happened here, with these drivers, on this GPU.
 * The badge turns red "Crashed on this PC" (still installable at their own
 * risk — Shader Guard auto-disables shaders on the next launch if it happens
 * again).
 *
 * The verdict is based on the real Shader Guard assessment (VRAM / vendor /
 * driver) plus the local crash history. Lightweight packs (Modrinth
 * "Lite"/"Potato"/"Performance" categories) get a one-step mercy on low-VRAM
 * machines, because those packs are specifically built to run on weak GPUs.
 */
export interface ShaderFit {
  level: 'ok' | 'limited' | 'no' | 'crashed'
  label: string
  hint: string
}

/** Normalize a pack name for fuzzy matching: lowercase, keep only letters/digits. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export function shaderFitFor(
  support: { level?: 'ok' | 'limited' | 'unsupported'; vramGB?: number } | null | undefined,
  categories?: string[],
  crashPacks?: string[],
  shaderName?: string
): ShaderFit {
  // A pack that crashed on THIS machine is the strongest signal there is —
  // it beats every GPU-based guess (v1.0.63).
  if (shaderName && crashPacks && crashPacks.length > 0) {
    const target = norm(shaderName)
    if (target) {
      for (const cp of crashPacks) {
        const c = norm(cp)
        // Minimum token length: short generic names ("lite", "bsl", "v2")
        // must never flag unrelated packs — this badge is alarming, so
        // missing a match is better than a false positive.
        if (c && c.length >= 4 && target.length >= 4 && (target.includes(c) || c.includes(target))) {
          return {
            level: 'crashed',
            label: 'Crashed on this PC',
            hint: 'This shader pack crashed on your machine before (GPU hang). You can still install it, but at your own risk — if it crashes again, Reimagined auto-disables shaders on the next launch.'
          }
        }
      }
    }
  }
  const vram = support?.vramGB ?? 0
  const lite = (categories ?? []).some((c) => /^(lite|potato|performance|low)$/i.test(c))
  if (vram > 0 && vram < 2) {
    return lite
      ? {
          level: 'limited',
          label: 'Suitable (light version)',
          hint: 'Lightweight shader — your GPU (low VRAM) can handle it, but with care.'
        }
      : {
          level: 'no',
          label: 'Not suitable for your PC',
          hint: 'Install at your own risk — your GPU has low VRAM and may crash or run very slowly.'
        }
  }
  if (vram >= 4) {
    return { level: 'ok', label: 'Suitable for your PC', hint: 'Your GPU can run this shader without issues.' }
  }
  if (vram >= 2) {
    return {
      level: 'limited',
      label: 'Limited',
      hint: 'May run low on VRAM at high render distance — try lowering the render distance.'
    }
  }
  if (support?.level === 'unsupported') {
    return {
      level: 'no',
      label: 'Not suitable for your PC',
      hint: 'Install at your own risk — your GPU/driver does not support shaders reliably.'
    }
  }
  return {
    level: 'limited',
    label: 'Unverified',
    hint: 'Could not evaluate your hardware — install at your own risk.'
  }
}

export function shaderFitClass(level: ShaderFit['level']): string {
  return level === 'ok' ? 'badge-success' : level === 'limited' ? 'badge-warn' : 'badge-danger'
}
