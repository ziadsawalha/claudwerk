/**
 * Sentinel handler for the `fetch_artifact` RPC. Surfaces host-local artifacts
 * (the `/insights` HTML report under a profile's CLAUDE_CONFIG_DIR) to a remote
 * control panel via the broker.
 *
 * Two layers of containment, both mandatory:
 *   1. `resolveInRoot(configDir, relPath)` jails the path under the profile's
 *      configDir (rejects `..` traversal + symlink escape) -- reused from the
 *      project store.
 *   2. An ALLOWLIST of configDir-relative glob patterns gates WHICH jailed
 *      files may be read. The built-in `usage-data/*.html` is always on; the
 *      operator can add more via `sentinel.json` -> `artifactAllowlist`.
 *
 * Read-only. Bytes come back base64 so the shape generalizes to future binary
 * artifacts (images, pdf).
 */

import { readFileSync, statSync } from 'node:fs'
import { extname, relative, resolve } from 'node:path'
import { resolveInRoot } from '../shared/project-store'
import type { FetchArtifact, FetchArtifactResult } from '../shared/protocol'

/** Always-on allowlist patterns, independent of operator config. */
export const BUILTIN_ARTIFACT_PATTERNS: readonly string[] = ['usage-data/*.html']

/** Refuse anything bigger than this -- a partial artifact is useless, and this
 *  caps the base64 payload over the WS. Insights reports are ~64KB. */
const MAX_ARTIFACT_BYTES = 8_000_000

const MEDIA_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.pdf': 'application/pdf',
}

function mediaTypeFor(absPath: string): string {
  return MEDIA_TYPES[extname(absPath).toLowerCase()] ?? 'application/octet-stream'
}

function err(requestId: string, message: string): FetchArtifactResult {
  return { type: 'fetch_artifact_result', requestId, ok: false, error: message }
}

/**
 * Resolve + allowlist-check + read a whitelisted artifact.
 * @param configDir absolute profile config dir (already resolved from profile)
 * @param patterns  full allowlist (built-in + operator extras)
 */
export function handleFetchArtifact(configDir: string, patterns: string[], msg: FetchArtifact): FetchArtifactResult {
  let abs: string
  try {
    abs = resolveInRoot(configDir, msg.relPath)
  } catch (e) {
    return err(msg.requestId, (e as Error).message)
  }

  // configDir-relative path for allowlist matching (jail already guarantees it
  // stays under configDir, so this never starts with `..`).
  const rel = relative(resolve(configDir), abs)
  const allowed = patterns.some(p => new Bun.Glob(p).match(rel))
  if (!allowed) return err(msg.requestId, `artifact not in allowlist: ${rel}`)

  const maxBytes = msg.maxBytes && msg.maxBytes > 0 ? Math.min(msg.maxBytes, MAX_ARTIFACT_BYTES) : MAX_ARTIFACT_BYTES
  try {
    const stat = statSync(abs)
    if (!stat.isFile()) return err(msg.requestId, 'not a file')
    if (stat.size > maxBytes) return err(msg.requestId, `artifact too large (${stat.size} > ${maxBytes} bytes)`)
    const data = readFileSync(abs).toString('base64')
    return {
      type: 'fetch_artifact_result',
      requestId: msg.requestId,
      ok: true,
      data,
      mediaType: mediaTypeFor(abs),
      size: stat.size,
    }
  } catch (e) {
    return err(msg.requestId, (e as Error).message)
  }
}
