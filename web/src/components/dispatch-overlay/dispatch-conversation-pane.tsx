import { useEffect, useRef, useState } from 'react'
import { sendInput, useConversationsStore } from '@/hooks/use-conversations'
import { projectDisplayName } from '@/lib/utils'
import { serializeTranscript } from '@/lib/web-control-transcript'
import { DispatchStateDot } from './dispatch-state-dot'
import { useDispatchStore } from './dispatch-store'

/** Right pane when a conversation is selected: a compact transcript tail + a
 *  send box, so the cockpit can TALK to any conversation without leaving it. */
export function DispatchConversationPane() {
  const convId = useDispatchStore(s => s.activeConvId)
  const conv = useConversationsStore(s => (convId ? s.conversationsById[convId] : undefined))
  const entries = useConversationsStore(s => (convId ? s.transcripts[convId] : undefined))
  const [draft, setDraft] = useState('')
  const tailRef = useRef<HTMLPreElement>(null)

  // Trigger the main store to load this conversation's transcript on selection.
  useEffect(() => {
    if (convId) useConversationsStore.getState().selectConversation(convId, 'dispatch-overlay')
  }, [convId])

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to tail on new entries
  useEffect(() => {
    if (tailRef.current) tailRef.current.scrollTop = tailRef.current.scrollHeight
  }, [entries?.length])

  if (!convId || !conv) {
    return <p className="px-4 py-8 text-center text-[12px] text-comment">Select a conversation from the fleet.</p>
  }

  const text = entries && entries.length > 0 ? serializeTranscript(entries.slice(-40)) : null
  const send = () => {
    const t = draft.trim()
    if (!t) return
    if (sendInput(convId, t)) setDraft('')
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <DispatchStateDot state={conv.liveStatus?.state} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-foreground">
            {conv.title || projectDisplayName(conv.project)}
          </span>
          <span className="block truncate text-[10px] text-comment">{projectDisplayName(conv.project)}</span>
        </span>
      </div>
      <pre
        ref={tailRef}
        className="dispatch-scroll min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap px-4 py-3 text-[11px] leading-relaxed text-foreground/80"
      >
        {text ?? 'Loading transcript…'}
      </pre>
      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2 rounded-lg border border-border bg-input/50 p-2 focus-within:border-primary/50">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                send()
              }
            }}
            rows={1}
            placeholder="message this conversation…"
            className="max-h-24 min-h-[1.75rem] flex-1 resize-none bg-transparent px-1 py-0.5 text-[12px] text-foreground placeholder:text-comment focus-visible:outline-none"
          />
          <button
            type="button"
            onClick={send}
            disabled={!draft.trim()}
            className="flex-none rounded-md bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:text-comment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            send
          </button>
        </div>
      </div>
    </div>
  )
}
