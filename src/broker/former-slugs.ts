/**
 * Pure helpers for conversation rename-alias retention + decay.
 *
 * When a conversation is renamed, the slug it used to answer to is retired into
 * `conversation.formerSlugs` so peers that cached the OLD name keep routing for
 * a decay window. The window is a SLIDING TTL from `lastUsedAt` (email-forwarding
 * style): every time a peer actually routes through an old name, the clock
 * resets; once nobody has used it for the TTL, it is dead and the name frees up.
 *
 * These functions are pure (caller injects `now`) so they unit-test without a
 * clock and stay deterministic.
 */

import type { FormerSlug } from './store/types'

/** Sliding decay window for a retired alias, measured from its last use. */
export const RENAME_ALIAS_TTL_MS = 24 * 60 * 60 * 1000

/** Max retired aliases kept per conversation (newest by lastUsedAt win). */
export const MAX_FORMER_SLUGS = 10

/** Is this retired alias still inside its sliding decay window? */
export function isAliasLive(entry: FormerSlug, now: number): boolean {
  return now - entry.lastUsedAt < RENAME_ALIAS_TTL_MS
}

/** Drop expired aliases. Returns a new array; never mutates the input. */
export function pruneExpiredAliases(former: FormerSlug[] | undefined, now: number): FormerSlug[] {
  if (!former?.length) return []
  return former.filter(e => isAliasLive(e, now))
}

/**
 * Record a retired slug into the former-slugs list, returning a new array.
 *
 * Rules:
 *  - Expired entries are pruned first (lazy cleanup on every rename).
 *  - `newSlug` (the slug the conversation now answers to) is removed from the
 *    history -- a name that is current again must not also be a stale alias.
 *  - `retiredSlug` is added (or, if already present, its retiredAt/lastUsedAt
 *    are refreshed). Skipped when it equals `newSlug` (renamed to itself) or is
 *    empty (cleared title -> the id-slice fallback already resolves, no alias
 *    needed).
 *  - Capped to MAX_FORMER_SLUGS, keeping the newest by lastUsedAt.
 */
export function recordRetiredSlug(
  former: FormerSlug[] | undefined,
  retiredSlug: string,
  newSlug: string,
  now: number,
): FormerSlug[] {
  let next = pruneExpiredAliases(former, now).filter(e => e.slug !== newSlug)
  if (retiredSlug && retiredSlug !== newSlug) {
    next = next.filter(e => e.slug !== retiredSlug)
    next.push({ slug: retiredSlug, retiredAt: now, lastUsedAt: now })
  }
  if (next.length > MAX_FORMER_SLUGS) {
    next = next.sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, MAX_FORMER_SLUGS)
  }
  return next
}
