/**
 * Registry of pokeable CC control + daemon commands -- the single source of truth
 * shared by the web debug modal (builds the picker + payload editor), the broker
 * (permission/danger gating) and the agent host (validates incoming sends).
 *
 * Wire shapes recovered from the CC binary (control surface re-verified against
 * 2.1.177); see `.claude/docs/plan-cc-subtype-adoption.md` for per-command
 * rationale and `.claude/docs/plan-cc-control-debug.md` for the modal architecture.
 *
 * NOT included: `rewind_files` (excluded by decision), the streaming daemon ops
 * (`subscribe`/`attach`/`dispatch` -- those are not one-shot pokes), and
 * `oauth_token_refresh`/`host_auth_token_refresh`. Those two are the ONLY auth
 * subtypes that are genuinely unpokeable: they are *inbound* (CC -> host) callbacks
 * that fire only when the SDK host owns the credential (Agent-SDK / Cowork 3P).
 * rclaude spawns CC with its own per-profile CLAUDE_CONFIG_DIR credentials, so CC
 * refreshes its own token and these never fire here. The login/OAuth-callback
 * family below (`claude_authenticate`, `mcp_authenticate`, ...) is the *opposite*
 * direction -- host -> CC `this.request({subtype})` SDK-client methods, identical
 * class to `get_context_usage`/`mcp_status` -- so it IS pokeable and lives here.
 */

export type ControlChannel = 'cc_control' | 'daemon_op'
export type ControlTransport = 'headless' | 'daemon'

export interface ControlCommandSpec {
  /** Wire command name: the control_request subtype, or the daemon op. */
  command: string
  channel: ControlChannel
  label: string
  description: string
  /** Pure read -- no state mutation; safe to fire freely. */
  readOnly: boolean
  /** Loaded gun (file exfil, tool invoke, kill/shutdown) -- needs explicit confirm + audit. */
  danger: boolean
  /** Transports on which this command is actually reachable. */
  transports: ControlTransport[]
  /** JSON skeleton pre-filled into the modal's payload editor. */
  payloadTemplate: Record<string, unknown>
  /** Optional per-field type hint shown beside the editor. */
  payloadHint?: Record<string, string>
}

/** cc_control = CC stream-json control_request subtypes (headless transport only). */
const CC_CONTROL_COMMANDS: ControlCommandSpec[] = [
  // --- getters (read-only) ---
  {
    command: 'get_session_cost',
    channel: 'cc_control',
    label: 'Get session cost',
    description: "CC's own formatted cost text (same as /usage). Exact, no LiteLLM estimate.",
    readOnly: true,
    danger: false,
    transports: ['headless'],
    payloadTemplate: {},
  },
  {
    command: 'get_context_usage',
    channel: 'cc_control',
    label: 'Get context usage',
    description: 'Breakdown of context-window usage by category.',
    readOnly: true,
    danger: false,
    transports: ['headless'],
    payloadTemplate: {},
  },
  {
    command: 'get_binary_version',
    channel: 'cc_control',
    label: 'Get binary version',
    description: "The worker's CC CLI binary version.",
    readOnly: true,
    danger: false,
    transports: ['headless'],
    payloadTemplate: {},
  },
  {
    command: 'get_settings',
    channel: 'cc_control',
    label: 'Get settings',
    description: 'Effective merged settings + raw per-source settings.',
    readOnly: true,
    danger: false,
    transports: ['headless'],
    payloadTemplate: {},
  },
  {
    command: 'get_usage',
    channel: 'cc_control',
    label: 'Get usage (experimental)',
    description:
      'Structured /usage data: session cost/usage totals + claude.ai plan rate-limit utilization when available. Experimental -- CC marks the response shape as may-change.',
    readOnly: true,
    danger: false,
    transports: ['headless'],
    payloadTemplate: {},
  },
  {
    command: 'mcp_status',
    channel: 'cc_control',
    label: 'MCP server status',
    description: 'Connection status of all MCP servers.',
    readOnly: true,
    danger: false,
    transports: ['headless'],
    payloadTemplate: {},
  },
  {
    command: 'file_suggestions',
    channel: 'cc_control',
    label: 'File suggestions (@-mention)',
    description: 'Fuzzy at-mention path suggestions for a prefix (same as the TUI).',
    readOnly: true,
    danger: false,
    transports: ['headless'],
    payloadTemplate: { query: '' },
    payloadHint: { query: 'string -- partial path prefix' },
  },
  {
    command: 'read_file',
    channel: 'cc_control',
    label: 'Read file (DANGER: host read)',
    description: "Read a file from the worker's host. utf-8 or base64 (images).",
    readOnly: true,
    danger: true,
    transports: ['headless'],
    payloadTemplate: { path: '', max_bytes: 65536, encoding: 'utf-8' },
    payloadHint: { path: 'string', max_bytes: 'number', encoding: 'utf-8 | base64' },
  },

  // --- setters / mutators ---
  {
    command: 'rename_session',
    channel: 'cc_control',
    label: 'Rename session',
    description: "Set CC's own user-facing session title.",
    readOnly: false,
    danger: false,
    transports: ['headless'],
    payloadTemplate: { title: '' },
    payloadHint: { title: 'string' },
  },
  {
    command: 'set_color',
    channel: 'cc_control',
    label: 'Set color',
    description: "Set CC's session UI color.",
    readOnly: false,
    danger: false,
    transports: ['headless'],
    payloadTemplate: { color: '' },
    payloadHint: { color: 'string' },
  },
  {
    command: 'set_model',
    channel: 'cc_control',
    label: 'Set model',
    description: 'Change the active model. "default" resets to original.',
    readOnly: false,
    danger: false,
    transports: ['headless'],
    payloadTemplate: { model: '' },
    payloadHint: { model: 'string -- model id or "default"' },
  },
  {
    command: 'set_permission_mode',
    channel: 'cc_control',
    label: 'Set permission mode',
    description: 'Change permission mode (e.g. bypassPermissions).',
    readOnly: false,
    danger: false,
    transports: ['headless'],
    payloadTemplate: { mode: '' },
    payloadHint: { mode: 'string -- default | acceptEdits | bypassPermissions | plan' },
  },
  {
    command: 'set_max_thinking_tokens',
    channel: 'cc_control',
    label: 'Set max thinking tokens',
    description: 'Thinking-token budget. budget_tokens 400s on Opus 4.7+.',
    readOnly: false,
    danger: false,
    transports: ['headless'],
    payloadTemplate: { max_thinking_tokens: 0 },
    payloadHint: { max_thinking_tokens: 'number (0/null to clear)' },
  },
  {
    command: 'interrupt',
    channel: 'cc_control',
    label: 'Interrupt turn',
    description: 'Abort the current turn.',
    readOnly: false,
    danger: false,
    transports: ['headless'],
    payloadTemplate: {},
  },
  {
    command: 'apply_flag_settings',
    channel: 'cc_control',
    label: 'Apply flag settings (DANGER)',
    description: 'Merge settings into the live flag-settings layer.',
    readOnly: false,
    danger: true,
    transports: ['headless'],
    payloadTemplate: { settings: {} },
    payloadHint: { settings: 'object -- settings to merge' },
  },
  {
    command: 'mcp_call',
    channel: 'cc_control',
    label: 'MCP tool call (DANGER)',
    description: 'Invoke an MCP tool by fully-qualified name.',
    readOnly: false,
    danger: true,
    transports: ['headless'],
    payloadTemplate: { tool: '' },
    payloadHint: { tool: 'string -- mcp__server__tool_name' },
  },
  {
    command: 'mcp_reconnect',
    channel: 'cc_control',
    label: 'MCP reconnect',
    description: 'Reconnect a disconnected/failed MCP server.',
    readOnly: false,
    danger: false,
    transports: ['headless'],
    payloadTemplate: { serverName: '' },
    payloadHint: { serverName: 'string' },
  },
  {
    command: 'mcp_toggle',
    channel: 'cc_control',
    label: 'MCP toggle',
    description: 'Enable or disable an MCP server.',
    readOnly: false,
    danger: false,
    transports: ['headless'],
    payloadTemplate: { serverName: '', enabled: true },
    payloadHint: { serverName: 'string', enabled: 'boolean' },
  },
  {
    command: 'mcp_authenticate',
    channel: 'cc_control',
    label: 'MCP authenticate (start OAuth)',
    description: "Begin an MCP server's OAuth flow; returns the provider authorization URL to open.",
    readOnly: false,
    danger: false,
    transports: ['headless'],
    payloadTemplate: { serverName: '', redirectUri: '' },
    payloadHint: { serverName: 'string', redirectUri: 'string -- OAuth redirect URI' },
  },
  {
    command: 'mcp_oauth_callback_url',
    channel: 'cc_control',
    label: 'MCP OAuth callback URL',
    description: 'Complete an MCP server OAuth flow by handing CC the redirected callback URL (with the auth code).',
    readOnly: false,
    danger: false,
    transports: ['headless'],
    payloadTemplate: { serverName: '', callbackUrl: '' },
    payloadHint: { serverName: 'string', callbackUrl: 'string -- full callback URL incl. ?code=' },
  },
  {
    command: 'mcp_clear_auth',
    channel: 'cc_control',
    label: 'MCP clear auth',
    description: 'Clear stored OAuth credentials for an MCP server (forces re-auth on next connect).',
    readOnly: false,
    danger: false,
    transports: ['headless'],
    payloadTemplate: { serverName: '' },
    payloadHint: { serverName: 'string' },
  },
  {
    command: 'reload_plugins',
    channel: 'cc_control',
    label: 'Reload plugins',
    description: 'Reload plugins from disk; returns refreshed components.',
    readOnly: false,
    danger: false,
    transports: ['headless'],
    payloadTemplate: {},
  },
  {
    command: 'stop_task',
    channel: 'cc_control',
    label: 'Stop task',
    description: 'Stop a running (sub)task by id.',
    readOnly: false,
    danger: false,
    transports: ['headless'],
    payloadTemplate: { task_id: '' },
    payloadHint: { task_id: 'string' },
  },
  {
    command: 'background_tasks',
    channel: 'cc_control',
    label: 'Background tasks',
    description: 'Background one task (by tool_use_id) or all foreground tasks.',
    readOnly: false,
    danger: false,
    transports: ['headless'],
    payloadTemplate: { tool_use_id: '' },
    payloadHint: { tool_use_id: 'string -- omit to background all' },
  },
  {
    command: 'cancel_async_message',
    channel: 'cc_control',
    label: 'Cancel queued message',
    description: 'Drop a pending async user message by uuid.',
    readOnly: false,
    danger: false,
    transports: ['headless'],
    payloadTemplate: { message_uuid: '' },
    payloadHint: { message_uuid: 'string' },
  },
  {
    command: 'seed_read_state',
    channel: 'cc_control',
    label: 'Seed read state',
    description: "Seed CC's file read-state for a path.",
    readOnly: false,
    danger: false,
    transports: ['headless'],
    payloadTemplate: { path: '', mtime: 0, callback_id: '', tool_use_id: '' },
  },
  {
    command: 'submit_feedback',
    channel: 'cc_control',
    label: 'Submit feedback',
    description: 'Submit session feedback (often disabled on 3P/org policy).',
    readOnly: false,
    danger: false,
    transports: ['headless'],
    payloadTemplate: { description: '', surface: '' },
  },
  {
    command: 'message_rated',
    channel: 'cc_control',
    label: 'Rate message',
    description: 'Record a thumbs rating on an assistant message.',
    readOnly: false,
    danger: false,
    transports: ['headless'],
    payloadTemplate: { messageUuid: '' },
    payloadHint: { messageUuid: 'string' },
  },

  // --- claude.ai login flow (DANGER: mutates the profile's auth state) ---
  // Three-step OAuth: authenticate -> (user visits URL) -> oauth_callback ->
  // wait_for_completion. CC is already authed via CLAUDE_CONFIG_DIR here, so
  // poking these re-runs login for the profile -- gated + confirm.
  {
    command: 'claude_authenticate',
    channel: 'cc_control',
    label: 'Claude login: start (DANGER)',
    description:
      'Begin a Claude.ai OAuth login for the profile; returns the authorization URL to open. Re-auths the profile.',
    readOnly: false,
    danger: true,
    transports: ['headless'],
    payloadTemplate: { loginWithClaudeAi: true },
    payloadHint: { loginWithClaudeAi: 'boolean -- true = Claude.ai subscription login' },
  },
  {
    command: 'claude_oauth_callback',
    channel: 'cc_control',
    label: 'Claude login: callback (DANGER)',
    description: 'Complete the login with the authorization code + state returned from the OAuth redirect.',
    readOnly: false,
    danger: true,
    transports: ['headless'],
    payloadTemplate: { authorizationCode: '', state: '' },
    payloadHint: { authorizationCode: 'string -- from the redirect', state: 'string -- from the redirect' },
  },
  {
    command: 'claude_oauth_wait_for_completion',
    channel: 'cc_control',
    label: 'Claude login: wait (DANGER)',
    description: 'Block until the in-progress Claude.ai login flow completes.',
    readOnly: false,
    danger: true,
    transports: ['headless'],
    payloadTemplate: {},
  },
]

/** daemon_op = CC background-daemon control socket ops (daemon transport only). */
const DAEMON_OP_COMMANDS: ControlCommandSpec[] = [
  {
    command: 'ping',
    channel: 'daemon_op',
    label: 'Ping daemon',
    description: 'Liveness + daemon version + proto. Pre-gate (survives version skew).',
    readOnly: true,
    danger: false,
    transports: ['daemon'],
    payloadTemplate: {},
  },
  {
    command: 'list',
    channel: 'daemon_op',
    label: 'List jobs',
    description: 'All background jobs the daemon knows about.',
    readOnly: true,
    danger: false,
    transports: ['daemon'],
    payloadTemplate: {},
  },
  {
    command: 'has',
    channel: 'daemon_op',
    label: 'Has job',
    description: 'Whether a short exists and its worker is alive.',
    readOnly: true,
    danger: false,
    transports: ['daemon'],
    payloadTemplate: { short: '' },
    payloadHint: { short: 'string -- 8-hex worker short' },
  },
  {
    command: 'leases',
    channel: 'daemon_op',
    label: 'List leases',
    description: 'Clients currently holding the daemon open.',
    readOnly: true,
    danger: false,
    transports: ['daemon'],
    payloadTemplate: {},
  },
  {
    command: 'nudge',
    channel: 'daemon_op',
    label: 'Nudge',
    description: '"Are you mid-restart?" version-skew convergence probe. Pre-gate.',
    readOnly: true,
    danger: false,
    transports: ['daemon'],
    payloadTemplate: {},
  },
  {
    command: 'yield',
    channel: 'daemon_op',
    label: 'Yield',
    description: 'Ask a transient daemon to release the lock to a service daemon.',
    readOnly: false,
    danger: false,
    transports: ['daemon'],
    payloadTemplate: {},
  },
  {
    command: 'ensure-spare',
    channel: 'daemon_op',
    label: 'Ensure spare',
    description: 'Pre-warm a spare PTY worker so the next dispatch in cwd is instant.',
    readOnly: false,
    danger: false,
    transports: ['daemon'],
    payloadTemplate: { cwd: '' },
    payloadHint: { cwd: 'string -- working directory' },
  },
  {
    command: 'reply',
    channel: 'daemon_op',
    label: 'Reply (inject turn)',
    description: 'Inject text into a worker without attaching.',
    readOnly: false,
    danger: false,
    transports: ['daemon'],
    payloadTemplate: { short: '', text: '' },
    payloadHint: { short: 'string -- 8-hex', text: 'string -- turn/slash to inject' },
  },
  {
    command: 'resize',
    channel: 'daemon_op',
    label: 'Resize',
    description: "Resize the worker PTY (or an attacher's view).",
    readOnly: false,
    danger: false,
    transports: ['daemon'],
    payloadTemplate: { short: '', cols: 80, rows: 24 },
    payloadHint: { short: 'string', cols: 'number 1..10000', rows: 'number 1..10000' },
  },
  {
    command: 'respawn-stale',
    channel: 'daemon_op',
    label: 'Respawn stale',
    description: 'Native fix for the sleep/wake "failed" worker case.',
    readOnly: false,
    danger: false,
    transports: ['daemon'],
    payloadTemplate: { short: '' },
    payloadHint: { short: 'string -- 8-hex' },
  },
  {
    command: 'await-ack',
    channel: 'daemon_op',
    label: 'Await ack',
    description: 'Wait for a dispatched worker to ack (dispatch recovery path).',
    readOnly: true,
    danger: false,
    transports: ['daemon'],
    payloadTemplate: { short: '', timeoutMs: 8000 },
    payloadHint: { short: 'string', timeoutMs: 'number' },
  },
  {
    command: 'permission-response',
    channel: 'daemon_op',
    label: 'Permission response',
    description: 'Answer a worker permission gate over the socket. Needs a live requestId.',
    readOnly: false,
    danger: true,
    transports: ['daemon'],
    payloadTemplate: { short: '', requestId: '', allow: true },
    payloadHint: { short: 'string', requestId: 'string -- from subscribe stream', allow: 'boolean' },
  },
  {
    command: 'kill',
    channel: 'daemon_op',
    label: 'Kill worker (DANGER)',
    description: 'Terminate a worker. SIGTERM default.',
    readOnly: false,
    danger: true,
    transports: ['daemon'],
    payloadTemplate: { short: '', signal: 'SIGTERM' },
    payloadHint: { short: 'string', signal: 'SIGTERM | SIGKILL' },
  },
  {
    command: 'shutdown',
    channel: 'daemon_op',
    label: 'Shutdown daemon (DANGER)',
    description: 'Stop the daemon. reapWorkers controls whether workers are killed.',
    readOnly: false,
    danger: true,
    transports: ['daemon'],
    payloadTemplate: { reapWorkers: false },
    payloadHint: { reapWorkers: 'boolean' },
  },
]

export const CONTROL_COMMANDS: ControlCommandSpec[] = [...CC_CONTROL_COMMANDS, ...DAEMON_OP_COMMANDS]

const BY_KEY = new Map<string, ControlCommandSpec>(CONTROL_COMMANDS.map(c => [`${c.channel}:${c.command}`, c]))

/** Look up a command spec by channel + command name. */
export function getControlCommandSpec(channel: ControlChannel, command: string): ControlCommandSpec | undefined {
  return BY_KEY.get(`${channel}:${command}`)
}

/** Commands reachable on a given transport (for the modal's filtered picker). */
export function commandsForTransport(transport: ControlTransport): ControlCommandSpec[] {
  return CONTROL_COMMANDS.filter(c => c.transports.includes(transport))
}
