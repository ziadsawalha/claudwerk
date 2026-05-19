/**
 * Transcript Bridge
 *
 * Watches the JSONL transcript file written by a Claude Code daemon worker
 * and forwards translated entries to the broker via HostTransport.
 *
 * JSONL path rule:
 *   ~/.claude/projects/<slug>/<ccSessionId>.jsonl
 *   where slug = the REAL path of cwd (symlinks resolved) with all '/', '.',
 *   and '_' replaced by '-'. CC slugs the resolved path -- e.g. on macOS a
 *   cwd under /var/folders/... lands under -private-var-folders-... because
 *   /var is a symlink to /private/var. Deriving the slug from the raw cwd
 *   would miss the JSONL entirely whenever cwd has a symlinked component.
 *
 * Example: cwd = /Users/jonas/.claude
 *   slug  = -Users-jonas--claude   (leading '-' is kept -- CC keeps it too)
 *   path  = ~/.claude/projects/-Users-jonas--claude/<ccSessionId>.jsonl
 *
 * On /clear the daemon worker's ccSessionId rotates. Call watch() again with
 * the new ccSessionId -- the bridge stops the old watcher, clears the
 * tool-name map, and starts fresh on the new file.
 */

import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { translateClaudeToolResult, translateClaudeToolUse } from '../claude-agent-host/dialect/from-claude'
import { createTranscriptWatcher, type TranscriptWatcher } from '../claude-agent-host/transcript-watcher'
import type { HostTransport } from '../shared/host-transport'
import type { TranscriptContentBlock, TranscriptEntry } from '../shared/protocol'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TranscriptBridgeOptions {
  transport: HostTransport
  onError?: (err: Error) => void
  debug?: (msg: string) => void
}

export interface TranscriptBridge {
  /** Start (or re-point) the JSONL watcher for a ccSessionId. Safe to call
   *  repeatedly: on /clear the worker's ccSessionId rotates and this
   *  re-points at the new file. */
  watch(ccSessionId: string, cwd: string): Promise<void>
  /** Re-read the whole current transcript file and re-send it as the initial
   *  batch. No-op if no watcher is running. */
  resend(): Promise<void>
  /** Stop watching. Idempotent. */
  stop(): void
}

// ---------------------------------------------------------------------------
// Implementation helpers
// ---------------------------------------------------------------------------

/** Translate tool_use / tool_result blocks in place before forwarding. */
function translateBlocks(entries: TranscriptEntry[], toolNameByUseId: Map<string, string>): void {
  for (const entry of entries) {
    const msg = (entry as { message?: { content?: unknown[] } }).message
    if (!Array.isArray(msg?.content)) continue
    if (entry.type === 'assistant') {
      for (const block of msg.content as TranscriptContentBlock[]) {
        if (block.type !== 'tool_use') continue
        translateClaudeToolUse(block)
        const useId = block.id ?? ''
        const name = block.name ?? ''
        if (useId && name) toolNameByUseId.set(useId, name)
      }
    } else if (entry.type === 'user') {
      const tur = (entry as Record<string, unknown>).toolUseResult
      for (const block of msg.content as TranscriptContentBlock[]) {
        if (block.type !== 'tool_result') continue
        translateClaudeToolResult(block, tur, toolNameByUseId)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createTranscriptBridge(opts: TranscriptBridgeOptions): TranscriptBridge {
  const { transport, onError, debug } = opts

  let watcher: TranscriptWatcher | null = null
  let stopped = false
  // One map per session -- cleared on each watch() re-point.
  const toolNameByUseId = new Map<string, string>()

  async function watch(ccSessionId: string, cwd: string): Promise<void> {
    if (stopped) return
    // Stop any existing watcher and reset session-scoped state.
    if (watcher) {
      watcher.stop()
      watcher = null
    }
    toolNameByUseId.clear()

    // CC slugs the REAL path of cwd (symlinks resolved). Match it, or the
    // JSONL path misses whenever cwd has a symlinked component.
    let realCwd = cwd
    try {
      realCwd = realpathSync(cwd)
    } catch {
      // cwd does not exist on this host -- fall back to the path as given.
    }
    const slug = realCwd.replace(/[/._]/g, '-')
    const path = join(homedir(), '.claude', 'projects', slug, `${ccSessionId}.jsonl`)
    debug?.(`watch: pointing at ${path}`)

    watcher = createTranscriptWatcher({
      onEntries(entries, isInitial) {
        if (stopped) return
        translateBlocks(entries, toolNameByUseId)
        transport.sendTranscriptEntries(entries, isInitial)
      },
      onError(err) {
        onError?.(err)
      },
      debug,
    })

    await watcher.start(path)
  }

  async function resend(): Promise<void> {
    if (!watcher) return
    await watcher.resend()
  }

  function stop(): void {
    stopped = true
    if (watcher) {
      watcher.stop()
      watcher = null
    }
  }

  return { watch, resend, stop }
}
