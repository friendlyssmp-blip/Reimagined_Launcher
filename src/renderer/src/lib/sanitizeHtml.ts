/**
 * Minimal, dependency-free HTML sanitizer for provider-supplied rich text
 * (CurseForge changelogs/descriptions are HTML, and some Modrinth changelogs
 * embed HTML too). Only safe formatting tags and attributes survive — scripts,
 * event handlers, javascript: URLs and style blocks are always dropped.
 */

const ALLOWED_TAGS = new Set([
  'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'small', 'sub', 'sup',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'pre', 'code', 'blockquote', 'hr', 'a', 'img', 'span', 'div',
  'table', 'thead', 'tbody', 'tr', 'th', 'td'
])

const SAFE_URL = /^(https?:|data:image\/)/i

/** Strip dangerous nodes/attributes and return the sanitized fragment. */
export function sanitizeHtml(html: string): string {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const root = doc.body

  const clean = (node: Node): Node | null => {
    if (node.nodeType === Node.TEXT_NODE) return node
    if (node.nodeType !== Node.ELEMENT_NODE) return null
    const el = node as HTMLElement
    const tag = el.tagName.toLowerCase()
    if (!ALLOWED_TAGS.has(tag)) {
      // Drop the element but keep its text content (e.g. <font>, <center>).
      const frag = doc.createDocumentFragment()
      for (const child of Array.from(el.childNodes)) {
        const c = clean(child)
        if (c) frag.appendChild(c)
      }
      return frag
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      const val = attr.value.trim()
      if (name.startsWith('on') || name === 'style') { el.removeAttribute(attr.name); continue }
      if (tag === 'a' && name === 'href' && !SAFE_URL.test(val)) { el.removeAttribute(attr.name); continue }
      if (tag === 'img' && name === 'src' && !SAFE_URL.test(val)) { el.removeAttribute(attr.name); continue }
      if (tag === 'img' && !['src', 'alt', 'title', 'width', 'height'].includes(name)) { el.removeAttribute(attr.name); continue }
      if (tag === 'a' && !['href', 'title', 'target', 'rel'].includes(name)) { el.removeAttribute(attr.name); continue }
      // v2.1.2 — every link must open in the SYSTEM browser, never navigate
      // the launcher in place (that stranded users on an external page with
      // no back button). Force target=_blank + rel so the main window's
      // setWindowOpenHandler routes it to shell.openExternal.
      if (tag === 'a') {
        el.setAttribute('target', '_blank')
        el.setAttribute('rel', 'noopener noreferrer')
      }
      if (tag !== 'a' && tag !== 'img' && name !== 'title') el.removeAttribute(attr.name)
    }
    for (const child of Array.from(el.childNodes)) {
      const c = clean(child)
      if (c === null) el.removeChild(child)
      else if (c !== child) el.replaceChild(c, child)
    }
    return el
  }

  for (const child of Array.from(root.childNodes)) {
    const c = clean(child)
    if (c === null) root.removeChild(child)
    else if (c !== child) root.replaceChild(c, child)
  }
  return root.innerHTML
}

/** Heuristic: does this text contain HTML tags? (CurseForge changelogs do.) */
export function isHtmlish(text: string | null | undefined): boolean {
  return /<\/?[a-z][^>]*>/i.test(text ?? '')
}
