/**
 * oauth-token-env -- inject a profile's long-lived OAuth token into a spawned
 * child's environment and clear the higher-precedence Anthropic creds that
 * would otherwise mask it.
 *
 * Claude Code auth precedence (highest first): Bedrock/Vertex/Foundry >
 * `ANTHROPIC_AUTH_TOKEN` > `ANTHROPIC_API_KEY` > `apiKeyHelper` >
 * `CLAUDE_CODE_OAUTH_TOKEN` > stored `/login` creds. The sentinel preserves
 * provider creds (`ANTHROPIC_*`) through `cleanSentinelEnv`, so a host-level
 * `ANTHROPIC_API_KEY` would beat our token. We therefore neutralise the two
 * `ANTHROPIC_*` env vars for a token-profile spawn -- but only when the
 * profile's own `env` did NOT set them (an explicit profile.env value is a
 * deliberate operator override and stays).
 *
 * Two shapes:
 *   - `applyOAuthToken` mutates a FULL child env (built from `cleanSentinelEnv`),
 *     so it can truly `delete` the conflicting keys.
 *   - `applyOAuthTokenDelta` builds a DELTA applied over an existing base env
 *     (the CC daemon's own env), where keys can only be shadowed with an empty
 *     string, not removed. Empty is treated as absent by CC's truthiness check.
 *
 * Note: `--bare` spawns do NOT read `CLAUDE_CODE_OAUTH_TOKEN` (a documented CC
 * limitation); a token is useless for bare profiles. PTY/interactive + headless
 * spawns read it normally.
 */

/** The two Anthropic env vars that outrank `CLAUDE_CODE_OAUTH_TOKEN`. */
const CONFLICTING_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const

/**
 * Inject `token` as `CLAUDE_CODE_OAUTH_TOKEN` into a full child env and DELETE
 * any inherited `ANTHROPIC_*` creds (unless `profileEnv` set them). No-op when
 * `token` is undefined.
 */
export function applyOAuthToken(
  env: Record<string, string | undefined>,
  token: string | undefined,
  profileEnv?: Record<string, string>,
): void {
  if (!token) return
  env.CLAUDE_CODE_OAUTH_TOKEN = token
  const profileSet = profileEnv ?? {}
  for (const key of CONFLICTING_KEYS) {
    if (!(key in profileSet)) delete env[key]
  }
}

/**
 * Inject `token` as `CLAUDE_CODE_OAUTH_TOKEN` into a worker env DELTA and SHADOW
 * any base `ANTHROPIC_*` creds with an empty string (delta cannot delete a base
 * var). Best-effort: for guaranteed token auth on the daemon backend, the
 * sentinel host must not export `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`.
 * No-op when `token` is undefined.
 */
export function applyOAuthTokenDelta(
  delta: Record<string, string>,
  token: string | undefined,
  profileEnv?: Record<string, string>,
): void {
  if (!token) return
  delta.CLAUDE_CODE_OAUTH_TOKEN = token
  const profileSet = profileEnv ?? {}
  for (const key of CONFLICTING_KEYS) {
    if (!(key in profileSet)) delta[key] = ''
  }
}
