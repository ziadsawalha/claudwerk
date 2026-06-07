import { useState } from 'react'
import { cn, haptic } from '@/lib/utils'
import { Markdown } from '../markdown'

const rule = (
  <div
    className="flex-1 h-px"
    style={{
      backgroundImage:
        'repeating-linear-gradient(90deg, var(--info) 0px, var(--info) 8px, transparent 8px, transparent 16px)',
    }}
  />
)

export function SkillDivider({ name, content }: { name: string; content: string }) {
  const [expanded, setExpanded] = useState(false)
  const hasBody = content.trim().length > 0

  // No injected body (e.g. a built-in slash command that ran but injected
  // nothing) -- render a static, non-expandable chip so the invocation is still
  // visible without a dead toggle.
  if (!hasBody) {
    return (
      <div className="my-3 flex items-center gap-2">
        {rule}
        <span className="px-2 py-0.5 text-[10px] font-bold font-mono uppercase tracking-widest text-teal-400/80 bg-teal-400/10 border border-teal-400/30 shrink-0">
          /{name}
        </span>
        {rule}
      </div>
    )
  }

  return (
    <div className="my-3">
      <button
        type="button"
        onClick={() => {
          haptic('tap')
          setExpanded(!expanded)
        }}
        className="flex items-center gap-2 w-full group"
      >
        {rule}
        <span className="px-2 py-0.5 text-[10px] font-bold font-mono uppercase tracking-widest text-teal-400/80 bg-teal-400/10 border border-teal-400/30 shrink-0 flex items-center gap-1.5">
          <span className={cn('transition-transform text-[8px]', expanded ? 'rotate-90' : '')}>&#9654;</span>/{name}
        </span>
        {rule}
      </button>
      {expanded && (
        <div className="mt-2 px-3 py-2 border border-teal-400/20 bg-teal-400/5 rounded text-xs max-h-[400px] overflow-y-auto">
          <Markdown>{content}</Markdown>
        </div>
      )}
    </div>
  )
}
