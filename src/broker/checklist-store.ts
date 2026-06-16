/**
 * Checklist Store -- SQLite-backed per-project personal checklists.
 *
 * "Sticky notes from the user to themselves," scoped to a project URI and shown
 * in the conversation list above that project's conversations. This is broker-
 * local config data (NOT time-series), so it gets its own durable DB file,
 * mirroring project-store.ts's module-singleton shape.
 *
 * Storage: {cacheDir}/checklists.db
 *
 * An item is OPEN while `resolved_at IS NULL` and RESOLVED (archived) once a
 * timestamp is stamped. Open items sort by created_at ASC (oldest first);
 * resolved items sort by resolved_at DESC (most recently finished first).
 *
 * `text` is stored raw -- the control panel renders a limited inline-markdown
 * subset for display only; the broker never parses it.
 */

import type { Database, Statement } from 'bun:sqlite'
import { resolve } from 'node:path'
import type { ChecklistItem, ChecklistStatus } from '../shared/protocol'
import { openWalDatabase } from './sqlite-open'

// ─── Types ──────────────────────────────────────────────────────────

/** SQLite row shape (snake_case columns). The wire-facing `ChecklistItem`
 *  (camelCase) is defined once in shared/protocol.ts. */
interface ChecklistRow {
  id: string
  text: string
  status: ChecklistStatus
  created_at: number
  updated_at: number
  resolved_at: number | null
}

function rowToItem(r: ChecklistRow): ChecklistItem {
  return {
    id: r.id,
    text: r.text,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    resolvedAt: r.resolved_at,
  }
}

// ─── Module State ───────────────────────────────────────────────────

let db: Database | null = null
let stmtOpen: Statement | null = null
let stmtArchive: Statement | null = null
let stmtInsert: Statement | null = null
let stmtSetStatus: Statement | null = null
let stmtUpdateText: Statement | null = null
let stmtDelete: Statement | null = null
let stmtDeleteAll: Statement | null = null
let stmtPurge: Statement | null = null

function newId(): string {
  return `chk_${crypto.randomUUID()}`
}

// ─── Init / Shutdown ────────────────────────────────────────────────

export function initChecklistStore(cacheDir: string): void {
  const dbPath = resolve(cacheDir, 'checklists.db')
  db = openWalDatabase(dbPath)

  db.run(`
    CREATE TABLE IF NOT EXISTS checklist_items (
      id          TEXT PRIMARY KEY,
      project_uri TEXT NOT NULL,
      text        TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'open',
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      resolved_at INTEGER
    )
  `)
  // Covers both the active query (status != 'done' ORDER BY created_at) and the
  // archive query (status = 'done' ORDER BY resolved_at) for one project.
  db.run('CREATE INDEX IF NOT EXISTS idx_checklist_project ON checklist_items(project_uri, status, created_at)')

  const COLS = 'id, text, status, created_at, updated_at, resolved_at'
  // Active = open + in_progress (everything not done). Oldest first; rowid breaks
  // same-millisecond ties so insertion order is stable.
  stmtOpen = db.prepare(
    `SELECT ${COLS} FROM checklist_items WHERE project_uri = $project_uri AND status != 'done' ORDER BY created_at ASC, rowid ASC`,
  )
  stmtArchive = db.prepare(
    `SELECT ${COLS} FROM checklist_items WHERE project_uri = $project_uri AND status = 'done' ORDER BY resolved_at DESC, rowid DESC`,
  )
  stmtInsert = db.prepare(
    'INSERT INTO checklist_items (id, project_uri, text, status, created_at, updated_at, resolved_at) VALUES ($id, $project_uri, $text, $status, $created_at, $updated_at, $resolved_at)',
  )
  stmtSetStatus = db.prepare(
    'UPDATE checklist_items SET status = $status, resolved_at = $resolved_at, updated_at = $updated_at WHERE id = $id AND project_uri = $project_uri',
  )
  stmtUpdateText = db.prepare(
    'UPDATE checklist_items SET text = $text, updated_at = $updated_at WHERE id = $id AND project_uri = $project_uri',
  )
  stmtDelete = db.prepare('DELETE FROM checklist_items WHERE id = $id AND project_uri = $project_uri')
  stmtDeleteAll = db.prepare('DELETE FROM checklist_items WHERE project_uri = $project_uri')
  stmtPurge = db.prepare(
    "DELETE FROM checklist_items WHERE project_uri = $project_uri AND status = 'done' AND resolved_at < $before",
  )

  const count = (db.query('SELECT COUNT(*) as n FROM checklist_items').get() as { n: number }).n
  console.log(`[checklist] Store initialized: ${dbPath} (${count} items)`)
}

export function closeChecklistStore(): void {
  if (!db) return
  try {
    db.run('PRAGMA wal_checkpoint(TRUNCATE)')
    db.close()
  } catch (err) {
    console.error('[checklist] Error closing database:', err)
  }
  db = null
  stmtOpen = null
  stmtArchive = null
  stmtInsert = null
  stmtSetStatus = null
  stmtUpdateText = null
  stmtDelete = null
  stmtDeleteAll = null
  stmtPurge = null
}

// ─── Queries ────────────────────────────────────────────────────────

/** Active items (open + in_progress) for a project, oldest first. */
export function listOpen(projectUri: string): ChecklistItem[] {
  if (!stmtOpen) return []
  return (stmtOpen.all({ project_uri: projectUri }) as ChecklistRow[]).map(rowToItem)
}

/** Resolved (archived) items for a project, most recently finished first. */
export function listArchive(projectUri: string): ChecklistItem[] {
  if (!stmtArchive) return []
  return (stmtArchive.all({ project_uri: projectUri }) as ChecklistRow[]).map(rowToItem)
}

// ─── Mutations ──────────────────────────────────────────────────────

/** An item to create: text plus an optional starting status (default 'open')
 *  and optional explicit dates (used by the bulk-replace path). */
export interface NewChecklistItem {
  text: string
  status?: ChecklistStatus
  createdAt?: number
  resolvedAt?: number
}

function insertRow(projectUri: string, item: NewChecklistItem, now: number): boolean {
  const text = item.text.trim()
  if (!text) return false
  const status: ChecklistStatus = item.status ?? 'open'
  const resolvedAt = status === 'done' ? (item.resolvedAt ?? now) : null
  stmtInsert?.run({
    id: newId(),
    project_uri: projectUri,
    text,
    status,
    created_at: item.createdAt ?? now,
    updated_at: now,
    resolved_at: resolvedAt,
  })
  return true
}

/**
 * Create N items in one shot (multi-line paste / single add). A `done` item is
 * stamped resolved_at=now so it lands straight in the archive. Returns the
 * number actually inserted (blank texts are skipped).
 */
export function createItems(projectUri: string, items: NewChecklistItem[]): number {
  if (!db || !stmtInsert) return 0
  const now = Date.now()
  let inserted = 0
  const tx = db.transaction((rows: NewChecklistItem[]) => {
    for (const row of rows) if (insertRow(projectUri, row, now)) inserted++
  })
  tx(items)
  return inserted
}

/**
 * Replace the WHOLE project list (bulk markdown editor save). Wipes the
 * project's rows and re-inserts `items` with fresh ids, honoring any supplied
 * createdAt/resolvedAt (the client parses them out of the doc; missing = now).
 * Returns the number inserted.
 */
export function replaceAll(projectUri: string, items: NewChecklistItem[]): number {
  if (!db || !stmtInsert || !stmtDeleteAll) return 0
  const now = Date.now()
  let inserted = 0
  const tx = db.transaction((rows: NewChecklistItem[]) => {
    stmtDeleteAll?.run({ project_uri: projectUri })
    for (const row of rows) if (insertRow(projectUri, row, now)) inserted++
  })
  tx(items)
  return inserted
}

/** Move an item to a new status. resolved_at is stamped now on -> done, cleared otherwise. */
export function setStatus(projectUri: string, id: string, status: ChecklistStatus): void {
  const now = Date.now()
  stmtSetStatus?.run({
    status,
    resolved_at: status === 'done' ? now : null,
    updated_at: now,
    id,
    project_uri: projectUri,
  })
}

/** Edit an item's text (raw). */
export function updateText(projectUri: string, id: string, text: string): void {
  stmtUpdateText?.run({ text: text.trim(), updated_at: Date.now(), id, project_uri: projectUri })
}

/** Delete one item outright. */
export function deleteItem(projectUri: string, id: string): void {
  stmtDelete?.run({ id, project_uri: projectUri })
}

/** Delete done items resolved before `before` (epoch ms). Returns count removed. */
export function purgeResolved(projectUri: string, before: number): number {
  const res = stmtPurge?.run({ project_uri: projectUri, before })
  return res ? Number(res.changes) : 0
}
