/**
 * Pure helpers for the sentinel's daemon-worker dispatch path.
 *
 * `index.ts` boots the sentinel on import, so the side-effect-free decisions of
 * the daemon launch flow -- the `claude --bg` argv assembly, the short-id
 * capture, the per-spawn env merge, the settings/mcp path validation, and the
 * ATTACH-mode presence check -- are extracted here so they are unit-testable
 * without launching anything. `index.ts` keeps the actual `Bun.spawn` / socket
 * I/O and calls into these functions.
 *
 * See `.claude/docs/plan-daemon-launch-ux.md` Section 5.2 (the three-mode
 * dispatch table) and Section 8 (the live spike findings).
 */
import type { DaemonResponse } from '../shared/cc-daemon/types'

/** Daemon launch mode. ATTACH never dispatches a worker. */
export type DaemonLaunchMode = 'new' | 'resume' | 'attach'

/** The two modes that run `claude --bg` (and so accept config injection). */
export type DaemonDispatchMode = 'new' | 'resume'

/** Whether a launch mode dispatches a worker via `claude --bg`. ATTACH does not. */
export function modeDispatchesWorker(mode: DaemonLaunchMode): boolean {
  return mode !== 'attach'
}

/**
 * Slugify a conversation name into a `cw-`-prefixed `claude --bg --name` value.
 * Non-alphanumeric runs collapse to a single hyphen; capped at 40 chars.
 */
export function daemonJobName(name: string): string {
  return `cw-${name.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40)}`
}

export interface DaemonDispatchArgsOpts {
  /** Launch mode -- 'new' or 'resume'. ATTACH must not reach this builder. */
  mode: DaemonDispatchMode
  /** Initial prompt. REQUIRED for new (caller validates); OPTIONAL for resume
   *  -- `claude --bg --resume` re-opens the session, a prompt is the first turn. */
  prompt?: string
  /** Daemon session id to fork from -- `claude --bg --resume <id>`. RESUME only. */
  resumeSessionId?: string
  /** Model -- `--model <model>`. */
  model?: string
  /** Conversation name -- slugified into `--name cw-<slug>`. */
  name?: string
  /** Absolute path to a settings JSON -- `--settings <path>`. */
  settingsPath?: string
  /** Absolute path to an MCP config JSON -- `--mcp-config <path>`. */
  mcpConfigPath?: string
  /** Text appended to the system prompt -- `--append-system-prompt <text>`. */
  appendSystemPrompt?: string
}

/**
 * Assemble the `claude --bg` argv for a NEW or RESUME daemon dispatch. Pure --
 * no I/O. Flag order mirrors the plan's Section 5.2 table:
 *
 *   claude --bg [--resume <id>] [--model <m>] [--name cw-<slug>]
 *               [--settings <path>] [--mcp-config <path>]
 *               [--append-system-prompt <text>] [<prompt>]
 *
 * The prompt is appended last (CC treats the trailing positional as the initial
 * turn). RESUME's prompt is optional -- only pushed when it has non-whitespace
 * content. NEW's prompt is required; the caller validates it before dispatch.
 */
export function buildDaemonDispatchArgs(opts: DaemonDispatchArgsOpts): string[] {
  if (opts.mode === 'resume' && !opts.resumeSessionId?.trim()) {
    throw new Error('buildDaemonDispatchArgs: resume mode requires a non-empty resumeSessionId')
  }
  const args = ['claude', '--bg']
  /** Append `flag value` only when the value is a non-empty string. */
  const pushFlag = (flag: string, value: string | undefined): void => {
    if (value) args.push(flag, value)
  }
  pushFlag('--resume', opts.mode === 'resume' ? opts.resumeSessionId : undefined)
  pushFlag('--model', opts.model)
  pushFlag('--name', opts.name ? daemonJobName(opts.name) : undefined)
  pushFlag('--settings', opts.settingsPath)
  pushFlag('--mcp-config', opts.mcpConfigPath)
  pushFlag('--append-system-prompt', opts.appendSystemPrompt)
  // Prompt is the trailing positional. RESUME's prompt is optional.
  if (opts.prompt?.trim()) args.push(opts.prompt)
  return args
}

/**
 * Match ANSI SGR sequences without the literal ESC control char (which trips
 * biome's noControlCharactersInRegex). The stray ESC left behind is harmless --
 * the consumer matches across it with `\W`.
 */
const DAEMON_ANSI_RE = /\[[0-9;]*m/g

/**
 * Capture the 8-hex daemon job short id from `claude --bg` output. CC prints a
 * `backgrounded - <8hex>` line on success (NEW and RESUME both print it).
 * Returns `null` if no short id is present.
 */
export function parseDaemonShort(output: string): string | null {
  const match = output.replace(DAEMON_ANSI_RE, '').match(/backgrounded\s+\W+\s*([0-9a-f]{8})/)
  return match ? match[1] : null
}

/**
 * Merge per-spawn env vars over the sentinel's base env for the `claude --bg`
 * worker process. The WORKER process -- not just the daemon-host -- needs them,
 * so this merge happens at the `claude --bg` `Bun.spawn` call site.
 */
export function mergeDaemonWorkerEnv(
  base: Record<string, string | undefined>,
  extra?: Record<string, string>,
): Record<string, string | undefined> {
  return extra ? { ...base, ...extra } : { ...base }
}

/** Outcome of a pre-dispatch / pre-attach validation -- ok, or a fail reason. */
export interface DaemonDispatchCheck {
  ok: boolean
  error?: string
}

/**
 * Validate the optional `--settings` / `--mcp-config` paths exist on the
 * sentinel host before a NEW/RESUME dispatch. `exists` is injected so this is
 * unit-testable; `index.ts` passes `existsSync`. Returns the first failure.
 */
export function validateDaemonConfigPaths(
  paths: { settingsPath?: string; mcpConfigPath?: string },
  exists: (path: string) => boolean,
): DaemonDispatchCheck {
  const labelled: Array<[string, string | undefined]> = [
    ['--settings', paths.settingsPath],
    ['--mcp-config', paths.mcpConfigPath],
  ]
  for (const [flag, path] of labelled) {
    if (path && !exists(path)) {
      return { ok: false, error: `daemon spawn: ${flag} path not found on the sentinel host: ${path}` }
    }
  }
  return { ok: true }
}

/**
 * Decide whether an ATTACH-mode spawn may proceed, given the `has(short)`
 * response from the daemon control socket. ATTACH fails the spawn when the
 * worker is not present in the daemon roster (`has` reported an error, or
 * `present !== true`). Pure -- the caller performs the socket I/O.
 */
export function evaluateAttachPresence(resp: DaemonResponse, short: string): DaemonDispatchCheck {
  if (resp.ok === false) {
    return {
      ok: false,
      error: `daemon attach: worker ${short} not found (has -> ${resp.code ?? 'error'}: ${resp.error})`,
    }
  }
  if (resp.present !== true) {
    return {
      ok: false,
      error:
        `daemon attach: worker ${short} is not present in the daemon roster ` +
        `(has -> present=${String(resp.present)}, alive=${String(resp.alive)})`,
    }
  }
  return { ok: true }
}
