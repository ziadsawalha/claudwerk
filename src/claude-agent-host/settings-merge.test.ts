/**
 * Tests for the spawn-injected settings merge (transport-reframe Phase 2).
 *
 * CC's `--settings` flag is single-value, so the agent host cannot pass a second
 * `--settings` for the spawn-injected file without clobbering its own generated
 * hooks settings. Instead it MERGES the injected file (carried via
 * `CLAUDWERK_SETTINGS_PATH`) into the generated settings -- with the rclaude
 * hooks winning, since they are load-bearing for the broker integration.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeMergedSettings } from './settings-merge'

let dir: string
const prevInjected = process.env.CLAUDWERK_SETTINGS_PATH

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'settings-merge-test-'))
  delete process.env.CLAUDWERK_SETTINGS_PATH
})

afterEach(() => {
  if (prevInjected === undefined) delete process.env.CLAUDWERK_SETTINGS_PATH
  else process.env.CLAUDWERK_SETTINGS_PATH = prevInjected
  rmSync(dir, { recursive: true, force: true })
})

/** Run writeMergedSettings into the temp dir and return the parsed output. */
async function generate(conversationId = 'conv-test-0001'): Promise<Record<string, unknown>> {
  const path = await writeMergedSettings(conversationId, 4321, '2.1.150', dir)
  return JSON.parse(readFileSync(path, 'utf-8'))
}

describe('writeMergedSettings -- spawn-injected --settings merge', () => {
  it('injects keys from CLAUDWERK_SETTINGS_PATH while keeping our hooks', async () => {
    const injected = join(dir, 'injected.json')
    writeFileSync(injected, JSON.stringify({ model: 'haiku', permissions: { allow: ['Bash(ls)'] } }))
    process.env.CLAUDWERK_SETTINGS_PATH = injected

    const settings = await generate()
    // Injected settings landed.
    expect(settings.model).toBe('haiku')
    expect((settings.permissions as { allow: string[] }).allow).toContain('Bash(ls)')
    // Our hooks still win (load-bearing for the broker integration).
    const hooks = settings.hooks as Record<string, unknown[]>
    expect(hooks.SessionStart).toBeDefined()
    expect(settings.allowedHttpHookUrls).toBeDefined()
  })

  it('does not inject anything when CLAUDWERK_SETTINGS_PATH is unset (baseline)', async () => {
    const settings = await generate()
    expect(settings.model).toBeUndefined()
    expect((settings.hooks as Record<string, unknown[]>).SessionStart).toBeDefined()
  })

  it('skips a missing injected path gracefully (hooks still generated)', async () => {
    process.env.CLAUDWERK_SETTINGS_PATH = join(dir, 'does-not-exist.json')
    const settings = await generate()
    expect((settings.hooks as Record<string, unknown[]>).SessionStart).toBeDefined()
  })

  it('skips an injected file that is not valid JSON (hooks still generated)', async () => {
    const bad = join(dir, 'bad.json')
    writeFileSync(bad, '{ not valid json')
    process.env.CLAUDWERK_SETTINGS_PATH = bad
    const settings = await generate()
    expect((settings.hooks as Record<string, unknown[]>).SessionStart).toBeDefined()
  })
})
