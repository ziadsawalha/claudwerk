import { Fragment } from 'react'
import { Markdown } from '@/components/markdown'
import { STATUS_FIELDS } from '@/lib/status-style'
import type { LiveStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * THE STATUS detail fields (done / pending / blocked / caveats / notes), each
 * rendered as Markdown. ONE renderer shared by the transcript HANDOFF card and
 * the conversation-list status hover card so the agent's status text reads the
 * same everywhere (code chips, **bold**, links — not raw backticks). `empty is
 * signal`: only populated string fields render; returns null when there are none.
 */
export function StatusDetailFields({
  source,
  className,
}: {
  // Accepts a typed LiveStatus (hover card) or the raw set_status tool input
  // (transcript) — both expose the same string-keyed detail fields.
  source: Partial<Record<keyof LiveStatus, unknown>>
  className?: string
}) {
  const fields = STATUS_FIELDS.filter(f => typeof source[f.key] === 'string' && (source[f.key] as string).trim())
  if (fields.length === 0) return null
  return (
    <div className={cn('grid grid-cols-[4.5rem_1fr] gap-x-4 gap-y-3', className)}>
      {fields.map(f => (
        <Fragment key={f.key}>
          <span className={cn('pt-px text-right text-[10px] font-bold uppercase tracking-wide', f.tone)}>
            {f.label}
          </span>
          <div className="min-w-0 text-[13px] leading-relaxed [&_a]:underline [&_li]:my-0 [&_ol]:my-1 [&_p]:my-0 [&_pre]:my-1.5 [&_ul]:my-1">
            <Markdown>{source[f.key] as string}</Markdown>
          </div>
        </Fragment>
      ))}
    </div>
  )
}
