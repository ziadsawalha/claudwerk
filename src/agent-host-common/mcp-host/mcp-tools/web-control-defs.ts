/**
 * Web-control host tool descriptors (pure data).
 *
 * One entry per `web_*` tool. Descriptions are COPIED VERBATIM from the broker MCP
 * site (src/broker/routes/mcp-server.ts) so the two binding sites never drift --
 * the canonical identity is the catalog summary; these are the served strings.
 *
 * The factory in web-control.ts turns each descriptor into a ToolDef whose handle()
 * relays `{ op, clientId, args: buildArgs(params) }` to the broker via brokerRpc
 * ('web_control_relay'). `clientId` is a standard optional param on every tool
 * except web_list_clients (which takes none); the factory injects it, so buildArgs
 * returns only the op-specific args.
 *
 * Types + the `str` helper live in web-control-defs-base.ts; the 7 terminal
 * descriptors live in web-control-defs-terminal.ts (split for the size bar).
 */

import { clampScriptTimeout, str, type WebToolDescriptor } from './web-control-defs-base'
import { TERMINAL_TOOL_DEFS } from './web-control-defs-terminal'

export type { WebToolDescriptor } from './web-control-defs-base'

export const WEB_CONTROL_TOOL_DEFS: readonly WebToolDescriptor[] = [
  {
    name: 'web_list_clients',
    op: 'list_clients',
    noClientId: true,
    description:
      'List control-panel browsers that have opted in to agent remote-control. Returns clientId (stable, pass it to the other web_* tools), label, userName, capabilities, and ttlMs (ms left on the 1h grant). Empty list = nobody opted in; ask the user to enable it in Settings > System > Debug. When exactly one client is opted-in you may omit clientId on the other tools and it is used implicitly.',
    properties: {},
  },
  {
    name: 'web_screenshot',
    op: 'screenshot',
    description:
      'Capture a screenshot of the opted-in control-panel browser and return a public image URL (fetch it to view). Optionally pass a CSS `selector` to capture just one element instead of the whole app.',
    properties: { selector: str('CSS selector of a single element to capture. Omit to capture the whole viewport.') },
    buildArgs: p => ({ selector: p.selector }),
  },
  {
    name: 'web_list_commands',
    op: 'list_commands',
    description:
      'List the command-palette commands currently registered (and visible) in the opted-in browser. Returns id, label, and group for each. Feed an id into web_execute_command.',
    properties: {},
  },
  {
    name: 'web_execute_command',
    op: 'execute_command',
    description:
      'Run a command-palette command in the opted-in browser by its id (discover ids via web_list_commands). Opting in grants full palette access, including destructive commands -- the user authorized this by enabling remote-control.',
    properties: {
      id: str('Command id to execute (from web_list_commands).'),
      args: { type: 'array', items: { type: 'string' }, description: 'String arguments passed to the command action.' },
    },
    required: ['id'],
    buildArgs: p => ({ id: p.id, args: Array.isArray(p.args) ? p.args : [] }),
  },
  {
    name: 'web_set_conversation',
    op: 'set_conversation',
    description: 'Navigate the opted-in browser to a specific conversation (selects it as the active conversation).',
    properties: { conversationId: str('Conversation id to select.') },
    required: ['conversationId'],
    buildArgs: p => ({ conversationId: p.conversationId }),
  },
  {
    name: 'web_read_transcript',
    op: 'read_transcript',
    description:
      "Read the transcript as rendered in the opted-in browser. Defaults to the browser's currently-active conversation; pass conversationId to read a specific one (must be loaded in that browser). format:'text' (default) returns a compact text rendering; format:'json' returns the raw entry array.",
    properties: {
      conversationId: str("Conversation to read. Omit for the browser's currently-active conversation."),
      format: { type: 'string', enum: ['text', 'json'], description: "Output format. Default 'text'." },
    },
    buildArgs: p => ({ conversationId: p.conversationId, format: p.format ?? 'text' }),
  },
  {
    name: 'web_send_prompt',
    op: 'send_prompt',
    description:
      'Type and send a prompt to a conversation through the opted-in browser (same path as a user typing in the input box, including client-side control verbs like /clear or /model).',
    properties: {
      conversationId: str('Conversation id to send the prompt to.'),
      text: str('Prompt text to send.'),
    },
    required: ['conversationId', 'text'],
    buildArgs: p => ({ conversationId: p.conversationId, text: p.text }),
  },
  ...TERMINAL_TOOL_DEFS,
  {
    name: 'web_set_perf_monitor',
    op: 'set_perf_monitor',
    description:
      'Turn the control-panel performance monitor (the "Details for Nerds" perf HUD) ON or OFF in the opted-in browser. It is OFF by default and records nothing until enabled. Turn it ON, ask the user to reproduce the slow activity (switch conversations, stream a turn, etc.), THEN call web_perf_report. Turn it OFF when done -- the Profiler wrappers add per-commit overhead while on.',
    properties: {
      enabled: { type: 'boolean', description: 'true = start recording, false = stop and clear the ring buffer.' },
    },
    required: ['enabled'],
    buildArgs: p => ({ enabled: p.enabled === true }),
  },
  {
    name: 'web_perf_report',
    op: 'perf_report',
    description:
      'Grab the performance report from the opted-in browser as markdown: a per-category Summary (count/avg/p95/max), a By-message impact rollup (apply vs render vs paint vs grouping cost per wire-message type), and a chronological Timeline of perf samples interleaved with debug-log lines. Requires the perf monitor to be ON (web_set_perf_monitor {enabled:true}) and some activity to have occurred since. See docs/perf-monitor.md for what each metric means.',
    properties: {
      significantOnly: {
        type: 'boolean',
        description: 'Only include samples >= 2.5ms in By-message + Timeline (cuts sub-ms noise). Default false.',
      },
    },
    buildArgs: p => ({ significantOnly: p.significantOnly === true }),
  },
  {
    name: 'web_execute_script',
    op: 'execute_script',
    description:
      'Run arbitrary JavaScript in the opted-in browser and return its result. The code runs in an async function in the page context (window/document/app stores in scope), so you can `await` and `return` a value. The result must be JSON-serializable (non-serializable values are stringified). Returns `{ result }` on success or an error.\n\nGATED: the browser needs a SEPARATE "Allow script execution" opt-in (beyond remote-control) -- if it is off this returns an error. Benevolent trust only. Every execution is logged in the browser\'s debug log (the user sees what you ran) and audited broker-side. Use for one-off debugging the fixed web_* ops do not cover (probe a store, read a computed style, drive getDisplayMedia capture, etc.).\n\nTIMEOUT covers async hangs (awaits) only -- a synchronous infinite loop still blocks the page; do not write one.',
    properties: {
      code: str(
        'JavaScript to run. Body of an async function: you may `await` and `return` a JSON-serializable value.',
      ),
      timeoutMs: {
        type: 'number',
        description: 'Max run time in ms before the script is abandoned. Default 20000, max 3600000 (1h).',
      },
    },
    required: ['code'],
    buildArgs: p => ({
      code: p.code,
      ...(p.timeoutMs !== undefined ? { timeoutMs: clampScriptTimeout(p.timeoutMs) } : {}),
    }),
    // Host brokerRpc must outlast the broker's per-op timeout (script + 5s); give +10s.
    relayTimeoutMs: p => clampScriptTimeout(p.timeoutMs) + 10_000,
  },
]
