/**
 * Sentinel management routes -- /api/sentinels
 * Admin-only CRUD for sentinel hosts.
 */

import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import type { SelectionMode, SentinelPatchConfig, SentinelProfileInfo } from '../../shared/protocol'
import type { ConversationStore } from '../conversation-store'
import { isValidSentinelAlias, type SentinelRegistry } from '../sentinel-registry'
import type { RouteHelpers } from './shared'

const POOL_NAME_RE = /^[a-z0-9-]{1,63}$/
const PROFILE_NAME_RE = /^[a-z0-9-]{1,63}$/

/**
 * Build a typed `sentinel_patch_config` from an untrusted REST body. Returns
 * `{ error }` on a malformed shape, or `{ patch }` with ONLY the broker-tunable
 * fields (per-profile weight / pool / label / color, sentinel-wide
 * defaultSelection / defaultPool).
 *
 * PROFILE-ENV BOUNDARY: this builder names no `configDir` / `env` / `spawnRoot`
 * field -- they are not part of `SentinelPatchConfig` and any such key in the
 * body is silently dropped here. The sentinel re-validates + enforces too.
 */
// fallow-ignore-next-line complexity
export function buildPatchFromBody(body: unknown, patchId: string): { patch: SentinelPatchConfig } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'body must be an object' }
  const b = body as Record<string, unknown>
  const patch: SentinelPatchConfig = { type: 'sentinel_patch_config', patchId }

  if (b.profiles !== undefined) {
    if (typeof b.profiles !== 'object' || b.profiles === null || Array.isArray(b.profiles)) {
      return { error: 'profiles must be an object keyed by profile name' }
    }
    const out: NonNullable<SentinelPatchConfig['profiles']> = {}
    for (const [name, raw] of Object.entries(b.profiles as Record<string, unknown>)) {
      if (!PROFILE_NAME_RE.test(name)) return { error: `profile name "${name}" must match [a-z0-9-]{1,63}` }
      if (!raw || typeof raw !== 'object') return { error: `profile "${name}" patch must be an object` }
      const r = raw as Record<string, unknown>
      const entry: NonNullable<SentinelPatchConfig['profiles']>[string] = {}
      if (r.weight !== undefined) {
        if (typeof r.weight !== 'number' || !Number.isFinite(r.weight) || r.weight < 0) {
          return { error: `profile "${name}".weight must be a finite number >= 0` }
        }
        entry.weight = r.weight
      }
      if (r.pool !== undefined) {
        if (r.pool !== null && (typeof r.pool !== 'string' || !POOL_NAME_RE.test(r.pool))) {
          return { error: `profile "${name}".pool must match [a-z0-9-]{1,63} or be null` }
        }
        entry.pool = r.pool as string | null
      }
      if (r.label !== undefined) {
        if (typeof r.label !== 'string') return { error: `profile "${name}".label must be a string` }
        entry.label = r.label
      }
      if (r.color !== undefined) {
        if (typeof r.color !== 'string') return { error: `profile "${name}".color must be a string` }
        entry.color = r.color
      }
      out[name] = entry
    }
    patch.profiles = out
  }

  if (b.defaultSelection !== undefined) {
    if (b.defaultSelection !== 'default' && b.defaultSelection !== 'balanced' && b.defaultSelection !== 'random') {
      return { error: 'defaultSelection must be one of "default", "balanced", "random"' }
    }
    patch.defaultSelection = b.defaultSelection as SelectionMode
  }
  if (b.defaultPool !== undefined) {
    if (typeof b.defaultPool !== 'string' || !POOL_NAME_RE.test(b.defaultPool)) {
      return { error: 'defaultPool must match [a-z0-9-]{1,63}' }
    }
    patch.defaultPool = b.defaultPool
  }

  const hasAny =
    (patch.profiles && Object.keys(patch.profiles).length > 0) ||
    patch.defaultSelection !== undefined ||
    patch.defaultPool !== undefined
  if (!hasAny) return { error: 'patch is empty (nothing to change)' }

  return { patch }
}

export function createSentinelRouter(
  sentinelRegistry: SentinelRegistry,
  conversationStore: ConversationStore,
  helpers: RouteHelpers,
): Hono {
  const { httpIsAdmin } = helpers
  const app = new Hono()

  // ─── Create sentinel ──────────────────────────────────────────────────
  app.post('/api/sentinels/create', async c => {
    if (!httpIsAdmin(c.req.raw)) return c.json({ error: 'Admin access required' }, 403)

    const body = (await c.req.json()) as { alias?: string; color?: string }
    const alias = body.alias?.trim().toLowerCase()

    if (!alias) return c.json({ error: 'alias is required' }, 400)
    if (!isValidSentinelAlias(alias)) {
      return c.json({ error: 'Invalid alias: must be lowercase alphanumeric with hyphens, 1-63 chars' }, 400)
    }

    const existing = sentinelRegistry.findByAlias(alias)
    if (existing) return c.json({ error: `Alias "${alias}" already exists` }, 409)

    const record = sentinelRegistry.create({
      alias,
      color: body.color,
      generateSecret: true,
    })

    return c.json({
      sentinelId: record.sentinelId,
      sentinelSecret: record.rawSecret,
      alias: record.aliases[0],
      isDefault: record.isDefault,
      color: record.color,
    })
  })

  // ─── List sentinels ────────────────────────────────────────────────────
  // fallow-ignore-next-line complexity
  app.get('/api/sentinels', c => {
    if (!httpIsAdmin(c.req.raw)) return c.json({ error: 'Admin access required' }, 403)

    const all = sentinelRegistry.getAll()
    const result: Array<{
      sentinelId: string
      alias: string
      aliases: string[]
      isDefault: boolean
      color?: string
      connected: boolean
      hostname?: string
      spawnRoot?: string
      createdAt: number
      /** Sentinel-reported profile NAMES + display only (Profile-Env Boundary).
       *  Present when the sentinel is connected AND reported a non-empty
       *  profiles list. Stale offline sentinels do NOT carry profiles. */
      profiles?: SentinelProfileInfo[]
      defaultSelection?: SelectionMode
      pools?: string[]
      defaultPool?: string
    }> = []

    for (const [sentinelId, record] of all) {
      const conn = conversationStore.getSentinelConnection(sentinelId)
      result.push({
        sentinelId,
        alias: record.aliases[0],
        aliases: record.aliases,
        isDefault: record.isDefault,
        color: record.color,
        connected: !!conn,
        hostname: conn?.hostname,
        spawnRoot: conn?.spawnRoot,
        createdAt: record.createdAt,
        profiles: conn?.profiles,
        defaultSelection: conn?.defaultSelection,
        pools: conn?.pools,
        defaultPool: conn?.defaultPool,
      })
    }

    return c.json(result)
  })

  // ─── Update sentinel ──────────────────────────────────────────────────
  app.post('/api/sentinels/:id', async c => {
    if (!httpIsAdmin(c.req.raw)) return c.json({ error: 'Admin access required' }, 403)

    const sentinelId = c.req.param('id')
    const body = (await c.req.json()) as { alias?: string; isDefault?: boolean; color?: string }

    if (body.alias !== undefined) {
      const alias = body.alias.trim().toLowerCase()
      if (!isValidSentinelAlias(alias)) {
        return c.json({ error: 'Invalid alias: must be lowercase alphanumeric with hyphens, 1-63 chars' }, 400)
      }
      const existing = sentinelRegistry.findByAlias(alias)
      if (existing && existing.sentinelId !== sentinelId) {
        return c.json({ error: `Alias "${alias}" already in use` }, 409)
      }
      body.alias = alias
    }

    const updated = sentinelRegistry.update(sentinelId, body)
    if (!updated) return c.json({ error: 'Sentinel not found' }, 404)

    return c.json({
      sentinelId: updated.sentinelId,
      alias: updated.aliases[0],
      aliases: updated.aliases,
      isDefault: updated.isDefault,
      color: updated.color,
    })
  })

  // ─── Read per-profile usage for one sentinel ──────────────────────────
  //
  // Returns the latest batched `sentinel_usage_report` snapshots the broker
  // has from this sentinel. 404 when the sentinel is unknown / offline /
  // hasn't reported yet. Used by the control panel for hydration on
  // reconnect (Phase 4) -- the live updates flow through the WS broadcast.
  //
  // Snapshots carry NAMES + utilisation numbers only -- Profile-Env Boundary
  // is preserved end-to-end (the sentinel sanitises at the wire, the broker
  // re-sanitises in the handler, this route just emits what's stored).
  app.get('/api/sentinels/:id/usage', c => {
    if (!httpIsAdmin(c.req.raw)) return c.json({ error: 'Admin access required' }, 403)
    const sentinelId = c.req.param('id')
    const usage = conversationStore.getSentinelProfileUsage(sentinelId)
    if (!usage) return c.json({ error: 'No usage data for sentinel' }, 404)
    return c.json(usage)
  })

  // ─── Patch sentinel config (broker-tunable subset) ────────────────────
  //
  // Phase 8 of `.claude/docs/plan-sentinel-profiles.md`. Forwards a single
  // batched `sentinel_patch_config` to the connected sentinel and relays the
  // ack. Tunes per-profile weight / pool / label / color and sentinel-wide
  // defaultSelection / defaultPool ONLY -- never configDir / env / spawnRoot,
  // never add/remove profiles (those bind a name to host filesystem +
  // credentials and stay sentinel-local CLI-only -- Profile-Env Boundary).
  //
  // The broker forwards the patch verbatim; on a successful ack the
  // `sentinel_patch_config_ack` handler refreshes the stored profile registry
  // from the `applied` snapshot. This route just relays the outcome.
  // fallow-ignore-next-line complexity
  app.post('/api/sentinels/:id/config', async c => {
    if (!httpIsAdmin(c.req.raw)) return c.json({ error: 'Admin access required' }, 403)

    const sentinelId = c.req.param('id')
    const conn = conversationStore.getSentinelConnection(sentinelId)
    if (!conn) return c.json({ error: 'Sentinel not connected' }, 503)

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const patchId = randomUUID()
    const built = buildPatchFromBody(body, patchId)
    if ('error' in built) return c.json({ error: built.error }, 400)

    // Send the patch over the sentinel WS and await the ack (correlated by
    // patchId). Mirrors the list_dirs / cc-sessions request-response idiom.
    const result = await new Promise<{ ok: boolean; error?: string; detail?: string }>(resolve => {
      const timeout = setTimeout(() => {
        conversationStore.removePatchListener(patchId)
        resolve({ ok: false, error: 'timeout', detail: 'sentinel did not ack within 10s' })
      }, 10_000)
      conversationStore.addPatchListener(patchId, msg => {
        clearTimeout(timeout)
        resolve(msg as { ok: boolean; error?: string; detail?: string })
      })
      try {
        conn.ws.send(JSON.stringify(built.patch))
      } catch (e) {
        clearTimeout(timeout)
        conversationStore.removePatchListener(patchId)
        resolve({ ok: false, error: 'send_failed', detail: (e as Error).message })
      }
    })

    if (!result.ok) {
      return c.json({ ok: false, error: result.error, detail: result.detail }, 400)
    }
    return c.json({ ok: true })
  })

  // ─── Delete sentinel ──────────────────────────────────────────────────
  app.delete('/api/sentinels/:id', c => {
    if (!httpIsAdmin(c.req.raw)) return c.json({ error: 'Admin access required' }, 403)

    const sentinelId = c.req.param('id')
    const record = sentinelRegistry.get(sentinelId)
    if (!record) return c.json({ error: 'Sentinel not found' }, 404)

    // Disconnect sentinel if online
    const conn = conversationStore.getSentinelConnection(sentinelId)
    if (conn) {
      try {
        conn.ws.close(4403, 'Sentinel revoked')
      } catch {}
    }

    sentinelRegistry.remove(sentinelId)
    return c.json({ ok: true })
  })

  return app
}
