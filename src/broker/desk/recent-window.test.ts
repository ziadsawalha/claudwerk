import { afterEach, describe, expect, test } from 'bun:test'
import { clearRecentWindows, recentTurns, recordDispatchTurn } from './recent-window'

afterEach(() => clearRecentWindows())

const HOUR = 3_600_000

describe('recent-window', () => {
  test('records and returns turns newest-last, scoped per user', () => {
    recordDispatchTurn('jonas', { ts: 1, intent: 'a', reply: 'ra' })
    recordDispatchTurn('jonas', { ts: 2, intent: 'b', reply: 'rb' })
    recordDispatchTurn('other', { ts: 3, intent: 'c', reply: 'rc' })
    expect(recentTurns('jonas', 3).map(t => t.intent)).toEqual(['a', 'b'])
    expect(recentTurns('other', 3).map(t => t.intent)).toEqual(['c'])
  })

  test('prunes turns older than the live window', () => {
    recordDispatchTurn('jonas', { ts: 0, intent: 'old', reply: 'r' })
    recordDispatchTurn('jonas', { ts: HOUR, intent: 'new', reply: 'r' })
    expect(recentTurns('jonas', HOUR).map(t => t.intent)).toEqual(['new'])
  })

  test('caps the number of retained turns', () => {
    for (let i = 0; i < 20; i++) recordDispatchTurn('jonas', { ts: i, intent: `i${i}`, reply: 'r' })
    expect(recentTurns('jonas', 20).length).toBeLessThanOrEqual(12)
  })

  test('a turn with no reply is not recorded', () => {
    recordDispatchTurn('jonas', { ts: 1, intent: 'x', reply: '   ' })
    expect(recentTurns('jonas', 1)).toHaveLength(0)
  })

  test('null userId shares a default window', () => {
    recordDispatchTurn(null, { ts: 1, intent: 'anon', reply: 'r' })
    expect(recentTurns(null, 1)).toHaveLength(1)
  })
})
