import type { Database } from 'bun:sqlite'

/**
 * Phase 2 conversation-rename (alias retention): add the `former_slugs` column
 * to `conversations`. JSON array of { slug, retiredAt, lastUsedAt } entries --
 * the addressable names a conversation has shed via rename, kept so peers that
 * cached an OLD name keep routing for a decay window (see RENAME_ALIAS_TTL_MS).
 *
 * Idempotent ALTER ADD COLUMN (guarded by a table_info check). Defaults to NULL
 * -- pre-existing rows simply have no alias history, which is correct.
 */
export function migrateFormerSlugs(db: Database): void {
  const cols = new Set(
    (db.prepare("PRAGMA table_info('conversations')").all() as Array<{ name: string }>).map(r => r.name),
  )
  if (!cols.has('former_slugs')) {
    db.run('ALTER TABLE conversations ADD COLUMN former_slugs TEXT DEFAULT NULL')
  }
}
