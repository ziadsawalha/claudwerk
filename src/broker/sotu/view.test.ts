import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeChronicle } from './chronicle'
import { recordContribution } from './contribute'
import { initSotuStore } from './index'
import type { CalloutContrib, GitScanContrib } from './types'
import { emptyChronicle } from './types'
import { buildSotuView, deriveAlerts, deriveHolds, renderSotuBrief } from './view'

const SLUG = 'remote-claude'
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sotu-view-'))
  initSotuStore(dir)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const claim = (over: Partial<CalloutContrib> = {}): CalloutContrib => ({
  kind: 'callout',
  convId: 'conv-a',
  ts: 1000,
  type: 'lock',
  payload: 'editing',
  weight: 'high',
  target: { kind: 'claim', path: 'src/broker/permissions.ts' },
  ...over,
})

test('deriveHolds groups a single claim with one holder, not contended', () => {
  const holds = deriveHolds([claim()])
  expect(holds).toHaveLength(1)
  expect(holds[0]).toMatchObject({ kind: 'claim', target: 'src/broker/permissions.ts', contended: false })
  expect(holds[0].holders).toEqual([{ convId: 'conv-a', since: 1000 }])
})

test('deriveHolds flags CONTENDED when two distinct convs claim the same path', () => {
  const holds = deriveHolds([
    claim({ convId: 'conv-a', ts: 1000 }),
    claim({ convId: 'conv-b', ts: 2000, path: './src/broker/permissions.ts' } as Partial<CalloutContrib>),
  ])
  expect(holds).toHaveLength(1)
  expect(holds[0].contended).toBe(true)
  expect(holds[0].holders.map(h => h.convId).sort()).toEqual(['conv-a', 'conv-b'])
})

test('deriveHolds: same conv re-stating a claim is ONE holder (keeps earliest ts)', () => {
  const holds = deriveHolds([claim({ ts: 5000 }), claim({ ts: 1000 })])
  expect(holds[0].holders).toEqual([{ convId: 'conv-a', since: 1000 }])
  expect(holds[0].contended).toBe(false)
})

test('deriveHolds: tagged stakes collide by tag; etaHint/scope surface', () => {
  const stakeA: CalloutContrib = {
    kind: 'callout',
    convId: 'conv-a',
    ts: 1000,
    type: 'focus',
    payload: 'reworking identity',
    weight: 'high',
    target: { kind: 'stake', concept: 'identity model', tag: 'identity-model', etaHint: '~1h', scope: 'rekey path' },
  }
  const stakeB: CalloutContrib = {
    ...stakeA,
    convId: 'conv-b',
    ts: 2000,
    target: { kind: 'stake', concept: 'the identity rekey', tag: 'identity-model' },
  }
  const holds = deriveHolds([stakeA, stakeB])
  expect(holds).toHaveLength(1)
  expect(holds[0]).toMatchObject({
    kind: 'stake',
    tag: 'identity-model',
    etaHint: '~1h',
    scope: 'rekey path',
    contended: true,
  })
})

test('deriveHolds ignores callouts without a target + non-callout contribs', () => {
  const noTarget: CalloutContrib = {
    kind: 'callout',
    convId: 'c',
    ts: 1,
    type: 'insight',
    payload: 'x',
    weight: 'high',
  }
  const git: GitScanContrib = { kind: 'git_scan', convId: '', ts: 2, git: { branches: [], scannedAt: 2 } }
  expect(deriveHolds([noTarget, git])).toEqual([])
})

test('deriveAlerts unions + dedupes alerts across branches', () => {
  const fabric = {
    scannedAt: 1,
    branches: [
      {
        branch: 'a',
        aheadOrigin: 1,
        behindOrigin: 0,
        aheadLocal: 1,
        behindLocal: 0,
        integration: 'merge-clean' as const,
        alerts: ['at-risk' as const],
      },
      {
        branch: 'b',
        aheadOrigin: 0,
        behindOrigin: 9,
        aheadLocal: 0,
        behindLocal: 9,
        integration: 'merge-clean' as const,
        alerts: ['at-risk' as const, 'stalled' as const],
      },
    ],
  }
  expect(deriveAlerts(fabric).sort()).toEqual(['at-risk', 'stalled'])
  expect(deriveAlerts(undefined)).toEqual([])
})

test('buildSotuView fuses chronicle + live floor', () => {
  const chron = emptyChronicle(5000)
  chron.narrative = 'Two convs converging on the auth refactor.'
  writeChronicle(SLUG, chron)
  recordContribution(SLUG, claim({ convId: 'conv-a', ts: 1000 }))
  recordContribution(SLUG, claim({ convId: 'conv-b', ts: 2000 }))

  const view = buildSotuView({ slug: SLUG, project: 'claude://h/remote-claude', enabled: true, now: 10_000 })
  expect(view.enabled).toBe(true)
  expect(view.chronicle.narrative).toContain('auth refactor')
  expect(view.holds[0].contended).toBe(true)
  expect(view.builtAt).toBe(10_000)
})

test('renderSotuBrief surfaces narrative + CONTENDED + spoken-for + alerts', () => {
  const view = {
    project: 'p',
    enabled: true,
    builtAt: 0,
    chronicle: { ...emptyChronicle(0), narrative: 'Where we are: mid auth refactor.' },
    holds: [
      {
        kind: 'claim' as const,
        target: 'src/auth.ts',
        holders: [
          { convId: 'a', since: 1 },
          { convId: 'b', since: 2 },
        ],
        contended: true,
      },
      {
        kind: 'stake' as const,
        target: 'recap-engine',
        etaHint: '~1h',
        holders: [{ convId: 'c', since: 3 }],
        contended: false,
      },
    ],
    alerts: ['at-risk' as const, 'unpushed' as const],
  }
  const brief = renderSotuBrief(view, 'remote-claude')
  expect(brief).toContain('State of the Union -- remote-claude')
  expect(brief).toContain('mid auth refactor')
  expect(brief).toContain('CONTENDED')
  expect(brief).toContain('src/auth.ts')
  expect(brief).toContain('Spoken for')
  expect(brief).toContain('"recap-engine"')
  expect(brief).toContain('Git alerts: at-risk, unpushed.')
})

test('renderSotuBrief returns empty string when there is nothing to say', () => {
  const view = { project: 'p', enabled: true, builtAt: 0, chronicle: emptyChronicle(0), holds: [], alerts: [] }
  expect(renderSotuBrief(view, 'x')).toBe('')
})
