/**
 * Agent-facing canvas tools -- let the agent reference, READ, MUTATE and manage
 * a project's hosted drawings, like the project board does for tasks. Canvases
 * live in the BROKER (durable scene store), so these reach it over HTTP using
 * the host's broker URL + secret (mirrors search.ts). The current project is
 * resolved broker-side from the agent's conversationId.
 *
 * A `scene` is an Excalidraw scene JSON OR a compact draw-dsl scene (the same
 * format the `dialog` Draw block accepts) -- the broker sanitizes it and the
 * canvas window renders it (DSL scenes expand on open).
 */

import { wsToHttpUrl } from '../../../shared/ws-url'
import type { McpToolContext, ToolDef } from './types'

function brokerBase(ctx: McpToolContext): string | null {
  if (ctx.noBroker || !ctx.brokerUrl) return null
  return wsToHttpUrl(ctx.brokerUrl)
}
function authHeaders(ctx: McpToolContext): Record<string, string> {
  return ctx.brokerSecret ? { Authorization: `Bearer ${ctx.brokerSecret}` } : {}
}
function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] }
}
function err(t: string) {
  return { content: [{ type: 'text' as const, text: t }], isError: true }
}
function age(ms: number): string {
  const m = Math.floor((Date.now() - ms) / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

interface CanvasMeta {
  id: string
  name: string
  updatedAt: number
  sceneBytes: number
  shared: boolean
  shareTier?: string
}

export function registerCanvasTools(ctx: McpToolContext): Record<string, ToolDef> {
  const conv = () => ctx.getIdentity()?.conversationId
  const headers = (extra?: Record<string, string>) => ({ ...authHeaders(ctx), ...extra })

  async function list() {
    const base = brokerBase(ctx)
    if (!base) return err('Canvas tools need a broker connection (none configured).')
    const res = await fetch(`${base}/api/canvases?conversationId=${encodeURIComponent(conv() ?? '')}`, {
      headers: headers(),
    })
    if (!res.ok) return err(`canvas_list failed (${res.status})`)
    const { canvases } = (await res.json()) as { canvases: CanvasMeta[] }
    if (!canvases.length) return text('No canvases in this project yet. Create one with canvas_create.')
    const lines = canvases.map(
      c =>
        `- ${c.id}  "${c.name}"  (${age(c.updatedAt)}, ${c.sceneBytes}b${c.shared ? `, shared:${c.shareTier}` : ''})`,
    )
    return text(`Canvases in this project:\n${lines.join('\n')}`)
  }

  async function read(id: string) {
    const base = brokerBase(ctx)
    if (!base) return err('Canvas tools need a broker connection (none configured).')
    const res = await fetch(`${base}/api/canvases/${encodeURIComponent(id)}`, { headers: headers() })
    if (res.status === 404) return err(`Canvas "${id}" not found.`)
    if (!res.ok) return err(`canvas_read failed (${res.status})`)
    const { canvas, scene } = (await res.json()) as { canvas: CanvasMeta; scene: string | null }
    return text(`"${canvas.name}" (${canvas.id})\n\n${scene ?? '(blank canvas -- no scene yet)'}`)
  }

  async function write(method: 'POST' | 'PUT' | 'PATCH', path: string, body: Record<string, unknown>) {
    const base = brokerBase(ctx)
    if (!base) return err('Canvas tools need a broker connection (none configured).')
    const res = await fetch(`${base}${path}`, {
      method,
      headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(body),
    })
    if (res.status === 404) return err('Canvas not found.')
    if (!res.ok) return err(`request failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
    return null
  }

  return {
    canvas_list: {
      description:
        "List this project's hosted drawings (canvases) -- id, name, last-edited, size, share state. They show on the Project Action Panel and open at /canvas/<id>.",
      inputSchema: { type: 'object' as const, properties: {} },
      handle: () => list(),
    },
    canvas_read: {
      description:
        'Read a hosted canvas: returns its scene (Excalidraw JSON, or a draw-dsl scene). Use the id from canvas_list.',
      inputSchema: {
        type: 'object' as const,
        properties: { id: { type: 'string', description: 'Canvas id (from canvas_list)' } },
        required: ['id'],
      },
      handle: p => read(String(p.id)),
    },
    canvas_create: {
      description:
        'Create a hosted drawing in THIS project. Optionally seed a scene (Excalidraw JSON or a draw-dsl scene, same format as the dialog Draw block). Returns the new id; it opens at /canvas/<id> and lists on the project panel.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string', description: 'Canvas name' },
          scene: { type: 'string', description: 'Optional scene JSON (Excalidraw or draw-dsl) to seed it' },
        },
        required: ['name'],
      },
      async handle(p) {
        const base = brokerBase(ctx)
        if (!base) return err('Canvas tools need a broker connection (none configured).')
        const res = await fetch(`${base}/api/canvases`, {
          method: 'POST',
          headers: headers({ 'content-type': 'application/json' }),
          body: JSON.stringify({ conversationId: conv(), name: String(p.name), scene: p.scene }),
        })
        if (!res.ok) return err(`canvas_create failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
        const { canvas } = (await res.json()) as { canvas: CanvasMeta }
        return text(`Created canvas ${canvas.id} "${canvas.name}". Opens at /canvas/${canvas.id}.`)
      },
    },
    canvas_update_scene: {
      description:
        "Replace a canvas's scene (mutate the drawing). Pass the full scene JSON (Excalidraw or draw-dsl). Sanitized broker-side (embeds/iframes dropped).",
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: { type: 'string', description: 'Canvas id' },
          scene: { type: 'string', description: 'Full scene JSON (Excalidraw or draw-dsl)' },
        },
        required: ['id', 'scene'],
      },
      async handle(p) {
        const e = await write('PUT', `/api/canvases/${encodeURIComponent(String(p.id))}/scene`, {
          scene: String(p.scene),
        })
        return e ?? text(`Updated canvas ${p.id}.`)
      },
    },
    canvas_rename: {
      description: 'Rename a hosted canvas.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: { type: 'string', description: 'Canvas id' },
          name: { type: 'string', description: 'New name' },
        },
        required: ['id', 'name'],
      },
      async handle(p) {
        const e = await write('PATCH', `/api/canvases/${encodeURIComponent(String(p.id))}`, { name: String(p.name) })
        return e ?? text(`Renamed canvas ${p.id} to "${p.name}".`)
      },
    },
  }
}
