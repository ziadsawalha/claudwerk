/**
 * Map a permission-gate decision to the numbered choice string the Claude Code
 * daemon worker's PTY-driven permission menu accepts as a `reply()` payload.
 *
 * CC's tool-permission prompt is rendered as a numbered menu inside the PTY:
 *   1. Allow once
 *   2. Allow for this session ("Always allow" on some tools)
 *   3. Cancel / Deny
 *
 * The daemon has no typed `permission-response` op in 2.1.150 (the schema entry
 * is a stub; see plan-daemon-launch-ux.md Section 8 spike 5/6). The verified
 * path is `reply(short, "<number>")` -- the worker resolves the active gate
 * when it sees text on the rendezvous socket. There is no requestId
 * correlation: the next text typed IS the answer.
 *
 * `PermissionResponse.behavior` on the wire is currently `'allow' | 'deny'`
 * only -- "allow_session" is not surfaced. If we add it later, mapping is "2".
 */
export type PermissionDecision = 'allow' | 'allow_session' | 'deny'

export function permissionDecisionToText(decision: PermissionDecision): '1' | '2' | '3' {
  switch (decision) {
    case 'allow':
      return '1'
    case 'allow_session':
      return '2'
    case 'deny':
      return '3'
  }
}
