import { describe, expect, it } from 'vitest'
import { useConversationsStore } from '@/hooks/use-conversations'
import { registerCanvasListener, unregisterCanvasListener } from './canvas-collab-bus'

function dispatch(msg: Record<string, unknown>) {
  useConversationsStore.getState().canvasHandler?.(msg)
}

describe('canvas-collab-bus', () => {
  it('routes messages to the listener for their canvasId', () => {
    const a: Record<string, unknown>[] = []
    const b: Record<string, unknown>[] = []
    registerCanvasListener('cnv_a', m => a.push(m))
    registerCanvasListener('cnv_b', m => b.push(m))

    dispatch({ type: 'canvas_pointer', canvasId: 'cnv_a', x: 1 })
    dispatch({ type: 'canvas_pointer', canvasId: 'cnv_b', x: 2 })
    dispatch({ type: 'canvas_pointer', canvasId: 'cnv_a', x: 3 })

    expect(a.map(m => m.x)).toEqual([1, 3])
    expect(b.map(m => m.x)).toEqual([2])

    unregisterCanvasListener('cnv_a')
    unregisterCanvasListener('cnv_b')
  })

  it('ignores messages with no/unknown canvasId after unregister', () => {
    const got: Record<string, unknown>[] = []
    registerCanvasListener('cnv_x', m => got.push(m))
    unregisterCanvasListener('cnv_x')
    dispatch({ type: 'canvas_presence', canvasId: 'cnv_x' })
    dispatch({ type: 'canvas_presence' })
    expect(got).toEqual([])
  })
})
