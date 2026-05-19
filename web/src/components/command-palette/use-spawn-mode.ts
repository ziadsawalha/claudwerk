import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { openSpawnDialog } from '@/components/spawn-dialog'
import { type SentinelStatusInfo, useConversationsStore } from '@/hooks/use-conversations'

/** Default sentinel name (mirrors src/shared/project-uri.ts DEFAULT_SENTINEL_NAME).
 *  Used as the implicit authority when no `@sentinel` token is given. */
const DEFAULT_SENTINEL = 'default'

export interface SentinelSuggestion {
  alias: string
  connected: boolean
  isDefault: boolean
}

export interface ProfileSuggestion {
  /** Profile name (e.g. "work"). Selected with Enter / Tab. */
  name: string
  /** Optional display label (free-form, set by the sentinel). */
  label?: string
  /** Optional color tint (hex, set by the sentinel). */
  color?: string
  /** Whether the profile participates in `balanced` / `random` selection. */
  pooled?: boolean
  /** Whether the sentinel believes credentials are present for this profile. */
  authed?: boolean
}

export interface SpawnModeState {
  spawnPath: string
  spawnParentDir: string
  spawnSentinel: string
  /** Resolved profile name (or selection-mode token), parsed from the
   *  `@sentinel:profile` shorthand. Empty when no profile token is present. */
  spawnProfile: string
  filteredSpawnDirs: string[]
  filteredSentinels: SentinelSuggestion[]
  /** Profile-name suggestions surfaced after the user types `@sentinel:`.
   *  Sourced from the sentinel's reported profiles. */
  filteredProfiles: ProfileSuggestion[]
  isSentinelEntry: boolean
  /** True when the user has typed `@sentinel:` (and no space yet) -- the
   *  hook shows profile autocomplete instead of the dir listing. */
  isProfileEntry: boolean
  spawnLoading: boolean
  spawnError: string | null
  spawning: boolean
  canCreateDir: boolean
  handleSpawn: (path: string, mkdir?: boolean) => void
  handleDirSelect: (dir: string) => void
  handleSentinelSelect: (alias: string) => void
  handleProfileSelect: (name: string) => void
}

interface UseSpawnModeArgs {
  filter: string
  isSpawnMode: boolean
  sentinelConnected: boolean
  inputRef: React.RefObject<HTMLInputElement | null>
  setFilter: (value: string) => void
  setActiveIndex: (value: number) => void
  onClose: () => void
}

/**
 * Spawn-mode (`s:` prefix) derivations. Parses the optional `@sentinel`
 * authority + path, debounces directory listings via the broker's `/api/dirs`
 * endpoint, and exposes the Tab/Enter completion targets. While the user is
 * still typing the `@sentinel` token (no space yet), the hook skips the dir
 * fetch and exposes a sentinel suggestion list with the default sentinel
 * first. `handleSpawn` defers to the spawn dialog -- this hook does not
 * actually launch conversations.
 */
export function useSpawnMode({
  filter,
  isSpawnMode,
  sentinelConnected,
  inputRef,
  setFilter,
  setActiveIndex,
  onClose,
}: UseSpawnModeArgs): SpawnModeState {
  const spawnRawInput = isSpawnMode ? filter.slice(2).trim() : ''
  const [spawnDirs, setSpawnDirs] = useState<string[]>([])
  const [spawnLoading, setSpawnLoading] = useState(false)
  const [spawnError, setSpawnError] = useState<string | null>(null)
  const spawning = false // spawn now handled by SpawnDialog
  const spawnFetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sentinels = useConversationsStore(s => s.sentinels)

  const spawnParsed = useMemo(() => parseSpawnInput(spawnRawInput), [spawnRawInput])
  const spawnPath = spawnParsed.path
  // Always resolve to a concrete sentinel name. No `@` token => 'default'.
  const spawnSentinel = spawnParsed.sentinel || DEFAULT_SENTINEL
  const spawnProfile = spawnParsed.profile || ''
  // Sentinel-entry mode: input has a leading `@` token but no space yet, so
  // the user is still typing the sentinel alias or the colon-profile suffix.
  // Profile-entry mode is a sub-state where the user has typed `@alias:` and
  // is now typing the profile name -- we swap dir completion for profile
  // completion based on the sentinel's reported profiles.
  const sentinelOrProfileToken =
    isSpawnMode && spawnRawInput.startsWith('@') && !spawnRawInput.includes(' ') ? spawnRawInput.slice(1) : ''
  const colonIdx = sentinelOrProfileToken.indexOf(':')
  const isSentinelEntry = sentinelOrProfileToken.length > 0 && colonIdx === -1
  const isProfileEntry = sentinelOrProfileToken.length > 0 && colonIdx !== -1
  const sentinelTypedPrefix = isSentinelEntry ? sentinelOrProfileToken.toLowerCase() : ''
  const profileTypedPrefix = isProfileEntry ? sentinelOrProfileToken.slice(colonIdx + 1).toLowerCase() : ''
  const profileEntrySentinelAlias = isProfileEntry ? sentinelOrProfileToken.slice(0, colonIdx).toLowerCase() : ''

  const spawnParentDir = spawnPath.includes('/') ? spawnPath.slice(0, spawnPath.lastIndexOf('/') + 1) : '/'
  const spawnPartial = spawnPath.includes('/')
    ? spawnPath.slice(spawnPath.lastIndexOf('/') + 1).toLowerCase()
    : spawnPath.toLowerCase()

  const fetchDirs = useCallback(
    (dirPath: string, sentinel?: string) => {
      if (!sentinelConnected) return
      setSpawnLoading(true)
      setSpawnError(null)
      const params = new URLSearchParams({ path: dirPath })
      if (sentinel) params.set('sentinel', sentinel)
      fetch(`/api/dirs?${params}`)
        .then(r => r.json())
        .then(data => {
          setSpawnDirs(data.dirs || [])
          setSpawnError(data.error || null)
          setSpawnLoading(false)
        })
        .catch(err => {
          setSpawnError(err.message)
          setSpawnLoading(false)
        })
    },
    [sentinelConnected],
  )

  useEffect(() => {
    if (!isSpawnMode || isSentinelEntry || isProfileEntry) {
      setSpawnDirs([])
      setSpawnError(null)
      return
    }
    if (spawnFetchTimer.current) clearTimeout(spawnFetchTimer.current)
    spawnFetchTimer.current = setTimeout(() => fetchDirs(spawnParentDir, spawnSentinel), 200)
    return () => {
      if (spawnFetchTimer.current) clearTimeout(spawnFetchTimer.current)
    }
  }, [isSpawnMode, isSentinelEntry, isProfileEntry, spawnParentDir, spawnSentinel, fetchDirs])

  const filteredSpawnDirs = spawnPartial ? spawnDirs.filter(d => d.toLowerCase().startsWith(spawnPartial)) : spawnDirs
  const canCreateDir =
    isSpawnMode &&
    !isSentinelEntry &&
    !isProfileEntry &&
    spawnPartial.length > 0 &&
    filteredSpawnDirs.length === 0 &&
    !spawnLoading

  const filteredSentinels = useMemo<SentinelSuggestion[]>(() => {
    if (!isSentinelEntry) return []
    return buildSentinelSuggestions(sentinels, sentinelTypedPrefix)
  }, [isSentinelEntry, sentinels, sentinelTypedPrefix])

  const filteredProfiles = useMemo<ProfileSuggestion[]>(() => {
    if (!isProfileEntry) return []
    return buildProfileSuggestions(sentinels, profileEntrySentinelAlias, profileTypedPrefix)
  }, [isProfileEntry, sentinels, profileEntrySentinelAlias, profileTypedPrefix])

  function handleSpawn(path: string, mkdir = false) {
    if (spawning || !path) return
    onClose()
    openSpawnDialog({ path, mkdir, sentinel: spawnSentinel, profile: spawnProfile || undefined })
  }

  function handleDirSelect(dir: string) {
    const prefix = sentinelPrefixFor(spawnRawInput)
    setFilter(`S:${prefix}${spawnParentDir}${dir}/`)
    setActiveIndex(0)
    inputRef.current?.focus()
  }

  function handleSentinelSelect(alias: string) {
    setFilter(`S:@${alias} `)
    setActiveIndex(0)
    inputRef.current?.focus()
  }

  function handleProfileSelect(name: string) {
    const sentinelPart = profileEntrySentinelAlias || spawnSentinel
    setFilter(`S:@${sentinelPart}:${name} `)
    setActiveIndex(0)
    inputRef.current?.focus()
  }

  return {
    spawnPath,
    spawnParentDir,
    spawnSentinel,
    spawnProfile,
    filteredSpawnDirs,
    filteredSentinels,
    filteredProfiles,
    isSentinelEntry,
    isProfileEntry,
    spawnLoading,
    spawnError,
    spawning,
    canCreateDir,
    handleSpawn,
    handleDirSelect,
    handleSentinelSelect,
    handleProfileSelect,
  }
}

interface SpawnInput {
  sentinel?: string
  /** Optional sentinel-profile name parsed from the `@sentinel:profile`
   *  shorthand. The colon separates sentinel from profile; everything before
   *  the colon is the sentinel alias, everything after (up to the first
   *  space) is the profile. */
  profile?: string
  path: string
}

export function parseSpawnInput(input: string): SpawnInput {
  if (input.startsWith('claude://')) {
    try {
      const url = new URL(input)
      const profile = url.username ? decodeURIComponent(url.username) : undefined
      return { sentinel: url.hostname || undefined, profile: profile || undefined, path: url.pathname }
    } catch {
      return { path: input }
    }
  }
  if (input.startsWith('@')) {
    // Only the LEADING @token is treated as a sentinel; subsequent `@`
    // characters are part of the path. Naturally enforces a single sentinel
    // per spawn line.
    const spaceIdx = input.indexOf(' ')
    const head = spaceIdx === -1 ? input.slice(1) : input.slice(1, spaceIdx)
    const path = spaceIdx === -1 ? '' : input.slice(spaceIdx + 1)
    // `@sentinel:profile` shorthand. The colon is reserved for this split --
    // sentinel aliases and profile names share the same `[a-z0-9-]+` shape.
    const colonIdx = head.indexOf(':')
    if (colonIdx === -1) return { sentinel: head, path }
    return {
      sentinel: head.slice(0, colonIdx),
      profile: head.slice(colonIdx + 1) || undefined,
      path,
    }
  }
  return { path: input }
}

/** Returns the verbatim leading `@sentinel[:profile] ` portion (including
 *  trailing space) so dir selection preserves the user's sentinel + profile
 *  choice when the filter string is rebuilt. */
function sentinelPrefixFor(rawInput: string): string {
  if (!rawInput.startsWith('@')) return ''
  const spaceIdx = rawInput.indexOf(' ')
  if (spaceIdx === -1) return ''
  return rawInput.slice(0, spaceIdx + 1)
}

/** Build profile suggestion list for `@sentinel:` autocomplete. Reads the
 *  target sentinel's reported `profiles[]` from the conversations store --
 *  these are the SAFE names only (Profile-Env Boundary). Filtered by name
 *  prefix (case-insensitive). Falls back to an empty list when the sentinel
 *  is unknown or reports zero / one profile (no point completing in those
 *  cases -- `default` is implicit). */
function buildProfileSuggestions(
  sentinels: SentinelStatusInfo[],
  sentinelAlias: string,
  prefix: string,
): ProfileSuggestion[] {
  const lookup = sentinelAlias.toLowerCase()
  const match = sentinels.find(s => s.alias.toLowerCase() === lookup)
  const profiles = match?.profiles ?? []
  if (profiles.length <= 1) return []
  const out: ProfileSuggestion[] = []
  for (const p of profiles) {
    if (prefix && !p.name.toLowerCase().startsWith(prefix)) continue
    out.push({
      name: p.name,
      label: p.label,
      color: p.color,
      pooled: p.pooled,
      authed: p.authed,
    })
  }
  return out
}

/** Build sentinel suggestion list. Default sentinel (whichever has
 *  `isDefault: true`, or the literal alias `default` as a fallback) is
 *  always first. Filtered by alias prefix (case-insensitive). */
function buildSentinelSuggestions(sentinels: SentinelStatusInfo[], prefix: string): SentinelSuggestion[] {
  const seen = new Set<string>()
  const out: SentinelSuggestion[] = []

  function push(s: SentinelSuggestion) {
    const key = s.alias.toLowerCase()
    if (seen.has(key)) return
    if (prefix && !key.startsWith(prefix)) return
    seen.add(key)
    out.push(s)
  }

  const defaultEntry = sentinels.find(s => s.isDefault) || sentinels.find(s => s.alias === DEFAULT_SENTINEL)
  if (defaultEntry) {
    push({ alias: defaultEntry.alias, connected: defaultEntry.connected, isDefault: true })
  } else {
    push({ alias: DEFAULT_SENTINEL, connected: sentinels.some(s => s.connected), isDefault: true })
  }

  for (const s of sentinels) {
    if (s.isDefault) continue
    push({ alias: s.alias, connected: s.connected, isDefault: false })
  }

  return out
}
