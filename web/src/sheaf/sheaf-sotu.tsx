/**
 * SOTU enrichment renderers for the Sheaf fleet view (Phase 6).
 *
 * SOTU plugs its narrative + git-fabric INTO the existing Sheaf structure rather
 * than a parallel panel. This file owns the SOTU-specific bits:
 *   - `SotuProjectStrip`: per-project narrative + git escalation alerts + the
 *     genuinely-visible CONTENDED warning pill + per-branch merge-risk + the
 *     citation-grounding score, shown under a project header.
 *   - `FleetSotuStats`: the cheap fleet union folded into the totals strip.
 *
 * The CONTENDED badge is the entire passive-collision mechanism, so it is loud
 * (amber, filled). At-risk/unpushed/stalled are loss/rot signals -- also loud.
 */

import type { GitAlert, SheafFleetSotu, SheafGrounding, SheafProjectSotu } from '@shared/sheaf-types'

const ALERT_STYLE: Record<GitAlert, { label: string; cls: string; title: string }> = {
  'at-risk': {
    label: 'AT-RISK',
    cls: 'bg-rose-500/15 border-rose-500/40 text-rose-300',
    title: 'A worktree has uncommitted changes -- loss risk',
  },
  unpushed: {
    label: 'UNPUSHED',
    cls: 'bg-amber-500/15 border-amber-500/40 text-amber-300',
    title: 'Local main is ahead of origin/main -- loss risk',
  },
  stalled: {
    label: 'STALLED',
    cls: 'bg-orange-500/15 border-orange-500/40 text-orange-300',
    title: 'An unmerged branch has drifted far behind origin/main -- rotting',
  },
}

function AlertChip({ alert }: { alert: GitAlert }) {
  const s = ALERT_STYLE[alert]
  return (
    <span
      className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${s.cls}`}
      title={s.title}
    >
      {s.label}
    </span>
  )
}

function ContendedPill({ count }: { count: number }) {
  return (
    <span
      className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500 text-amber-950"
      title={`${count} target${count === 1 ? '' : 's'} held by 2+ conversations at once -- coordinate before editing`}
    >
      ⚠ {count} CONTENDED
    </span>
  )
}

function GroundingChip({ g }: { g: SheafGrounding }) {
  // Bard-lying detector: surface the precision and (most important) the count of
  // cited conversations that are NOT in the input.
  const pct = Math.round(g.precision * 100)
  const lying = g.unknownCited > 0
  return (
    <span
      className={`shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded border ${
        lying ? 'bg-rose-500/15 border-rose-500/40 text-rose-300' : 'border-border/60 text-muted-foreground'
      }`}
      title={`Citation grounding: ${pct}% precision, ${Math.round(g.coverage * 100)}% coverage, ${g.unknownCited} ungrounded of ${g.citedConvs} cited`}
    >
      grounded {pct}%{lying ? ` · ${g.unknownCited} ungrounded` : ''}
    </span>
  )
}

/** A single branch's merge-risk line: conflicts get the loudest treatment. */
function BranchRisk({ branches }: { branches: SheafProjectSotu['branches'] }) {
  const risky = branches.filter(b => b.integration === 'conflicts' || b.aheadOrigin > 0)
  if (risky.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {risky.slice(0, 8).map(b => {
        const conflicts = b.integration === 'conflicts'
        return (
          <span
            key={b.branch}
            className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
              conflicts ? 'bg-rose-500/15 border-rose-500/40 text-rose-300' : 'border-border/50 text-muted-foreground'
            }`}
            title={
              conflicts
                ? `${b.branch}: merge conflicts vs origin/main${b.conflictFiles?.length ? ` (${b.conflictFiles.length} files)` : ''}`
                : `${b.branch}: ${b.aheadOrigin} ahead / ${b.behindOrigin} behind origin/main (${b.integration})`
            }
          >
            {b.branch} {conflicts ? '⚠ conflicts' : `↑${b.aheadOrigin} ↓${b.behindOrigin}`}
          </span>
        )
      })}
    </div>
  )
}

/** Per-project SOTU strip rendered between a project's header and its forest. */
export function SotuProjectStrip({ sotu }: { sotu: SheafProjectSotu | undefined }) {
  if (!sotu) return null
  const hasAnything =
    sotu.narrative ||
    sotu.alerts.length > 0 ||
    sotu.contended > 0 ||
    sotu.grounding !== undefined ||
    sotu.branches.some(b => b.aheadOrigin > 0 || b.integration === 'conflicts')
  if (!hasAnything) return null
  return (
    <div className="mx-1 mb-1 rounded border border-border/50 bg-muted/20 px-3 py-2 space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {sotu.contended > 0 && <ContendedPill count={sotu.contended} />}
        {sotu.alerts.map(a => (
          <AlertChip key={a} alert={a} />
        ))}
        {sotu.grounding && <GroundingChip g={sotu.grounding} />}
        {!sotu.enabled && (
          <span
            className="text-[10px] text-muted-foreground/50 italic"
            title="SOTU paid distill not enabled -- free floor only"
          >
            floor only
          </span>
        )}
      </div>
      {sotu.narrative && (
        <div className="text-xs text-foreground/90 leading-snug whitespace-pre-wrap">{sotu.narrative}</div>
      )}
      <BranchRisk branches={sotu.branches} />
    </div>
  )
}

/** Fleet-union stats folded into the totals strip (cheap, zero-LLM). */
export function FleetSotuStats({ sotu }: { sotu: SheafFleetSotu | undefined }) {
  if (!sotu) return null
  const parts: React.ReactNode[] = []
  if (sotu.contended > 0) parts.push(<ContendedPill key="c" count={sotu.contended} />)
  for (const a of sotu.alerts) parts.push(<AlertChip key={a} alert={a} />)
  if (sotu.grounding) parts.push(<GroundingChip key="g" g={sotu.grounding} />)
  if (sotu.filteredProjects > 0) {
    parts.push(
      <span
        key="f"
        className="text-[10px] text-muted-foreground/60 italic"
        title="Projects hidden by per-project visibility"
      >
        {sotu.filteredProjects} hidden
      </span>,
    )
  }
  if (parts.length === 0) return null
  return <div className="flex flex-wrap items-center gap-1.5 ml-auto">{parts}</div>
}
