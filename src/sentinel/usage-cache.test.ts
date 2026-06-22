import { describe, expect, it } from 'bun:test'
import {
  buildCarriedSnapshot,
  defaultUsageCachePath,
  loadUsageCache,
  saveUsageCache,
  USAGE_CARRY_FORWARD_MAX_MS,
  type UsageCacheDeps,
} from './usage-cache'
import { rateLimitedSnapshot as errored, goodSnapshot as good, NOW } from './usage-test-fixtures'

/** In-memory fs double so the round-trip stays hermetic. */
function memFs(seed: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(seed))
  const fs: NonNullable<UsageCacheDeps['fs']> = {
    existsSync: ((p: string) => files.has(p)) as never,
    readFileSync: ((p: string) => {
      const v = files.get(p)
      if (v === undefined) throw new Error(`ENOENT: ${p}`)
      return v
    }) as never,
    writeFileSync: ((p: string, data: string) => {
      files.set(p, data)
    }) as never,
    mkdirSync: (() => undefined) as never,
  }
  return { files, fs }
}

describe('defaultUsageCachePath', () => {
  it('sits next to sentinel.json under the XDG config dir', () => {
    const p = defaultUsageCachePath({ XDG_CONFIG_HOME: '/cfg' }, '/home/u')
    expect(p).toBe('/cfg/rclaude/usage-cache.json')
  })

  it('falls back to ~/.config when XDG is unset', () => {
    const p = defaultUsageCachePath({}, '/home/u')
    expect(p).toBe('/home/u/.config/rclaude/usage-cache.json')
  })
})

describe('saveUsageCache / loadUsageCache round-trip', () => {
  it('persists only windowed snapshots and reads them back', () => {
    const { files, fs } = memFs()
    const path = '/cfg/rclaude/usage-cache.json'
    const ok = saveUsageCache([good(), errored], { path, fs })
    expect(ok).toBe(true)
    // The errored (no-windows) snapshot is dropped on write.
    const written = JSON.parse(files.get(path) as string)
    expect(written.version).toBe(1)
    expect(written.profiles).toHaveLength(1)
    expect(written.profiles[0].profile).toBe('default')

    const loaded = loadUsageCache({ path, fs })
    expect(loaded).toHaveLength(1)
    expect(loaded[0].fiveHour?.usedPercent).toBe(1)
    expect(loaded[0].polledAt).toBe(NOW)
  })

  it('returns [] for a missing file', () => {
    const { fs } = memFs()
    expect(loadUsageCache({ path: '/nope.json', fs })).toEqual([])
  })

  it('returns [] for a corrupt file', () => {
    const { fs } = memFs({ '/c.json': 'not json {{{' })
    expect(loadUsageCache({ path: '/c.json', fs })).toEqual([])
  })

  it('drops entries that lost their windows on a hand-edited file', () => {
    const { fs } = memFs({
      '/c.json': JSON.stringify({ version: 1, profiles: [{ profile: 'x', authed: true, polledAt: NOW }] }),
    })
    expect(loadUsageCache({ path: '/c.json', fs })).toEqual([])
  })
})

describe('buildCarriedSnapshot', () => {
  it('returns a stale-flagged copy when the last-good reading is recent', () => {
    const carried = buildCarriedSnapshot(good(), NOW + 5 * 60 * 1000)
    expect(carried).not.toBeNull()
    expect(carried?.stale).toBe(true)
    expect(carried?.fiveHour?.usedPercent).toBe(1)
    // polledAt stays the ORIGINAL reading time so the UI can render its age.
    expect(carried?.polledAt).toBe(NOW)
  })

  it('returns null past the max display age (the window has long since rolled)', () => {
    const carried = buildCarriedSnapshot(good(), NOW + USAGE_CARRY_FORWARD_MAX_MS + 1)
    expect(carried).toBeNull()
  })

  it('returns null when there is no windowed last-good reading', () => {
    expect(buildCarriedSnapshot(undefined, NOW)).toBeNull()
    expect(buildCarriedSnapshot(errored, NOW)).toBeNull()
  })
})
