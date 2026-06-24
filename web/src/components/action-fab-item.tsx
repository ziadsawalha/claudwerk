/**
 * One fan item in the mobile ActionFab -- a label + circular action button,
 * positioned/animated by the parent. Split from action-fab.tsx to keep the
 * component under the size bar.
 */

import type { MouseEvent } from 'react'
import { cn } from '@/lib/utils'
import type { FanAction } from './action-fab-actions'

interface FanItemProps {
  action: FanAction
  index: number
  offset: number
  expanded: boolean
  confirmId: string | null
  onActivate: (e: MouseEvent, action: FanAction) => void
}

// Presentational only -- the cyclomatic count is conditional styling (animation
// state ternaries in cn()), not branching logic. Lifted verbatim from the old
// inline action-fab render; extracting it just made the same CC individually visible.
// fallow-ignore-next-line complexity
export function FanItem({ action, index, offset, expanded, confirmId, onActivate }: FanItemProps) {
  return (
    <div
      className={cn(
        'absolute flex items-center gap-2 transition-all duration-200 ease-out',
        expanded ? 'opacity-100' : 'opacity-0 pointer-events-none',
      )}
      style={{
        right: 0,
        bottom: expanded ? offset + 4 : 0,
        transitionDelay: expanded ? `${index * 30}ms` : '0ms',
      }}
    >
      {/* Label */}
      <span
        className={cn(
          'px-2 py-0.5 rounded text-[10px] font-mono font-bold whitespace-nowrap',
          'bg-black/70 text-white/90 border border-white/10',
          'transition-all duration-200',
          expanded ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0',
          confirmId === action.id && 'border-red-500/50 text-red-300',
        )}
        style={{ transitionDelay: expanded ? `${index * 30 + 50}ms` : '0ms' }}
      >
        {confirmId === action.id ? `${action.label}?` : action.label}
      </span>
      {/* Button */}
      <button
        type="button"
        className={cn(
          'w-10 h-10 rounded-full flex items-center justify-center shrink-0',
          'shadow-md border border-white/10 text-white',
          'transition-transform duration-200 ease-out active:scale-90',
          action.color,
          expanded ? 'scale-100' : 'scale-0',
          confirmId === action.id && 'ring-2 ring-red-500/60 animate-pulse',
        )}
        style={{ transitionDelay: expanded ? `${index * 30}ms` : '0ms' }}
        onClick={e => onActivate(e, action)}
      >
        {action.icon}
      </button>
    </div>
  )
}
