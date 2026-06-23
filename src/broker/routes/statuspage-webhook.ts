/**
 * Statuspage webhook receiver.
 *
 * status.claude.com runs on Atlassian Statuspage, which fires an outgoing
 * JSON POST on incident create/update/resolve and on component status change.
 * Statuspage CANNOT send an auth header, so the endpoint is public; we guard it
 * with an unguessable secret in the path, derived deterministically from
 * RCLAUDE_SECRET (stable across restarts, no extra config to set).
 *
 * Policy (decided 2026-06-24): NO filtering -- push EVERYTHING to all broker
 * users, and LOG every raw payload to the kv ring so we can build filters + a
 * UI later off real data.
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { sendPushToAll } from '../push'
import type { StoreDriver } from '../store/types'

/** kv key holding the rolling ring of received webhook events. */
const EVENTS_KEY = 'statuspage:events'
/** How many raw events we keep (for the future filter/UI work). */
const RING_CAP = 500

/** One persisted webhook hit -- full raw payload kept on purpose. */
interface StatuspageEvent {
  receivedAt: number
  ip?: string
  pushTitle: string
  pushBody: string
  /** The full parsed Statuspage payload, verbatim. */
  payload: unknown
}

/** Derive the stable, unguessable path token from the broker secret. */
function webhookToken(rclaudeSecret: string): string {
  return createHash('sha256').update(`${rclaudeSecret}:statuspage-webhook`).digest('hex').slice(0, 32)
}

// ─── Payload -> push text ──────────────────────────────────────────────────
// Statuspage sends a few distinct shapes; we render each to a title/body and
// fall back to the page-level status for anything we don't recognise (incl.
// the validation ping Statuspage sends when you first subscribe).

interface Push {
  title: string
  body: string
}
interface IncidentShape {
  name?: string
  status?: string
  impact?: string
  incident_updates?: Array<{ body?: string }>
}
interface ComponentShape {
  name?: string
  status?: string
}
interface ComponentUpdateShape {
  old_status?: string
  new_status?: string
}

function renderIncident(incident: IncidentShape): Push {
  const latest = incident.incident_updates?.[0]?.body
  const impact = incident.impact && incident.impact !== 'none' ? ` [${incident.impact}]` : ''
  const status = `${incident.status ?? ''}${impact}`.trim()
  return {
    title: `Claude: ${incident.name ?? 'incident update'}`,
    body: [status, latest].filter(Boolean).join(' - ') || 'incident updated',
  }
}

function renderComponent(component: ComponentShape | undefined, update: ComponentUpdateShape | undefined): Push {
  const name = component?.name ?? 'component'
  const to = update?.new_status ?? component?.status ?? 'updated'
  return {
    title: `Claude: ${name} ${to}`,
    body: update?.old_status ? `${update.old_status} -> ${to}` : to,
  }
}

function renderPush(payload: Record<string, unknown>): Push {
  const incident = payload.incident as IncidentShape | undefined
  if (incident) return renderIncident(incident)

  const component = payload.component as ComponentShape | undefined
  const update = payload.component_update as ComponentUpdateShape | undefined
  if (component || update) return renderComponent(component, update)

  const page = payload.page as { status_description?: string } | undefined
  return { title: 'Claude status update', body: page?.status_description ?? 'status changed' }
}

/** Persist one event to the capped kv ring. Best-effort -- never throws. */
function persistEvent(store: StoreDriver, event: StatuspageEvent): void {
  try {
    const ring = store.kv.get<StatuspageEvent[]>(EVENTS_KEY) ?? []
    ring.push(event)
    if (ring.length > RING_CAP) ring.splice(0, ring.length - RING_CAP)
    store.kv.set(EVENTS_KEY, ring)
  } catch (err) {
    console.error('[statuspage] failed to persist event:', err instanceof Error ? err.message : err)
  }
}

export function createStatuspageWebhookRouter(store: StoreDriver, rclaudeSecret: string | undefined): Hono {
  const app = new Hono()
  const expected = rclaudeSecret ? webhookToken(rclaudeSecret) : null

  if (expected) console.log(`[statuspage] webhook receiver ready at POST /webhooks/statuspage/${expected}`)
  else console.warn('[statuspage] RCLAUDE_SECRET unset -- webhook receiver disabled (503 on hit)')

  app.post('/webhooks/statuspage/:token', async c => {
    const token = c.req.param('token')
    if (!expected) return c.json({ error: 'Webhook not configured' }, 503)
    // Constant-time compare; lengths are fixed (32 hex chars) so a mismatch is a 404.
    const ok = token.length === expected.length && timingSafeEqual(Buffer.from(token), Buffer.from(expected))
    if (!ok) return c.json({ error: 'Not found' }, 404)

    const raw = await c.req.text()
    let payload: Record<string, unknown>
    try {
      payload = raw ? JSON.parse(raw) : {}
    } catch {
      console.warn('[statuspage] non-JSON webhook body, ignoring:', raw.slice(0, 200))
      return c.json({ ok: true }) // ack so Statuspage doesn't retry-storm
    }

    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || undefined
    const { title, body } = renderPush(payload)

    persistEvent(store, { receivedAt: Date.now(), ip, pushTitle: title, pushBody: body, payload })
    console.log(
      `[statuspage] webhook received ip=${ip ?? '?'} title="${title}" body="${body}" payloadKeys=${Object.keys(payload).join(',')}`,
    )

    // No filters -- push every event to every subscribed user.
    sendPushToAll({ title, body, tag: 'claude-status', data: { source: 'statuspage' } })
      .then(r => console.log(`[statuspage] pushed: sent=${r.sent} failed=${r.failed}`))
      .catch(err => console.error('[statuspage] push failed:', err instanceof Error ? err.message : err))

    return c.json({ ok: true })
  })

  return app
}
