import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readChronicle } from './chronicle'
import type { SotuProjectConfig } from './config'
import { clearContributionHandlers, recordContribution } from './contribute'
import type { ChatFn } from './distill/llm'
import { decideTrigger, maybeDistillOnRead, type SotuEngineDeps, startSotuEngine, stopSotuEngine } from './engine'
import { initSotuStore, projectSlug } from './index'
import { writeState } from './state'

const PROJECT = '/Users/jonas/projects/remote-claude'
const NOW = 1_000_000
const ENABLED: SotuProjectConfig = { enabled: true, budget: {} }
const T = { burst: 10, minIntervalMs: 5 * 60_000, quietSettleMs: 90_000 }
let dir: string
let slug: string

const CHRON = JSON.stringify({ now: [], justDone: [], narrative: 'folded' })

function stubChat(): { fn: ChatFn; calls: number } {
  const state = { fn: (() => {}) as unknown as ChatFn, calls: 0 }
  state.fn = async () => {
    state.calls++
    return {
      content: CHRON,
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.01,
        costSource: 'litellm' as const,
      },
    }
  }
  return state
}

function start(chat: ChatFn, over: Partial<SotuEngineDeps> = {}): void {
  startSotuEngine({
    chat,
    broadcast: () => {},
    resolveConfig: () => ENABLED,
    now: () => NOW,
    reconcileBurst: 10_000,
    ...over,
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sotu-engine-'))
  initSotuStore(dir)
  slug = projectSlug(PROJECT)
})
afterEach(() => {
  stopSotuEngine()
  clearContributionHandlers()
  rmSync(dir, { recursive: true, force: true })
})

// ─── decideTrigger (pure policy) ────────────────────────────────────

test('decideTrigger: nothing pending -> none', () => {
  expect(decideTrigger(0, 10 * 60_000, T)).toEqual({ action: 'none' })
})

test('decideTrigger: BURST past the cost floor -> fire now', () => {
  expect(decideTrigger(10, 6 * 60_000, T)).toEqual({ action: 'now' })
})

test('decideTrigger: BURST still inside MIN_INTERVAL -> arm at floor-remaining', () => {
  // elapsed 1min, floor 5min -> wait the remaining 4min (>= quiet-settle).
  expect(decideTrigger(20, 60_000, T)).toEqual({ action: 'arm', delayMs: 4 * 60_000 })
})

test('decideTrigger: a trickle past the floor -> arm at QUIET_SETTLE', () => {
  expect(decideTrigger(3, 6 * 60_000, T)).toEqual({ action: 'arm', delayMs: 90_000 })
})

// ─── integration: contributions drive distills ─────────────────────

test('a BURST of contributions fires a distill immediately', async () => {
  const chat = stubChat()
  start(chat.fn, { burstThreshold: 2, minIntervalMs: 0, quietSettleMs: 5 })
  recordContribution(
    slug,
    { kind: 'callout', convId: 'c1', ts: 10, type: 'lock', payload: 'x', weight: 'high' },
    PROJECT,
  )
  await Bun.sleep(25)
  expect(chat.calls).toBe(1)
  expect(readChronicle(slug).narrative).toBe('folded')
})

test('a trickle arms a trailing timer that folds after QUIET_SETTLE', async () => {
  const chat = stubChat()
  start(chat.fn, { burstThreshold: 1_000, minIntervalMs: 0, quietSettleMs: 10 })
  recordContribution(slug, { kind: 'turn_digest', convId: 'c1', ts: 10, intent: 'x' }, PROJECT)
  expect(chat.calls).toBe(0) // not yet -- armed, not fired
  await Bun.sleep(40)
  expect(chat.calls).toBe(1)
})

test('a project-less contribution never triggers a distill', async () => {
  const chat = stubChat()
  start(chat.fn, { burstThreshold: 1, minIntervalMs: 0, quietSettleMs: 5 })
  recordContribution(slug, { kind: 'turn_digest', convId: 'c1', ts: 10 }) // no project arg
  await Bun.sleep(20)
  expect(chat.calls).toBe(0)
})

// ─── STALE_ON_READ ──────────────────────────────────────────────────

test('maybeDistillOnRead forces a reconcile when the chronicle is stale', async () => {
  const chat = stubChat()
  start(chat.fn, { staleOnReadMs: 1_000 }) // genAt 0, now 1e6 -> stale
  const out = await maybeDistillOnRead(PROJECT)
  expect(out).toMatchObject({ status: 'distilled', mode: 'reconcile' })
  expect(chat.calls).toBe(2) // scribe + reconcile (the "wither on return" re-ground)
})

test('maybeDistillOnRead is a no-op when fresh + nothing pending', async () => {
  const chat = stubChat()
  start(chat.fn, { staleOnReadMs: 1_000 })
  writeState(slug, { lastDistillAt: NOW, pendingContribs: 0, genAt: NOW, pipelineVersion: 1 })
  const out = await maybeDistillOnRead(PROJECT)
  expect(out).toBeNull()
  expect(chat.calls).toBe(0)
})
