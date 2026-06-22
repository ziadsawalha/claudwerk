import { describe, expect, test } from 'bun:test'
import { registerDialogTaxonomyTool } from '../../agent-host-common/mcp-host/mcp-tools/dialog-taxonomy'
import {
  allSubjects,
  EXCALIDRAW_VERSION,
  getEntry,
  renderEntry,
  renderIndex,
  resolveSubject,
  topLevelSubjects,
} from './index'

// --- drift guard: the docs are pinned to the shipped Excalidraw version --------
describe('version pin', () => {
  test('EXCALIDRAW_VERSION matches web/package.json (docs cannot silently drift)', async () => {
    const pkgPath = `${import.meta.dir}/../../../web/package.json`
    const pkg = (await Bun.file(pkgPath).json()) as { dependencies?: Record<string, string> }
    const dep = pkg.dependencies?.['@excalidraw/excalidraw']
    expect(dep, '@excalidraw/excalidraw missing from web/package.json').toBeDefined()
    const installed = (dep as string).replace(/^[\^~]/, '')
    expect(
      installed,
      `Taxonomy is pinned to ${EXCALIDRAW_VERSION} but web ships ${installed}. ` +
        'Revisit src/shared/dialog-taxonomy/draw-schema.ts + bump EXCALIDRAW_VERSION.',
    ).toBe(EXCALIDRAW_VERSION)
  })
})

// --- golden scenes stay schema-conformant --------------------------------------
const KNOWN_TYPES = new Set([
  'rectangle',
  'diamond',
  'ellipse',
  'text',
  'line',
  'arrow',
  'freedraw',
  'image',
  'frame',
  'magicframe',
  'embeddable',
  'iframe',
  'selection',
])
const FILL_STYLES = new Set(['hachure', 'cross-hatch', 'solid', 'zigzag'])
const STROKE_STYLES = new Set(['solid', 'dashed', 'dotted'])

describe('golden example scenes', () => {
  for (const name of ['rocket', 'robot', 'skyline']) {
    test(`${name}.json is a well-formed, schema-conformant scene`, async () => {
      const scene = (await Bun.file(`${import.meta.dir}/golden/${name}.json`).json()) as {
        type: string
        version: number
        elements: Array<Record<string, unknown>>
      }
      expect(scene.type).toBe('excalidraw')
      expect(typeof scene.version).toBe('number')
      expect(Array.isArray(scene.elements)).toBe(true)
      expect(scene.elements.length).toBeGreaterThan(0)
      for (const el of scene.elements) {
        expect(typeof el.id).toBe('string')
        expect(KNOWN_TYPES.has(el.type as string)).toBe(true)
        expect(typeof el.x).toBe('number')
        expect(typeof el.y).toBe('number')
        if (el.fillStyle !== undefined) expect(FILL_STYLES.has(el.fillStyle as string)).toBe(true)
        if (el.strokeStyle !== undefined) expect(STROKE_STYLES.has(el.strokeStyle as string)).toBe(true)
      }
    })
  }
})

// --- subject resolution --------------------------------------------------------
describe('resolveSubject', () => {
  test('exact canonical', () => {
    const r = resolveSubject('draw.colors')
    expect('entry' in r && r.entry.subject).toBe('draw.colors')
  })
  test('alias: arrow -> draw.elements.arrow', () => {
    const r = resolveSubject('arrow')
    expect('entry' in r && r.entry.subject).toBe('draw.elements.arrow')
  })
  test('alias: palette -> draw.colors', () => {
    const r = resolveSubject('palette')
    expect('entry' in r && r.entry.subject).toBe('draw.colors')
  })
  test('quoted + cased input normalizes', () => {
    const r = resolveSubject('"Draw.Colors"')
    expect('entry' in r && r.entry.subject).toBe('draw.colors')
  })
  test('unique prefix: draw.element -> draw.elements', () => {
    const r = resolveSubject('draw.element')
    expect('entry' in r && r.entry.subject).toBe('draw.elements')
  })
  test('empty -> top-level suggestions', () => {
    const r = resolveSubject('')
    expect('suggestions' in r && r.suggestions.length).toBeGreaterThan(0)
  })
  test('nonsense -> suggestions, not a throw', () => {
    const r = resolveSubject('zzznope')
    expect('suggestions' in r).toBe(true)
  })
})

// --- registry integrity --------------------------------------------------------
describe('registry integrity', () => {
  test('every related[] link points at a real subject', () => {
    const subjects = new Set(allSubjects())
    for (const s of allSubjects()) {
      const e = getEntry(s)
      for (const rel of e?.related ?? []) {
        expect(subjects.has(rel), `${s} -> dangling related "${rel}"`).toBe(true)
      }
    }
  })
  test('index lists every subject and resolves each', () => {
    const index = renderIndex()
    for (const s of allSubjects()) {
      expect(index.includes(s), `index missing ${s}`).toBe(true)
      expect('entry' in resolveSubject(s)).toBe(true)
    }
  })
  test('index advertises the pinned version + the top gotchas', () => {
    const index = renderIndex()
    expect(index.includes(EXCALIDRAW_VERSION)).toBe(true)
    expect(index.toLowerCase()).toContain('colors')
    expect(index.toLowerCase()).toContain('theme')
  })
  test('top-level subjects include draw + blocks', () => {
    const top = topLevelSubjects()
    expect(top).toContain('draw')
    expect(top).toContain('blocks')
    expect(top).toContain('mermaid')
  })
  test('renderEntry appends see-also + token estimate', () => {
    const e = getEntry('draw.colors')
    if (!e) throw new Error('missing draw.colors')
    const out = renderEntry(e)
    expect(out).toContain('See also')
    expect(out).toContain('tokens')
  })
})

// --- the MCP tool --------------------------------------------------------------
describe('dialog_taxonomy tool', () => {
  const tool = registerDialogTaxonomyTool().dialog_taxonomy
  const ctx = { rawArgs: {}, extra: undefined }

  test('no subject -> the index', async () => {
    const res = await tool.handle({}, ctx)
    expect(res.content[0].text).toContain('dialog_taxonomy -- index')
  })
  test('subject -> the slice', async () => {
    const res = await tool.handle({ subject: 'draw.colors' }, ctx)
    expect(res.content[0].text).toContain('STANDARD light palette')
  })
  test('unknown subject -> suggestions, not an error', async () => {
    const res = await tool.handle({ subject: 'zzznope' }, ctx)
    expect(res.isError).toBeUndefined()
    expect(res.content[0].text.toLowerCase()).toContain('did you mean')
  })
})
