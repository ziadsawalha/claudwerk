/**
 * Canvas scene sanitizer -- runs on EVERY save and on every inbound remote/guest
 * delta (Phase D/E). Mandatory for public sharing, applied to authed saves too
 * (defense in depth). Mirrors the recap public-share-sanitize discipline.
 *
 * Threat: Excalidraw `embeddable` / `iframe` elements render arbitrary URLs in an
 * iframe inside the canvas; a `link` on any element can carry a javascript: URI.
 * A malicious client (or a public editor) could inject HTML / script that way.
 * We DROP embed elements and strip dangerous links, allowlist-style.
 *
 * The parse is defensive: malformed JSON -> reject (caller keeps the prior scene).
 */

/** Element types that render external/embedded content -- never persisted. */
const FORBIDDEN_TYPES = new Set(['embeddable', 'iframe'])

function isSafeLink(link: unknown): boolean {
  if (typeof link !== 'string') return false
  const v = link.trim().toLowerCase()
  // Allow http(s) and same-origin relative links; drop javascript:/data:/vbscript: etc.
  return v.startsWith('http://') || v.startsWith('https://') || v.startsWith('/')
}

export interface SanitizeResult {
  /** Sanitized scene JSON string (re-serialized), or null when input was unparseable. */
  json: string | null
  /** Count of elements removed. */
  droppedElements: number
  /** Count of links stripped from surviving elements. */
  strippedLinks: number
}

/**
 * Sanitize a serialized Excalidraw scene. Drops embed elements, strips unsafe
 * links. Returns re-serialized JSON (or null if the input could not be parsed).
 */
export function sanitizeCanvasScene(raw: string): SanitizeResult {
  let scene: Record<string, unknown>
  try {
    scene = JSON.parse(raw)
  } catch {
    return { json: null, droppedElements: 0, strippedLinks: 0 }
  }
  if (!scene || typeof scene !== 'object') {
    return { json: null, droppedElements: 0, strippedLinks: 0 }
  }

  let droppedElements = 0
  let strippedLinks = 0

  const elements = Array.isArray(scene.elements) ? scene.elements : []
  const cleaned = elements.filter((el): el is Record<string, unknown> => {
    if (!el || typeof el !== 'object') return false
    const type = (el as Record<string, unknown>).type
    if (typeof type === 'string' && FORBIDDEN_TYPES.has(type)) {
      droppedElements++
      return false
    }
    return true
  })

  for (const el of cleaned) {
    if ('link' in el && el.link != null && !isSafeLink(el.link)) {
      el.link = null
      strippedLinks++
    }
  }

  scene.elements = cleaned
  return { json: JSON.stringify(scene), droppedElements, strippedLinks }
}
