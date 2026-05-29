import { describe, expect, it } from 'bun:test'
import { MAX_RESUME_ATTEMPTS, type OrchestratorDeps, resumeRecap } from './orchestrator'

// Minimal fakes -- resumeRecap's guards + bookkeeping are synchronous; the
// scheduled background run is covered by map-stage.test.ts. We make the broker
// store throw so the scheduled run dies immediately (caught) without touching
// real data; our assertions are all on the synchronous return + the patches.

interface FakeOpts {
  row?: Record<string, unknown> | null
  manifest?: Record<string, unknown> | null
  parsedChunks?: Set<number> // which chunk indices have a persisted extraction
}

function makeDeps(opts: FakeOpts) {
  const storeUpdates: Array<Record<string, unknown>> = []
  const manifestPatches: Array<Record<string, unknown>> = []
  const deps = {
    store: {
      get: () => opts.row ?? null,
      update: (_id: string, patch: Record<string, unknown>) => storeUpdates.push(patch),
    },
    brokerStore: new Proxy(
      {},
      {
        get: () => () => {
          throw new Error('fake brokerStore -- scheduled run is not under test')
        },
      },
    ),
    broadcaster: { broadcast: () => {} },
    // Proxy: the 3 methods resumeRecap reads synchronously are real; every other
    // bundle method (used only by the background run) is a no-op, so the run
    // fails cleanly at the stubbed brokerStore instead of a missing-method error.
    bundle: new Proxy(
      {
        readManifest: () => opts.manifest ?? null,
        readMapParsed: (_id: string, i: number) => (opts.parsedChunks?.has(i) ? { keywords: [] } : null),
        updateManifest: (_id: string, patch: Record<string, unknown>) => manifestPatches.push(patch),
      } as Record<string, unknown>,
      { get: (t, k) => t[k as string] ?? (() => undefined) },
    ),
  } as unknown as OrchestratorDeps
  return { deps, storeUpdates, manifestPatches }
}

const baseRow = {
  id: 'recap_x',
  projectUri: 'claude://default/p',
  periodLabel: 'last_30',
  periodStart: 1,
  periodEnd: 2,
  timeZone: 'UTC',
  audience: 'human',
  status: 'partial',
  signalsJson: '["commits"]',
  argsJson: '{"chunkSize":90000}',
}
const baseManifest = {
  mode: 'chunked',
  chunkCount: 3,
  period: { label: 'last_30', human: 'Last 30 days', isoRange: '...' },
  models: { map: 'm', reduce: 'r' },
}

describe('resumeRecap guards', () => {
  it('throws when the recap is not found', () => {
    const { deps } = makeDeps({ row: null })
    expect(() => resumeRecap(deps, 'recap_x')).toThrow(/not found/)
  })

  it('refuses a non-chunked recap (nothing to reuse)', () => {
    const { deps } = makeDeps({ row: baseRow, manifest: { ...baseManifest, mode: 'oneshot' } })
    expect(() => resumeRecap(deps, 'recap_x')).toThrow(/only applies to chunked/)
  })

  it('refuses a recap still in flight', () => {
    const { deps } = makeDeps({ row: { ...baseRow, status: 'rendering' }, manifest: baseManifest })
    expect(() => resumeRecap(deps, 'recap_x')).toThrow(/nothing to resume/)
  })

  it('refuses + marks failed once the resume cap is hit', () => {
    const { deps, storeUpdates } = makeDeps({
      row: baseRow,
      manifest: { ...baseManifest, resumeCount: MAX_RESUME_ATTEMPTS },
    })
    expect(() => resumeRecap(deps, 'recap_x')).toThrow(/resume cap/)
    expect(storeUpdates.some(p => p.status === 'failed')).toBe(true)
  })
})

describe('resumeRecap happy path', () => {
  it('counts reusable chunks, increments resumeCount, flips status to rendering', () => {
    const { deps, storeUpdates, manifestPatches } = makeDeps({
      row: baseRow,
      manifest: baseManifest,
      parsedChunks: new Set([0, 1]), // chunk 2 missing -> only it will be re-mapped
    })
    const result = resumeRecap(deps, 'recap_x')
    expect(result.totalChunks).toBe(3)
    expect(result.reusableChunks).toBe(2)
    expect(result.resumeCount).toBe(1)
    expect(manifestPatches.some(p => p.resumeCount === 1 && p.status === 'rendering')).toBe(true)
    expect(storeUpdates.some(p => p.status === 'rendering' && p.progress === 0)).toBe(true)
  })
})
