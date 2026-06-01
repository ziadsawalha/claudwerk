/**
 * Public-share sanitizer for recaps.
 *
 * A recap share token grants ZERO project access -- the only thing it exposes is
 * the stored recap document served by `GET /shared/public/recap/:token`. That
 * document must therefore NOT carry the project's per-conversation inventory.
 *
 * Incident 2026-06-01 (plan-recap-share-leak.md): the public endpoint returned
 * `digest` verbatim, leaking `digest.conversations` (every conversation's title,
 * id, turn count, status, and per-conversation cost) plus the conversation-id
 * citation arrays embedded in `metadata.*[].conversations`. Sharing a "last 7
 * days" recap silently published the whole project's conversation manifest.
 *
 * This module strips those identity-bearing fields while preserving the
 * aggregate analytics (cost rollup, activity counts, commits, context buckets)
 * that make the shared report useful. The per-conversation drill-down and the
 * citation chips only ever functioned in-app (they navigate to a conversation
 * the external viewer cannot open), so stripping them is invisible on the public
 * surface.
 */

import type { RecapDigest, RecapMetadata } from '../../../shared/protocol'

/** Remove the per-conversation manifest from a digest. Keeps every aggregate. */
export function sanitizeDigestForPublicShare(digest: RecapDigest | undefined): RecapDigest | undefined {
  if (!digest) return digest
  // `activity.conversations` retains the aggregate count, so the scorecard can
  // still show "N conversations" without the per-conversation identities.
  return { ...digest, conversations: [] }
}

/** Strip the conversation-id citation arrays from every metadata section item.
 *  Other citations (commit hashes) and all prose/tags are preserved. */
export function sanitizeMetadataForPublicShare(metadata: RecapMetadata | undefined): RecapMetadata | undefined {
  if (!metadata) return metadata
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (Array.isArray(value)) {
      out[key] = value.map(item =>
        item && typeof item === 'object' && 'conversations' in (item as object)
          ? { ...(item as Record<string, unknown>), conversations: undefined }
          : item,
      )
    } else {
      out[key] = value
    }
  }
  return out as unknown as RecapMetadata
}

/** Sanitize a recap's structured render data for the public share endpoint. */
export function sanitizeRecapForPublicShare(input: {
  metadata: RecapMetadata | undefined
  digest: RecapDigest | undefined
}): { metadata: RecapMetadata | undefined; digest: RecapDigest | undefined } {
  return {
    metadata: sanitizeMetadataForPublicShare(input.metadata),
    digest: sanitizeDigestForPublicShare(input.digest),
  }
}
