/**
 * FileTree block — renders a flat list of paths as an indented tree, with a
 * per-entry change status dot and optional note. Indentation is derived from
 * the number of slash segments in each path.
 */
import { cn } from '@/lib/utils'
import type { FileTreeComponent } from '../types'
import { STATUS_DOT, STATUS_TEXT } from './block-status'

export function FileTreeBlock({ label, entries }: Pick<FileTreeComponent, 'label' | 'entries'>) {
  return (
    <div className="rounded border border-border/30 overflow-hidden">
      {label && (
        <div className="px-3 py-1.5 bg-muted/40 border-b border-border/30 text-xs font-medium text-muted-foreground">
          {label}
        </div>
      )}
      <div className="p-2 font-mono text-xs space-y-0.5">
        {entries.map((entry, i) => {
          const segments = entry.path.split('/').filter(Boolean)
          const depth = Math.max(0, segments.length - 1)
          const name = segments[segments.length - 1] || entry.path
          const status = entry.status ?? 'unchanged'
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: file-tree rows are positional
              // react-doctor-disable-next-line react-doctor/no-array-index-key, react-doctor/no-array-index-as-key
              key={i}
              className="flex items-center gap-2"
              style={{ paddingLeft: `${depth * 14}px` }}
            >
              <span className={cn('size-1.5 rounded-full shrink-0', STATUS_DOT[status])} />
              <span className={cn('truncate', STATUS_TEXT[status])}>{name}</span>
              {entry.note && <span className="text-muted-foreground/60 truncate">— {entry.note}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
