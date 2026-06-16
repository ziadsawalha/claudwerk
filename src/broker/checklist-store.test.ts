import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  closeChecklistStore,
  createItems,
  deleteItem,
  initChecklistStore,
  listArchive,
  listOpen,
  purgeResolved,
  replaceAll,
  setStatus,
  updateText,
} from './checklist-store'

const P = 'claude://default/Users/x/proj'
const Q = 'claude://default/Users/x/other'
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checklist-test-'))
  initChecklistStore(dir)
})

afterEach(() => {
  closeChecklistStore()
  rmSync(dir, { recursive: true, force: true })
})

test('create + listOpen: open items, oldest first, blanks skipped', () => {
  const n = createItems(P, [{ text: 'first' }, { text: '   ' }, { text: 'second' }])
  expect(n).toBe(2)
  const open = listOpen(P)
  expect(open.map(i => i.text)).toEqual(['first', 'second'])
  expect(open[0].resolvedAt).toBeNull()
})

test('create with status=done lands in archive, not open', () => {
  createItems(P, [{ text: 'done already', status: 'done' }, { text: 'todo' }])
  expect(listOpen(P).map(i => i.text)).toEqual(['todo'])
  const arch = listArchive(P)
  expect(arch.map(i => i.text)).toEqual(['done already'])
  expect(arch[0].resolvedAt).toBeGreaterThan(0)
})

test('in_progress items stay active (shown inline), not archived', () => {
  createItems(P, [{ text: 'wip', status: 'in_progress' }, { text: 'plain' }])
  const open = listOpen(P)
  expect(open.map(i => i.text)).toEqual(['wip', 'plain'])
  expect(open.find(i => i.text === 'wip')?.status).toBe('in_progress')
  expect(listArchive(P)).toHaveLength(0)
})

test('setStatus moves open -> in_progress -> done -> open', () => {
  createItems(P, [{ text: 'task' }])
  const id = listOpen(P)[0].id
  setStatus(P, id, 'in_progress')
  expect(listOpen(P)[0].status).toBe('in_progress')
  expect(listOpen(P)[0].resolvedAt).toBeNull()
  setStatus(P, id, 'done')
  expect(listOpen(P)).toHaveLength(0)
  expect(listArchive(P)[0].resolvedAt).toBeGreaterThan(0)
  setStatus(P, id, 'open')
  expect(listOpen(P)).toHaveLength(1)
  expect(listArchive(P)).toHaveLength(0)
})

test('replaceAll wipes + reinserts, honoring supplied dates', () => {
  createItems(P, [{ text: 'old one' }, { text: 'old two' }])
  const n = replaceAll(P, [
    { text: 'fresh open' },
    { text: 'fresh wip', status: 'in_progress' },
    { text: 'fresh done', status: 'done', createdAt: 1000, resolvedAt: 2000 },
  ])
  expect(n).toBe(3)
  expect(listOpen(P).map(i => i.text)).toEqual(['fresh open', 'fresh wip'])
  const arch = listArchive(P)
  expect(arch).toHaveLength(1)
  expect(arch[0].createdAt).toBe(1000)
  expect(arch[0].resolvedAt).toBe(2000)
})

test('updateText edits raw text', () => {
  createItems(P, [{ text: 'old' }])
  const id = listOpen(P)[0].id
  updateText(P, id, '  new  ')
  expect(listOpen(P)[0].text).toBe('new')
})

test('delete removes an item', () => {
  createItems(P, [{ text: 'gone' }])
  const id = listOpen(P)[0].id
  deleteItem(P, id)
  expect(listOpen(P)).toHaveLength(0)
})

test('project scoping is isolated', () => {
  createItems(P, [{ text: 'mine' }])
  createItems(Q, [{ text: 'theirs' }])
  expect(listOpen(P).map(i => i.text)).toEqual(['mine'])
  expect(listOpen(Q).map(i => i.text)).toEqual(['theirs'])
})

test('mutations are scoped: wrong project cannot touch an item', () => {
  createItems(P, [{ text: 'protected' }])
  const id = listOpen(P)[0].id
  setStatus(Q, id, 'done')
  deleteItem(Q, id)
  updateText(Q, id, 'hacked')
  const open = listOpen(P)
  expect(open).toHaveLength(1)
  expect(open[0].text).toBe('protected')
})

test('purgeResolved deletes only old resolved items', () => {
  createItems(P, [{ text: 'open one' }, { text: 'recent done', status: 'done' }])
  // An item resolved "long ago": create open, then backdate via toggle is now-stamped,
  // so instead assert recent resolved survives a 30d purge and nothing open is touched.
  const purged = purgeResolved(P, Date.now() - 30 * 24 * 60 * 60 * 1000)
  expect(purged).toBe(0)
  expect(listOpen(P)).toHaveLength(1)
  expect(listArchive(P)).toHaveLength(1)
  // Purge everything resolved before "now + 1s" -> the recent one goes.
  const purged2 = purgeResolved(P, Date.now() + 1000)
  expect(purged2).toBe(1)
  expect(listArchive(P)).toHaveLength(0)
  expect(listOpen(P)).toHaveLength(1)
})
