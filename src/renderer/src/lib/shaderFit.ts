/**
 * v1.0.56 — per-shader hardware-fit badge.
 *
 * When browsing shader packs, every card (and the detail page) shows a badge
 * telling the user whether THIS machine can realistically run that pack:
 * green "Suitable for your PC", amber "Limited", or red "Not suitable for your PC"
 * (always installable — it is their call, but they know the risk up front).
 *
 * The verdict is based on the real Shader Guard assessment (VRAM / vendor /
 * driver). Lightweight packs (Modrinth "Lite"/"Potato"/"Performance"
 * categories) get a one-step mercy on low-VRAM machines, because those packs
 * are specifically built to run on weak GPUs.
 */
export interface ShaderFit {
  level: 'ok' | 'limited' | 'no'
  label: string
  hint: string
}

export function shaderFitFor(
  support: { level?: 'ok' | 'limited' | 'unsupported'; vramGB?: number } | null | undefined,
  categories?: string[]
): ShaderFit {
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
