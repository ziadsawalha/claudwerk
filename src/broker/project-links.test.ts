import { beforeEach, describe, expect, test } from 'bun:test'
import {
  addPersistedLink,
  clearLinksForProject,
  findLink,
  getPersistedLinks,
  initProjectLinks,
  removePersistedLink,
} from './project-links'
import type { KVStore } from './store/types'

function makeKV(): KVStore {
  const map = new Map<string, unknown>()
  return {
    get: <T = unknown>(key: string) => (map.has(key) ? (map.get(key) as T) : null),
    set: (key: string, value: unknown) => {
      map.set(key, value)
    },
    delete: (key: string) => map.delete(key),
    keys: (prefix?: string) => [...map.keys()].filter(k => !prefix || k.startsWith(prefix)),
  }
}

beforeEach(() => {
  initProjectLinks(makeKV())
})

describe('persisted project links - canonical matching', () => {
  // Regression: removal keyed on the raw URI string silently missed when the
  // stored surface form differed from the URI the control panel sent on delete
  // (empty vs `default` authority, trailing slash, scheme case). The link then
  // reappeared on refetch -- the "can't remove links" bug.
  test('removes a link sent in a different-but-equivalent surface form', () => {
    addPersistedLink('claude:///Users/jonas/projects/alpha', 'claude:///Users/jonas/projects/beta')
    expect(getPersistedLinks()).toHaveLength(1)

    // Control panel sends the canonical `default`-authority form on delete.
    const removed = removePersistedLink(
      'claude://default/Users/jonas/projects/alpha',
      'claude://default/Users/jonas/projects/beta',
    )

    expect(removed).toBe(true)
    expect(getPersistedLinks()).toHaveLength(0)
  })

  test('removal is order-independent and tolerant of trailing slash', () => {
    addPersistedLink('claude://default/Users/jonas/projects/alpha', 'claude://default/Users/jonas/projects/beta')

    const removed = removePersistedLink(
      'claude://default/Users/jonas/projects/beta/',
      'claude:///Users/jonas/projects/alpha',
    )

    expect(removed).toBe(true)
    expect(getPersistedLinks()).toHaveLength(0)
  })

  test('findLink matches across surface forms', () => {
    addPersistedLink('claude:///Users/jonas/projects/alpha', 'claude:///Users/jonas/projects/beta')
    expect(
      findLink('claude://default/Users/jonas/projects/alpha', 'claude://default/Users/jonas/projects/beta'),
    ).not.toBeNull()
  })

  test('addPersistedLink dedupes across surface forms', () => {
    addPersistedLink('claude:///Users/jonas/projects/alpha', 'claude:///Users/jonas/projects/beta')
    addPersistedLink('claude://default/Users/jonas/projects/beta', 'claude://default/Users/jonas/projects/alpha')
    expect(getPersistedLinks()).toHaveLength(1)
  })

  test('clearLinksForProject removes every link touching the focus project', () => {
    addPersistedLink('claude://default/Users/jonas/projects/alpha', 'claude://default/Users/jonas/projects/beta')
    addPersistedLink('claude://default/Users/jonas/projects/alpha', 'claude://default/Users/jonas/projects/gamma')
    addPersistedLink('claude://default/Users/jonas/projects/beta', 'claude://default/Users/jonas/projects/gamma')

    // Focus = alpha (sent in legacy empty-authority form). Both alpha links go;
    // the beta<->gamma link survives.
    const removed = clearLinksForProject('claude:///Users/jonas/projects/alpha')

    expect(removed).toHaveLength(2)
    expect(getPersistedLinks()).toHaveLength(1)
    const survivor = getPersistedLinks()[0]
    expect(survivor.projectA).toContain('beta')
    expect(survivor.projectB).toContain('gamma')
  })
})
