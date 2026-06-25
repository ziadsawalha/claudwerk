/**
 * HTTP routes for project-scoped hosted canvases.
 *
 *   GET    /api/canvases?projectUri=     list a project's canvases (metadata)
 *   POST   /api/canvases                 create (optionally seed a scene)
 *   GET    /api/canvases/:id             metadata + scene JSON
 *   PUT    /api/canvases/:id/scene       overwrite scene (+ optional thumbnail)
 *   PATCH  /api/canvases/:id             rename / archive
 *   DELETE /api/canvases/:id             remove (row + scene files)
 *   GET    /api/canvases/:id/thumb       thumbnail PNG
 *
 * Permission model (authed path -- Phase A):
 *   read  -> files:read on the canvas's project_uri
 *   write -> files       on the canvas's project_uri
 * Public share tiers (Phase D) layer on top via the share-token route.
 *
 * Every scene write runs through sanitizeCanvasScene (drops embed/iframe +
 * unsafe links) before it touches disk -- defense in depth, mandatory for share.
 */

import { type Context, Hono } from 'hono'
import type { CanvasSummary } from '../../shared/protocol'
import { getAuthenticatedUser } from '../auth-routes'
import { sanitizeCanvasScene } from '../canvas-sanitize'
import { readScene, readThumb } from '../canvas-scenes'
import {
  archiveCanvas,
  createCanvas,
  deleteCanvas,
  getCanvas,
  listCanvases,
  renameCanvas,
  saveCanvasScene,
} from '../canvas-store'
import type { ConversationStore } from '../conversation-store'
import type { RouteHelpers } from './shared'

/** Decode a thumbnail field (raw base64 or a data: URL) to bytes, or undefined. */
function decodeThumb(thumb: unknown): Uint8Array | undefined {
  if (typeof thumb !== 'string' || !thumb) return undefined
  const b64 = thumb.startsWith('data:') ? thumb.slice(thumb.indexOf(',') + 1) : thumb
  try {
    return new Uint8Array(Buffer.from(b64, 'base64'))
  } catch {
    return undefined
  }
}

export function createCanvasesRouter(conversationStore: ConversationStore, helpers: RouteHelpers): Hono {
  const app = new Hono()

  /** Project URI for a request: explicit `projectUri`, else resolved from a
   *  `conversationId` (how agent MCP tools, which only know their conv, scope). */
  function resolveProject(explicit: unknown, conversationId: unknown): string | undefined {
    if (typeof explicit === 'string' && explicit) return explicit
    if (typeof conversationId === 'string' && conversationId)
      return conversationStore.getConversation(conversationId)?.project
    return undefined
  }

  /** Load the :id canvas and enforce a permission on its project, in one shot.
   *  Returns the canvas, or a 404/403 Response to return immediately. */
  function guard(c: Context, perm: 'files' | 'files:read'): { res: Response } | { canvas: CanvasSummary } {
    const canvas = getCanvas(c.req.param('id') ?? '')
    if (!canvas) return { res: c.json({ error: 'Not found' }, 404) }
    if (!helpers.httpHasPermission(c.req.raw, perm, canvas.projectUri))
      return { res: c.json({ error: 'Forbidden' }, 403) }
    return { canvas }
  }

  /** Parse + sanitize an optional scene field from a request body. Returns the
   *  clean JSON (absent when no scene supplied) or a 400 Response. Shared by the
   *  create + save routes so the sanitize contract lives in exactly one place. */
  function sceneFromBody(c: Context, body: Record<string, unknown> | null): { json?: string } | { res: Response } {
    const raw = body?.scene
    if (typeof raw !== 'string' || !raw.trim()) return {}
    const clean = sanitizeCanvasScene(raw)
    if (clean.json === null) return { res: c.json({ error: 'Invalid scene JSON' }, 400) }
    return { json: clean.json }
  }

  // ─── list ────────────────────────────────────────────────────────
  app.get('/api/canvases', c => {
    const projectUri = resolveProject(c.req.query('projectUri'), c.req.query('conversationId'))
    if (!projectUri) return c.json({ error: 'projectUri or conversationId required' }, 400)
    if (!helpers.httpHasPermission(c.req.raw, 'files:read', projectUri)) return c.json({ error: 'Forbidden' }, 403)
    return c.json({ canvases: listCanvases(projectUri) })
  })

  // ─── create ──────────────────────────────────────────────────────
  app.post('/api/canvases', async c => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
    const projectUri = resolveProject(body?.projectUri, body?.conversationId)
    if (!projectUri) return c.json({ error: 'projectUri or conversationId required' }, 400)
    if (!helpers.httpHasPermission(c.req.raw, 'files', projectUri)) return c.json({ error: 'Forbidden' }, 403)
    const s = sceneFromBody(c, body)
    if ('res' in s) return s.res
    const canvas = createCanvas(projectUri, {
      name: typeof body?.name === 'string' ? body.name : 'Untitled canvas',
      createdBy: getAuthenticatedUser(c.req.raw) ?? undefined,
      sceneJson: s.json,
    })
    return c.json({ canvas })
  })

  // ─── read (metadata + scene) ─────────────────────────────────────
  app.get('/api/canvases/:id', c => {
    const g = guard(c, 'files:read')
    if ('res' in g) return g.res
    return c.json({ canvas: g.canvas, scene: readScene(g.canvas.id) })
  })

  // ─── save scene (+ optional thumbnail) ───────────────────────────
  app.put('/api/canvases/:id/scene', async c => {
    const g = guard(c, 'files')
    if ('res' in g) return g.res
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
    const s = sceneFromBody(c, body)
    if ('res' in s) return s.res
    if (!s.json) return c.json({ error: 'scene required' }, 400)
    saveCanvasScene(g.canvas.id, s.json, decodeThumb(body?.thumb))
    return c.json({ canvas: getCanvas(g.canvas.id) })
  })

  // ─── rename / archive ────────────────────────────────────────────
  app.patch('/api/canvases/:id', async c => {
    const g = guard(c, 'files')
    if ('res' in g) return g.res
    const body = await c.req.json().catch(() => null)
    if (typeof body?.name === 'string') renameCanvas(g.canvas.id, body.name)
    if (typeof body?.archived === 'boolean') archiveCanvas(g.canvas.id, body.archived)
    return c.json({ canvas: getCanvas(g.canvas.id) })
  })

  // ─── delete ──────────────────────────────────────────────────────
  app.delete('/api/canvases/:id', c => {
    const g = guard(c, 'files')
    if ('res' in g) return g.res
    deleteCanvas(g.canvas.id)
    return c.json({ ok: true })
  })

  // ─── thumbnail ───────────────────────────────────────────────────
  app.get('/api/canvases/:id/thumb', c => {
    const g = guard(c, 'files:read')
    if ('res' in g) return g.res
    const bytes = readThumb(g.canvas.id)
    if (!bytes) return c.json({ error: 'No thumbnail' }, 404)
    return new Response(bytes, { headers: { 'content-type': 'image/png', 'cache-control': 'no-cache' } })
  })

  return app
}
