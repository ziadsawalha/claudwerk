/**
 * Canvas Store -- SQLite-backed per-project hosted Excalidraw canvases.
 *
 * Metadata only: one row per canvas (name, owner, timestamps, share state). The
 * scene JSON + thumbnail live in durable files via canvas-scenes.ts (NOT the
 * 7-day-reaped blob store). Mirrors checklist-store.ts's module-singleton shape.
 *
 * Storage: {cacheDir}/canvases.db  +  {cacheDir}/canvas-scenes/{id}.{excalidraw,png}
 *
 * Private by default; `share_token` (+ `share_tier`) is set when a canvas is
 * shared publicly (Phase D). See plan-project-canvases.md.
 */

import type { Database, Statement } from 'bun:sqlite'
import { resolve } from 'node:path'
import type { CanvasShareTier, CanvasSummary } from '../shared/protocol'
import { CANVAS_COLS, type CanvasRow, rowToSummary } from './canvas-row'
import { deleteSceneFiles, initCanvasScenes, hasThumb as sceneHasThumb, writeScene, writeThumb } from './canvas-scenes'
import { openWalDatabase } from './sqlite-open'

let db: Database | null = null
let stmtList: Statement | null = null
let stmtGet: Statement | null = null
let stmtByToken: Statement | null = null
let stmtInsert: Statement | null = null
let stmtSaveScene: Statement | null = null
let stmtRename: Statement | null = null
let stmtArchive: Statement | null = null
let stmtSetShare: Statement | null = null
let stmtDelete: Statement | null = null

function newId(): string {
  return `cnv_${crypto.randomUUID()}`
}

export function initCanvasStore(cacheDir: string): void {
  const dbPath = resolve(cacheDir, 'canvases.db')
  db = openWalDatabase(dbPath)
  initCanvasScenes(cacheDir)

  db.run(`
    CREATE TABLE IF NOT EXISTS canvases (
      id          TEXT PRIMARY KEY,
      project_uri TEXT NOT NULL,
      name        TEXT NOT NULL,
      created_by  TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      scene_bytes INTEGER NOT NULL DEFAULT 0,
      has_thumb   INTEGER NOT NULL DEFAULT 0,
      shared      INTEGER NOT NULL DEFAULT 0,
      share_token TEXT,
      share_tier  TEXT,
      archived_at INTEGER
    )
  `)
  db.run('CREATE INDEX IF NOT EXISTS idx_canvas_project ON canvases(project_uri, updated_at DESC)')
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_canvas_token ON canvases(share_token) WHERE share_token IS NOT NULL')

  stmtList = db.prepare(
    `SELECT ${CANVAS_COLS} FROM canvases WHERE project_uri = $project_uri AND archived_at IS NULL ORDER BY updated_at DESC, rowid DESC`,
  )
  stmtGet = db.prepare(`SELECT ${CANVAS_COLS} FROM canvases WHERE id = $id`)
  stmtByToken = db.prepare(`SELECT ${CANVAS_COLS} FROM canvases WHERE share_token = $token`)
  stmtInsert = db.prepare(
    `INSERT INTO canvases (id, project_uri, name, created_by, created_at, updated_at, scene_bytes, has_thumb)
     VALUES ($id, $project_uri, $name, $created_by, $created_at, $updated_at, $scene_bytes, $has_thumb)`,
  )
  stmtSaveScene = db.prepare(
    'UPDATE canvases SET scene_bytes = $scene_bytes, has_thumb = $has_thumb, updated_at = $updated_at WHERE id = $id',
  )
  stmtRename = db.prepare('UPDATE canvases SET name = $name, updated_at = $updated_at WHERE id = $id')
  stmtArchive = db.prepare('UPDATE canvases SET archived_at = $archived_at, updated_at = $updated_at WHERE id = $id')
  stmtSetShare = db.prepare(
    'UPDATE canvases SET shared = $shared, share_token = $share_token, share_tier = $share_tier, updated_at = $updated_at WHERE id = $id',
  )
  stmtDelete = db.prepare('DELETE FROM canvases WHERE id = $id')

  const count = (db.query('SELECT COUNT(*) as n FROM canvases').get() as { n: number }).n
  console.log(`[canvas] Store initialized: ${dbPath} (${count} canvases)`)
}

export function closeCanvasStore(): void {
  if (!db) return
  try {
    db.run('PRAGMA wal_checkpoint(TRUNCATE)')
    db.close()
  } catch (err) {
    console.error('[canvas] Error closing database:', err)
  }
  db = null
  stmtList = stmtGet = stmtByToken = stmtInsert = null
  stmtSaveScene = stmtRename = stmtArchive = stmtSetShare = stmtDelete = null
}

/** Active (non-archived) canvases for a project, most recently edited first. */
export function listCanvases(projectUri: string): CanvasSummary[] {
  if (!stmtList) return []
  return (stmtList.all({ project_uri: projectUri }) as CanvasRow[]).map(rowToSummary)
}

export function getCanvas(id: string): CanvasSummary | null {
  const row = stmtGet?.get({ id }) as CanvasRow | undefined
  return row ? rowToSummary(row) : null
}

export function getCanvasByToken(token: string): CanvasSummary | null {
  const row = stmtByToken?.get({ token }) as CanvasRow | undefined
  return row ? rowToSummary(row) : null
}

/** Create a canvas, optionally seeding a scene. Returns its summary. */
export function createCanvas(
  projectUri: string,
  opts: { name: string; createdBy?: string; sceneJson?: string },
): CanvasSummary {
  const now = Date.now()
  const id = newId()
  const sceneBytes = opts.sceneJson ? writeScene(id, opts.sceneJson) : 0
  stmtInsert?.run({
    id,
    project_uri: projectUri,
    name: opts.name.trim() || 'Untitled canvas',
    created_by: opts.createdBy ?? null,
    created_at: now,
    updated_at: now,
    scene_bytes: sceneBytes,
    has_thumb: 0,
  })
  const created = getCanvas(id)
  if (!created) throw new Error('canvas insert failed')
  return created
}

/** Overwrite the scene (and optional thumbnail) for a canvas. */
export function saveCanvasScene(id: string, sceneJson: string, thumb?: Uint8Array): void {
  const bytes = writeScene(id, sceneJson)
  if (thumb) writeThumb(id, thumb)
  stmtSaveScene?.run({
    id,
    scene_bytes: bytes,
    has_thumb: sceneHasThumb(id) ? 1 : 0,
    updated_at: Date.now(),
  })
}

export function renameCanvas(id: string, name: string): void {
  stmtRename?.run({ id, name: name.trim() || 'Untitled canvas', updated_at: Date.now() })
}

export function archiveCanvas(id: string, archived: boolean): void {
  stmtArchive?.run({ id, archived_at: archived ? Date.now() : null, updated_at: Date.now() })
}

/** Set or clear a canvas's public share (token + tier). token=null clears. */
export function setCanvasShare(id: string, token: string | null, tier: CanvasShareTier | null): void {
  stmtSetShare?.run({
    id,
    shared: token ? 1 : 0,
    share_token: token,
    share_tier: token ? tier : null,
    updated_at: Date.now(),
  })
}

export function deleteCanvas(id: string): void {
  stmtDelete?.run({ id })
  deleteSceneFiles(id)
}
