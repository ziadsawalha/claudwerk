/**
 * cwd-change signal (agent-host side of the backend-agnostic `cwd_changed`
 * protocol message).
 *
 * The agent host owns translating CC's native cwd notions into ONE canonical
 * `cwd_changed { conversationId, cwd }` wire message. Two sources feed it:
 *   - CC's `CwdChanged` hook (handled in hook-processor.ts), and
 *   - `EnterWorktree` / `ExitWorktree` tool results (detected here -- CC
 *     attaches the resolved path to the result's `toolUseResult` sidecar).
 *
 * `emitCwdChanged` is the single chokepoint both call: it dedups and sends the
 * canonical message. The broker reads only `cwd` and never parses a CC payload
 * -- same boundary tool-vocab enforces for tools.
 *
 * `conversation.project` (the project identity URI) is deliberately left
 * untouched -- worktrees belong to their parent project. The live "working in
 * directory X" signal is `currentPath`, which `cwd_changed` populates.
 */

import type { CwdChangedMessage, TranscriptContentBlock, TranscriptEntry } from '../shared/protocol'
import type { AgentHostContext } from './agent-host-context'

const WORKTREE_TOOLS = new Set(['EnterWorktree', 'ExitWorktree'])

/**
 * Emit the canonical, backend-agnostic `cwd_changed` message. Dedups against
 * the last emitted cwd so repeated/replayed signals (or both feeds firing for
 * the same move) don't re-send. Shared by the CwdChanged hook path and the
 * worktree-tool path. No-ops when cwd is empty/unchanged or the WS is down.
 */
export function emitCwdChanged(ctx: AgentHostContext, cwd: string | undefined): void {
  if (!cwd || cwd === ctx.lastEmittedCwd) return
  const prev = ctx.lastEmittedCwd ?? ctx.cwd
  ctx.lastEmittedCwd = cwd
  const msg: CwdChangedMessage = { type: 'cwd_changed', conversationId: ctx.conversationId, cwd }
  ctx.wsClient?.send(msg)
  ctx.debug(`[cwd] ${prev} -> ${cwd} (conv=${ctx.conversationId.slice(0, 8)}) emitted cwd_changed`)
}
const PATH_KEYS = ['worktreePath', 'cwd', 'path'] as const

/** Pull the resolved worktree path out of a translated tool_result block's
 *  origin payload. CC attaches `{ worktreePath, message }` to the
 *  `toolUseResult` sidecar; the human message is parsed as a fallback. */
// fallow-ignore-next-line complexity
function worktreePathFromResult(block: TranscriptContentBlock): string | undefined {
  const tur = (block.raw as { toolUseResult?: unknown } | undefined)?.toolUseResult as
    | Record<string, unknown>
    | undefined
  for (const key of PATH_KEYS) {
    const v = tur?.[key]
    if (typeof v === 'string' && v) return v
  }
  const msg = typeof tur?.message === 'string' ? tur.message : ''
  return msg.match(/worktree at (\/\S+?)\.?(?:\s|$)/)?.[1]
}

/** The cwd a single block moves CC to, or undefined if it's not a (successful)
 *  worktree enter/exit. Enter -> resolved worktree path; Exit -> the boot cwd. */
// fallow-ignore-next-line complexity
function cwdFromBlock(ctx: AgentHostContext, block: TranscriptContentBlock): string | undefined {
  if (block.type !== 'tool_result' || block.is_error) return undefined
  const toolName = (block.raw as { name?: string } | undefined)?.name
  if (!toolName || !WORKTREE_TOOLS.has(toolName)) return undefined
  return toolName === 'ExitWorktree' ? ctx.cwd : worktreePathFromResult(block)
}

/** Last worktree-move cwd in a batch (later wins), or undefined if none. */
// fallow-ignore-next-line complexity
function scanWorktreeCwd(ctx: AgentHostContext, entries: TranscriptEntry[]): string | undefined {
  let nextCwd: string | undefined
  for (const entry of entries) {
    if (entry.type !== 'user') continue
    const content = (entry as { message?: { content?: unknown } }).message?.content
    if (!Array.isArray(content)) continue
    for (const block of content as TranscriptContentBlock[]) {
      const cwd = cwdFromBlock(ctx, block)
      if (cwd) nextCwd = cwd
    }
  }
  return nextCwd
}

/**
 * Scan a LIVE (non-replay, parent) batch of dialect-translated entries for the
 * most recent worktree enter/exit and emit a canonical `cwd_changed` for it.
 * Returns the emitted cwd (or undefined when nothing changed) -- handy for tests.
 *
 * MUST be called AFTER `translateClaudeBlocks` so `block.raw.name` (the source
 * tool) and `block.raw.toolUseResult` are populated.
 */
export function detectWorktreeCwd(ctx: AgentHostContext, entries: TranscriptEntry[]): string | undefined {
  const nextCwd = scanWorktreeCwd(ctx, entries)
  if (!nextCwd || nextCwd === ctx.lastEmittedCwd) return undefined
  emitCwdChanged(ctx, nextCwd)
  return nextCwd
}
