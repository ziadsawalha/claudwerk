/**
 * Write-up tab body: the LLM narrative markdown plus the A/B eval controls --
 * a fork switcher (sibling variants of the same project+period) and a model
 * dropdown that regenerates the write-up with a different reduce model.
 *
 * Presentational only: the parent viewer owns the WS send, the sibling fetch,
 * and the auto-switch on fork. This component just renders state + fires
 * callbacks, which keeps it trivially testable.
 */

import type { PeriodRecapDoc, RecapSummary } from '@shared/protocol'
import { useEffect, useState } from 'react'
import { Markdown } from '@/components/markdown'
import { cn, haptic } from '@/lib/utils'
import { DEFAULT_RECAP_MODEL, modelLabel, RECAP_MODEL_OPTIONS } from './recap-forks'

function isTerminalStatus(status: RecapSummary['status']): boolean {
  return status === 'done' || status === 'failed' || status === 'cancelled'
}

/** Pick the dropdown's initial value: the recap's own model when it's one of
 *  the curated options, otherwise the default (Opus). */
function initialModel(recap: PeriodRecapDoc): string {
  if (recap.model && RECAP_MODEL_OPTIONS.some(o => o.slug === recap.model)) return recap.model
  return DEFAULT_RECAP_MODEL
}

function ForkSwitcher({
  recap,
  siblings,
  onSelectFork,
}: {
  recap: PeriodRecapDoc
  siblings: RecapSummary[]
  onSelectFork: (recapId: string) => void
}) {
  if (siblings.length <= 1) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Write-up variants">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-0.5">Variants</span>
      {siblings.map(s => {
        const active = s.id === recap.recapId
        const pending = !isTerminalStatus(s.status)
        return (
          <button
            key={s.id}
            type="button"
            disabled={active}
            title={`${s.model || 'pending'}${s.llmCostUsd > 0 ? ` - $${s.llmCostUsd.toFixed(4)}` : ''} (${s.status})`}
            onClick={() => {
              if (active) return
              haptic('tap')
              onSelectFork(s.id)
            }}
            className={cn(
              'px-2 py-0.5 text-[11px] rounded-full border transition-colors',
              active
                ? 'border-accent bg-accent/15 text-foreground cursor-default'
                : 'border-border text-muted-foreground hover:bg-muted/60 cursor-pointer',
            )}
          >
            <span className="inline-flex items-center gap-1">
              {pending && (
                <span className="inline-block size-2.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              )}
              {modelLabel(s.model)}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function RecapWriteupTab({
  recap,
  siblings,
  regenerating,
  onSelectFork,
  onRegenerate,
}: {
  recap: PeriodRecapDoc
  siblings: RecapSummary[]
  regenerating: boolean
  onSelectFork: (recapId: string) => void
  onRegenerate: (model: string) => void
}) {
  const [model, setModel] = useState<string>(() => initialModel(recap))

  // Re-seed the dropdown to the loaded fork's model when switching variants.
  useEffect(() => {
    setModel(initialModel(recap))
  }, [recap])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-border">
        <ForkSwitcher recap={recap} siblings={siblings} onSelectFork={onSelectFork} />
        <div className="flex items-center gap-1.5 ml-auto">
          <label className="sr-only" htmlFor="recap-model-select">
            Model
          </label>
          <select
            id="recap-model-select"
            aria-label="Regenerate write-up model"
            value={model}
            disabled={regenerating}
            onChange={e => setModel(e.target.value)}
            className="px-2 py-1 text-xs rounded border border-border bg-background disabled:opacity-50"
          >
            {RECAP_MODEL_OPTIONS.map(o => (
              <option key={o.slug} value={o.slug}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={regenerating}
            title="Re-run the write-up's reduce call with the selected model (forks a new variant; the original survives)"
            onClick={() => {
              if (regenerating) return
              haptic('tap')
              onRegenerate(model)
            }}
            className={cn(
              'px-2 py-1 text-xs rounded border border-border transition-all',
              regenerating ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted/60 cursor-pointer',
            )}
          >
            {regenerating ? (
              <span className="inline-flex items-center gap-1">
                <span className="inline-block size-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                Generating…
              </span>
            ) : (
              'Regenerate write-up'
            )}
          </button>
        </div>
      </div>
      {recap.markdown ? (
        <Markdown copyable>{recap.markdown}</Markdown>
      ) : (
        <div className="text-sm text-muted-foreground">No write-up for this recap.</div>
      )}
    </div>
  )
}
