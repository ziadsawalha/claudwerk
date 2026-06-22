/**
 * CONTRACT: bun:sqlite behaviors the broker store + backup depend on.
 *
 * Mirrors broker/store/sqlite/* and broker/backup.ts:
 *  - FTS5 full-text search (transcript/recap search)
 *  - VACUUM INTO a separate file (the backup path)
 *  - STRICT tables reject wrong-typed values
 *  - bind params use bare names (no `$` prefix) -- the documented gotcha
 */

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpFile = ''
let counter = 0
beforeEach(() => {
  // No Date.now()/random needed: pid + a counter keeps the name unique per run.
  tmpFile = join(tmpdir(), `bun-sqlite-contract-${process.pid}-${counter++}.db`)
})
afterEach(async () => {
  await rm(tmpFile, { force: true })
  await rm(`${tmpFile}-wal`, { force: true })
  await rm(`${tmpFile}-shm`, { force: true })
})

describe('bun:sqlite contract', () => {
  test('FTS5 virtual table matches', () => {
    const db = new Database(':memory:')
    db.run('CREATE VIRTUAL TABLE docs USING fts5(body)')
    db.run("INSERT INTO docs(body) VALUES ('the quick brown fox')")
    db.run("INSERT INTO docs(body) VALUES ('lazy dog sleeps')")
    const rows = db.query("SELECT body FROM docs WHERE docs MATCH 'fox'").all() as { body: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].body).toContain('fox')
    db.close()
  })

  test('VACUUM INTO writes a usable backup file', () => {
    const db = new Database(':memory:')
    db.run('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)')
    const ins = db.prepare('INSERT INTO t (v) VALUES (?)')
    for (const v of ['a', 'b', 'c']) ins.run(v)
    db.run(`VACUUM INTO '${tmpFile}'`)
    db.close()

    const backup = new Database(tmpFile, { readonly: true })
    const n = backup.query('SELECT count(*) AS n FROM t').get() as { n: number }
    expect(n.n).toBe(3)
    backup.close()
  })

  test('STRICT table rejects a wrong-typed value', () => {
    const db = new Database(':memory:')
    db.run('CREATE TABLE s (n INTEGER) STRICT')
    expect(() => db.run("INSERT INTO s (n) VALUES ('not-an-int')")).toThrow()
    db.close()
  })

  test('strict:true binds bare keys; without it bare keys silently bind NULL', () => {
    // The broker opens every DB with { strict: true } (driver.ts). That is what
    // lets the whole store bind `{ id }` against SQL `$id`. This is load-bearing:
    // in DEFAULT (non-strict) mode a bare key binds NULL with no error -- silent
    // data corruption. Pin both halves so a Bun change to strict semantics fails
    // here, not in production.
    const strict = new Database(':memory:', { strict: true })
    strict.run('CREATE TABLE p (k TEXT, v TEXT)')
    strict.prepare('INSERT INTO p (k, v) VALUES ($k, $v)').run({ k: 'hello', v: 'world' })
    const row = strict.query('SELECT v FROM p WHERE k = $k').get({ k: 'hello' }) as { v: string }
    expect(row.v).toBe('world')
    strict.close()

    // Non-strict: bare key does NOT bind -> row stored with NULLs.
    const loose = new Database(':memory:')
    loose.run('CREATE TABLE p (k TEXT, v TEXT)')
    loose.prepare('INSERT INTO p (k, v) VALUES ($k, $v)').run({ k: 'hello', v: 'world' })
    const looseRow = loose.query('SELECT k FROM p').get() as { k: string | null }
    expect(looseRow.k).toBeNull()
    loose.close()
  })
})
