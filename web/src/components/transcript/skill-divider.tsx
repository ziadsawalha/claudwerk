import { FileText } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { cn, haptic } from '@/lib/utils'
import { Markdown } from '../markdown'

const ReportArtifactModal = lazy(() =>
  import('./report-artifact-modal').then(m => ({ default: m.ReportArtifactModal })),
)

/** A host-local artifact (e.g. the /insights HTML report) the broker can proxy
 *  from the sentinel for this conversation. `relPath` is configDir-relative. */
export interface SkillReportArtifact {
  conversationId: string
  relPath: string
}

const rule = (
  <div
    className="flex-1 h-px"
    style={{
      backgroundImage:
        'repeating-linear-gradient(90deg, var(--info) 0px, var(--info) 8px, transparent 8px, transparent 16px)',
    }}
  />
)

// "Show report" action -- opens the artifact in a lazily-loaded sandboxed-iframe
// modal. Self-contained (own open state) so it can sit beside the chip pill.
function ReportAction({ name, artifact }: { name: string; artifact: SkillReportArtifact }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => {
          haptic('tap')
          setOpen(true)
        }}
        className="shrink-0 flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold font-mono uppercase tracking-wider text-teal-400 bg-teal-400/15 border border-teal-400/40 hover:bg-teal-400/25 transition-colors"
      >
        <FileText className="size-3" />
        report
      </button>
      {open && (
        <Suspense fallback={null}>
          <ReportArtifactModal
            conversationId={artifact.conversationId}
            relPath={artifact.relPath}
            title={`/${name} report`}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      )}
    </>
  )
}

export function SkillDivider({
  name,
  content,
  reportArtifact,
}: {
  name: string
  content: string
  reportArtifact?: SkillReportArtifact
}) {
  const [expanded, setExpanded] = useState(false)
  const hasBody = content.trim().length > 0

  return (
    <div className="my-3">
      <div className="flex items-center gap-2">
        {rule}
        {hasBody ? (
          <button
            type="button"
            onClick={() => {
              haptic('tap')
              setExpanded(!expanded)
            }}
            className="px-2 py-0.5 text-[10px] font-bold font-mono uppercase tracking-widest text-teal-400/80 bg-teal-400/10 border border-teal-400/30 shrink-0 flex items-center gap-1.5 hover:bg-teal-400/20 transition-colors"
          >
            <span className={cn('transition-transform text-[8px]', expanded ? 'rotate-90' : '')}>&#9654;</span>/{name}
          </button>
        ) : (
          <span className="px-2 py-0.5 text-[10px] font-bold font-mono uppercase tracking-widest text-teal-400/80 bg-teal-400/10 border border-teal-400/30 shrink-0">
            /{name}
          </span>
        )}
        {reportArtifact && <ReportAction name={name} artifact={reportArtifact} />}
        {rule}
      </div>
      {hasBody && expanded && (
        <div className="mt-2 px-3 py-2 border border-teal-400/20 bg-teal-400/5 rounded text-xs max-h-[400px] overflow-y-auto">
          <Markdown>{content}</Markdown>
        </div>
      )}
    </div>
  )
}
