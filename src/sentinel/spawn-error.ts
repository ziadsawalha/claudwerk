/**
 * spawn-error -- helpers for capturing host stderr and CC headless logs so
 * SpawnFailed messages carry the actual cause instead of a generic
 * "exit 1 in 1s -- likely hook/config issue".
 *
 * All exports here are pure (no globals, no top-level I/O) so they unit-test
 * cleanly without launching a real process.
 *
 * See `SpawnFailed.stderrTail` / `hookStage` in src/shared/protocol.ts for
 * the wire-side contract.
 */

import { readFileSync, statSync } from 'node:fs'

/** Fixed-capacity ring of strings. push(line) drops the oldest when full. */
export class RingBuffer<T> {
  private buf: T[] = []
  constructor(private readonly capacity: number) {
    if (capacity <= 0) throw new Error('RingBuffer capacity must be > 0')
  }
  push(item: T): void {
    this.buf.push(item)
    if (this.buf.length > this.capacity) this.buf.shift()
  }
  /** Copy of current contents, oldest first. */
  snapshot(): T[] {
    return this.buf.slice()
  }
  get size(): number {
    return this.buf.length
  }
}

/**
 * Parse a CC hook-stage from the tail of stderr / headless-ndjsonl output.
 *
 * CC's headless mode writes errors like:
 *   `ERR Error creating worktree: WorktreeCreate hook failed: bash "...": ...`
 *   `ERR Error during PostToolUse hook: ...`
 *
 * We capture the hook name so the wire message can say `hookStage:
 * "WorktreeCreate"` instead of forcing the dashboard to regex the tail.
 *
 * Returns the first match found (most recent error usually wins because tails
 * are short). Returns `claude-launch` when there's an ERR line but no
 * recognizable hook -- distinguishes "CC ran but a hook crashed" from
 * "CC itself failed to start".
 */
export function parseHookStage(lines: string[]): string | undefined {
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    // `WorktreeCreate hook failed`, `SessionStart hook failed`, etc.
    const hookMatch = line.match(/\b([A-Z][A-Za-z]+)\s+hook\s+failed\b/)
    if (hookMatch) return hookMatch[1]
    // `during PostToolUse hook` / `during the SessionStart hook`
    const duringMatch = line.match(/\bduring\s+(?:the\s+)?([A-Z][A-Za-z]+)\s+hook\b/)
    if (duringMatch) return duringMatch[1]
  }
  for (const raw of lines) {
    if (/^ERR\b/.test(raw.trim())) return 'claude-launch'
  }
  return undefined
}

/**
 * Tail the last N meaningful lines of CC's headless-ndjsonl log.
 *
 * CC writes one stream event per line; lines starting with `#` are file
 * banners we skip. On early-failure the last meaningful line is usually
 * either a textual `ERR ...` (hook crash) or a `{"type":"result",...}`
 * payload with an `errors:` array.
 *
 * Bounded read: caps file size at 256KB to avoid pathological tails.
 * Returns [] when the file doesn't exist or can't be read -- never throws.
 */
export function tailHeadlessNdjson(path: string, maxLines: number): string[] {
  try {
    const st = statSync(path)
    if (st.size === 0) return []
    const buf = readFileSync(path, 'utf8')
    const tail = buf.length > 256 * 1024 ? buf.slice(buf.length - 256 * 1024) : buf
    const lines = tail.split('\n')
    const out: string[] = []
    for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
      const line = lines[i].trim()
      if (!line) continue
      if (line.startsWith('#')) continue
      out.push(line)
    }
    return out.reverse()
  } catch {
    return []
  }
}

/** Path to CC's per-conversation headless log written by the agent host. */
export function headlessNdjsonPath(cwd: string, conversationId: string): string {
  return `${cwd}/.rclaude/settings/headless-${conversationId}.ndjsonl`
}
