/**
 * Live "the model is thinking" pill.
 *
 * Subscribes to the ephemeral thinking-progress store (outside Zustand) and
 * renders ONLY while pings are arriving for this conversation. Three modes:
 *   detailed (default): sparkline of recent deltas + tokens/sec + count
 *   compact            : spinner + compact count (1.4k)
 *   off                : returns null
 */

import { memo, useSyncExternalStore } from 'react'
import {
  getThinkingProgress,
  getVersion,
  subscribe,
  type ThinkingProgressEntry,
  type ThinkingSample,
} from '@/hooks/thinking-progress-store'
import { useConversationsStore } from '@/hooks/use-conversations'

const BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

function formatCount(n: number): string {
  if (n < 1000) return n.toLocaleString()
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
}

function sparkline(samples: ThinkingSample[]): string {
  if (samples.length === 0) return ''
  const deltas = samples.map(s => s.delta ?? 0).filter(d => d >= 0)
  if (deltas.length === 0) return ''
  const max = Math.max(...deltas, 1)
  return deltas.map(d => BARS[Math.min(BARS.length - 1, Math.floor((d / max) * (BARS.length - 1)))]).join('')
}

function tokensPerSec(entry: ThinkingProgressEntry): number {
  const last = entry.samples[entry.samples.length - 1]
  const first = entry.samples[0]
  if (!last || !first || last === first) return 0
  const dt = (last.t - first.t) / 1000
  if (dt <= 0) return 0
  return Math.round((last.tokens - first.tokens) / dt)
}

interface ThinkingPillProps {
  conversationId: string | null
}

export const ThinkingPill = memo(function ThinkingPill({ conversationId }: ThinkingPillProps) {
  const mode = useConversationsStore(state => state.controlPanelPrefs.thinkingIndicator) ?? 'detailed'
  // Subscribe to the external store -- version bumps on coalesced 250ms ticks.
  useSyncExternalStore(subscribe, getVersion, getVersion)
  if (mode === 'off' || !conversationId) return null
  const entry = getThinkingProgress(conversationId)
  if (!entry) return null

  const last = entry.samples[entry.samples.length - 1]
  if (!last) return null

  if (mode === 'compact') {
    return (
      <div className="mt-1 flex items-center gap-1.5 px-4 py-1 text-[11px] font-mono text-muted-foreground/60">
        <span className="inline-block w-1.5 h-1.5 bg-accent rounded-full animate-pulse" />
        <span className="text-accent/70">thinking</span>
        <span className="text-muted-foreground/50 tabular-nums">{formatCount(last.tokens)}</span>
      </div>
    )
  }

  const rate = tokensPerSec(entry)
  return (
    <div className="mt-1 flex items-center gap-2 px-4 py-1 text-[11px] font-mono text-muted-foreground/60">
      <span className="text-accent/70">thinking</span>
      <span className="text-accent/70 tabular-nums leading-none">{sparkline(entry.samples)}</span>
      {rate > 0 && <span className="text-muted-foreground/50 tabular-nums">{rate}/s</span>}
      <span className="text-muted-foreground/70 tabular-nums">{formatCount(last.tokens)}</span>
    </div>
  )
})
