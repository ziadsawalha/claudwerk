/**
 * usage-cache -- disk persistence for the sentinel's last-good per-profile
 * usage snapshots.
 *
 * WHY: `/api/oauth/usage` rate-limits PER ACCOUNT. A profile whose account is
 * busy -- notably the default/main login shared with the desktop app, the IDE
 * extension and every interactive `claude` terminal -- gets 429'd on the very
 * first poll after a sentinel (re)start, so the in-memory `lastGoodProfileUsage`
 * never gets seeded and the profile shows BLANK forever. (Account B, idle and
 * dedicated, never contends -- which is why only the busy account "stops
 * reporting usage".)
 *
 * Persisting the last error-free reading to disk lets a cold start re-broadcast
 * the previous (stale-flagged) reading instead of nothing -- the panel shows
 * "usage 44m old" rather than a blank row. The carry-forward DISPLAY decision
 * (and its max age) lives in `buildCarriedSnapshot`; this module is only the
 * load/save plumbing.
 *
 * Only error-free snapshots WITH both windows are stored. Best-effort: any fs /
 * parse error is swallowed (a missing or corrupt cache just means "no
 * carry-forward yet"). All side-effecting paths take DI seams for hermetic
 * tests.
 */

import {
  existsSync as existsSyncReal,
  mkdirSync as mkdirSyncReal,
  readFileSync as readFileSyncReal,
  writeFileSync as writeFileSyncReal,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ProfileUsageSnapshot } from '../shared/protocol'
import { defaultConfigPath } from './sentinel-config'
import { snapshotHasWindows } from './usage-headroom'

/** How long a carried-forward reading stays worth SHOWING. Past this even the
 *  5h window has rolled over (it resets every 5h), so a stale reading is no
 *  longer meaningful -- we drop back to the honest error/unknown state. */
export const USAGE_CARRY_FORWARD_MAX_MS = 6 * 60 * 60 * 1000 // 6 hours

/** Cache file path -- sits next to `sentinel.json`
 *  (`$XDG_CONFIG_HOME/rclaude/usage-cache.json`). */
export function defaultUsageCachePath(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  return join(dirname(defaultConfigPath(env, home)), 'usage-cache.json')
}

export interface UsageCacheDeps {
  path?: string
  fs?: {
    existsSync: typeof existsSyncReal
    readFileSync: typeof readFileSyncReal
    writeFileSync: typeof writeFileSyncReal
    mkdirSync: typeof mkdirSyncReal
  }
}

function resolveFs(deps: UsageCacheDeps) {
  return (
    deps.fs ?? {
      existsSync: existsSyncReal,
      readFileSync: readFileSyncReal,
      writeFileSync: writeFileSyncReal,
      mkdirSync: mkdirSyncReal,
    }
  )
}

interface CacheFile {
  version: 1
  profiles: ProfileUsageSnapshot[]
}

/**
 * Load persisted last-good snapshots. Returns only entries that still have both
 * windows (defensive against a hand-edited / partially-written file). Any error
 * -> empty array.
 */
export function loadUsageCache(deps: UsageCacheDeps = {}): ProfileUsageSnapshot[] {
  const fs = resolveFs(deps)
  const path = deps.path ?? defaultUsageCachePath()
  try {
    if (!fs.existsSync(path)) return []
    const parsed = JSON.parse(fs.readFileSync(path, 'utf8')) as Partial<CacheFile> | null
    if (!parsed || !Array.isArray(parsed.profiles)) return []
    return parsed.profiles.filter(snap => snapshotHasWindows(snap) && typeof snap.profile === 'string')
  } catch {
    return []
  }
}

/**
 * Persist the given last-good snapshots. Only error-free windowed snapshots are
 * written. Best-effort -- swallows fs errors (returns false so the caller can
 * log, but never throws into the poll cycle).
 */
export function saveUsageCache(snapshots: Iterable<ProfileUsageSnapshot>, deps: UsageCacheDeps = {}): boolean {
  const fs = resolveFs(deps)
  const path = deps.path ?? defaultUsageCachePath()
  try {
    const profiles = [...snapshots].filter(snapshotHasWindows)
    const body: CacheFile = { version: 1, profiles }
    fs.mkdirSync(dirname(path), { recursive: true })
    fs.writeFileSync(path, JSON.stringify(body, null, 2))
    return true
  } catch {
    return false
  }
}

/**
 * Build the snapshot to DISPLAY for a profile whose live poll is unavailable
 * (throttled / errored / not yet run). Returns a stale-flagged copy of the
 * last-good reading when it's still within the max display age, else null (the
 * caller falls back to the honest error/unknown snapshot).
 *
 * Pure -- the `now`/`maxAgeMs` seams keep it unit-testable.
 */
export function buildCarriedSnapshot(
  lastGood: ProfileUsageSnapshot | undefined,
  now: number,
  maxAgeMs: number = USAGE_CARRY_FORWARD_MAX_MS,
): ProfileUsageSnapshot | null {
  if (!snapshotHasWindows(lastGood)) return null
  if (now - lastGood.polledAt > maxAgeMs) return null
  return { ...lastGood, stale: true }
}
