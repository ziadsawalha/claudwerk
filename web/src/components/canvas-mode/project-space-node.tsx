// The PROJECT SPACE: a slightly tinted rect behind a project's conversations
// with the project title painted large and faint across it. Clicking the
// header chip navigates to the project view.
import type { NodeProps } from '@xyflow/react'
import type { ProjectSpaceData } from './canvas-types'

export function ProjectSpaceNode({ data, width, height }: NodeProps) {
  const d = data as ProjectSpaceData
  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-2xl border"
      style={{
        width,
        height,
        backgroundColor: `oklch(0.32 0.045 ${d.hue} / 0.16)`,
        borderColor: `oklch(0.6 0.08 ${d.hue} / 0.25)`,
      }}
    >
      {/* the painted-in large title */}
      <div
        className="pointer-events-none absolute inset-x-3 top-0 select-none truncate font-black uppercase tracking-tight"
        style={{ color: `oklch(0.85 0.06 ${d.hue} / 0.13)`, fontSize: 56, lineHeight: '72px' }}
      >
        {d.label}
      </div>
      <div className="absolute left-3 top-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            window.location.hash = `project/${encodeURIComponent(d.uri)}`
          }}
          className="pointer-events-auto cursor-pointer rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold hover:brightness-125"
          style={{ color: `oklch(0.85 0.07 ${d.hue})`, backgroundColor: `oklch(0.5 0.07 ${d.hue} / 0.22)` }}
          title={`Open project ${d.label}`}
        >
          {d.label}
        </button>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {d.count} conv{d.count === 1 ? '' : 's'}
          {d.activeCount > 0 ? ` - ${d.activeCount} active` : ''}
        </span>
      </div>
    </div>
  )
}
