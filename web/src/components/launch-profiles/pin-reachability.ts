/**
 * Reachability checks for a launch profile's pinned sentinel + project.
 *
 * Live state only -- no probes. Reads the sentinel registry already
 * delivered to the control panel via `sentinel_status` and the project
 * URI parser.
 */

import type { LaunchProfile } from '@shared/launch-profile'
import { parseProjectUri } from '@shared/project-uri'
import type { SentinelStatusInfo } from '@/hooks/use-conversations'

const DEFAULT_ALIAS = 'default'

export interface PinCheckOk {
  ok: true
  sentinel: string | undefined
  cwd: string | undefined
}

export interface PinCheckError {
  ok: false
  reason: string
}

export type PinCheckResult = PinCheckOk | PinCheckError

export function isSentinelReachable(name: string | undefined, sentinels: SentinelStatusInfo[]): boolean {
  if (!name || name === DEFAULT_ALIAS) {
    return sentinels.some(s => s.connected)
  }
  return sentinels.some(s => s.connected && (s.alias === name || s.sentinelId === name))
}

export function resolveProjectCwd(uri: string): string | null {
  try {
    return parseProjectUri(uri).path || null
  } catch {
    return null
  }
}

export function checkProfilePins(profile: LaunchProfile, sentinels: SentinelStatusInfo[]): PinCheckResult {
  // A pinned project URI is the source of truth: its authority IS the
  // sentinel (claude://{sentinel}/{path}). An empty/`default` authority
  // routes to the broker's default sentinel -- no explicit pin.
  if (profile.project) {
    let parsed: ReturnType<typeof parseProjectUri>
    try {
      parsed = parseProjectUri(profile.project)
    } catch {
      return { ok: false, reason: `Pinned project URI "${profile.project}" is invalid` }
    }
    const cwd = parsed.path || undefined
    if (!cwd) {
      return { ok: false, reason: `Pinned project URI "${profile.project}" has no path` }
    }
    const sentinel = parsed.authority && parsed.authority !== DEFAULT_ALIAS ? parsed.authority : undefined
    if (sentinel && !isSentinelReachable(sentinel, sentinels)) {
      return { ok: false, reason: `Sentinel "${sentinel}" is offline` }
    }
    return { ok: true, sentinel, cwd }
  }
  // No project pin -- fall back to the legacy standalone `sentinel` field
  // (set by profiles created before the URI builder merged the two).
  if (profile.sentinel && !isSentinelReachable(profile.sentinel, sentinels)) {
    return { ok: false, reason: `Sentinel "${profile.sentinel}" is offline` }
  }
  return { ok: true, sentinel: profile.sentinel || undefined, cwd: undefined }
}
