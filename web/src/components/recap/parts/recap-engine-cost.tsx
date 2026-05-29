/**
 * Pillar E COST 2 -- the ENGINE-cost footer: what this recap cost to GENERATE
 * (distinct from COST 1, what the project spent). Fed by RecapMeta.costLedger
 * (the per-call ledger: oneshot/map/reduce/retry, recorded even on failure).
 * Internal ops data -- rendered in the in-app viewer, NOT on public shares.
 */

import type { RecapCostLedger } from '@shared/protocol'
import { fmtCompact, fmtUsd } from './recap-format'

function shortModel(m: string): string {
  return m
    .replace(/^anthropic\//, '')
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
}

export function RecapEngineCost({ ledger }: { ledger?: RecapCostLedger }) {
  if (!ledger || ledger.entries.length === 0) return null
  const s = ledger.summary
  const stages = Object.entries(s.byStage).filter(([, v]) => v && v.calls > 0)
  const cacheHit =
    s.totalInputTokens + s.totalCacheReadTokens > 0
      ? s.totalCacheReadTokens / (s.totalInputTokens + s.totalCacheReadTokens)
      : 0
  return (
    <details className="rounded-md border border-border bg-muted/10">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-muted-foreground">
        Generation cost <span className="text-foreground">{fmtUsd(s.totalCostUsd)}</span> · {s.callCount} call
        {s.callCount === 1 ? '' : 's'} · {s.models.map(shortModel).join(', ')}
      </summary>
      <div className="flex flex-col gap-2 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span>in {fmtCompact(s.totalInputTokens)} tok</span>
          <span>out {fmtCompact(s.totalOutputTokens)} tok</span>
          <span>cache rd {fmtCompact(s.totalCacheReadTokens)} tok</span>
          <span>cache wr {fmtCompact(s.totalCacheWriteTokens)} tok</span>
          {cacheHit > 0 && <span>cache hit {(cacheHit * 100).toFixed(0)}%</span>}
        </div>
        {stages.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {stages.map(([stage, v]) => (
              <span key={stage} className="inline-flex items-center gap-1">
                <span className="rounded bg-muted/40 px-1 py-0.5 uppercase tracking-wide">{stage}</span>
                {v?.calls}× {fmtUsd(v?.costUsd ?? 0)}
              </span>
            ))}
          </div>
        )}
      </div>
    </details>
  )
}
