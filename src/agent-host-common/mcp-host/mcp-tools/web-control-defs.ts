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
 */

import type { WebControlOp } from '../../../shared/protocol'

type Params = Record<string, unknown>
type JsonSchemaProps = Record<string, unknown>

export interface WebToolDescriptor {
  name: string
  op: 'list_clients' | WebControlOp
  description: string
  /** Op-specific schema properties (clientId is added by the factory unless noClientId). */
  properties: JsonSchemaProps
  required?: string[]
  /** This tool takes NO clientId param (web_list_clients). */
  noClientId?: boolean
  /** Map validated params -> the op `args` payload (clientId handled separately). */
  buildArgs?: (p: Params) => Record<string, unknown>
}

const str = (description: string) => ({ type: 'string', description })

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
  {
    name: 'web_terminal_list',
    op: 'terminal_list',
    description:
      'List host shells visible to the opted-in browser. Returns shellId, title, path, projectUri, status, agentAttached (driven by you, off-screen) and readable (has a live buffer you can read now). Start a new one with web_terminal_start or attach an existing one with web_terminal_attach.',
    properties: {},
  },
  {
    name: 'web_terminal_start',
    op: 'terminal_start',
    description:
      'Open a NEW host shell in the given project and attach to it detached (off-screen, never pops the overlay). Title is prefixed "[debug] ". Returns shellId. After ~1.5s the buffer is ready for web_terminal_read. projectUri is claude://sentinel/path -- discover via list_hosts / list_conversations.',
    properties: {
      projectUri: str('claude://sentinel/path -- where to run the shell.'),
      title: str('Label (will be prefixed "[debug] ").'),
    },
    required: ['projectUri'],
    buildArgs: p => ({ projectUri: p.projectUri, title: p.title }),
  },
  {
    name: 'web_terminal_attach',
    op: 'terminal_attach',
    description:
      "Attach to an EXISTING host shell (by shellId from web_terminal_list) detached/off-screen so you can read and write it without taking over the user's screen. Wait ~1.5s after attaching before web_terminal_read.",
    properties: { shellId: str('Shell to attach (from web_terminal_list).') },
    required: ['shellId'],
    buildArgs: p => ({ shellId: p.shellId }),
  },
  {
    name: 'web_terminal_detach',
    op: 'terminal_detach',
    description:
      'Detach from a host shell (unmounts the off-screen pane / unsubscribes). The shell keeps running; you just stop reading it.',
    properties: { shellId: str('Shell to detach.') },
    required: ['shellId'],
    buildArgs: p => ({ shellId: p.shellId }),
  },
  {
    name: 'web_terminal_read',
    op: 'terminal_read',
    description:
      "Read a host shell's terminal buffer (scrollback + viewport) as plain text. The shell must be attached first (web_terminal_start / web_terminal_attach). Capped to the last maxLines rows (default 2000).",
    properties: {
      shellId: str('Shell to read.'),
      maxLines: { type: 'number', description: 'Cap on rows returned (default 2000, from the bottom).' },
    },
    required: ['shellId'],
    buildArgs: p => ({ shellId: p.shellId, maxLines: p.maxLines }),
  },
  {
    name: 'web_terminal_write',
    op: 'terminal_write',
    description:
      'Write raw bytes to a host shell (keystrokes / input). Text is sent EXACTLY as given -- append "\\n" (or "\\r") yourself to submit a command. Control chars work too (e.g. "\\x03" for Ctrl-C). The shell need not be attached to write, but attach to read the result.',
    properties: {
      shellId: str('Shell to write to.'),
      data: str('Raw bytes to send. Include the trailing newline to submit.'),
    },
    required: ['shellId', 'data'],
    buildArgs: p => ({ shellId: p.shellId, data: p.data }),
  },
  {
    name: 'web_terminal_screenshot',
    op: 'terminal_screenshot',
    description:
      "Screenshot a host shell's terminal surface and return a public image URL. The shell must be attached first. Usually web_terminal_read (text) is more useful; use this for TUIs / rendering issues.",
    properties: { shellId: str('Shell to screenshot.') },
    required: ['shellId'],
    buildArgs: p => ({ shellId: p.shellId }),
  },
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
]
