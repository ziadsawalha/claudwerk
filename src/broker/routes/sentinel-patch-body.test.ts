/**
 * Tier-1 unit tests for the REST body builder of `POST /api/sentinels/:id/config`
 * (Phase 8). Asserts the wire-shape mapping + that secret-bearing / unknown
 * keys never make it into the typed `SentinelPatchConfig` (Profile-Env Boundary).
 */
import { describe, expect, it } from 'bun:test'
import { buildPatchFromBody } from './sentinels'

describe('buildPatchFromBody', () => {
  it('maps the broker-tunable subset into a typed patch', () => {
    const res = buildPatchFromBody(
      {
        profiles: { work: { weight: 3, pool: 'main', label: 'Work', color: '#abc' }, alt: { pool: null } },
        defaultSelection: 'balanced',
        defaultPool: 'main',
      },
      'pid',
    )
    expect('patch' in res).toBe(true)
    if (!('patch' in res)) return
    expect(res.patch).toEqual({
      type: 'sentinel_patch_config',
      patchId: 'pid',
      profiles: { work: { weight: 3, pool: 'main', label: 'Work', color: '#abc' }, alt: { pool: null } },
      defaultSelection: 'balanced',
      defaultPool: 'main',
    })
  })

  it('drops unknown / secret-bearing keys (configDir, env, spawnRoot)', () => {
    const res = buildPatchFromBody(
      { profiles: { work: { weight: 2, configDir: '/secret', env: { KEY: 'x' }, spawnRoot: '/r' } } },
      'pid',
    )
    expect('patch' in res).toBe(true)
    if (!('patch' in res)) return
    expect(res.patch.profiles?.work).toEqual({ weight: 2 })
    // No leaked fields anywhere in the serialised patch.
    const json = JSON.stringify(res.patch)
    expect(json).not.toContain('configDir')
    expect(json).not.toContain('spawnRoot')
    expect(json).not.toContain('secret')
  })

  it('rejects a negative weight', () => {
    expect(buildPatchFromBody({ profiles: { work: { weight: -1 } } }, 'pid')).toMatchObject({
      error: expect.stringContaining('weight'),
    })
  })

  it('rejects a malformed pool name but accepts null', () => {
    expect(buildPatchFromBody({ profiles: { work: { pool: 'BAD POOL' } } }, 'pid')).toHaveProperty('error')
    expect(buildPatchFromBody({ profiles: { work: { pool: null } } }, 'pid')).toHaveProperty('patch')
  })

  it('rejects a bad defaultSelection', () => {
    expect(buildPatchFromBody({ defaultSelection: 'nope' }, 'pid')).toMatchObject({
      error: expect.stringContaining('defaultSelection'),
    })
  })

  it('rejects a malformed profile name', () => {
    expect(buildPatchFromBody({ profiles: { 'Bad Name': { weight: 1 } } }, 'pid')).toHaveProperty('error')
  })

  it('rejects an empty patch (nothing to change)', () => {
    expect(buildPatchFromBody({}, 'pid')).toMatchObject({ error: expect.stringContaining('empty') })
  })

  it('rejects a non-object body', () => {
    expect(buildPatchFromBody(null, 'pid')).toHaveProperty('error')
    expect(buildPatchFromBody('x', 'pid')).toHaveProperty('error')
  })
})
