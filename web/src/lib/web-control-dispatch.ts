/**
 * Web Debug Control -- request dispatcher (client side).
 *
 * Executes a broker-relayed `web_control_request` in THIS browser and replies
 * with `web_control_response`. Every op is gated on a live local grant first
 * (default-deny): if the user has not opted in (or the grant expired), the op is
 * refused regardless of what the broker sent. Every op is also logged to the
 * debug log (the user sees what the agent ran) and raises a visibility toast (in
 * the op handler). Op bodies live in web-control-ops.ts; this is just the router.
 */

import type { WebControlOp } from '@shared/protocol'
import { getActiveWebControlGrant } from './web-control-grant'
import { describeError, logControlOp } from './web-control-log'
import {
  opExecuteCommand,
  opExecuteScript,
  opListCommands,
  opPerfReport,
  opReadTranscript,
  opScreenshot,
  opSendPrompt,
  opSetConversation,
  opSetPerfMonitor,
  respond,
  type Send,
  sendTerm,
} from './web-control-ops'
import {
  terminalAttach,
  terminalDetach,
  terminalList,
  terminalRead,
  terminalScreenshot,
  terminalStart,
  terminalWrite,
} from './web-control-terminal'

interface WebControlRequestMsg {
  requestId: string
  op: WebControlOp
  args?: Record<string, unknown>
}

/** Entry point wired into the WS onmessage bypass. */
export async function handleWebControlRequest(msg: WebControlRequestMsg, send: Send): Promise<void> {
  const { requestId, op } = msg
  const args = msg.args ?? {}

  // Front-end audit: log every control op so the user sees what the agent ran.
  logControlOp(op, args)

  // Default-deny: a live local grant is required for every op.
  if (!getActiveWebControlGrant()) {
    respond(send, requestId, false, undefined, 'Browser is not opted-in to remote control (no active grant).')
    return
  }

  try {
    switch (op) {
      case 'screenshot':
        await opScreenshot(send, requestId, args)
        break
      case 'list_commands':
        opListCommands(send, requestId)
        break
      case 'execute_command':
        opExecuteCommand(send, requestId, args)
        break
      case 'set_conversation':
        opSetConversation(send, requestId, args)
        break
      case 'read_transcript':
        opReadTranscript(send, requestId, args)
        break
      case 'send_prompt':
        opSendPrompt(send, requestId, args)
        break
      case 'terminal_list':
        sendTerm(send, requestId, op, terminalList())
        break
      case 'terminal_start':
        sendTerm(send, requestId, op, await terminalStart(args))
        break
      case 'terminal_attach':
        sendTerm(send, requestId, op, await terminalAttach(args))
        break
      case 'terminal_detach':
        sendTerm(send, requestId, op, terminalDetach(args))
        break
      case 'terminal_read':
        sendTerm(send, requestId, op, terminalRead(args))
        break
      case 'terminal_write':
        sendTerm(send, requestId, op, terminalWrite(args))
        break
      case 'terminal_screenshot':
        sendTerm(send, requestId, op, await terminalScreenshot(args))
        break
      case 'perf_report':
        opPerfReport(send, requestId, args)
        break
      case 'set_perf_monitor':
        opSetPerfMonitor(send, requestId, args)
        break
      case 'execute_script':
        await opExecuteScript(send, requestId, args)
        break
      default:
        respond(send, requestId, false, undefined, `Unknown op '${op}'`)
    }
  } catch (e) {
    respond(send, requestId, false, undefined, describeError(e))
  }
}
