/**
 * ShellOverlay -- the expanded (subscribed) view of one host shell.
 *
 * Fullscreen panel hosting a ShellPane plus minimal chrome: title + path,
 * minimize (unsubscribe, keep the tile), detach (popout window), close (kill
 * the PTY). Mirrors WebTerminal's overlay treatment but for the `shell_*`
 * transport. Mounting subscribes; unmounting (minimize / close) unsubscribes.
 */
import { ExternalLink, Minus, X } from 'lucide-react'
import { useCallback } from 'react'
import { useShellEntry } from '@/hooks/use-shells'
import { closeShell, popoutShell, shellDisplayPath, shellOverlayChord, shellTitle } from '@/lib/shell-commands'
import { useScrollLock } from './input-editor/shell/use-scroll-lock'
import { ShellPane } from './shell-pane'

interface ShellOverlayProps {
  shellId: string
  /** Minimize: drop the byte stream, keep the roster tile + light. */
  onMinimize: () => void
}

export function ShellOverlay({ shellId, onMinimize }: ShellOverlayProps) {
  const entry = useShellEntry(shellId)
  useScrollLock(true)

  const title = entry ? shellTitle(entry) : shellId.slice(0, 8)
  const path = entry ? shellDisplayPath(entry) : ''

  const detach = useCallback(() => {
    popoutShell(shellId)
    onMinimize()
  }, [shellId, onMinimize])

  // Esc must reach the PTY (vim/less/etc. need it), so it is NOT bound here --
  // it flows through xterm as `shell_input`. Minimize/detach use Ctrl+Cmd chords
  // the shell never sees (Cmd is invisible to the PTY), intercepted via xterm's
  // customKeyHandler so they fire even while the terminal holds focus -- a window
  // listener wouldn't, since a focused xterm swallows keydowns.
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      const chord = shellOverlayChord(e)
      if (!chord) return true
      if (e.type === 'keydown') {
        e.preventDefault()
        if (chord === 'minimize') onMinimize()
        else detach()
      }
      return false // swallow the whole combo from xterm (all event phases)
    },
    [onMinimize, detach],
  )

  return (
    <div
      data-shell-overlay
      role="application"
      className="fixed inset-0 z-50 flex flex-col bg-[#0a0a0a] overflow-hidden"
      style={{ overscrollBehavior: 'none' }}
    >
      <div className="shrink-0 flex items-center gap-2 border-b border-white/10 bg-black/60 px-3 py-1.5">
        <span className="text-[11px] font-mono font-semibold text-emerald-300">{title}</span>
        <span className="text-[10px] font-mono text-white/40 truncate flex-1">{path}</span>
        <span className="text-[9px] font-mono text-white/30 hidden sm:inline mr-1">⌃⌘M minimize · ⌃⌘D detach</span>
        <button
          type="button"
          onClick={onMinimize}
          className="p-1 text-white/50 hover:text-white transition-colors"
          title="Minimize (keep running)"
        >
          <Minus className="size-4" />
        </button>
        <button
          type="button"
          onClick={detach}
          className="p-1 text-white/50 hover:text-white transition-colors"
          title="Detach to its own window"
        >
          <ExternalLink className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => closeShell(shellId)}
          className="p-1 text-white/50 hover:text-red-400 transition-colors"
          title="Kill shell"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="relative flex-1 min-h-0 overflow-hidden" style={{ overscrollBehavior: 'contain' }}>
        <ShellPane shellId={shellId} customKeyHandler={handleKey} className="absolute inset-0 p-1" />
      </div>
    </div>
  )
}
