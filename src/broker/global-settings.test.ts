import { afterAll, describe, expect, it } from 'bun:test'
import { getGlobalSettings, initGlobalSettings, updateGlobalSettings } from './global-settings'
import type { KVStore } from './store/types'

/** Map-backed KVStore for driving initGlobalSettings without a real store. */
function fakeKv(initial?: Record<string, unknown>): KVStore {
  const map = new Map<string, unknown>()
  if (initial) map.set('global-settings', initial)
  return {
    get: <T = unknown>(key: string): T | null => (map.has(key) ? (map.get(key) as T) : null),
    set: <T = unknown>(key: string, value: T): void => {
      map.set(key, value)
    },
    delete: (key: string): boolean => map.delete(key),
    keys: (prefix?: string): string[] => [...map.keys()].filter(k => !prefix || k.startsWith(prefix)),
  }
}

// The module holds a singleton; restore pristine defaults so later test files
// do not inherit this file's mutations.
afterAll(() => initGlobalSettings(fakeKv({})))

describe('global-settings defaultTransport (transport reframe Phase 3)', () => {
  it('schema default: defaultTransport.claude is claude-pty', () => {
    initGlobalSettings(fakeKv())
    expect(getGlobalSettings().defaultTransport.claude).toBe('claude-pty')
  })

  it('within-object default fills claude when defaultTransport is set without it', () => {
    initGlobalSettings(fakeKv({ defaultTransport: {} }))
    expect(getGlobalSettings().defaultTransport.claude).toBe('claude-pty')
  })

  it('migrates a legacy defaultBackend=daemon blob into defaultTransport.claude=claude-daemon', () => {
    initGlobalSettings(fakeKv({ defaultBackend: 'daemon' }))
    const s = getGlobalSettings()
    expect(s.defaultTransport.claude).toBe('claude-daemon')
    // legacy field preserved for the dual-read fallback (dropped in Phase 6).
    expect(s.defaultBackend).toBe('daemon')
  })

  it('migrates legacy defaultBackend=headless into claude-headless', () => {
    initGlobalSettings(fakeKv({ defaultBackend: 'headless' }))
    expect(getGlobalSettings().defaultTransport.claude).toBe('claude-headless')
  })

  it('migrates legacy defaultBackend=pty into claude-pty', () => {
    initGlobalSettings(fakeKv({ defaultBackend: 'pty' }))
    expect(getGlobalSettings().defaultTransport.claude).toBe('claude-pty')
  })

  it('does not overwrite an explicit defaultTransport with the legacy field', () => {
    initGlobalSettings(fakeKv({ defaultBackend: 'daemon', defaultTransport: { claude: 'claude-pty' } }))
    expect(getGlobalSettings().defaultTransport.claude).toBe('claude-pty')
  })

  it('updateGlobalSettings persists a new defaultTransport value', () => {
    initGlobalSettings(fakeKv())
    const { settings } = updateGlobalSettings({ defaultTransport: { claude: 'claude-daemon' } })
    expect(settings.defaultTransport.claude).toBe('claude-daemon')
  })

  it('updateGlobalSettings still accepts the legacy defaultBackend field', () => {
    initGlobalSettings(fakeKv())
    const { settings, errors } = updateGlobalSettings({ defaultBackend: 'daemon' })
    expect(errors).toBeUndefined()
    expect(settings.defaultBackend).toBe('daemon')
  })
})
