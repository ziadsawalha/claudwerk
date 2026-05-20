/**
 * Tier-1 unit tests for the broker's `daemon_session_retired` normalizer.
 *
 * The handler proper writes ccSessionId + retiredAt into the conversation's
 * opaque agentHostMeta bag (boundary-safe -- broker never reads back) and
 * broadcasts the typed event scoped to the conversation's project. Those
 * effects need a HandlerContext; the normalizer is pure and gets the bulk
 * of the unit coverage here.
 *
 * This file lives under `__tests__/` so it may reference ccSessionId freely;
 * `lint-boundary.ts` skips this directory.
 */

import { describe, expect, it } from 'bun:test'
import { normalizeDaemonSessionRetired } from '../daemon'

describe('normalizeDaemonSessionRetired', () => {
  it('accepts a fully populated payload', () => {
    const got = normalizeDaemonSessionRetired({
      type: 'daemon_session_retired',
      conversationId: 'conv_abc',
      short: 'aeb185f9',
      ccSessionId: 'ccs_xyz',
      lastState: 'idle',
      idleMs: 300_000,
      retiredAt: 1_700_000_000_000,
    })
    expect(got).toEqual({
      type: 'daemon_session_retired',
      conversationId: 'conv_abc',
      short: 'aeb185f9',
      ccSessionId: 'ccs_xyz',
      lastState: 'idle',
      idleMs: 300_000,
      retiredAt: 1_700_000_000_000,
    })
  })

  it('accepts a null ccSessionId (worker never reported one)', () => {
    const got = normalizeDaemonSessionRetired({
      conversationId: 'conv_abc',
      short: 'aeb185f9',
      ccSessionId: null,
      lastState: 'idle',
      idleMs: 270_000,
      retiredAt: 1_700_000_000_000,
    })
    expect(got?.ccSessionId).toBeNull()
  })

  it('preserves freeform daemon lastState strings beyond the canonical set', () => {
    const got = normalizeDaemonSessionRetired({
      conversationId: 'conv_abc',
      short: 'aeb185f9',
      ccSessionId: null,
      lastState: 'parked',
      idleMs: 270_000,
      retiredAt: 1_700_000_000_000,
    })
    expect(got?.lastState).toBe('parked')
  })

  it('rejects when conversationId is missing', () => {
    expect(
      normalizeDaemonSessionRetired({
        short: 'aeb185f9',
        ccSessionId: null,
        lastState: 'idle',
        idleMs: 270_000,
        retiredAt: 1_700_000_000_000,
      }),
    ).toBeNull()
  })

  it('rejects when short is missing', () => {
    expect(
      normalizeDaemonSessionRetired({
        conversationId: 'conv_abc',
        ccSessionId: null,
        lastState: 'idle',
        idleMs: 270_000,
        retiredAt: 1_700_000_000_000,
      }),
    ).toBeNull()
  })

  it('rejects when idleMs is not a number', () => {
    expect(
      normalizeDaemonSessionRetired({
        conversationId: 'conv_abc',
        short: 'aeb185f9',
        ccSessionId: null,
        lastState: 'idle',
        idleMs: 'forever',
        retiredAt: 1_700_000_000_000,
      }),
    ).toBeNull()
  })

  it('rejects when idleMs is negative', () => {
    expect(
      normalizeDaemonSessionRetired({
        conversationId: 'conv_abc',
        short: 'aeb185f9',
        ccSessionId: null,
        lastState: 'idle',
        idleMs: -1,
        retiredAt: 1_700_000_000_000,
      }),
    ).toBeNull()
  })

  it('rejects when retiredAt is missing', () => {
    expect(
      normalizeDaemonSessionRetired({
        conversationId: 'conv_abc',
        short: 'aeb185f9',
        ccSessionId: null,
        lastState: 'idle',
        idleMs: 270_000,
      }),
    ).toBeNull()
  })
})
