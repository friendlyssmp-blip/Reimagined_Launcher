/** Normalized title — the shared identity key across Modrinth ↔ CurseForge.
 *  Both providers name projects differently ("Essential Mod" vs "Essential"),
 *  so a canonical lowercase-alphanumeric form is used to recognize the same
 *  item installed from either provider. */
export function normalizeTitle(t: string | null | undefined): string {
  return (t ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}
