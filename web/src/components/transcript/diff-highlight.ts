/**
 * Content-keyed cache of Shiki-highlighted diff lines.
 *
 * DiffView remounts whenever its transcript group's virtualizer key changes
 * (e.g. the live-slot key swap at turn end). A remount resets component state,
 * so without a cache the diff painted plain and only re-colored after the
 * async tokenize round-trip -- a visible flash. Caching the computed
 * line->html map by (lang, patch content) lets a remounted DiffView seed its
 * state synchronously and paint colored on the first frame.
 */

import { escapeHtml } from './shared'
import { ensureLang, getHighlighter } from './syntax'

export type DiffPatch = { oldStart: number; lines: string[] }

const CACHE_MAX = 48
const cache = new Map<string, Map<string, string>>()

export function diffHighlightKey(lang: string, patches: DiffPatch[]): string {
  let key = lang
  for (const p of patches) key += `\u0001${p.lines.join('\n')}`
  return key
}

export function getCachedDiffHighlight(key: string): Map<string, string> | undefined {
  const hit = cache.get(key)
  if (hit) {
    // LRU bump: re-insert so eviction drops the stalest entry first.
    cache.delete(key)
    cache.set(key, hit)
  }
  return hit
}

/**
 * Tokenize patch lines into a line-content -> html map and cache it under
 * `key`. Each patch runs TWO passes (context+removed, context+added): mixing
 * +/- lines or concatenating across hunks creates syntactically broken code
 * shiki's tokenizer can't recover from (e.g. a stray unterminated string makes
 * it emit the rest as one plain token). Returns null when the language is
 * unavailable.
 */
export async function computeDiffHighlight(
  key: string,
  lang: string,
  patches: DiffPatch[],
): Promise<Map<string, string> | null> {
  const ok = await ensureLang(lang)
  if (!ok) return null
  const highlighter = await getHighlighter()
  const lineMap = new Map<string, string>()
  const runPass = (lines: string[]) => {
    if (lines.length === 0) return
    try {
      const tokens = highlighter.codeToTokens(lines.join('\n'), {
        lang: lang as never,
        theme: 'tokyo-night',
      })
      for (let i = 0; i < tokens.tokens.length; i++) {
        const lineTokens = tokens.tokens[i] as Array<{ color?: string; content: string }>
        const html = lineTokens.map(t => `<span style="color:${t.color}">${escapeHtml(t.content)}</span>`).join('')
        lineMap.set(lines[i], html)
      }
    } catch {
      // skip -- line stays plain
    }
  }
  for (const patch of patches) {
    const beforeLines: string[] = []
    const afterLines: string[] = []
    for (const line of patch.lines) {
      const prefix = line[0]
      const content = line.slice(1)
      if (prefix === ' ' || prefix === '-') beforeLines.push(content)
      if (prefix === ' ' || prefix === '+') afterLines.push(content)
    }
    runPass(beforeLines)
    runPass(afterLines)
  }
  cache.set(key, lineMap)
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  return lineMap
}
