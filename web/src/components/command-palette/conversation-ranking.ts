import type { Conversation } from '@/lib/types'
import type { MergedItem } from './types'

/**
 * No-prefix palette ranking tiers (higher wins). A strong NAME match must always beat
 * fuzzy chaff, so we partition results into hard tiers instead of blending one fzf score.
 * Order of importance (Jonas's spec):
 *   1. NAME          -- the conversation's own name/title matches the query ("Fuzzy-dragon")
 *   2. PROJECT_CONV  -- active conversations of a project whose NAME matches ("Claudewerk"),
 *                       ordered by start time
 *   3. PROJECT_NODE  -- the project node itself, when it has no active conversations
 *   4. FUZZY         -- everything else fzf matched (weak/scattered), plus commands
 */
export const RANK_TIER = {
  NAME: 4,
  PROJECT_CONV: 3,
  PROJECT_NODE: 2,
  FUZZY: 1,
} as const

const WORD_BOUNDARY = new Set([' ', '-', '_', '/', '.', ':'])

/**
 * Contiguous-match strength of `query` inside `text`, case-insensitive.
 *   4 exact | 3 prefix | 2 word-start | 1 substring | 0 none (no contiguous run).
 * 0 does NOT mean "no fzf match" -- fzf can still match scattered chars; it means the
 * query is not a contiguous substring of this field, i.e. only fuzzy.
 */
export function matchStrength(query: string, text: string): number {
  if (!query || !text) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (t === q) return 4
  if (t.startsWith(q)) return 3
  const idx = t.indexOf(q)
  if (idx < 0) return 0
  return WORD_BOUNDARY.has(t[idx - 1] ?? '') ? 2 : 1
}

/** Last non-empty path segment of a project URI (the human "project name" when unlabeled). */
export function projectBasename(uri: string): string {
  const parts = uri.split('/').filter(Boolean)
  const last = parts.pop() ?? ''
  // First segment after split is the "scheme:" token for an empty path -- ignore it.
  return last.endsWith(':') ? '' : last
}

/** Best contiguous-match strength of `query` against a project's name -- its label or, when
 *  unlabeled, its path basename. */
export function projectNameStrength(query: string, label: string | undefined, uri: string): number {
  return Math.max(matchStrength(query, label || ''), matchStrength(query, projectBasename(uri)))
}

/**
 * A match counts as "strong" only at a word boundary or better (exact / prefix / word-start,
 * strength >= 2). A strength-1 mid-word substring is incidental, not an intentional hit:
 * searching "nsf" lands inside "tra-NSF-orms", so a conversation titled "...transforms..."
 * must NOT be promoted to a strong tier above an exact match on the "nsf" project. Weak
 * substrings fall to the fuzzy tier, where their higher fzf score still floats them above
 * scattered chaff. Without this gate, fuzzy noise buries perfect prefix matches (the user's bug).
 */
const STRONG_MATCH = 2

/** Legacy soft boosts for the fuzzy tier: +50% top MRU, +30% hottest project, +30% live. */
export function fuzzyMultiplier(opts: {
  mruRank: number
  freqCount: number
  maxFreq: number
  isActive: boolean
}): number {
  const mruBoost = opts.mruRank < 0 ? 0 : 1 / (1 + opts.mruRank)
  const freqBoost = opts.freqCount / opts.maxFreq
  return 1 + 0.5 * mruBoost + 0.3 * freqBoost + 0.3 * (opts.isActive ? 1 : 0)
}

/**
 * Tier for a fzf-matched conversation given how it matched its own name vs its project name.
 * Only a STRONG (word-boundary-or-better) match earns NAME/PROJECT_CONV; a weak mid-word
 * substring drops to FUZZY so an exact project match always outranks incidental letters.
 */
export function conversationTier(opts: { nameStrength: number; projStrength: number; isActive: boolean }): number {
  if (opts.nameStrength >= STRONG_MATCH) return RANK_TIER.NAME
  if (opts.projStrength >= STRONG_MATCH && opts.isActive) return RANK_TIER.PROJECT_CONV
  return RANK_TIER.FUZZY
}

/** Tier for a fzf-matched project node. The node only surfaces strongly when the project has
 *  no active conversation representing it AND the query strongly matches it; else fuzzy chaff. */
export function projectNodeTier(projStrength: number, hasActiveConv: boolean): number {
  if (projStrength >= STRONG_MATCH && !hasActiveConv) return RANK_TIER.PROJECT_NODE
  return RANK_TIER.FUZZY
}

const FAR = Number.MAX_SAFE_INTEGER
const startedAtOf = (i: MergedItem) => (i.kind === 'conversation' ? i.conversation.startedAt : 0)
const lastActivityOf = (i: MergedItem) => (i.kind === 'conversation' ? i.conversation.lastActivity : 0)
const mruRankOf = (i: MergedItem, mru: Map<string, number>) =>
  i.kind === 'conversation' ? (mru.get(i.conversation.id) ?? FAR) : FAR

/**
 * Tier + intra-tier score for a fzf-matched conversation. NAME -> match strength then fzf;
 * PROJECT_CONV -> match strength (start time is the comparator tiebreak); FUZZY -> raw fzf
 * scaled by the caller's MRU/frequency/liveness multiplier.
 */
export function scoreConversationMatch(opts: {
  nameStrength: number
  projStrength: number
  isActive: boolean
  fzfScore: number
  fuzzyMultiplier: number
}): { tier: number; score: number } {
  const tier = conversationTier(opts)
  if (tier === RANK_TIER.NAME) return { tier, score: opts.nameStrength * 1000 + Math.min(opts.fzfScore, 999) }
  if (tier === RANK_TIER.PROJECT_CONV) return { tier, score: opts.projStrength }
  return { tier, score: opts.fzfScore * opts.fuzzyMultiplier }
}

/**
 * Tier + intra-tier score for a fzf-matched project node, or `null` when the node should be
 * omitted (an unpinned project that is only a fuzzy match, or one already represented by its
 * active conversations). Pinned projects keep a legacy always-visible node in the fuzzy tier.
 */
export function classifyProjectMatch(opts: {
  projStrength: number
  hasActiveConv: boolean
  isPinned: boolean
  fzfScore: number
}): { tier: number; score: number } | null {
  const tier = projectNodeTier(opts.projStrength, opts.hasActiveConv)
  if (tier === RANK_TIER.PROJECT_NODE) return { tier, score: opts.projStrength * 1000 + Math.min(opts.fzfScore, 999) }
  if (opts.isPinned) return { tier: RANK_TIER.FUZZY, score: opts.fzfScore }
  return null
}

/**
 * Final comparator for merged palette results: tier desc, then intra-tier score desc, then
 * (T2 only) newest start time, then the stable MRU-asc / lastActivity-desc tiebreakers.
 */
export function compareMergedItems(a: MergedItem, b: MergedItem, mruIndex: Map<string, number>): number {
  if (a.tier !== b.tier) return b.tier - a.tier
  if (b.score !== a.score) return b.score - a.score
  if (a.tier === RANK_TIER.PROJECT_CONV && startedAtOf(b) !== startedAtOf(a)) return startedAtOf(b) - startedAtOf(a)
  const am = mruRankOf(a, mruIndex)
  const bm = mruRankOf(b, mruIndex)
  if (am !== bm) return am - bm
  return lastActivityOf(b) - lastActivityOf(a)
}

/**
 * Pre-search ordering of the conversation corpus (unfiltered). Top-2 MRU spots are sacred
 * (alt-tab), the rest fall to project frequency then recency. Ended conversations are dropped
 * when the project has an active one. Unchanged from the prior inline implementation.
 */
export function sortConversationsForPalette(
  conversations: Conversation[],
  mruIndex: Map<string, number>,
  freqMap: Record<string, { count: number }>,
): Conversation[] {
  const activeProjects = new Set<string>()
  for (const s of conversations) {
    if (s.status !== 'ended') activeProjects.add(s.project)
  }
  const deduplicated = conversations.filter(s => s.status !== 'ended' || !activeProjects.has(s.project))
  // Inherent 3-key sort (top-2 MRU / frequency / recency), moved verbatim from the old hook.
  // fallow-ignore-next-line complexity
  return deduplicated.toSorted((a, b) => {
    const ai = mruIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER
    const bi = mruIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER
    const aTop = ai < 2
    const bTop = bi < 2
    if (aTop !== bTop) return aTop ? -1 : 1
    if (aTop && bTop) return ai - bi
    const af = freqMap[a.project]?.count || 0
    const bf = freqMap[b.project]?.count || 0
    if (af !== bf) return bf - af
    return b.lastActivity - a.lastActivity
  })
}
