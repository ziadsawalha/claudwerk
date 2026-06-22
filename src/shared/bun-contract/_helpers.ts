/**
 * Shared helpers for the Bun runtime contract suite.
 *
 * Not a *.test.ts file, so the bun test runner ignores it.
 */

/** Resolve once `predicate()` is truthy, polling every `intervalMs`. Rejects on timeout. */
export async function waitFor(
  predicate: () => boolean,
  {
    timeoutMs = 5000,
    intervalMs = 20,
    label = 'condition',
  }: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await sleep(intervalMs)
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms waiting for: ${label}`)
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

/**
 * Pump a ReadableStream of bytes into a growing string. Returns a live `read()`
 * accessor + a `done` promise. Used to observe a subprocess's piped stdout the
 * way stream-backend.ts does (getReader + TextDecoder).
 */
export function pumpToString(stream: ReadableStream<Uint8Array>): { read: () => string; done: Promise<void> } {
  const reader = stream.getReader()
  const dec = new TextDecoder()
  let acc = ''
  const done = (async () => {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      acc += dec.decode(value, { stream: true })
    }
  })()
  return { read: () => acc, done }
}
