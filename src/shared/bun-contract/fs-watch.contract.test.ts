/**
 * CONTRACT: fs.watch behavior -- the decider for dropping chokidar.
 *
 * transcript-watcher.ts uses chokidar + a 500ms poll to dodge a Bun macOS
 * fs.watch bug: "closing a file watcher and starting a new one on a different
 * file in the same directory causes events to silently stop" (triggered by
 * /clear + compaction minting new transcript JSONLs). Bun 1.3.14 rewrote the
 * fs.watch backend. These tests pin the behavior we'd need before swapping
 * chokidar for native fs.watch.
 *
 *  A) THE BUG: watch fileA, close, watch fileB in same dir -> does B still fire?
 *  B) MIGRATION TARGET: directory watch sees create + change for two files
 *     (the /clear scenario) -- the native replacement for chokidar dir-watch.
 *  C) BURSTY WRITES (informational): the watcher survives a write burst and
 *     still fires afterward -- informs whether the 500ms poll net can go.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { watch } from 'node:fs'
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sleep, waitFor } from './_helpers'

let dir = ''
const watchers: Array<{ close: () => void }> = []

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bun-fswatch-'))
})
afterEach(async () => {
  for (const w of watchers.splice(0)) {
    try {
      w.close()
    } catch {}
  }
  await rm(dir, { recursive: true, force: true })
})

describe('fs.watch contract', () => {
  test('A) file watcher: close one, open another in same dir -- new one still fires', async () => {
    const a = join(dir, 'a.jsonl')
    const b = join(dir, 'b.jsonl')
    await writeFile(a, '')
    await writeFile(b, '')

    let aHits = 0
    const w1 = watch(a, () => {
      aHits++
    })
    watchers.push(w1)
    await appendFile(a, 'one\n')
    await waitFor(() => aHits > 0, { label: 'fileA change' })

    // Close the first file watcher, then watch a DIFFERENT file in the SAME dir.
    w1.close()

    let bHits = 0
    const w2 = watch(b, () => {
      bHits++
    })
    watchers.push(w2)
    await sleep(50)
    await appendFile(b, 'two\n')

    // The bug: bHits stays 0. The fix: it fires.
    await waitFor(() => bHits > 0, { label: 'fileB change after re-watch in same dir' })
    expect(bHits).toBeGreaterThan(0)
  })

  test('B) directory watch: create + change for two files (the /clear scenario)', async () => {
    const seen = new Set<string>()
    const w = watch(dir, (_event, filename) => {
      if (filename) seen.add(String(filename))
    })
    watchers.push(w)
    await sleep(50)

    // First transcript.
    await writeFile(join(dir, 'first.jsonl'), '')
    await appendFile(join(dir, 'first.jsonl'), 'x\n')
    await waitFor(() => seen.has('first.jsonl'), { label: 'first.jsonl seen' })

    // /clear mints a second transcript in the SAME dir -- the dir watcher must
    // keep firing for it.
    await writeFile(join(dir, 'second.jsonl'), '')
    await appendFile(join(dir, 'second.jsonl'), 'y\n')
    await waitFor(() => seen.has('second.jsonl'), { label: 'second.jsonl seen after rotation' })

    expect(seen.has('first.jsonl')).toBe(true)
    expect(seen.has('second.jsonl')).toBe(true)
  })

  test('C) bursty writes: watcher survives a burst and still fires afterward (informational)', async () => {
    const f = join(dir, 'burst.jsonl')
    await writeFile(f, '')
    let hits = 0
    const w = watch(dir, (_e, filename) => {
      if (String(filename) === 'burst.jsonl') hits++
    })
    watchers.push(w)
    await sleep(50)

    for (let i = 0; i < 25; i++) await appendFile(f, `line ${i}\n`)
    // fs.watch coalesces -- we do NOT assert one-event-per-append (that is why
    // transcript-watcher.ts re-stats after each read). We assert the watcher is
    // alive: at least one event fired, and a later write still triggers one.
    await waitFor(() => hits > 0, { label: 'burst produced >=1 event' })
    const afterBurst = hits

    await sleep(100)
    await appendFile(f, 'final\n')
    await waitFor(() => hits > afterBurst, { label: 'post-burst write still fires' })
    expect(hits).toBeGreaterThan(afterBurst)
  })
})
