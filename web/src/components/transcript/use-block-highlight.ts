/**
 * Whole-block Shiki highlight with a content-keyed cache, shared by
 * ShellCommand / WritePreview / ReplView (their copy-pasted tokenize effects
 * lived in tool-renderers.tsx before this).
 *
 * Same remount rationale as diff-highlight.ts: a virtualizer key change
 * remounts the renderer and resets its state, so without a cache the block
 * painted plain and re-colored only after the async tokenize round-trip.
 * Seeding from the cache in the useState initializer paints colored on the
 * first frame of a remount.
 */

import { useEffect, useState } from 'react'
import { escapeHtml } from './shared'
import { ensureLang, getHighlighter } from './syntax'

const CACHE_MAX = 64
const cache = new Map<string, string>()

function getCached(key: string): string | undefined {
  const hit = cache.get(key)
  if (hit !== undefined) {
    // LRU bump: re-insert so eviction drops the stalest entry first.
    cache.delete(key)
    cache.set(key, hit)
  }
  return hit
}

async function computeBlockHighlight(key: string, lang: string, code: string): Promise<string | null> {
  const ok = await ensureLang(lang)
  if (!ok) return null
  const highlighter = await getHighlighter()
  try {
    const tokens = highlighter.codeToTokens(code, { lang: lang as never, theme: 'tokyo-night' })
    const html = tokens.tokens
      .map((lineTokens: Array<{ color?: string; content: string }>) =>
        lineTokens.map(t => `<span style="color:${t.color}">${escapeHtml(t.content)}</span>`).join(''),
      )
      .join('\n')
    cache.set(key, html)
    if (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    return html
  } catch {
    return null // fall back to plain
  }
}

/** Per-line Shiki HTML for a code block, lines joined with '\n'. Returns null
 *  until highlighted (or when the language is unsupported) -- callers render
 *  the plain fallback for null. */
export function useBlockHighlight(lang: string | undefined, code: string): string | null {
  const key = lang ? `${lang}\u0000${code}` : null
  const [html, setHtml] = useState<string | null>(() => (key ? (getCached(key) ?? null) : null))
  useEffect(() => {
    if (!key || !lang) return
    const cached = getCached(key)
    if (cached !== undefined) {
      setHtml(prev => (prev === cached ? prev : cached))
      return
    }
    let alive = true
    computeBlockHighlight(key, lang, code)
      .then(h => {
        if (alive && h !== null) setHtml(h)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [key, lang, code])
  return html
}
