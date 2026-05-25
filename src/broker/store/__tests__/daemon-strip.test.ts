import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runStartupMigration, SCHEMA_VERSION } from '../migrate'
import { createSqliteDriver } from '../sqlite/driver'
import type { StoreDriver } from '../types'

/**
 * v6 daemon-URI strip migration tests.
 *
 * The Claude Code daemon is a transport for the claude backend (see
 * `src/broker/backends/claude-daemon.ts` header), not a peer backend. Legacy
 * daemon-host binaries minted `daemon://` URIs, splitting the project bucket
 * for the same folder. v6 rewrites every persisted URI to `claude://` and
 * relies on UPDATE OR IGNORE + DELETE to merge with any pre-existing claude
 * row owning the same identity.
 */
describe('v6: daemon:// -> claude:// migration', () => {
  let cacheDir: string
  let store: StoreDriver

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'daemon-strip-test-'))
    store = createSqliteDriver({ type: 'sqlite', dataDir: cacheDir })
    store.init()
  })

  afterEach(() => {
    store.close?.()
    rmSync(cacheDir, { recursive: true, force: true })
  })

  // --- helpers --------------------------------------------------------------

  function seedAndRewind(seed: (db: Database) => void): void {
    store.kv.set('schema-version', 5)
    store.close?.()
    {
      const db = new Database(join(cacheDir, 'store.db'))
      try {
        seed(db)
      } finally {
        db.close()
      }
    }
    store = createSqliteDriver({ type: 'sqlite', dataDir: cacheDir })
    store.init()
  }

  function openStore(): Database {
    return new Database(join(cacheDir, 'store.db'))
  }

  // --- tests ---------------------------------------------------------------

  it('rewrites turns.project_uri', () => {
    seedAndRewind(db => {
      db.prepare(
        `INSERT INTO turns (timestamp, conversation_id, project_uri, account, model, input_tokens, output_tokens)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(Date.now(), 'conv_a', 'daemon://default/Users/jonas/projects/foo', 'acct', 'sonnet', 10, 20)
    })

    const result = runStartupMigration(store, cacheDir)
    expect(result.toVersion).toBe(SCHEMA_VERSION)
    expect(result.daemonStripped?.storeTurns.updated).toBe(1)
    expect(result.daemonStripped?.storeTurns.deleted).toBe(0)

    const db = openStore()
    try {
      const row = db.prepare("SELECT project_uri FROM turns WHERE conversation_id = 'conv_a'").get() as {
        project_uri: string
      }
      expect(row.project_uri).toBe('claude://default/Users/jonas/projects/foo')

      const leftover = db.prepare("SELECT COUNT(*) AS n FROM turns WHERE project_uri LIKE 'daemon://%'").get() as {
        n: number
      }
      expect(leftover.n).toBe(0)
    } finally {
      db.close()
    }
  })

  it('rewrites conversations.scope', () => {
    seedAndRewind(db => {
      db.prepare('INSERT INTO conversations (id, scope, agent_type, created_at) VALUES (?, ?, ?, ?)').run(
        'conv_b',
        'daemon://default/Users/jonas/projects/foo',
        'claude',
        Date.now(),
      )
    })

    runStartupMigration(store, cacheDir)

    const db = openStore()
    try {
      const row = db.prepare("SELECT scope FROM conversations WHERE id = 'conv_b'").get() as { scope: string }
      expect(row.scope).toBe('claude://default/Users/jonas/projects/foo')
    } finally {
      db.close()
    }
  })

  it('rewrites scope_links scope_a and scope_b', () => {
    seedAndRewind(db => {
      db.prepare('INSERT INTO scope_links (scope_a, scope_b, created_at) VALUES (?, ?, ?)').run(
        'daemon://default/foo',
        'claude://default/bar',
        Date.now(),
      )
      db.prepare('INSERT INTO scope_links (scope_a, scope_b, created_at) VALUES (?, ?, ?)').run(
        'claude://default/baz',
        'daemon://default/qux',
        Date.now(),
      )
    })

    runStartupMigration(store, cacheDir)

    const db = openStore()
    try {
      const leftover = db
        .prepare("SELECT COUNT(*) AS n FROM scope_links WHERE scope_a LIKE 'daemon://%' OR scope_b LIKE 'daemon://%'")
        .get() as { n: number }
      expect(leftover.n).toBe(0)

      const both = db
        .prepare(
          "SELECT COUNT(*) AS n FROM scope_links WHERE scope_a = 'claude://default/foo' AND scope_b = 'claude://default/bar'",
        )
        .get() as { n: number }
      expect(both.n).toBe(1)
    } finally {
      db.close()
    }
  })

  it('PK-collision: existing claude row wins, daemon duplicate is deleted', () => {
    seedAndRewind(db => {
      // Two turns rows for the same conversation - both project URIs collapse
      // to the same claude:// identity. turns has no UNIQUE constraint, so this
      // is the safer collision case to test via conversations (UNIQUE on id is
      // by id, not scope -- scope has only an index). Use scope_links PK instead.
      db.prepare('INSERT INTO scope_links (scope_a, scope_b, created_at) VALUES (?, ?, ?)').run(
        'daemon://default/projects/x',
        'claude://default/projects/y',
        Date.now(),
      )
      db.prepare('INSERT INTO scope_links (scope_a, scope_b, created_at) VALUES (?, ?, ?)').run(
        'claude://default/projects/x',
        'claude://default/projects/y',
        Date.now() + 1,
      )
    })

    const result = runStartupMigration(store, cacheDir)
    expect(result.daemonStripped?.storeScopeLinks.deleted).toBeGreaterThanOrEqual(1)

    const db = openStore()
    try {
      const survivors = db
        .prepare(
          "SELECT COUNT(*) AS n FROM scope_links WHERE scope_a = 'claude://default/projects/x' AND scope_b = 'claude://default/projects/y'",
        )
        .get() as { n: number }
      expect(survivors.n).toBe(1)
      const daemon = db.prepare("SELECT COUNT(*) AS n FROM scope_links WHERE scope_a LIKE 'daemon://%'").get() as {
        n: number
      }
      expect(daemon.n).toBe(0)
    } finally {
      db.close()
    }
  })

  it('rewrites hourly_stats by deletion (PK contains project_uri)', () => {
    seedAndRewind(db => {
      db.prepare(
        `INSERT INTO hourly_stats (hour, account, model, project_uri, turn_count, input_tokens, output_tokens)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run('2026-05-26-00', 'acct', 'sonnet', 'daemon://default/foo', 1, 10, 20)
    })

    const result = runStartupMigration(store, cacheDir)
    expect(result.daemonStripped?.storeHourlyDeleted).toBe(1)

    const db = openStore()
    try {
      const leftover = db
        .prepare("SELECT COUNT(*) AS n FROM hourly_stats WHERE project_uri LIKE 'daemon://%'")
        .get() as {
        n: number
      }
      expect(leftover.n).toBe(0)
    } finally {
      db.close()
    }
  })

  it('rewrites message_queue from_scope and to_scope', () => {
    seedAndRewind(db => {
      db.prepare(
        `INSERT INTO message_queue (from_scope, to_scope, content, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('daemon://default/a', 'claude://default/b', 'hello', Date.now(), Date.now() + 3600000)
    })

    runStartupMigration(store, cacheDir)

    const db = openStore()
    try {
      const row = db.prepare('SELECT from_scope, to_scope FROM message_queue').get() as {
        from_scope: string
        to_scope: string
      }
      expect(row.from_scope).toBe('claude://default/a')
      expect(row.to_scope).toBe('claude://default/b')
    } finally {
      db.close()
    }
  })

  it('rewrites recaps.project_uri when recap schema is present', () => {
    seedAndRewind(db => {
      db.prepare(
        `INSERT INTO recaps (id, project_uri, period_label, period_start, period_end, time_zone, status, created_at, signals_json, signals_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        'recap_d1',
        'daemon://default/Users/jonas/projects/foo',
        'today',
        Date.now() - 86400000,
        Date.now(),
        'UTC',
        'done',
        Date.now(),
        '{}',
        'hash',
      )
    })

    runStartupMigration(store, cacheDir)

    const db = openStore()
    try {
      const row = db.prepare("SELECT project_uri FROM recaps WHERE id = 'recap_d1'").get() as {
        project_uri: string
      }
      expect(row.project_uri).toBe('claude://default/Users/jonas/projects/foo')
    } finally {
      db.close()
    }
  })

  it('migration is idempotent: re-running is a no-op', () => {
    const first = runStartupMigration(store, cacheDir)
    expect(first.toVersion).toBe(SCHEMA_VERSION)
    const second = runStartupMigration(store, cacheDir)
    expect(second.skipped).toBe(true)
  })

  it('no-op on a fresh DB with zero daemon rows', () => {
    seedAndRewind(_db => {
      // empty -- exercise the path with nothing to rewrite
    })

    const result = runStartupMigration(store, cacheDir)
    expect(result.daemonStripped?.storeTurns.updated).toBe(0)
    expect(result.daemonStripped?.storeTurns.deleted).toBe(0)
    expect(result.daemonStripped?.storeHourlyDeleted).toBe(0)
  })
})
