/**
 * Regression test for the "Edit diff flashes plain -> colored on remount" bug.
 *
 * DiffView remounts whenever its group's virtualizer key changes (the
 * live-slot key swap at turn end is the surviving by-design remount). A fresh
 * mount used to start with highlighted=null and re-tokenize through the async
 * Shiki round-trip, repainting the diff. The fix is a module-level
 * content-keyed cache (diff-highlight.ts) that the component seeds from
 * SYNCHRONOUSLY in its useState initializer.
 *
 * Probes:
 *   - cache unit behavior (compute -> cached, LRU eviction, unknown lang).
 *   - component remount: after a first mount has populated the cache, a brand
 *     new mount must show colored spans IMMEDIATELY (no async flush between
 *     render() and the assertion).
 */

import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./syntax', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    ensureLang: async (lang: string) => lang !== 'nope',
    getHighlighter: async () => ({
      codeToTokens: (code: string) => ({
        tokens: code.split('\n').map(line => [{ color: '#c0ffee', content: line }]),
      }),
    }),
  }
})

import { computeDiffHighlight, diffHighlightKey, getCachedDiffHighlight } from './diff-highlight'
import { DiffView } from './tool-renderers'

afterEach(cleanup)

const PATCHES = [{ oldStart: 1, lines: [' const a = 1', '-const b = 2', '+const b = 3'] }]

describe('diff-highlight cache', () => {
  it('computes a line->html map and caches it under the key', async () => {
    const key = diffHighlightKey('typescript', PATCHES)
    expect(getCachedDiffHighlight(key)).toBeUndefined()
    const map = await computeDiffHighlight(key, 'typescript', PATCHES)
    expect(map).not.toBeNull()
    expect(map?.get('const b = 3')).toContain('#c0ffee')
    expect(getCachedDiffHighlight(key)).toBe(map)
  })

  it('returns null and caches nothing for an unavailable language', async () => {
    const key = diffHighlightKey('nope', PATCHES)
    const map = await computeDiffHighlight(key, 'nope', PATCHES)
    expect(map).toBeNull()
    expect(getCachedDiffHighlight(key)).toBeUndefined()
  })

  it('evicts the least-recently-used entry past the cap', async () => {
    const firstKey = diffHighlightKey('typescript', [{ oldStart: 1, lines: ['+seed-0'] }])
    await computeDiffHighlight(firstKey, 'typescript', [{ oldStart: 1, lines: ['+seed-0'] }])
    for (let i = 1; i <= 48; i++) {
      const p = [{ oldStart: 1, lines: [`+seed-${i}`] }]
      await computeDiffHighlight(diffHighlightKey('typescript', p), 'typescript', p)
    }
    expect(getCachedDiffHighlight(firstKey)).toBeUndefined()
  })
})

describe('DiffView remount', () => {
  it('paints colored synchronously on a remount (cache seed, no flash)', async () => {
    const coloredSpans = (el: HTMLElement) => el.querySelectorAll('span[style*="#c0ffee"]').length

    const first = render(<DiffView patches={PATCHES} filePath="example.ts" />)
    // First mount is allowed to be async: wait for the highlight to land.
    await waitFor(() => expect(coloredSpans(first.container)).toBeGreaterThan(0))
    first.unmount()

    // Fresh mount = the remount scenario. Assert colored output IMMEDIATELY
    // after the synchronous render, with no promise flush in between.
    const second = render(<DiffView patches={[...PATCHES]} filePath="example.ts" />)
    expect(coloredSpans(second.container)).toBeGreaterThan(0)
  })
})
