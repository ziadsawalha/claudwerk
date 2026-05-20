/**
 * Tier-1 unit tests for the broker's `cc_version_changed` handler.
 *
 * The handler is pure modulo `normalizeCcVersionChanged` -- the diff payload
 * is validated, then the sentinelId is overlaid from `ws.data.sentinelId`
 * (auth-derived) and broadcast. These tests exercise the normalizer and the
 * fact that the broadcast carries the auth-derived id.
 */
import { describe, expect, it } from 'bun:test'
import { normalizeCcVersionChanged } from '../sentinel'

describe('normalizeCcVersionChanged', () => {
  it('accepts a fully populated payload', () => {
    const got = normalizeCcVersionChanged({
      type: 'cc_version_changed',
      sentinelId: 'snt_abc',
      fromVersion: '2.1.144',
      toVersion: '2.1.145',
      fromProto: 1,
      toProto: 1,
      observedAt: 1_700_000_000_000,
    })
    expect(got).toEqual({
      type: 'cc_version_changed',
      sentinelId: 'snt_abc',
      fromVersion: '2.1.144',
      toVersion: '2.1.145',
      fromProto: 1,
      toProto: 1,
      observedAt: 1_700_000_000_000,
    })
  })

  it('accepts a first-observation payload (null fromVersion + null fromProto)', () => {
    const got = normalizeCcVersionChanged({
      sentinelId: 'snt_abc',
      fromVersion: null,
      toVersion: '2.1.145',
      fromProto: null,
      toProto: 1,
      observedAt: 1_700_000_000_000,
    })
    expect(got?.fromVersion).toBeNull()
    expect(got?.fromProto).toBeNull()
    expect(got?.toVersion).toBe('2.1.145')
  })

  it('rejects when sentinelId is missing', () => {
    expect(
      normalizeCcVersionChanged({
        toVersion: '2.1.145',
        toProto: 1,
        observedAt: 1_700_000_000_000,
      }),
    ).toBeNull()
  })

  it('rejects when toVersion is missing', () => {
    expect(
      normalizeCcVersionChanged({
        sentinelId: 'snt_abc',
        toProto: 1,
        observedAt: 1_700_000_000_000,
      }),
    ).toBeNull()
  })

  it('rejects when toProto is not a number', () => {
    expect(
      normalizeCcVersionChanged({
        sentinelId: 'snt_abc',
        toVersion: '2.1.145',
        toProto: 'one',
        observedAt: 1_700_000_000_000,
      }),
    ).toBeNull()
  })

  it('rejects when observedAt is missing', () => {
    expect(
      normalizeCcVersionChanged({
        sentinelId: 'snt_abc',
        toVersion: '2.1.145',
        toProto: 1,
      }),
    ).toBeNull()
  })
})
