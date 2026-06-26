/**
 * Canvas multiplayer message bus. The dashboard WS funnels every `canvas_*`
 * message to one store handler; this routes them to the right open canvas room
 * by canvasId, so several canvases can be live at once. Install once (idempotent),
 * register/unregister per open room.
 */

import { useConversationsStore } from '@/hooks/use-conversations'

type CanvasMsg = Record<string, unknown> & { canvasId?: string }
type Listener = (msg: CanvasMsg) => void

const listeners = new Map<string, Listener>()
let installed = false

function install(): void {
  if (installed) return
  installed = true
  useConversationsStore.setState({
    canvasHandler: (msg: Record<string, unknown>) => {
      const id = (msg as CanvasMsg).canvasId
      if (id) listeners.get(id)?.(msg as CanvasMsg)
    },
  })
}

export function registerCanvasListener(canvasId: string, fn: Listener): void {
  install()
  listeners.set(canvasId, fn)
}

export function unregisterCanvasListener(canvasId: string): void {
  listeners.delete(canvasId)
}
