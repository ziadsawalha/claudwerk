/**
 * THE DIALOGUE — host-authoritative open-dialog registry.
 *
 * Every persistent dialog the agent creates lives here as a {layout, state, seq,
 * status} snapshot. The HOST owns this snapshot (red/blue-team resolution
 * R1#5/#6, R3#9): it applies ops, bumps the monotonic seq, and is the single
 * source of truth. The broker only persists the blob opaquely and replays it —
 * it never interprets layout/state/ops.
 *
 * D1b owns the outbound half (the tools mutate this registry, the host emits the
 * resulting snapshot). Inbound submit/event delivery, broker persistence, and
 * reconnect replay land in D1c/D2 and consume the same snapshot shape.
 */

import type { DialogOp, DialogSnapshot } from '../../shared/dialog-live'
import { applyDialogOps, type OpConflict } from '../../shared/dialog-ops'
import type { DialogLayout } from '../../shared/dialog-schema'

export type ApplyOpsResult =
  | { ok: true; snapshot: DialogSnapshot; conflicts: OpConflict[] }
  | { ok: false; reason: 'unknown' | 'closed' | 'orphaned' | 'stale'; currentSeq?: number }

export type LifecycleResult =
  | { ok: true; snapshot: DialogSnapshot }
  | { ok: false; reason: 'unknown' | 'open' | 'closed' | 'orphaned' }

export class OpenDialogRegistry {
  private dialogs = new Map<string, DialogSnapshot>()

  /** Track a freshly-shown persistent dialog at seq 0 / status open. */
  register(dialogId: string, layout: DialogLayout, initialState: Record<string, unknown> = {}): DialogSnapshot {
    const snapshot: DialogSnapshot = { dialogId, layout, state: { ...initialState }, seq: 0, status: 'open' }
    this.dialogs.set(dialogId, snapshot)
    return snapshot
  }

  get(dialogId: string): DialogSnapshot | undefined {
    return this.dialogs.get(dialogId)
  }

  has(dialogId: string): boolean {
    return this.dialogs.has(dialogId)
  }

  /** Currently-open snapshots (used by reset-channel orphaning + reconnect). */
  openSnapshots(): DialogSnapshot[] {
    return [...this.dialogs.values()].filter(d => d.status === 'open')
  }

  /**
   * Apply ops to a dialog. Rejects (never silently) when the dialog is unknown,
   * not open, or the agent's `baseSeq` is behind the authoritative seq. On
   * success bumps seq by one and returns the new snapshot + per-op conflicts.
   */
  applyOps(dialogId: string, ops: DialogOp[], baseSeq?: number): ApplyOpsResult {
    const cur = this.dialogs.get(dialogId)
    if (!cur) return { ok: false, reason: 'unknown' }
    if (cur.status !== 'open') return { ok: false, reason: cur.status, currentSeq: cur.seq }
    if (baseSeq !== undefined && baseSeq < cur.seq) return { ok: false, reason: 'stale', currentSeq: cur.seq }

    const r = applyDialogOps(cur, ops)
    const next: DialogSnapshot = {
      dialogId,
      layout: r.layout,
      state: r.state,
      seq: cur.seq + 1,
      status: r.status,
    }
    this.dialogs.set(dialogId, next)
    return { ok: true, snapshot: next, conflicts: r.conflicts }
  }

  /** Mark a dialog closed (terminal but reopenable; record retained). */
  close(dialogId: string): LifecycleResult {
    const cur = this.dialogs.get(dialogId)
    if (!cur) return { ok: false, reason: 'unknown' }
    if (cur.status !== 'open') return { ok: false, reason: cur.status }
    const next: DialogSnapshot = { ...cur, seq: cur.seq + 1, status: 'closed' }
    this.dialogs.set(dialogId, next)
    return { ok: true, snapshot: next }
  }

  /** Reopen a closed dialog into its persisted live state. */
  reopen(dialogId: string): LifecycleResult {
    const cur = this.dialogs.get(dialogId)
    if (!cur) return { ok: false, reason: 'unknown' }
    if (cur.status === 'open') return { ok: false, reason: 'open' }
    if (cur.status === 'orphaned') return { ok: false, reason: 'orphaned' }
    const next: DialogSnapshot = { ...cur, seq: cur.seq + 1, status: 'open' }
    this.dialogs.set(dialogId, next)
    return { ok: true, snapshot: next }
  }

  /**
   * Orphan a dialog (agent gone — /clear, conversation end). The host stops
   * tracking it; the broker keeps the last blob as a read-only record. Returns
   * the orphaned snapshot for the emit, or undefined if it wasn't tracked.
   */
  orphan(dialogId: string): DialogSnapshot | undefined {
    const cur = this.dialogs.get(dialogId)
    if (!cur) return undefined
    this.dialogs.delete(dialogId)
    return { ...cur, seq: cur.seq + 1, status: 'orphaned' }
  }
}
