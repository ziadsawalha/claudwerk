import { useDispatchStore } from './dispatch-store'

/** The dispatcher's durable MEMORY FILE, shown so the user can SEE what it
 *  remembers long-term (the post-turn digest appends here). Renders nothing
 *  until there's something remembered. */
export function MemorySection() {
  const memory = useDispatchStore(s => s.memory)
  if (!memory.trim()) return null
  return (
    <div>
      <span className="text-[11px] uppercase tracking-[0.2em] text-comment">what I remember</span>
      <pre className="mt-3 whitespace-pre-wrap rounded-xl border border-border/70 bg-card/40 px-3.5 py-2.5 font-mono text-[11.5px] leading-relaxed text-comment">
        {memory}
      </pre>
    </div>
  )
}
