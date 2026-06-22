/**
 * The Jarvis voice tool contract (plan-dispatcher-build.md §5 item 6 + §6).
 *
 * These are the OpenAI Realtime function-schemas the voice model emits. They
 * are the SAME verbs the text front-end hits -- voice and text are two
 * front-ends onto ONE `desk.dispatch` surface. The Realtime model function-CALLS
 * these; the web client maps each call to a `desk.dispatch` request or a
 * screen-modal action, returns the result via `sendFunctionResult`, and Jarvis
 * speaks the outcome.
 *
 * Shape matches the OpenAI Realtime `tools[]` entry exactly:
 *   { type:'function', name, description, parameters:<JSON Schema, strict> }
 * (verified against the protokol interview-poc reference impl, 2026-06).
 */

export interface RealtimeTool {
  type: 'function'
  name: string
  description: string
  parameters: {
    type: 'object'
    strict: true
    properties: Record<string, unknown>
    required: string[]
  }
}

/** The primary verb: hand an intent to the dispatcher and let it decide the
 *  disposition (spawn / route / revive / ask). Optional target/disposition for
 *  a hard override ("in yemaya, ..."). */
const dispatchTool: RealtimeTool = {
  type: 'function',
  name: 'dispatch',
  description:
    "Route the user's intent to the fleet. The dispatcher decides whether to spawn a NEW conversation, route into an EXISTING one, or revive an ENDED one. Pass only `intent` to let it decide; pass `target`/`disposition` only when the user is explicit (e.g. 'in the mic-bug conversation, ...').",
  parameters: {
    type: 'object',
    strict: true,
    properties: {
      intent: { type: 'string', description: 'What the user wants done, in their words.' },
      target: {
        type: ['string', 'null'],
        description: 'Explicit conversationId or project, when the user named one. Else null.',
      },
      disposition: {
        type: ['string', 'null'],
        enum: ['new', 'route', 'revive', null],
        description: 'Hard override of the routing decision. Usually null -- let the dispatcher decide.',
      },
    },
    required: ['intent', 'target', 'disposition'],
  },
}

/** Pick one of the candidate conversations the dispatcher offered when it was
 *  unsure (the `ask` disposition / conversation_select cards). */
const conversationSelectTool: RealtimeTool = {
  type: 'function',
  name: 'conversation_select',
  description:
    'When the dispatcher asked the user to choose between candidate conversations, call this with the conversationId the user picked.',
  parameters: {
    type: 'object',
    strict: true,
    properties: {
      decisionId: { type: 'string', description: 'The dispatch decision being answered.' },
      conversationId: { type: 'string', description: 'The conversation the user chose.' },
    },
    required: ['decisionId', 'conversationId'],
  },
}

/** Answer the cost-confirmation gate by voice (routing into a very-expensive
 *  conversation, or spawning Opus). */
const confirmExpensiveTool: RealtimeTool = {
  type: 'function',
  name: 'confirm_expensive',
  description:
    "When the dispatcher warned that a route is very expensive (large context, cold cache, or Opus) and asked for confirmation, call this with the user's yes/no.",
  parameters: {
    type: 'object',
    strict: true,
    properties: {
      decisionId: { type: 'string', description: 'The held decision being confirmed.' },
      confirm: { type: 'boolean', description: 'true to proceed despite the cost, false to cancel.' },
    },
    required: ['decisionId', 'confirm'],
  },
}

/** Screen-modal control -- Jarvis drives the visual surface by voice. */
const controlScreenTool: RealtimeTool = {
  type: 'function',
  name: 'control_screen',
  description:
    'Drive the dashboard by voice: open or close a modal, or navigate to a view. Use when the user says things like "open the audit log", "close that", "show me yemaya".',
  parameters: {
    type: 'object',
    strict: true,
    properties: {
      action: { type: 'string', enum: ['open_modal', 'close_modal', 'navigate'] },
      target: {
        type: ['string', 'null'],
        description: 'Modal name or navigation target. Null for close_modal.',
      },
    },
    required: ['action', 'target'],
  },
}

/** The full Jarvis tool set wired into the Realtime session. */
export const voiceTools: RealtimeTool[] = [
  dispatchTool,
  conversationSelectTool,
  confirmExpensiveTool,
  controlScreenTool,
]

/** Tool names the web client must handle in its `onFunctionCall`. */
export const voiceToolNames = voiceTools.map(t => t.name)
