/**
 * SOTU per-project spend ledger + budget gate (Phase 4).
 *
 * FREE FLOOR vs PAID TOP: the budget gates ONLY the paid distill. This module
 * tracks the day/month USD a project's scribe/reconcile folds have burned (COST 2,
 * fed from the recap ledger's `totalCostUsd()` per distill) and answers "is this
 * project over budget right now?". Budget-exhausted != dark -- the caller keeps the
 * free floor and emits `sotu_budget_exhausted`; it just withholds the paid fold.
 *
 * Period keys come from `now` (epoch ms), so the rollover is deterministic + the
 * accumulation is testable without wall-clock. A new day/month resets that period's
 * total (the OTHER period keeps accumulating independently).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { SotuProjectConfig } from './config'
import { spendPath } from './paths'

interface PeriodSpend {
  /** The period key this total is for (`YYYY-MM-DD` for day, `YYYY-MM` for month). */
  key: string
  usd: number
}

interface SpendLedger {
  day: PeriodSpend
  month: PeriodSpend
}

/** Day key `YYYY-MM-DD` (UTC) for an epoch-ms instant. */
export function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

/** Month key `YYYY-MM` (UTC) for an epoch-ms instant. */
export function monthKey(now: number): string {
  return new Date(now).toISOString().slice(0, 7)
}

function readLedger(slug: string): SpendLedger | null {
  const p = spendPath(slug)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as SpendLedger
  } catch {
    return null
  }
}

/** The spend so far in the current day + month for a project. A rolled-over
 *  period (the stored key no longer matches `now`'s key) reads 0 -- the old total
 *  is stale and will be overwritten on the next `recordSpend`. */
export function spendThisPeriod(slug: string, now: number): { dailyUsd: number; monthlyUsd: number } {
  const led = readLedger(slug)
  const dk = dayKey(now)
  const mk = monthKey(now)
  return {
    dailyUsd: led && led.day.key === dk ? led.day.usd : 0,
    monthlyUsd: led && led.month.key === mk ? led.month.usd : 0,
  }
}

/** Add `usd` to the current day + month totals, rolling either period over when
 *  its key changed. A zero/negative spend is a no-op (a no-LLM distill costs
 *  nothing and must not churn the file). */
export function recordSpend(slug: string, usd: number, now: number): void {
  if (!(usd > 0)) return
  const dk = dayKey(now)
  const mk = monthKey(now)
  const prior = spendThisPeriod(slug, now)
  const next: SpendLedger = {
    day: { key: dk, usd: prior.dailyUsd + usd },
    month: { key: mk, usd: prior.monthlyUsd + usd },
  }
  writeFileSync(spendPath(slug), `${JSON.stringify(next, null, 2)}\n`)
}

/** Whether a project's spend has reached either cap it set. An absent cap never
 *  binds (enabled-but-uncapped = unbounded; the opt-in flag is the real gate). */
export function overBudget(
  spend: { dailyUsd: number; monthlyUsd: number },
  budget: SotuProjectConfig['budget'],
): boolean {
  if (typeof budget.dailyUsd === 'number' && spend.dailyUsd >= budget.dailyUsd) return true
  if (typeof budget.monthlyUsd === 'number' && spend.monthlyUsd >= budget.monthlyUsd) return true
  return false
}
