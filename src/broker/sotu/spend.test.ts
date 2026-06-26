import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initSotuStore } from './index'
import { dayKey, monthKey, overBudget, recordSpend, spendThisPeriod } from './spend'

const SLUG = 'proj'
// Two instants in the same UTC month, different days.
const DAY1 = Date.UTC(2026, 5, 26, 12, 0, 0)
const DAY2 = Date.UTC(2026, 5, 27, 9, 0, 0)
const NEXT_MONTH = Date.UTC(2026, 6, 1, 1, 0, 0)
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sotu-spend-'))
  initSotuStore(dir)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

test('period keys are UTC day/month', () => {
  expect(dayKey(DAY1)).toBe('2026-06-26')
  expect(monthKey(DAY1)).toBe('2026-06')
})

test('spend accumulates within a period', () => {
  expect(spendThisPeriod(SLUG, DAY1)).toEqual({ dailyUsd: 0, monthlyUsd: 0 })
  recordSpend(SLUG, 1.5, DAY1)
  recordSpend(SLUG, 0.5, DAY1)
  expect(spendThisPeriod(SLUG, DAY1)).toEqual({ dailyUsd: 2, monthlyUsd: 2 })
})

test('a new day resets the daily total but the month keeps accumulating', () => {
  recordSpend(SLUG, 2, DAY1)
  recordSpend(SLUG, 3, DAY2)
  expect(spendThisPeriod(SLUG, DAY2)).toEqual({ dailyUsd: 3, monthlyUsd: 5 })
})

test('a new month resets both totals', () => {
  recordSpend(SLUG, 4, DAY1)
  expect(spendThisPeriod(SLUG, NEXT_MONTH)).toEqual({ dailyUsd: 0, monthlyUsd: 0 })
  recordSpend(SLUG, 1, NEXT_MONTH)
  expect(spendThisPeriod(SLUG, NEXT_MONTH)).toEqual({ dailyUsd: 1, monthlyUsd: 1 })
})

test('zero/negative spend is a no-op', () => {
  recordSpend(SLUG, 0, DAY1)
  recordSpend(SLUG, -1, DAY1)
  expect(spendThisPeriod(SLUG, DAY1)).toEqual({ dailyUsd: 0, monthlyUsd: 0 })
})

test('overBudget binds on whichever cap is reached; absent caps never bind', () => {
  expect(overBudget({ dailyUsd: 5, monthlyUsd: 5 }, {})).toBe(false)
  expect(overBudget({ dailyUsd: 5, monthlyUsd: 5 }, { dailyUsd: 5 })).toBe(true)
  expect(overBudget({ dailyUsd: 4.99, monthlyUsd: 4.99 }, { dailyUsd: 5 })).toBe(false)
  expect(overBudget({ dailyUsd: 1, monthlyUsd: 50 }, { dailyUsd: 5, monthlyUsd: 50 })).toBe(true)
})
