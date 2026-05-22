import { describe, expect, it } from 'bun:test'
import { type SpawnRequest, validatedSpawnRequestSchema } from './spawn-schema'

/** A minimal daemon spawn request, overridable per-test. */
const daemonReq = (over: Partial<SpawnRequest> = {}): Record<string, unknown> => ({
  cwd: '/tmp/work',
  backend: 'daemon',
  ...over,
})

describe('validatedSpawnRequestSchema -- daemon cross-field rules (refineDaemonSpawn)', () => {
  it('does not apply daemon rules to a non-daemon backend', () => {
    // A claude headless spawn with no prompt is valid -- the daemon rules must not fire.
    expect(validatedSpawnRequestSchema.safeParse({ cwd: '/tmp', backend: 'claude' }).success).toBe(true)
  })

  it('accepts daemon new with a prompt', () => {
    expect(validatedSpawnRequestSchema.safeParse(daemonReq({ daemonMode: 'new', prompt: 'go' })).success).toBe(true)
  })

  it('rejects daemon new without a prompt', () => {
    expect(validatedSpawnRequestSchema.safeParse(daemonReq({ daemonMode: 'new' })).success).toBe(false)
  })

  it('treats daemonMode as new by default (daemon backend, no mode, no prompt -> reject)', () => {
    expect(validatedSpawnRequestSchema.safeParse(daemonReq()).success).toBe(false)
  })

  it('rejects daemon resume without daemonResumeSessionId', () => {
    expect(validatedSpawnRequestSchema.safeParse(daemonReq({ daemonMode: 'resume' })).success).toBe(false)
  })

  it('accepts daemon resume with daemonResumeSessionId and no prompt (resume prompt is optional)', () => {
    expect(
      validatedSpawnRequestSchema.safeParse(daemonReq({ daemonMode: 'resume', daemonResumeSessionId: 'sess-1' }))
        .success,
    ).toBe(true)
  })

  it('rejects daemon attach without daemonAttachShort', () => {
    expect(validatedSpawnRequestSchema.safeParse(daemonReq({ daemonMode: 'attach' })).success).toBe(false)
  })

  it('accepts daemon attach with a valid 8-hex daemonAttachShort and no prompt', () => {
    expect(
      validatedSpawnRequestSchema.safeParse(daemonReq({ daemonMode: 'attach', daemonAttachShort: 'aeb185f9' })).success,
    ).toBe(true)
  })

  it('rejects a daemonAttachShort that is not 8 hex chars', () => {
    expect(
      validatedSpawnRequestSchema.safeParse(daemonReq({ daemonMode: 'attach', daemonAttachShort: 'NOTHEX!!' })).success,
    ).toBe(false)
    expect(
      validatedSpawnRequestSchema.safeParse(daemonReq({ daemonMode: 'attach', daemonAttachShort: 'abc' })).success,
    ).toBe(false)
  })

  it('surfaces the failing field in the issue path', () => {
    const r = validatedSpawnRequestSchema.safeParse(daemonReq({ daemonMode: 'resume' }))
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues.some(i => i.path.includes('daemonResumeSessionId'))).toBe(true)
    }
  })
})

describe('validatedSpawnRequestSchema -- sentinel profile / pool fields (Phase 9 audit)', () => {
  it('accepts a literal profile name (Fixed selection)', () => {
    expect(validatedSpawnRequestSchema.safeParse({ cwd: '/tmp', profile: 'work' }).success).toBe(true)
  })

  it('accepts SelectionMode tokens as profile values', () => {
    for (const token of ['default', 'balanced', 'random']) {
      expect(validatedSpawnRequestSchema.safeParse({ cwd: '/tmp', profile: token }).success).toBe(true)
    }
  })

  it('accepts a pool name', () => {
    expect(validatedSpawnRequestSchema.safeParse({ cwd: '/tmp', pool: 'work' }).success).toBe(true)
  })

  it('accepts profile + pool together (broker resolves precedence: profile wins)', () => {
    expect(validatedSpawnRequestSchema.safeParse({ cwd: '/tmp', profile: 'work', pool: 'default' }).success).toBe(true)
  })

  it('treats both profile and pool as optional (omitting both is valid)', () => {
    const r = validatedSpawnRequestSchema.safeParse({ cwd: '/tmp' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.profile).toBeUndefined()
      expect(r.data.pool).toBeUndefined()
    }
  })

  it('rejects an empty profile string (min length 1)', () => {
    expect(validatedSpawnRequestSchema.safeParse({ cwd: '/tmp', profile: '' }).success).toBe(false)
  })

  it('rejects an over-long profile name (max length 63)', () => {
    expect(validatedSpawnRequestSchema.safeParse({ cwd: '/tmp', profile: 'a'.repeat(64) }).success).toBe(false)
  })

  it('rejects a pool name with characters outside [a-z0-9-]', () => {
    for (const bad of ['Work', 'work_pool', 'work pool', 'work!']) {
      expect(validatedSpawnRequestSchema.safeParse({ cwd: '/tmp', pool: bad }).success).toBe(false)
    }
  })

  it('rejects an empty pool string', () => {
    expect(validatedSpawnRequestSchema.safeParse({ cwd: '/tmp', pool: '' }).success).toBe(false)
  })

  it('rejects an over-long pool name (max length 63)', () => {
    expect(validatedSpawnRequestSchema.safeParse({ cwd: '/tmp', pool: 'a'.repeat(64) }).success).toBe(false)
  })

  it('surfaces "pool" in the issue path for a malformed pool', () => {
    const r = validatedSpawnRequestSchema.safeParse({ cwd: '/tmp', pool: 'Bad Pool' })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues.some(i => i.path.includes('pool'))).toBe(true)
    }
  })
})
