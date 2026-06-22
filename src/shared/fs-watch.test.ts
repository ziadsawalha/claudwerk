/**
 * Tests for the native fs.watch helper (chokidar replacement).
 *
 * NOTE: macOS FSEvents (and chokidar before it) coalesces/drops watch events
 * under bursty writes -- a single write is NOT guaranteed to yield one event.
 * That is why every production site pairs watchTree with a poll floor + a
 * full-re-read handler. These tests mirror that reality: event-arrival
 * assertions RETRY the trigger until observed, rather than asserting 1:1.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type TreeWatcher, watchTree } from './fs-watch'

let dir = ''
const open: TreeWatcher[] = []
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** Repeat `action` every 150ms until `done()` is true, or fail after `ms`. */
const retryUntil = async (action: () => Promise<unknown>, done: () => boolean, ms = 5000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (done()) return
    await action()
    await sleep(150)
  }
  throw new Error('retryUntil timed out')
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fswatch-helper-'))
})
afterEach(async () => {
  for (const w of open.splice(0)) w.close()
  await sleep(50) // let FSEvents release the path before the next test churns
  await rm(dir, { recursive: true, force: true })
})

describe('watchTree', () => {
  test('classifies change, add, and unlink', async () => {
    const events: Array<[string, string]> = []
    const got = (e: string, pred: (n: string) => boolean) => events.some(([ee, n]) => ee === e && pred(n))
    await writeFile(join(dir, 'a.txt'), 'init')
    open.push(watchTree({ dir, onEvent: (e, p) => events.push([e, p.split('/').pop() ?? '']) }))
    await sleep(50)

    // change: pre-existing file appended -> 'change' (not a spurious 'add').
    await retryUntil(
      () => appendFile(join(dir, 'a.txt'), 'x'),
      () => got('change', n => n === 'a.txt'),
    )
    // add: a brand-new file -> 'add'. Fresh name each retry so a dropped event retries cleanly.
    let k = 0
    await retryUntil(
      () => writeFile(join(dir, `b${k++}.txt`), 'n'),
      () => got('add', n => /^b\d+\.txt$/.test(n)),
    )
    // unlink: removing a known file -> 'unlink'. Create-then-remove a fresh name each retry.
    let j = 0
    await retryUntil(
      async () => {
        const f = join(dir, `u${j++}.txt`)
        await writeFile(f, '1')
        await sleep(60)
        await rm(f, { force: true })
      },
      () => got('unlink', n => /^u\d+\.txt$/.test(n)),
    )
  })

  test('filter excludes non-matching files', async () => {
    const seen = new Set<string>()
    open.push(
      watchTree({ dir, filter: abs => abs.endsWith('.json'), onEvent: (_e, p) => seen.add(p.split('/').pop() ?? '') }),
    )
    await sleep(50)
    let k = 0
    await retryUntil(
      async () => {
        await writeFile(join(dir, `keep${k}.json`), '{}')
        await writeFile(join(dir, `skip${k++}.md`), '#')
      },
      () => [...seen].some(n => n.startsWith('keep')),
    )
    expect([...seen].some(n => n.endsWith('.md'))).toBe(false)
  })

  test('emitInitial fires add for pre-existing files', async () => {
    await writeFile(join(dir, 'pre1.json'), '1')
    await writeFile(join(dir, 'pre2.json'), '2')
    const adds: string[] = []
    open.push(
      watchTree({
        dir,
        emitInitial: true,
        filter: abs => abs.endsWith('.json'),
        onEvent: (e, p) => {
          if (e === 'add') adds.push(p.split('/').pop() ?? '')
        },
      }),
    )
    // Initial scan is synchronous on construction -- no retry needed.
    expect(adds).toContain('pre1.json')
    expect(adds).toContain('pre2.json')
  })

  test('debounce coalesces a write burst into few events', async () => {
    let count = 0
    const f = join(dir, 'burst.txt')
    await writeFile(f, '')
    open.push(watchTree({ dir, debounceMs: 120, onEvent: () => count++ }))
    await sleep(50)
    for (let i = 0; i < 15; i++) await appendFile(f, `${i}\n`)
    await retryUntil(
      () => appendFile(f, 'x\n'),
      () => count >= 1,
    )
    await sleep(250)
    expect(count).toBeLessThanOrEqual(4) // bursts collapse, nowhere near 15
  })

  test('recursive + depth tracks files in newly-created subdirs', async () => {
    const seen = new Set<string>()
    open.push(
      watchTree({
        dir,
        recursive: true,
        depth: 2,
        filter: abs => abs.endsWith('.md'),
        onEvent: (_e, p) => seen.add(p.split('/').slice(-2).join('/')),
      }),
    )
    await sleep(50)
    await mkdir(join(dir, 'a', 'b'), { recursive: true })
    let k = 0
    await retryUntil(
      () => writeFile(join(dir, 'a', 'b', `deep${k++}.md`), '#'),
      () => [...seen].some(s => /b\/deep\d+\.md$/.test(s)),
    )
  })
})
