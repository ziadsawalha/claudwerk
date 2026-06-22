import { BLOCK_ENTRIES } from './blocks'
import { DRAW_GUIDE_ENTRIES } from './draw-guide'
import { DRAW_SCHEMA_ENTRIES } from './draw-schema'
import { estimateTokens, type TaxonomyEntry } from './types'

/**
 * Excalidraw version the draw.* schema is pinned to. Transcribed from the
 * installed @excalidraw/excalidraw. A test asserts this still matches
 * web/package.json so the docs cannot silently drift from the real renderer --
 * bumping the dep without revisiting these docs fails the build.
 */
export const EXCALIDRAW_VERSION = '0.18.1'

const ALL_ENTRIES: TaxonomyEntry[] = [...DRAW_SCHEMA_ENTRIES, ...DRAW_GUIDE_ENTRIES, ...BLOCK_ENTRIES]

const BY_SUBJECT = new Map<string, TaxonomyEntry>(ALL_ENTRIES.map(e => [e.subject, e]))

/** Common shorthands -> canonical subject. */
const ALIASES: Record<string, string> = {
  excalidraw: 'draw',
  scene: 'draw.envelope',
  envelope: 'draw.envelope',
  elements: 'draw.elements',
  element: 'draw.elements',
  rectangle: 'draw.elements.shapes',
  rect: 'draw.elements.shapes',
  diamond: 'draw.elements.shapes',
  ellipse: 'draw.elements.shapes',
  circle: 'draw.elements.shapes',
  shapes: 'draw.elements.shapes',
  text: 'draw.elements.text',
  label: 'draw.elements.text',
  arrow: 'draw.elements.arrow',
  line: 'draw.elements.arrow',
  linear: 'draw.elements.arrow',
  freedraw: 'draw.elements.freedraw',
  image: 'draw.elements.image',
  frame: 'draw.elements.frame',
  enums: 'draw.enums',
  enum: 'draw.enums',
  binding: 'draw.bindings',
  bindings: 'draw.bindings',
  color: 'draw.colors',
  colors: 'draw.colors',
  colour: 'draw.colors',
  palette: 'draw.colors',
  gotcha: 'draw.gotchas',
  gotchas: 'draw.gotchas',
  comment: 'draw.comments',
  comments: 'draw.comments',
  annotation: 'draw.comments',
  annotations: 'draw.comments',
  recipe: 'draw.recipes',
  recipes: 'draw.recipes',
  example: 'draw.examples',
  examples: 'draw.examples',
  diagram: 'mermaid',
  api: 'apiendpoint',
  endpoint: 'apiendpoint',
  schema: 'datamodel',
  model: 'datamodel',
  code: 'annotatedcode',
  tree: 'filetree',
  files: 'filetree',
  block: 'blocks',
}

export type ResolveResult = { entry: TaxonomyEntry } | { suggestions: string[] }

function normalize(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/\s+/g, '')
}

/** Resolve a requested subject to an entry, or to a list of suggestions. */
export function resolveSubject(rawInput: string): ResolveResult {
  const input = normalize(rawInput)
  if (!input) return { suggestions: topLevelSubjects() }

  // 1. exact canonical
  const exact = BY_SUBJECT.get(input)
  if (exact) return { entry: exact }

  // 2. alias
  const aliased = ALIASES[input]
  if (aliased && BY_SUBJECT.get(aliased)) return { entry: BY_SUBJECT.get(aliased) as TaxonomyEntry }

  // 3. prefix match (e.g. "draw.elem" -> draw.elements). When several match,
  //    prefer the single shallowest (fewest segments) -- so "draw.element"
  //    resolves to "draw.elements", but a genuinely ambiguous "draw.e" suggests.
  const depth = (s: string) => s.split('.').length
  const prefixHits = ALL_ENTRIES.filter(e => e.subject.startsWith(input))
  if (prefixHits.length === 1) return { entry: prefixHits[0] }
  if (prefixHits.length > 1) {
    const minDepth = Math.min(...prefixHits.map(e => depth(e.subject)))
    const shallowest = prefixHits.filter(e => depth(e.subject) === minDepth)
    if (shallowest.length === 1) return { entry: shallowest[0] }
    return { suggestions: prefixHits.map(e => e.subject) }
  }

  // 4. last segment match (e.g. "draw.arrow" -> draw.elements.arrow)
  const lastSeg = input.split('.').pop() ?? input
  if (lastSeg !== input && ALIASES[lastSeg] && BY_SUBJECT.get(ALIASES[lastSeg])) {
    return { entry: BY_SUBJECT.get(ALIASES[lastSeg]) as TaxonomyEntry }
  }

  // 5. substring match anywhere in the subject
  const contains = ALL_ENTRIES.filter(e => e.subject.includes(input))
  if (contains.length === 1) return { entry: contains[0] }
  if (contains.length > 1) return { suggestions: contains.map(e => e.subject) }

  // 6. nothing -- offer the top level
  return { suggestions: topLevelSubjects() }
}

/** Top-level subjects (block types), for the index + fallbacks. */
export function topLevelSubjects(): string[] {
  return ALL_ENTRIES.filter(e => !e.subject.includes('.')).map(e => e.subject)
}

export function allSubjects(): string[] {
  return ALL_ENTRIES.map(e => e.subject)
}

export function getEntry(subject: string): TaxonomyEntry | undefined {
  return BY_SUBJECT.get(subject)
}

/** The cheap index (TOC + overview + gotchas summary) returned with no subject. */
export function renderIndex(): string {
  const lines: string[] = []
  lines.push('# dialog_taxonomy -- index')
  lines.push('')
  lines.push(
    'On-demand docs for authoring `dialog` block DSLs. Call `dialog_taxonomy("<subject>")` ' +
      'to pull ONE slice (~200-500 tokens) instead of inlining the whole spec. Subjects are ' +
      'dotted and fuzzy-matched (e.g. "arrow", "draw.colors", "mermaid").',
  )
  lines.push('')
  lines.push(`Excalidraw schema pinned to **v${EXCALIDRAW_VERSION}**.`)
  lines.push('')
  lines.push('## Subjects')
  for (const e of ALL_ENTRIES) {
    const indent = '  '.repeat(e.subject.split('.').length - 1)
    lines.push(`${indent}- \`${e.subject}\` -- ${e.summary}`)
  }
  lines.push('')
  lines.push('## Draw -- the 3 things that bite first')
  lines.push(
    '1. **Colors:** author with STANDARD light-palette hexes (#1e1e1e ink, #a5d8ff/#b2f2bb ' +
      'fills). The dark canvas inverts+hue-rotates them into correct pastels -- storing the ' +
      'final pastel = muddy. (`draw.colors`)',
  )
  lines.push('2. **Theme:** seed `appState.theme:"dark"` in the scene, never a `theme` prop. (`draw.gotchas`)')
  lines.push(
    '3. **Comments come back as scene `text` elements**, not a side channel; absence of ' +
      '`customData.dslId` marks a user annotation. (`draw.comments`)',
  )
  return lines.join('\n')
}

/** Render a single entry as the tool's text payload (body + see-also footer). */
export function renderEntry(entry: TaxonomyEntry): string {
  let out = entry.body
  if (entry.related && entry.related.length > 0) {
    out += `\n\n---\nSee also: ${entry.related.map(r => `\`${r}\``).join(', ')}`
  }
  out += `\n\n(~${estimateTokens(out)} tokens. Call dialog_taxonomy() with no subject for the full index.)`
  return out
}
