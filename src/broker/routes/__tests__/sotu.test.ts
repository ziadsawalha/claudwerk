/**
 * Tests for /api/sotu -- the per-project State of the Union read surface.
 * Verifies: admin auth gate, missing-param 400, and a served view (chronicle
 * narrative + free-floor claims/CONTENDED) for a project.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import type { SotuView } from '../../../shared/protocol'
import { setRclaudeSecret } from '../../auth-routes'
import { initSotuStore, projectSlug } from '../../sotu'
import { writeChronicle } from '../../sotu/chronicle'
import { claimContrib } from '../../sotu/contrib-fixtures'
import { recordContribution } from '../../sotu/contribute'
import { emptyChronicle } from '../../sotu/types'
import { createRouteHelpers, type RouteHelpers } from '../shared'
import { createSotuRouter } from '../sotu'

const TEST_SECRET = 'test-secret-sotu-42'
const PROJECT = 'claude://host/sotu-route-proj'

let app: Hono
let helpers: RouteHelpers
let dir: string

beforeEach(() => {
  setRclaudeSecret(TEST_SECRET)
  helpers = createRouteHelpers(TEST_SECRET)
  dir = mkdtempSync(join(tmpdir(), 'sotu-route-'))
  initSotuStore(dir)
  app = new Hono()
  app.route('/', createSotuRouter(helpers))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const auth = () => ({ Authorization: `Bearer ${TEST_SECRET}` })

it('rejects a non-admin caller', async () => {
  const res = await app.request('/api/sotu?project=' + encodeURIComponent(PROJECT))
  expect(res.status).toBe(403)
})

it('400s without a project param', async () => {
  const res = await app.request('/api/sotu', { headers: auth() })
  expect(res.status).toBe(400)
})

it('serves the view (narrative + CONTENDED holds) for a project', async () => {
  const slug = projectSlug(PROJECT)
  const chron = emptyChronicle(1)
  chron.narrative = 'Mid auth refactor; two convs in flight.'
  writeChronicle(slug, chron)
  recordContribution(slug, claimContrib('conv-a', 1000))
  recordContribution(slug, claimContrib('conv-b', 2000))

  const res = await app.request('/api/sotu?project=' + encodeURIComponent(PROJECT), { headers: auth() })
  expect(res.status).toBe(200)
  const view = (await res.json()) as SotuView
  expect(view.project).toBe(PROJECT)
  expect(view.chronicle.narrative).toContain('auth refactor')
  expect(view.holds).toHaveLength(1)
  expect(view.holds[0]).toMatchObject({ target: 'src/auth.ts', contended: true })
})
