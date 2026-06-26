/**
 * Which host shell (if any) is expanded into the ShellOverlay, plus the two
 * roster-reconciliation effects: drop the selection when that shell leaves the
 * roster, and auto-expand a shell THIS client just opened once it lands. Split
 * out of <Dock> so the tray component stays simple.
 */
import type { ShellRosterEntry } from '@shared/protocol'
import { useEffect, useState } from 'react'
import { useShellAutoExpandId, useShellsStore } from './use-shells'

type ShellRoster = Record<string, ShellRosterEntry>

export function useShellExpansion(roster: ShellRoster): [string | null, (id: string | null) => void] {
  const autoExpandId = useShellAutoExpandId()
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Drop the expanded selection if that shell left the roster (killed/exited).
  useEffect(() => {
    if (expandedId && !roster[expandedId]) setExpandedId(null)
  }, [expandedId, roster])

  // Auto-maximize a shell THIS client just opened, once it lands in the roster
  // (the `shell_added` round-trip arrives a tick after open-shell). Clear the
  // pending id so it fires exactly once and never re-expands after a minimize.
  useEffect(() => {
    if (autoExpandId && roster[autoExpandId]) {
      setExpandedId(autoExpandId)
      useShellsStore.getState().setAutoExpandId(null)
    }
  }, [autoExpandId, roster])

  return [expandedId, setExpandedId]
}
