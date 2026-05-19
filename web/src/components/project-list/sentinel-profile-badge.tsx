/**
 * Sentinel-profile badge for the conversation list / sidebar.
 *
 * Resolves the conversation's CURRENT profile from `conversation.project`
 * URI userinfo (the RESOLVED name -- what the sentinel actually picked at
 * spawn time), and renders a small inline badge tinted by the profile's
 * `color`. For conversations launched via Balanced or Random, also renders
 * a shuffle icon next to the badge -- the "intent indicator" read from
 * `launchConfig.sentinelProfile.kind`.
 *
 * INTENT vs RESOLVED (per plan-sentinel-profiles.md): the badge text is the
 * RESOLVED name. The shuffle icon surfaces the user's original intent so a
 * conversation picked by Balanced is visually distinct from one Fixed-pinned
 * to the same profile.
 *
 * PROFILE-ENV BOUNDARY: this component never touches configDir / env --
 * sentinel.profiles only carries name / label / color / pooled / authed.
 */

import type { LaunchConfig } from '@shared/protocol'
import { Shuffle } from 'lucide-react'
import { type SentinelStatusInfo, useConversationsStore } from '@/hooks/use-conversations'

interface SentinelProfileBadgeProps {
  /** Conversation's stored project URI -- the profile lives in the
   *  userinfo slot (e.g. `claude://work@beast/path`). */
  project: string
  /** Sentinel alias the conversation runs on. Used to look up the profile's
   *  display metadata (color, label) from the live sentinel report. */
  hostSentinelAlias?: string
  /** The user's original intent -- `{ kind: 'balanced' | 'random' | 'fixed' }`.
   *  Surfaced as the shuffle icon for balanced/random. */
  launchConfig?: LaunchConfig
}

/** Extract the userinfo (= profile name) from a `claude://profile@host/path`
 *  URI. Returns `undefined` when the URI lacks a userinfo slot. Manual parse
 *  -- web bundles can't always rely on `new URL()` for non-standard schemes
 *  on every browser, but `claude://` is well-formed and parses cleanly. */
export function extractProfileFromProjectUri(uri: string | undefined): string | undefined {
  if (!uri || uri === '*') return undefined
  try {
    const url = new URL(uri)
    return url.username ? decodeURIComponent(url.username) : undefined
  } catch {
    return undefined
  }
}

function findProfileMeta(sentinels: SentinelStatusInfo[], hostSentinelAlias: string | undefined, profileName: string) {
  if (!hostSentinelAlias) return undefined
  const alias = hostSentinelAlias.toLowerCase()
  const match = sentinels.find(s => s.alias.toLowerCase() === alias)
  return match?.profiles?.find(p => p.name === profileName)
}

type SentinelProfileIntent = LaunchConfig['sentinelProfile']

function intentLabelFor(intent: SentinelProfileIntent): string | null {
  if (!intent) return null
  if (intent.kind === 'balanced') return 'Picked by Balanced'
  if (intent.kind === 'random') return 'Picked by Random'
  return null
}

function buildBadgeTitle(resolvedProfile: string, metaLabel: string | undefined, intentLabel: string | null): string {
  const parts = [`Profile: ${resolvedProfile}`]
  if (metaLabel) parts.push(metaLabel)
  if (intentLabel) parts.push(intentLabel)
  return parts.join(' - ')
}

// fallow-ignore-next-line complexity
export function SentinelProfileBadge({ project, hostSentinelAlias, launchConfig }: SentinelProfileBadgeProps) {
  const sentinels = useConversationsStore(s => s.sentinels)
  const resolvedProfile = extractProfileFromProjectUri(project)

  // Skip rendering when the resolved profile is the implicit `default` -- the
  // shuffle icon alone (without a profile badge) is also intentionally elided
  // because the profile would be unknown, which is the more confusing UX.
  if (!resolvedProfile || resolvedProfile === 'default') return null

  const intent = launchConfig?.sentinelProfile
  const isShuffleIntent = intent?.kind === 'balanced' || intent?.kind === 'random'
  const profileMeta = findProfileMeta(sentinels, hostSentinelAlias, resolvedProfile)
  const colorStyle = profileMeta?.color ? { color: profileMeta.color, borderColor: profileMeta.color } : undefined
  const title = buildBadgeTitle(resolvedProfile, profileMeta?.label, intentLabelFor(intent))

  return (
    <span
      className="inline-flex items-center gap-0.5 px-1 py-0.5 text-[8px] rounded border border-primary/20 bg-muted text-muted-foreground font-medium"
      style={colorStyle}
      title={title}
    >
      {isShuffleIntent && <Shuffle className="w-2.5 h-2.5" />}
      {resolvedProfile}
    </span>
  )
}
