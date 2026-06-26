/**
 * SOTU per-project configuration (Phase 4) -- the opt-in flag + spend caps that
 * gate the PAID distill. The FREE floor (queue + git-fabric scan + live soft-lock
 * map) never reads this; only the scribe/reconcile fold does.
 *
 * Design (`plan-state-of-union.md` BUDGET section): `ProjectMeta.sotuEnabled` +
 * `sotuBudget {dailyUsd?, monthlyUsd?}`. Mission-control's `ProjectMeta` is not
 * built, so the canonical per-project store -- `ProjectSettings` (the same store
 * `lessonsEnabled` rides) -- is the real home. This module is the thin adapter:
 * the shape the engine consumes + the default resolver off ProjectSettings.
 *
 * The engine takes the resolver as an injectable dep (tests pass a stub), so the
 * gate is exercised without the broker's settings store.
 */

import { getProjectSettings } from '../project-settings'

/** The resolved SOTU config for one project. */
export interface SotuProjectConfig {
  /** Opt-in: false = FREE floor only, no LLM ever (design: "off = floor only"). */
  enabled: boolean
  /** Optional USD caps. Absent = no cap on that period (enabled-but-uncapped). */
  budget: { dailyUsd?: number; monthlyUsd?: number }
}

export type ResolveSotuConfig = (projectUri: string) => SotuProjectConfig

/** Default resolver: read the project's `ProjectSettings`. Opt-in defaults OFF
 *  (no settings entry, or `sotuEnabled` unset/false -> disabled). The budget caps
 *  are folded in only when set, so an enabled-but-uncapped project runs unbounded
 *  (the opt-in itself is the gate; the budget is an OPTIONAL ceiling). */
export function defaultResolveSotuConfig(projectUri: string): SotuProjectConfig {
  const s = getProjectSettings(projectUri)
  return {
    enabled: s?.sotuEnabled === true,
    budget: {
      ...(typeof s?.sotuBudgetDailyUsd === 'number' ? { dailyUsd: s.sotuBudgetDailyUsd } : {}),
      ...(typeof s?.sotuBudgetMonthlyUsd === 'number' ? { monthlyUsd: s.sotuBudgetMonthlyUsd } : {}),
    },
  }
}
