// Mac-platform terminal passthrough: a physical Ctrl+<key> combo inside an xterm
// is a terminal control code (Ctrl+D = EOF, Ctrl+C, ...) and must reach the PTY,
// never fire a dashboard shortcut. Cmd (mod) shortcuts still fire in the terminal.
//
// Separate file because isMac is resolved ONCE at module load -- this file mocks a
// Mac navigator before the dynamic import (key-layers.test.ts forces non-Mac).
if (typeof globalThis.KeyboardEvent === 'undefined') {
  globalThis.KeyboardEvent = class KeyboardEvent extends Event {
    readonly key: string
    readonly code: string
    readonly ctrlKey: boolean
    readonly metaKey: boolean
    readonly altKey: boolean
    readonly shiftKey: boolean
    constructor(type: string, init: KeyboardEventInit = {}) {
      super(type, init)
      this.key = init.key ?? ''
      this.code = init.code ?? ''
      this.ctrlKey = init.ctrlKey ?? false
      this.metaKey = init.metaKey ?? false
      this.altKey = init.altKey ?? false
      this.shiftKey = init.shiftKey ?? false
    }
  } as unknown as typeof KeyboardEvent
}
if (typeof globalThis.window === 'undefined') {
  const listeners: Record<string, ((...args: never[]) => unknown)[]> = {}
  globalThis.window = {
    addEventListener(type: string, fn: (...args: never[]) => unknown) {
      if (!listeners[type]) listeners[type] = []
      listeners[type].push(fn)
    },
    removeEventListener(type: string, fn: (...args: never[]) => unknown) {
      const arr = listeners[type]
      if (arr) listeners[type] = arr.filter(f => f !== fn)
    },
  } as unknown as Window & typeof globalThis
}
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    querySelector: () => null,
    activeElement: null,
  } as unknown as Document
}
// Force Mac platform so isMac resolves true (metaKey = mod, ctrlKey = physical Ctrl)
const realNavigator = globalThis.navigator
globalThis.navigator = {
  platform: 'MacIntel',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
} as unknown as Navigator

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `?mac` forces a SEPARATE module instance from key-layers.test.ts's non-Mac one.
// Under `bun test` all files share one module cache, so whichever imported plain
// './key-layers' first would freeze module-level `isMac` for everyone; the query
// suffix gives this file its own evaluation that sees the Mac navigator above.
const { _test } = await import('./key-layers.ts?mac')
globalThis.navigator = realNavigator

const { pushLayer, popLayer, dispatch, normalizeEvent, layers, resetDoubleTap } = _test

// A fake DOM target. closest('.xterm') returns a truthy node only when `inTerm`.
function makeTarget(inTerm: boolean): Element {
  const node = {} as Element
  return {
    tagName: 'DIV',
    isContentEditable: false,
    closest: (sel: string) => (inTerm && sel === '.xterm' ? node : null),
  } as unknown as Element
}

function key(
  k: string,
  mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; code: string }> = {},
  inTerminal = false,
): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods })
  Object.defineProperty(e, 'target', { value: makeTarget(inTerminal), configurable: true })
  return e
}

function clear() {
  while (layers.length > 0) popLayer(layers[0])
  resetDoubleTap()
}

describe('key-layers (Mac terminal passthrough)', () => {
  beforeEach(clear)
  afterEach(clear)

  it('normalizes physical Ctrl on Mac to ctrl+ (not mod+)', () => {
    expect(normalizeEvent(key('d', { ctrlKey: true }))).toBe('ctrl+d')
    expect(normalizeEvent(key('d', { metaKey: true }))).toBe('mod+d')
  })

  it('does NOT fire the mod+d dispatch shortcut on physical Ctrl+D inside a terminal', () => {
    const fn = vi.fn()
    pushLayer({ 'mod+d': fn }, { base: true, id: 'cmd:open-dispatch' })

    const e = key('d', { ctrlKey: true }, /* inTerminal */ true)
    const prevented = vi.spyOn(e, 'preventDefault')
    dispatch(e)

    expect(fn).not.toHaveBeenCalled() // Ctrl+D reaches the PTY...
    expect(prevented).not.toHaveBeenCalled() // ...and the event is not swallowed
  })

  it('STILL fires Cmd+D (mod) inside a terminal', () => {
    const fn = vi.fn()
    pushLayer({ 'mod+d': fn }, { base: true, id: 'cmd:open-dispatch' })

    dispatch(key('d', { metaKey: true }, /* inTerminal */ true))
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('still fires the mod+d shortcut on physical Ctrl+D OUTSIDE a terminal (cross-match intact)', () => {
    const fn = vi.fn()
    pushLayer({ 'mod+d': fn }, { base: true, id: 'cmd:open-dispatch' })

    dispatch(key('d', { ctrlKey: true }, /* inTerminal */ false))
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does NOT enter chord mode on physical Ctrl+K inside a terminal', () => {
    const fn = vi.fn()
    pushLayer({ 'mod+k t': fn }, { base: true, id: 'cmd:some-chord' })

    const e = key('k', { ctrlKey: true }, /* inTerminal */ true)
    dispatch(e)
    expect(_test.getActiveChord()).toBeNull() // Ctrl+K is kill-line, not a chord prefix
  })
})
