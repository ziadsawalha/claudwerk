/**
 * THE DIALOGUE (D1c) — authority gate for inbound dialog_event.
 *
 * Security must-fixes (plan-the-dialogue.md R2):
 *  - NEW `dialog:interact` permission, OFF by default for shares. Crucially we
 *    do NOT use ctx.requirePermission here: it BYPASSES every non-control-panel
 *    connection (`if (!ws.data.isControlPanel) return`), so a share viewer would
 *    slip through. We resolve grants EXPLICITLY so shares are gated. Shares
 *    always carry synthetic grants (never the no-grants=trusted branch).
 *  - dialogId<->conversationId binding + open-only + handlerId sanity.
 *  - single-interactor lock (first-wins): later principals are read-only.
 *  - byte cap on the event state payload.
 * Never branches on the opaque snapshot payload beyond its `status` enum.
 */

import { withinEventStateCap } from './dialog-live-store'
import type { WsData } from './handler-context'
import { resolvePermissions, type UserGrant } from './permissions'

export type DialogEventReject =
  | 'permission'
  | 'no_dialog'
  | 'wrong_dialog'
  | 'not_open'
  | 'bad_handler'
  | 'too_large'
  | 'locked'

export type GuardResult = { ok: true; principal: string } | { ok: false; reason: DialogEventReject }

/** Reserved handler ids allowed despite the leading-underscore namespace. */
const RESERVED_HANDLER_IDS = new Set(['__close__', '__submit__'])

/** Stable principal id for the single-interactor lock. */
export function dialogPrincipal(data: WsData): string {
  if (data.userName) return data.userName
  if (data.shareToken) return `share:${data.shareToken.slice(0, 8)}`
  return 'bearer'
}

/**
 * Holds `dialog:interact` for `project`? Unlike ctx.requirePermission this also
 * gates shares (they are not control-panel connections). A connection with no
 * grants is a trusted bearer/legacy-admin link — but a share ALWAYS has grants,
 * so it can never reach that branch.
 */
export function hasDialogInteract(data: WsData, project: string): boolean {
  const grants = data.grants as UserGrant[] | undefined
  if (!grants) return !data.isShare
  const { permissions, isAdmin } = resolvePermissions(grants, project)
  return isAdmin || permissions.has('dialog:interact')
}

function validHandlerId(handlerId: unknown): boolean {
  if (typeof handlerId !== 'string' || handlerId === '') return false
  if (!handlerId.startsWith('_')) return true
  return RESERVED_HANDLER_IDS.has(handlerId)
}

export interface GuardInput {
  data: WsData
  project: string
  liveDialog: { dialogId: string; snapshot: { status: string }; interactor?: string } | undefined
  dialogId: unknown
  handlerId: unknown
  state: unknown
}

/** Authorize one dialog_event. Returns the resolved principal on success so the
 *  caller can claim/enforce the single-interactor lock. */
export function guardDialogEvent(input: GuardInput): GuardResult {
  const { data, project, liveDialog, dialogId, handlerId, state } = input
  if (!hasDialogInteract(data, project)) return { ok: false, reason: 'permission' }
  if (!liveDialog) return { ok: false, reason: 'no_dialog' }
  if (typeof dialogId !== 'string' || dialogId !== liveDialog.dialogId) return { ok: false, reason: 'wrong_dialog' }
  if (liveDialog.snapshot.status !== 'open') return { ok: false, reason: 'not_open' }
  if (!validHandlerId(handlerId)) return { ok: false, reason: 'bad_handler' }
  if (!withinEventStateCap(state)) return { ok: false, reason: 'too_large' }
  const principal = dialogPrincipal(data)
  if (liveDialog.interactor && liveDialog.interactor !== principal) return { ok: false, reason: 'locked' }
  return { ok: true, principal }
}
