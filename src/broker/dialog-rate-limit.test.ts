import { describe, expect, it } from 'bun:test'
import { SlidingWindowRateLimiter } from './dialog-rate-limit'

describe('SlidingWindowRateLimiter', () => {
  it('allows up to max within the window, then rejects', () => {
    const rl = new SlidingWindowRateLimiter({ windowMs: 1000, max: 3 })
    expect(rl.check('k', 0)).toBe(true)
    expect(rl.check('k', 10)).toBe(true)
    expect(rl.check('k', 20)).toBe(true)
    expect(rl.check('k', 30)).toBe(false) // 4th in window -> rejected
  })

  it('frees capacity once old hits fall out of the window', () => {
    const rl = new SlidingWindowRateLimiter({ windowMs: 1000, max: 2 })
    expect(rl.check('k', 0)).toBe(true)
    expect(rl.check('k', 100)).toBe(true)
    expect(rl.check('k', 200)).toBe(false)
    // At t=1101 the first two hits (0, 100) are outside the 1000ms window.
    expect(rl.check('k', 1101)).toBe(true)
  })

  it('tracks keys independently and resets', () => {
    const rl = new SlidingWindowRateLimiter({ windowMs: 1000, max: 1 })
    expect(rl.check('a', 0)).toBe(true)
    expect(rl.check('b', 0)).toBe(true)
    expect(rl.check('a', 1)).toBe(false)
    rl.reset('a')
    expect(rl.check('a', 2)).toBe(true)
  })
})
