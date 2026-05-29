/**
 * Tests for the former_slugs column migration (conversation-rename Phase 2a).
 * Verifies idempotency and that the column persists a JSON round-trip.
 *
 * NOTE: the round-trip is exercised with RAW SQL, NOT createSqliteConversationStore.
 * bun:sqlite caches compiled statements by SQL text across Database instances in
 * one process, so going through the shared store insert here would couple this
 * unit to whatever other test file prepared the same INSERT first (flaky
 * cross-file scope-bind failures). The store's create/update mapping of
 * former_slugs is covered by typecheck + the handler/resolver tests; the
 * migration's own job is simply "column exists and holds JSON".
 */

import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { migrateFormerSlugs } from './migrate-former-slugs'

function baseConversationsTable(db: Database): void {
  // Minimal pre-migration shape (no former_slugs column).
  db.run(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      agent_type TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      meta TEXT
    )
  `)
}

function hasColumn(db: Database, table: string, col: string): boolean {
  return (db.prepare(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>).some(r => r.name === col)
}

describe('migrateFormerSlugs', () => {
  it('adds the former_slugs column when missing', () => {
    const db = new Database(':memory:')
    baseConversationsTable(db)
    expect(hasColumn(db, 'conversations', 'former_slugs')).toBe(false)
    migrateFormerSlugs(db)
    expect(hasColumn(db, 'conversations', 'former_slugs')).toBe(true)
  })

  it('is idempotent (second run is a no-op, no throw)', () => {
    const db = new Database(':memory:')
    baseConversationsTable(db)
    migrateFormerSlugs(db)
    expect(() => migrateFormerSlugs(db)).not.toThrow()
    expect(hasColumn(db, 'conversations', 'former_slugs')).toBe(true)
  })

  it('round-trips a former_slugs JSON value through the column', () => {
    const db = new Database(':memory:')
    baseConversationsTable(db)
    migrateFormerSlugs(db)
    const former = [{ slug: 'old-name', retiredAt: 1000, lastUsedAt: 2000 }]
    db.prepare(
      'INSERT INTO conversations (id, scope, agent_type, created_at, former_slugs) VALUES (?, ?, ?, ?, ?)',
    ).run('conv_x', 'claude:///x', 'rclaude', 1, JSON.stringify(former))
    const row = db.prepare('SELECT former_slugs FROM conversations WHERE id = ?').get('conv_x') as {
      former_slugs: string | null
    }
    expect(row.former_slugs).not.toBeNull()
    expect(JSON.parse(row.former_slugs as string)).toEqual(former)
  })

  it('defaults former_slugs to NULL for rows inserted without it', () => {
    const db = new Database(':memory:')
    baseConversationsTable(db)
    migrateFormerSlugs(db)
    db.prepare('INSERT INTO conversations (id, scope, agent_type, created_at) VALUES (?, ?, ?, ?)').run(
      'conv_y',
      'claude:///y',
      'rclaude',
      1,
    )
    const row = db.prepare('SELECT former_slugs FROM conversations WHERE id = ?').get('conv_y') as {
      former_slugs: string | null
    }
    expect(row.former_slugs).toBeNull()
  })
})
