/**
 * v1.0.56 — per-shader hardware-fit badge.
 *
 * When browsing shader packs, every card (and the detail page) shows a badge
 * telling the user whether THIS machine can realistically run that pack:
 * green "Apto para tu PC", amber "Limitado", or red "No apto para tu PC"
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
          label: 'Apto (versión ligera)',
          hint: 'Shader ligero — tu GPU (poca VRAM) puede correrlo, pero con cuidado.'
        }
      : {
          level: 'no',
          label: 'No apto para tu PC',
          hint: 'Instalar bajo tu propio riesgo — tu GPU tiene poca VRAM y puede crashear o ir muy lento.'
        }
  }
  if (vram >= 4) {
    return { level: 'ok', label: 'Apto para tu PC', hint: 'Tu GPU puede con este shader sin problemas.' }
  }
  if (vram >= 2) {
    return {
      level: 'limited',
      label: 'Limitado',
      hint: 'Puede ir corto de VRAM a distancia de renderizado alta — prueba con la distancia baja.'
    }
  }
  if (support?.level === 'unsupported') {
    return {
      level: 'no',
      label: 'No apto para tu PC',
      hint: 'Instalar bajo tu propio riesgo — tu GPU/driver no soporta shaders de forma fiable.'
    }
  }
  return {
    level: 'limited',
    label: 'Sin verificar',
    hint: 'No se pudo evaluar tu hardware — instalar bajo tu propio riesgo.'
  }
}

export function shaderFitClass(level: ShaderFit['level']): string {
  return level === 'ok' ? 'badge-success' : level === 'limited' ? 'badge-warn' : 'badge-danger'
}
