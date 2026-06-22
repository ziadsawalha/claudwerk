/**
 * Draw block header: label + size meter (flags a drawing over DRAW_INLINE_MAX as
 * "saved as file", since draw-spill.ts spills it to a blob on submit) + save and
 * fullscreen toggles. Split out of draw-block.tsx to keep each file small.
 */
import { DRAW_INLINE_MAX } from '@shared/draw'
import { Download, Maximize2, Minimize2 } from 'lucide-react'
import { cn } from '@/lib/utils'

function sizeLabel(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`
}

export interface DrawBlockHeaderProps {
  label: string
  bytes: number
  hasScene: boolean
  fullscreen: boolean
  onSave: () => void
  onToggleFullscreen: () => void
}

export function DrawBlockHeader({
  label,
  bytes,
  hasScene,
  fullscreen,
  onSave,
  onToggleFullscreen,
}: DrawBlockHeaderProps) {
  const over = bytes > DRAW_INLINE_MAX
  return (
    <div className="flex items-center justify-between gap-2 px-0.5 pb-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        {bytes > 0 && (
          <span className={cn('text-[10px] tabular-nums', over ? 'text-amber-500' : 'text-muted-foreground')}>
            {sizeLabel(bytes)}
            {over && ' -- saved as file'}
          </span>
        )}
        {hasScene && (
          <button
            type="button"
            onClick={onSave}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Save drawing (.excalidraw + PNG)"
          >
            <Download className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={onToggleFullscreen}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </button>
      </div>
    </div>
  )
}
