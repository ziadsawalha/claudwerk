/**
 * Tests for the former_slugs column migration (conversation-rename Phase 2a).
 * Verifies idempotency and that a JSON round-trip survives the conversation store.
 */

import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { createSqliteConversationStore } from './conversations'
import { migrateFormerSlugs } from './migrate-former-slugs'

function baseConversationsTable(db: Database): void {
  // Minimal pre-migration shape (no former_slugs column).
  db.run(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      agent_type TEXT NOT NULL,
      agent_version TEXT,
      title TEXT,
      summary TEXT,
      label TEXT,
      icon TEXT,
      color TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      model TEXT,
      created_at INTEGER NOT NULL,
      ended_at INTEGER,
      last_activity INTEGER,
      meta TEXT,
      stats TEXT,
      parent_conversation_id TEXT,
      root_conversation_id TEXT
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

  it('round-trips formerSlugs through create + get', () => {
    const db = new Database(':memory:')
    baseConversationsTable(db)
    migrateFormerSlugs(db)
    const store = createSqliteConversationStore(db)
    const former = [{ slug: 'old-name', retiredAt: 1000, lastUsedAt: 2000 }]
    store.create({ id: 'conv_x', scope: 'claude:///x', agentType: 'rclaude', formerSlugs: former })
    const got = store.get('conv_x')
    expect(got?.formerSlugs).toEqual(former)
  })

  it('round-trips formerSlugs through update', () => {
    const db = new Database(':memory:')
    baseConversationsTable(db)
    migrateFormerSlugs(db)
    const store = createSqliteConversationStore(db)
    store.create({ id: 'conv_y', scope: 'claude:///y', agentType: 'rclaude' })
    expect(store.get('conv_y')?.formerSlugs).toBeUndefined()
    const former = [
      { slug: 'a', retiredAt: 1, lastUsedAt: 2 },
      { slug: 'b', retiredAt: 3, lastUsedAt: 4 },
    ]
    store.update('conv_y', { formerSlugs: former })
    expect(store.get('conv_y')?.formerSlugs).toEqual(former)
  })
})
