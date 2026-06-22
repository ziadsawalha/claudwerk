/**
 * Native fs.watch helper -- the chokidar replacement.
 *
 * Bun 1.3.14 rewrote the fs.watch backend (FSEvents-direct on macOS, fixed
 * Linux delete/recreate + recursive new-subdir tracking), fixing the macOS bug
 * that originally forced us onto chokidar. This covers the fleet's watch needs
 * in one place: directory watching, optional recursion + depth cap, a path
 * filter, an optional initial scan (chokidar `ignoreInitial: false`), and an
 * optional per-path debounce (chokidar `awaitWriteFinish`). Emits unified
 * add | change | unlink events with absolute paths.
 *
 * IF FILESYSTEM MONITORING REGRESSES (transcripts/tasks/board/roster not
 * updating), SUSPECT THIS FILE FIRST -- see memory project_fswatch_chokidar_removal.
 */

import { type Dirent, existsSync, type FSWatcher, watch as nativeWatch, readdirSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

export type WatchEventType = 'add' | 'change' | 'unlink'

export interface WatchTreeOptions {
  /** Directory to watch. Must exist (callers with a poll floor degrade gracefully if not). */
  dir: string
  /** Recurse into subdirectories. Default false. */
  recursive?: boolean
  /** Max directory depth below `dir` to report (0 = direct children only). Default: unlimited. */
  depth?: number
  /** Only emit for absolute paths passing this predicate. Default: all files. */
  filter?: (absPath: string) => boolean
  /** Emit a synthetic 'add' for each pre-existing matching file at start. Default false. */
  emitInitial?: boolean
  /** Coalesce events per path: fire `debounceMs` after the last event for that path. 0 = immediate. */
  debounceMs?: number
  onEvent: (event: WatchEventType, absPath: string) => void
  onError?: (err: Error) => void
}

export interface TreeWatcher {
  close: () => void
}

export function watchTree(opts: WatchTreeOptions): TreeWatcher {
  const { dir, recursive = false, depth, filter, emitInitial = false, debounceMs = 0, onEvent, onError } = opts
  const root = resolve(dir)
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  // Paths we've emitted 'add' for. Used to classify add/change/unlink by
  // EXISTENCE rather than the native eventType, which macOS FSEvents fuzzes
  // ('rename' vs 'change' are not reliable -- a plain append can arrive as
  // 'rename'). Existence-based classification is what chokidar does internally.
  const seen = new Set<string>()
  let closed = false

  const passes = (abs: string): boolean => {
    if (depth !== undefined) {
      const rel = relative(root, abs)
      if (!rel || rel.startsWith('..')) return false
      if (rel.split(sep).length - 1 > depth) return false
    }
    return !filter || filter(abs)
  }

  const emit = (event: WatchEventType, abs: string): void => {
    if (closed) return
    if (debounceMs > 0) {
      const prev = timers.get(abs)
      if (prev) clearTimeout(prev)
      timers.set(
        abs,
        setTimeout(() => {
          timers.delete(abs)
          if (!closed) onEvent(event, abs)
        }, debounceMs),
      )
    } else {
      onEvent(event, abs)
    }
  }

  // Seed `seen` with pre-existing files so the first event on one is classified
  // as 'change'/'unlink', not a spurious 'add' (chokidar tracks existing files
  // even when ignoreInitial suppresses their events). emitInitial additionally
  // emits a synthetic 'add' for each.
  if (existsSync(root)) {
    for (const abs of walk(root, recursive, depth)) {
      if (!passes(abs)) continue
      seen.add(abs)
      if (emitInitial) emit('add', abs)
    }
  }

  let watcher: FSWatcher
  try {
    watcher = nativeWatch(root, { recursive })
  } catch (err) {
    onError?.(err instanceof Error ? err : new Error(String(err)))
    return { close() {} }
  }

  watcher.on('change', (_eventType, filename) => {
    if (closed || filename == null) return
    const name = typeof filename === 'string' ? filename : filename.toString()
    const abs = resolve(root, name)
    if (!passes(abs)) return
    // Classify by existence + whether we've seen it (eventType is unreliable on macOS).
    if (!existsSync(abs)) {
      if (seen.delete(abs)) emit('unlink', abs)
    } else if (seen.has(abs)) {
      emit('change', abs)
    } else {
      seen.add(abs)
      emit('add', abs)
    }
  })
  watcher.on('error', err => onError?.(err instanceof Error ? err : new Error(String(err))))

  return {
    close() {
      closed = true
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
      try {
        watcher.close()
      } catch {}
    },
  }
}

/** Yield absolute file paths under `dir`, descending up to `depth` dir levels when recursive. */
function* walk(dir: string, recursive: boolean, depth: number | undefined, cur = 0): Generator<string> {
  let entries: Dirent<string>[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const abs = resolve(dir, e.name)
    if (e.isDirectory()) {
      if (recursive && (depth === undefined || cur < depth)) yield* walk(abs, recursive, depth, cur + 1)
    } else {
      yield abs
    }
  }
}
