/**
 * Web Debug Control -- shared logging + error helpers.
 *
 * Every control op the agent runs in this browser is logged via console.debug,
 * which the debug-log ring buffer (debug-log.ts) captures -- so the USER can see
 * exactly what the agent did to their browser (and it shows up in the perf-report
 * Timeline). This is the front-end half of the audit trail (the broker logs the
 * other half). Jonas: "always log all control messages."
 */

import type { WebControlOp } from '@shared/protocol'

/** A few known arg keys, summarized + length-capped, for the audit line. */
const SUMMARY_KEYS = ['conversationId', 'id', 'selector', 'shellId', 'projectUri', 'enabled', 'text', 'timeoutMs']

function summarizeArgs(args: Record<string, unknown>): string {
  const parts: string[] = []
  for (const k of SUMMARY_KEYS) {
    const raw = args[k]
    if (raw === undefined) continue
    let v = typeof raw === 'string' ? raw : String(raw)
    if (v.length > 60) v = `${v.slice(0, 60)}…`
    parts.push(`${k}=${v}`)
  }
  return parts.join(' ')
}

/** Log an inbound control op so the user sees it in the debug log + perf timeline. */
export function logControlOp(op: WebControlOp, args: Record<string, unknown>): void {
  const summary = summarizeArgs(args)
  console.debug(`[web-control] ${op}${summary ? ` ${summary}` : ''}`)
}

/**
 * Turn anything thrown into a useful string. Critical for Safari: html-to-image
 * threw an `Event` whose String() was "[object Event]" -- useless. Extract a real
 * message from Error / DOM-event-like / plain objects.
 */
export function describeError(e: unknown): string {
  if (e instanceof Error) return e.message || e.name || 'error'
  if (typeof e === 'string') return e
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>
    if (typeof o.message === 'string' && o.message) return o.message
    if (typeof o.type === 'string' && o.type) return `event:${o.type}`
  }
  return String(e)
}
