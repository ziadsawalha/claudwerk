/**
 * Hosted-canvas surface -- a thin header + the Excalidraw surface. Rendered in
 * two homes off the SAME `CanvasSurface`:
 *   - the standalone /canvas/:id route (main.tsx), for deep-links + share, and
 *   - a portal popout (PopoutHost), the default in-app open, which keeps the
 *     drawing in the parent React tree (no second document/WS/bundle).
 *
 * All load/save/rename logic lives in useCanvasDocument, which is target-window
 * aware -- in a popout it titles + flush-saves the POPUP, not the parent tab.
 */

import type { CanvasPeer, CanvasSummary } from '@shared/protocol'
import ExcalidrawCanvas, { type CanvasCollabBinding } from '@/components/dialog/excalidraw-canvas'
import { CanvasShareControl } from './canvas-share-control'
import { useCanvasCollab } from './use-canvas-collab'
import { canvasIdFromPath, type DocState, type SaveState, useCanvasDocument } from './use-canvas-document'

const SAVE_LABEL: Record<SaveState, string> = { idle: '', saving: 'saving...', saved: 'saved' }

function CanvasBody({
  state,
  canvas,
  seed,
  onSnapshot,
  collab,
}: {
  state: DocState
  canvas: CanvasSummary | null
  seed: unknown
  onSnapshot: (json: string) => void
  collab: CanvasCollabBinding
}) {
  if (state !== 'ready' || !canvas) {
    return (
      <div className="absolute inset-0 grid place-items-center text-muted-foreground text-sm">Loading canvas...</div>
    )
  }
  return <ExcalidrawCanvas key={canvas.id} initialSnapshot={seed} onSnapshot={onSnapshot} collab={collab} />
}

/** Live-presence dots for the peers currently in the room (self included). */
function PresenceDots({ peers }: { peers: CanvasPeer[] }) {
  if (peers.length < 2) return null
  return (
    <span className="flex items-center gap-1 shrink-0" title={`${peers.length} editing`}>
      {peers.slice(0, 5).map(p => (
        <span
          key={p.peerId}
          className="w-2.5 h-2.5 rounded-full border border-background"
          style={{ background: p.color }}
          title={p.name}
        />
      ))}
    </span>
  )
}

function SurfaceHeader({
  canvas,
  saveState,
  peers,
  onRename,
}: {
  canvas: CanvasSummary | null
  saveState: SaveState
  peers: CanvasPeer[]
  onRename: () => void
}) {
  return (
    <div className="flex items-center gap-3 px-3 h-9 border-b border-border shrink-0 text-xs">
      <button type="button" onClick={onRename} className="font-mono text-sky-400/90 hover:text-sky-300 truncate">
        {canvas?.name ?? 'Loading...'}
      </button>
      <span className="text-[10px] text-muted-foreground/60 shrink-0">{SAVE_LABEL[saveState]}</span>
      <span className="flex-1" />
      <PresenceDots peers={peers} />
      {canvas && <CanvasShareControl canvas={canvas} />}
    </div>
  )
}

export function CanvasSurface({ canvasId }: { canvasId: string | null }) {
  const { canvas, seed, state, saveState, onSnapshot, onRename } = useCanvasDocument(canvasId)
  // Live multiplayer is on for the hosted canvas window (a solo editor is just a
  // room of one). The Draw dialog block stays solo (no collab prop).
  const { peers, bindApi, onLocalPointer, onLocalChange } = useCanvasCollab(canvasId, state === 'ready')
  const collab: CanvasCollabBinding = { bindApi, onPointer: onLocalPointer, onChange: onLocalChange }

  if (state === 'missing') {
    return <div className="fixed inset-0 grid place-items-center text-muted-foreground text-sm">Canvas not found.</div>
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      <SurfaceHeader canvas={canvas} saveState={saveState} peers={peers} onRename={onRename} />
      <div className="flex-1 min-h-0 relative">
        <CanvasBody state={state} canvas={canvas} seed={seed} onSnapshot={onSnapshot} collab={collab} />
      </div>
    </div>
  )
}

/** Standalone /canvas/:id route entry -- keys the canvas off the path. */
export function CanvasWindow() {
  return <CanvasSurface canvasId={canvasIdFromPath()} />
}
