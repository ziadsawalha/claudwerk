/**
 * Dock -- THE single global tray of every parked / floating surface.
 *
 * Folds what used to be two parallel trays (ModalDock + ShellDock) into one bar
 * with sections: PARKED (manager-backed UI modals whose presentation==='docked',
 * plus minimized live dialogs) and SHELLS (always-roster host shells, click to
 * expand into the ShellOverlay). One tray, one mental model; self-hides when
 * everything is empty. See plan-unified-modals.md.
 */
import type { ShellRosterEntry } from '@shared/protocol'
import { lazy, Suspense, useMemo } from 'react'
import { LiveDialogDockTile } from '@/components/dialog/live-dialog-dock-tile'
import type { ModalRecord } from '@/hooks/modal-manager-types'
import { useConversationsStore } from '@/hooks/use-conversations'
import { useMinimizedLiveDialogs } from '@/hooks/use-minimized-live-dialogs'
import { useModalManagerStore } from '@/hooks/use-modal-manager'
import { useShellExpansion } from '@/hooks/use-shell-expansion'
import { useShellRoster } from '@/hooks/use-shells'
import { ModalDockTile } from './modal-dock-tile'
import { ShellDockTile } from './shell-dock-tile'

// xterm.js is heavy -- keep it out of the index chunk; pulled on first expand.
const ShellOverlay = lazy(() => import('./shell-overlay').then(m => ({ default: m.ShellOverlay })))

type ShellRoster = Record<string, ShellRosterEntry>
type LiveDialogTile = { conversationId: string; title: string }

function SectionLabel({ children }: { children: string }) {
  return <span className="text-[9px] font-mono uppercase tracking-wide text-white/30 shrink-0 px-1">{children}</span>
}

function ParkedSection({ parked, liveDialogs }: { parked: ModalRecord[]; liveDialogs: LiveDialogTile[] }) {
  return (
    <>
      <SectionLabel>parked</SectionLabel>
      {parked.map(r => (
        <ModalDockTile key={r.id} record={r} />
      ))}
      {liveDialogs.map(d => (
        <LiveDialogDockTile key={d.conversationId} conversationId={d.conversationId} title={d.title} />
      ))}
    </>
  )
}

function ShellsSection({
  shellIds,
  onExpand,
  showDivider,
}: {
  shellIds: string[]
  onExpand: (id: string) => void
  showDivider: boolean
}) {
  return (
    <>
      {showDivider && <span className="h-4 w-px bg-white/10 shrink-0" aria-hidden />}
      <SectionLabel>shells</SectionLabel>
      {shellIds.map(shellId => (
        <ShellDockTile key={shellId} shellId={shellId} onExpand={() => onExpand(shellId)} />
      ))}
    </>
  )
}

function ShellOverlayHost({
  expandedId,
  roster,
  onMinimize,
}: {
  expandedId: string | null
  roster: ShellRoster
  onMinimize: () => void
}) {
  if (!expandedId || !roster[expandedId]) return null
  return (
    <Suspense fallback={null}>
      <ShellOverlay shellId={expandedId} onMinimize={onMinimize} />
    </Suspense>
  )
}

/** The dock's live contents: parked modals + live dialogs + shells, with the
 *  derived emptiness flags. Keeps <Dock> a thin render decision. */
function useDockContents() {
  const records = useModalManagerStore(s => s.records)
  const currentConversationId = useConversationsStore(s => s.selectedConversationId)
  const liveDialogs = useMinimizedLiveDialogs(currentConversationId)
  const roster = useShellRoster()

  const parked = useMemo(
    () =>
      Object.values(records)
        .filter(r => r.presentation === 'docked')
        .sort((a, b) => a.openedAt - b.openedAt),
    [records],
  )

  // Newest first -- the freshest shell is the most likely target.
  const shellIds = useMemo(
    () =>
      Object.values(roster)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(s => s.shellId),
    [roster],
  )

  const hasParked = parked.length > 0 || liveDialogs.length > 0
  const hasShells = shellIds.length > 0
  return { roster, parked, liveDialogs, shellIds, hasParked, hasShells, empty: !hasParked && !hasShells }
}

export function Dock() {
  const { roster, parked, liveDialogs, shellIds, hasParked, hasShells, empty } = useDockContents()
  const [expandedId, setExpandedId] = useShellExpansion(roster)
  if (empty) return null

  return (
    <>
      <div className="flex items-center gap-1.5 overflow-x-auto py-1" data-dock>
        {hasParked && <ParkedSection parked={parked} liveDialogs={liveDialogs} />}
        {hasShells && <ShellsSection shellIds={shellIds} onExpand={setExpandedId} showDivider={hasParked} />}
      </div>
      <ShellOverlayHost expandedId={expandedId} roster={roster} onMinimize={() => setExpandedId(null)} />
    </>
  )
}
