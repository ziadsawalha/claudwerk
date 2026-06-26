/**
 * Public canvas viewer -- mounted when the SPA enters share mode with
 * kind='canvas' (/c/:token redirects here). No project chrome, no auth gate.
 * Tier drives the surface: read = view-only; comment = add notes only (base
 * locked, enforced server-side); edit = full co-edit. All writes go through the
 * tier-gated public route.
 */

import ExcalidrawCanvas from '@/components/dialog/excalidraw-canvas'
import type { PublicCanvasDoc } from './use-public-canvas'
import { usePublicCanvas } from './use-public-canvas'

const TIER_NOTE: Record<string, string> = {
  read: 'View only',
  comment: 'Comment mode - add notes, the design is locked',
  edit: 'Edit mode - changes save live',
}

const SAVE_BADGE: Record<PublicCanvasDoc['saveState'], { text: string; cls: string } | null> = {
  idle: null,
  saving: { text: 'saving...', cls: 'text-muted-foreground/60' },
  saved: { text: 'saved', cls: 'text-emerald-400/70' },
  rejected: { text: 'change rejected - the design is locked in comment mode', cls: 'text-red-400/90' },
}

function FullScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 grid place-items-center bg-background text-sm text-muted-foreground">{children}</div>
  )
}

function ViewerHeader({
  name,
  tier,
  saveState,
}: {
  name: string
  tier: string
  saveState: PublicCanvasDoc['saveState']
}) {
  const badge = SAVE_BADGE[saveState]
  return (
    <div className="flex items-center gap-3 px-3 h-9 border-b border-border shrink-0 text-xs">
      <span className="font-mono text-sky-400/90 truncate">{name}</span>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 shrink-0">{TIER_NOTE[tier]}</span>
      <span className="flex-1" />
      {badge && <span className={`text-[10px] ${badge.cls}`}>{badge.text}</span>}
    </div>
  )
}

// fallow-ignore-next-line complexity -- loading/missing/ready three-state view, irreducible.
export function PublicCanvasView({ token }: { token: string }) {
  const { doc, seed, state, saveState, onSnapshot } = usePublicCanvas(token)

  if (state === 'loading') return <FullScreen>Loading canvas...</FullScreen>
  if (state === 'missing' || !doc) return <FullScreen>This share link is invalid or has been revoked.</FullScreen>

  const readOnly = doc.tier === 'read'
  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      <ViewerHeader name={doc.canvas.name} tier={doc.tier} saveState={saveState} />
      <div className="flex-1 min-h-0 relative">
        <ExcalidrawCanvas
          key={doc.canvas.id}
          initialSnapshot={seed}
          readOnly={readOnly}
          onSnapshot={readOnly ? undefined : onSnapshot}
        />
      </div>
    </div>
  )
}
