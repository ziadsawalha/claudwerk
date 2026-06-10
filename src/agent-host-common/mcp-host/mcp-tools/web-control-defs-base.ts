/**
 * Web-control host tool descriptors -- shared types + helpers.
 *
 * Split out from web-control-defs.ts so the descriptor data (and the terminal
 * subset) stays under the size bar. Pure leaf module.
 */

import type { WebControlOp } from '../../../shared/protocol'

export type Params = Record<string, unknown>
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
  /** Override the host brokerRpc timeout (ms) for a long-running op (execute_script).
   *  Must exceed the broker's per-op timeout so the host doesn't abort first. */
  relayTimeoutMs?: (p: Params) => number
}

export const str = (description: string) => ({ type: 'string', description })

/** Clamp an execute_script timeout: default 20s, min 1s, max 1h (mirrors broker). */
export function clampScriptTimeout(raw: unknown): number {
  const requested = typeof raw === 'number' ? raw : 20_000
  return Math.min(Math.max(1000, requested), 60 * 60 * 1000)
}
