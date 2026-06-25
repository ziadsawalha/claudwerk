/** Morning Result screen as a modal-hostable body: fetch the latest run snapshot + render it. */
import { useNightshift } from '@/hooks/use-nightshift'
import { NightshiftReport } from './nightshift-report'

export function NightshiftReportBody({ projectUri }: { projectUri: string }) {
  const { snapshot, loading, error, refetch } = useNightshift(projectUri)

  // Snapshot-first: once we have a run, keep showing it (no flicker on refetch).
  if (snapshot) return <NightshiftReport snapshot={snapshot} projectUri={projectUri} />
  if (loading) return <p className="text-xs text-muted-foreground">Loading night report…</p>
  if (error)
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-red-400">{error}</span>
        <button type="button" onClick={refetch} className="text-muted-foreground hover:text-foreground">
          retry
        </button>
      </div>
    )
  return <p className="text-sm text-muted-foreground">No nightshift runs yet for this project.</p>
}
