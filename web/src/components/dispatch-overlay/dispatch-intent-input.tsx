import { useRef } from 'react'
import { cn } from '@/lib/utils'
import { useDispatchStore } from './dispatch-store'

/** The hero: a single intent box. Submit hands the natural-language intent to
 *  the Front Desk dispatcher, which decides route / revive / spawn. */
export function DispatchIntentInput() {
  const intent = useDispatchStore(s => s.intent)
  const pending = useDispatchStore(s => s.pending)
  const setIntent = useDispatchStore(s => s.setIntent)
  const submit = useDispatchStore(s => s.submit)
  const ref = useRef<HTMLTextAreaElement>(null)

  const send = () => {
    submit()
    ref.current?.focus()
  }

  return (
    <div className="px-5 pt-5">
      <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-comment">
        Tell dispatch what you need
      </span>
      <div
        className={cn(
          'flex items-end gap-2 rounded-xl border bg-surface-inset/60 p-2.5 transition-colors',
          pending ? 'border-primary/40' : 'border-border focus-within:border-primary/50',
        )}
      >
        <textarea
          ref={ref}
          value={intent}
          onChange={e => setIntent(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              send()
            }
          }}
          rows={2}
          // biome-ignore lint/a11y/noAutofocus: cockpit hero input -- focus on summon is the point
          autoFocus
          placeholder="e.g. pick up the auth refactor, or find who's reviewing the broker PR…"
          className="min-h-[2.5rem] flex-1 resize-none bg-transparent px-1.5 py-1 text-[14px] leading-relaxed text-foreground placeholder:text-comment focus-visible:outline-none"
        />
        <button
          type="button"
          onClick={send}
          disabled={pending || !intent.trim()}
          className={cn(
            'flex-none rounded-lg px-4 py-2 text-[12px] font-semibold uppercase tracking-wide transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            pending || !intent.trim()
              ? 'cursor-not-allowed bg-muted text-comment'
              : 'bg-primary text-primary-foreground hover:bg-primary/90',
          )}
        >
          {pending ? 'routing…' : 'dispatch'}
        </button>
      </div>
      <p className="mt-1.5 px-1 text-[10px] text-comment">⌘↵ to dispatch · the desk decides route, revive, or spawn</p>
    </div>
  )
}
