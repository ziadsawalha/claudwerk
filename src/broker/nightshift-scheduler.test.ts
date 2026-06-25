/**
 * Nightshift scheduler tests -- the pure clock-window predicate (`withinWindow`),
 * the only branch-heavy logic in the scheduler. The tick + dispatch path is
 * covered end-to-end by the orchestrator test + the live Phase-F smoke run.
 */

import { describe, expect, test } from 'bun:test'
import { DEFAULT_NIGHTSHIFT_CONFIG, type NightshiftConfig } from '../shared/nightshift-types'
import { shouldSchedule, withinWindow } from './nightshift-scheduler'

function cfg(over: Partial<NightshiftConfig>): NightshiftConfig {
  return { ...DEFAULT_NIGHTSHIFT_CONFIG, ...over }
}

/** A local Date pinned to `hh:mm` (Y-M-D irrelevant for time-of-day windows). */
function at(hh: number, mm = 0): Date {
  return new Date(2026, 5, 26, hh, mm, 0, 0)
}

describe('withinWindow', () => {
  test('inside a same-day window', () => {
    expect(withinWindow('01:00-07:00', at(3))).toBe(true)
    expect(withinWindow('01:00-07:00', at(1))).toBe(true) // start is inclusive
  })

  test('outside a same-day window', () => {
    expect(withinWindow('01:00-07:00', at(0, 30))).toBe(false)
    expect(withinWindow('01:00-07:00', at(7))).toBe(false) // end is exclusive
    expect(withinWindow('01:00-07:00', at(23))).toBe(false)
  })

  test('wrap-around window spans midnight', () => {
    expect(withinWindow('23:00-06:00', at(23, 30))).toBe(true)
    expect(withinWindow('23:00-06:00', at(2))).toBe(true)
    expect(withinWindow('23:00-06:00', at(5, 59))).toBe(true)
    expect(withinWindow('23:00-06:00', at(6))).toBe(false) // end exclusive
    expect(withinWindow('23:00-06:00', at(12))).toBe(false)
  })

  test('malformed / non-clock windows never match', () => {
    expect(withinWindow('interactive load < X', at(3))).toBe(false)
    expect(withinWindow('25:00-26:00', at(3))).toBe(false)
    expect(withinWindow('01:99-07:00', at(3))).toBe(false)
    expect(withinWindow('0100-0700', at(3))).toBe(false)
    expect(withinWindow('', at(3))).toBe(false)
  })
})

describe('shouldSchedule', () => {
  test('fires only when enabled, windowed, and in-window', () => {
    expect(shouldSchedule(cfg({ enabled: true, window: '01:00-07:00' }), at(3))).toBe(true)
  })

  test('disabled config never fires (default is OFF)', () => {
    expect(shouldSchedule(cfg({ enabled: false, window: '01:00-07:00' }), at(3))).toBe(false)
    expect(shouldSchedule(DEFAULT_NIGHTSHIFT_CONFIG, at(3))).toBe(false)
  })

  test('enabled but no window never fires', () => {
    expect(shouldSchedule(cfg({ enabled: true, window: undefined }), at(3))).toBe(false)
  })

  test('enabled + windowed but out of window does not fire', () => {
    expect(shouldSchedule(cfg({ enabled: true, window: '01:00-07:00' }), at(12))).toBe(false)
  })
})
