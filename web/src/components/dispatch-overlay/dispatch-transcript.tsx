import type { DispatchHistoryTurn } from '@shared/protocol'
import { Markdown } from '../markdown'

/** A warm dot marking the concierge's "voice". */
function Mark() {
  return <span className="mt-1.5 inline-block h-2 w-2 flex-none rounded-full" style={{ background: 'var(--accent)' }} />
}

/** One turn of the persisted conversation. The user's line is quiet; the
 *  dispatcher's reply is markdown-rendered next to its mark. */
function TranscriptTurn({ turn }: { turn: DispatchHistoryTurn }) {
  if (turn.role === 'user') {
    return (
      <p className="px-6 text-[13px] leading-relaxed text-comment">
        <span className="text-comment/50">you · </span>
        {turn.content}
      </p>
    )
  }
  return (
    <div className="flex gap-2.5 px-6">
      <Mark />
      <div className="min-w-0 flex-1 text-[14px] leading-relaxed text-foreground/90">
        <Markdown>{turn.content}</Markdown>
      </div>
    </div>
  )
}

/**
 * The persistent conversation, rendered from the streamed living history (the
 * SOURCE OF TRUTH, Slice C) -- oldest first, newest at the bottom. Decoupled from
 * the in-flight decision feed: this is what survives restart + streams to every
 * device, so opening on any device shows the same continuous conversation.
 */
export function DispatchTranscript({ turns }: { turns: DispatchHistoryTurn[] }) {
  return (
    <div className="flex flex-col gap-5 py-6">
      {turns.map((t, i) => (
        <TranscriptTurn key={`${t.ts}-${i}`} turn={t} />
      ))}
    </div>
  )
}
