/**
 * Canonical resolver for spawn request defaults.
 *
 * Merges `explicit > project > global > undefined` across every field that
 * has a settings-backed default. Consumed by:
 * - HTTP /api/spawn route (src/broker/routes.ts)
 * - HTTP /conversations/:id/revive route
 * - WS channel_spawn handler (src/broker/handlers/inter-conversation.ts)
 *
 * Empty strings, the `'default'` sentinel, and `0` numerics (in defaults) all
 * mean "unset" -- callers downstream treat `undefined` as "use CC default".
 */

import type { LaunchProfile } from './launch-profile'
import type { SpawnRequest } from './spawn-schema'

export type DefaultsSource = {
  defaultModel?: string
  defaultEffort?: string
  defaultPermissionMode?: string
  defaultMaxBudgetUsd?: number
  defaultAutocompactPct?: number
  defaultLaunchMode?: 'headless' | 'pty'
  defaultBare?: boolean
  defaultRepl?: boolean
  defaultIncludePartialMessages?: boolean
  /**
   * Transport reframe (Phase 3): the per-backend default transport. Replaces
   * `defaultBackend` at the GLOBAL tier. The resolvers read this FIRST and fall
   * back to `defaultBackend` for one phase (dropped in Phase 6), so a loose
   * DefaultsSource carrying only `defaultBackend` (e.g. a pre-migration fixture)
   * still resolves correctly. `claude:'claude-daemon'` -> daemon backend (NEW
   * mode); `'claude-pty'`/`'claude-headless'` -> claude backend at that wire.
   */
  defaultTransport?: { claude?: NonNullable<SpawnRequest['transport']> }
  /**
   * LEGACY cutover flag (transport reframe dual-read fallback). Only the GLOBAL
   * tier ever carries this -- it is the default backend for agent-spawned
   * conversations that name none explicitly. 'daemon' -> daemon backend (NEW
   * mode); 'pty'/'headless' -> claude backend at that launch mode. Superseded by
   * `defaultTransport`; consulted only when `defaultTransport` is absent.
   */
  defaultBackend?: 'daemon' | 'pty' | 'headless'
}

/** Shape returned by resolveSpawnConfig -- `headless` is always concrete. */
export type ResolvedSpawnConfig = Partial<SpawnRequest> & { headless: boolean }

/**
 * The backend a spawn resolves to, plus a human-readable reason. The `reason`
 * exists for the LOG EVERYTHING covenant -- the dispatch site logs it so the
 * backend fork is never a silent decision.
 */
export type BackendDecision = {
  backend: SpawnRequest['backend']
  daemonMode: SpawnRequest['daemonMode']
  reason: string
}

/**
 * Decide the backend for a spawn request. Precedence:
 *   1. an explicit `partial.backend` always wins (control panel, launch
 *      profiles, an MCP caller that named one);
 *   2. adHoc spawns always stay the claude headless path -- never daemon;
 *   3. otherwise the global default transport drives it -- `defaultTransport.
 *      claude='claude-daemon'` adopts the daemon backend (NEW mode unless the
 *      caller set `daemonMode`); the other claude transports / unset leave the
 *      backend unset (claude). The legacy `defaultBackend` flat enum is the
 *      dual-read fallback when `defaultTransport` is absent (dropped in Phase 6).
 *
 * This is the cutover knob. Agent-spawned conversations (MCP spawn_conversation,
 * inter-conversation channel_spawn) carry no explicit backend, so the global
 * default governs them; user launches from the control panel always name a
 * backend / transport and are unaffected.
 */
export function resolveDefaultBackend(partial: Partial<SpawnRequest>, global?: DefaultsSource | null): BackendDecision {
  if (partial.backend) {
    return {
      backend: partial.backend,
      daemonMode: partial.backend === 'daemon' ? (partial.daemonMode ?? 'new') : partial.daemonMode,
      reason: `explicit backend=${partial.backend}`,
    }
  }
  if (partial.adHoc) {
    return { backend: undefined, daemonMode: undefined, reason: 'adHoc spawn -> claude headless path' }
  }
  // Transport reframe (Phase 3): prefer the per-backend default transport; fall
  // back to the legacy `defaultBackend` flat enum (dropped in Phase 6).
  const claudeTransport = global?.defaultTransport?.claude
  if (claudeTransport) {
    if (claudeTransport === 'claude-daemon') {
      const daemonMode = partial.daemonMode ?? 'new'
      return { backend: 'daemon', daemonMode, reason: `defaultTransport.claude=claude-daemon -> daemon ${daemonMode}` }
    }
    return { backend: undefined, daemonMode: undefined, reason: `defaultTransport.claude=${claudeTransport} -> claude` }
  }
  const flag = global?.defaultBackend
  if (flag === 'daemon') {
    const daemonMode = partial.daemonMode ?? 'new'
    return { backend: 'daemon', daemonMode, reason: `defaultBackend=daemon -> daemon ${daemonMode}` }
  }
  return { backend: undefined, daemonMode: undefined, reason: `defaultBackend=${flag ?? 'unset'} -> claude` }
}

/**
 * Resolve the `transport` (transport reframe § 0.2) alongside the backend.
 * Phase 1 dual-resolution:
 *   1. an explicit `partial.transport` always wins;
 *   2. the daemon backend implies `claude-daemon`;
 *   3. the claude backend (or unset, which defaults to claude) maps the
 *      resolved `headless` flag to `claude-headless` / `claude-pty`.
 * Other backends (opencode / chat-api / hermes) have no transport in this plan
 * yet -- they resolve to `undefined`. The default source is the global
 * `defaultTransport.claude` (Phase 3), threaded in via the already-resolved
 * `resolvedBackend` (resolveDefaultBackend) and `headless` (globalLaunchMode)
 * flags; the legacy `defaultBackend` is their dual-read fallback (Phase 6 drop).
 */
export function resolveTransport(
  partial: Partial<SpawnRequest>,
  resolvedBackend: SpawnRequest['backend'],
  headless: boolean,
): SpawnRequest['transport'] {
  if (partial.transport) return partial.transport
  if (resolvedBackend === 'daemon') return 'claude-daemon'
  if (resolvedBackend === undefined || resolvedBackend === 'claude') {
    return headless ? 'claude-headless' : 'claude-pty'
  }
  return undefined
}

/**
 * The global-tier launch mode. The global default transport supersedes the
 * legacy `defaultLaunchMode` at the global tier: `claude-headless` -> headless,
 * `claude-pty`/`claude-daemon` -> pty. The legacy `defaultBackend` flat enum is
 * the dual-read fallback (Phase 6 drop); `defaultLaunchMode` is the final
 * fallback when neither transport default is set.
 */
function globalLaunchMode(global?: DefaultsSource | null): 'headless' | 'pty' | undefined {
  const claudeTransport = global?.defaultTransport?.claude
  if (claudeTransport === 'claude-headless') return 'headless'
  if (claudeTransport === 'claude-pty' || claudeTransport === 'claude-daemon') return 'pty'
  switch (global?.defaultBackend) {
    case 'headless':
      return 'headless'
    case 'pty':
    case 'daemon':
      return 'pty'
    default:
      return global?.defaultLaunchMode
  }
}

/**
 * Merge spawn request defaults: explicit > profile > project > global > undefined.
 * Empty strings, 'default' sentinel, and 0 numerics in defaults are treated as unset.
 */
export function resolveSpawnConfig(
  partial: Partial<SpawnRequest>,
  project?: DefaultsSource | null,
  global?: DefaultsSource | null,
  profile?: DefaultsSource | null,
): ResolvedSpawnConfig {
  const model = pickString(partial.model, profile?.defaultModel, project?.defaultModel, global?.defaultModel) as
    | SpawnRequest['model']
    | undefined
  const effort = pickString(partial.effort, profile?.defaultEffort, project?.defaultEffort, global?.defaultEffort) as
    | SpawnRequest['effort']
    | undefined
  const permissionModeResolved = pickString(
    partial.permissionMode,
    profile?.defaultPermissionMode,
    project?.defaultPermissionMode,
    global?.defaultPermissionMode,
  ) as SpawnRequest['permissionMode'] | undefined

  // Phase I cutover: the backend an agent-spawned conversation adopts. Carried
  // through ResolvedSpawnConfig so callers see the resolved choice; the dispatch
  // site (src/broker/spawn-dispatch.ts) is the one that logs the decision.
  const backendDecision = resolveDefaultBackend(partial, global)

  const launchMode = profile?.defaultLaunchMode || project?.defaultLaunchMode || globalLaunchMode(global)
  // Default to PTY. PTY conversations bill against the Anthropic subscription;
  // headless (--print) bills at API rate from 2026-06-15. adHoc spawns, an
  // explicit `headless` flag, and a 'headless' launch mode still opt back in.
  const headless = partial.adHoc ? true : partial.headless !== undefined ? partial.headless : launchMode === 'headless'

  const autocompactPct = pickNumber(
    partial.autocompactPct,
    profile?.defaultAutocompactPct,
    project?.defaultAutocompactPct,
    global?.defaultAutocompactPct,
  )
  const maxBudgetUsd = pickNumber(
    partial.maxBudgetUsd,
    profile?.defaultMaxBudgetUsd,
    project?.defaultMaxBudgetUsd,
    global?.defaultMaxBudgetUsd,
  )

  const bare = partial.bare ?? profile?.defaultBare ?? project?.defaultBare ?? global?.defaultBare ?? undefined
  const repl = partial.repl ?? profile?.defaultRepl ?? project?.defaultRepl ?? global?.defaultRepl ?? undefined

  const includePartialMessages = partial.adHoc
    ? (partial.includePartialMessages ?? false)
    : (partial.includePartialMessages ??
      profile?.defaultIncludePartialMessages ??
      project?.defaultIncludePartialMessages ??
      global?.defaultIncludePartialMessages ??
      true)

  // Transport reframe (Phase 1): resolve the transport alongside the backend so
  // every caller sees the canonical wire discriminator. Derived from the
  // resolved `headless` flag for the claude backend.
  const transport = resolveTransport(partial, backendDecision.backend, headless)

  return {
    ...partial,
    model,
    effort,
    permissionMode: partial.adHoc ? 'bypassPermissions' : permissionModeResolved,
    backend: backendDecision.backend,
    daemonMode: backendDecision.daemonMode,
    transport,
    headless,
    autocompactPct,
    maxBudgetUsd,
    bare,
    repl,
    includePartialMessages,
  }
}

export function profileToDefaultsSource(profile: LaunchProfile | null | undefined): DefaultsSource | null {
  if (!profile) return null
  const spawn = profile.spawn
  return {
    defaultModel: spawn.model,
    defaultEffort: spawn.effort,
    defaultPermissionMode: spawn.permissionMode,
    defaultMaxBudgetUsd: spawn.maxBudgetUsd,
    defaultAutocompactPct: spawn.autocompactPct,
    defaultLaunchMode: spawn.headless === undefined ? undefined : spawn.headless ? 'headless' : 'pty',
    defaultBare: spawn.bare,
    defaultRepl: spawn.repl,
    defaultIncludePartialMessages: spawn.includePartialMessages,
  }
}

/**
 * Apply non-defaults profile fields (backend, env, prompt, appendSystemPrompt, ...)
 * that are not covered by DefaultsSource. Returns a partial that explicit form
 * values can be merged over.
 */
export function profileToSpawnPartial(profile: LaunchProfile | null | undefined): Partial<SpawnRequest> {
  if (!profile) return {}
  const spawn = profile.spawn
  const partial: Partial<SpawnRequest> = {}
  if (spawn.backend !== undefined) partial.backend = spawn.backend
  if (spawn.agent !== undefined) partial.agent = spawn.agent
  if (spawn.env !== undefined) partial.env = spawn.env
  if (spawn.appendSystemPrompt !== undefined) partial.appendSystemPrompt = spawn.appendSystemPrompt
  if (spawn.openCodeModel !== undefined) partial.openCodeModel = spawn.openCodeModel
  if (spawn.toolPermission !== undefined) partial.toolPermission = spawn.toolPermission
  if (spawn.chatConnectionId !== undefined) partial.chatConnectionId = spawn.chatConnectionId
  if (spawn.chatConnectionName !== undefined) partial.chatConnectionName = spawn.chatConnectionName
  if (spawn.gatewayId !== undefined) partial.gatewayId = spawn.gatewayId
  return partial
}

function pickString(...values: Array<string | undefined>): string | undefined {
  for (const v of values) {
    if (v && v !== 'default') return v
  }
  return undefined
}

function pickNumber(...values: Array<number | undefined>): number | undefined {
  for (const v of values) {
    if (v !== undefined && v > 0) return v
  }
  return undefined
}
