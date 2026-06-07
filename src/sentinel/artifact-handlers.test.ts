/**
 * Tier 1 unit tests for the `fetch_artifact` sentinel handler -- jail + allowlist
 * containment + read. These cover the security-critical perimeter: only
 * whitelisted artifacts under a profile's configDir may ever leave the host.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FetchArtifact } from '../shared/protocol'
import { BUILTIN_ARTIFACT_PATTERNS, handleFetchArtifact } from './artifact-handlers'

let configDir: string
let outside: string

function req(relPath: string, maxBytes?: number): FetchArtifact {
  return { type: 'fetch_artifact', requestId: 'r1', relPath, maxBytes }
}

const builtins = [...BUILTIN_ARTIFACT_PATTERNS]

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'cw-configdir-'))
  outside = mkdtempSync(join(tmpdir(), 'cw-outside-'))
  mkdirSync(join(configDir, 'usage-data'), { recursive: true })
})

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

describe('handleFetchArtifact -- allowlist + jail', () => {
  test('reads a whitelisted report and returns base64 + mediaType', () => {
    const html = '<html><body>hello report</body></html>'
    writeFileSync(join(configDir, 'usage-data', 'report-2026-06-07-131009.html'), html)
    const res = handleFetchArtifact(configDir, builtins, req('usage-data/report-2026-06-07-131009.html'))
    expect(res.ok).toBe(true)
    expect(res.mediaType).toBe('text/html')
    expect(res.size).toBe(Buffer.byteLength(html))
    expect(Buffer.from(res.data ?? '', 'base64').toString('utf8')).toBe(html)
  })

  test('rejects a file under configDir that is NOT in the allowlist', () => {
    writeFileSync(join(configDir, '.credentials.json'), '{"token":"secret"}')
    const res = handleFetchArtifact(configDir, builtins, req('.credentials.json'))
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/allowlist/)
  })

  test('rejects a non-.html file inside usage-data (pattern is *.html)', () => {
    writeFileSync(join(configDir, 'usage-data', 'facets.json'), '{}')
    const res = handleFetchArtifact(configDir, builtins, req('usage-data/facets.json'))
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/allowlist/)
  })

  test('rejects ../ traversal escaping configDir', () => {
    writeFileSync(join(outside, 'report-evil.html'), '<html></html>')
    const res = handleFetchArtifact(configDir, builtins, req('usage-data/../../report-evil.html'))
    expect(res.ok).toBe(false)
    // Jail rejects the escape before the allowlist even runs.
    expect(res.error).toMatch(/escapes|allowlist/)
  })

  test('rejects a symlink that points outside configDir', () => {
    const secret = join(outside, 'report-secret.html')
    writeFileSync(secret, '<html>secret</html>')
    symlinkSync(secret, join(configDir, 'usage-data', 'report-link.html'))
    const res = handleFetchArtifact(configDir, builtins, req('usage-data/report-link.html'))
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/symlink|escapes/)
  })

  test('missing file -> structured error, not a throw', () => {
    const res = handleFetchArtifact(configDir, builtins, req('usage-data/report-nope.html'))
    expect(res.ok).toBe(false)
    expect(res.error).toBeDefined()
  })

  test('enforces the byte cap', () => {
    const big = 'x'.repeat(2_000_000)
    writeFileSync(join(configDir, 'usage-data', 'report-big.html'), big)
    const res = handleFetchArtifact(configDir, builtins, req('usage-data/report-big.html', 1000))
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/too large/)
  })

  test('operator-configured extra pattern widens the allowlist', () => {
    mkdirSync(join(configDir, 'exports'), { recursive: true })
    writeFileSync(join(configDir, 'exports', 'summary.html'), '<html>ok</html>')
    const patterns = [...builtins, 'exports/*.html']
    const res = handleFetchArtifact(configDir, patterns, req('exports/summary.html'))
    expect(res.ok).toBe(true)
  })

  test('a nested report is NOT matched by the single-level *.html builtin', () => {
    mkdirSync(join(configDir, 'usage-data', 'sub'), { recursive: true })
    writeFileSync(join(configDir, 'usage-data', 'sub', 'report-x.html'), '<html></html>')
    const res = handleFetchArtifact(configDir, builtins, req('usage-data/sub/report-x.html'))
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/allowlist/)
  })
})
