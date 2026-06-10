/**
 * Three seed profiles materialized on first ever load (D5).
 *
 * Re-seeding semantics: a `null` KV value means "never written" and
 * triggers seeding. An empty array `[]` means "user emptied the list"
 * and is preserved verbatim -- do NOT re-seed.
 */

import type { LaunchProfile } from './launch-profile'
import { LAUNCH_PROFILE_ID_PREFIX } from './launch-profile'

interface SeedSpec {
  idSlug: string
  name: string
  shortLabel: string
  icon: string
  color: LaunchProfile['color']
  chord: string
  spawn: LaunchProfile['spawn']
}

const SEED_SPECS: SeedSpec[] = [
  {
    idSlug: 'seed-small',
    name: 'Small',
    shortLabel: 'Small',
    icon: 'Zap',
    color: 'success',
    chord: 's',
    // Bare CC aliases auto-track the latest build -- no pinned slug to bump.
    spawn: { backend: 'claude', model: 'haiku', effort: 'low', headless: true },
  },
  {
    idSlug: 'seed-opus',
    name: 'Opus Planner',
    shortLabel: 'Opus',
    icon: 'Brain',
    color: 'primary',
    chord: 'o',
    spawn: { backend: 'claude', model: 'opus', effort: 'high', headless: true },
  },
  {
    idSlug: 'seed-sonnet-pty',
    name: 'Sonnet PTY',
    shortLabel: 'Sonnet',
    icon: 'Terminal',
    color: 'info',
    chord: 'p',
    spawn: { backend: 'claude', model: 'sonnet', effort: 'medium', headless: false },
  },
]

export function buildSeedProfiles(nowMs: number = Date.now()): LaunchProfile[] {
  return SEED_SPECS.map((spec, idx) => ({
    id: `${LAUNCH_PROFILE_ID_PREFIX}${spec.idSlug}`,
    name: spec.name,
    shortLabel: spec.shortLabel,
    icon: spec.icon,
    color: spec.color,
    order: idx,
    chord: spec.chord,
    immediate: true,
    spawn: spec.spawn,
    createdAt: nowMs,
    updatedAt: nowMs,
  }))
}
