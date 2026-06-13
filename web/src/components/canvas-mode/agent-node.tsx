// One subagent on THE CANVAS: a small pink satellite orbiting its parent
// conversation card. Running agents glow + pulse; just-stopped ones fade out
// over their linger window before layout.ts drops them.
import { Handle, type NodeProps, Position } from '@xyflow/react'
import { cn } from '@/lib/utils'
import { AGENT_PINK, type AgentNodeData } from './canvas-types'

export function AgentNode({ data }: NodeProps) {
  const d = data as AgentNodeData
  return (
    <div
      className={cn(
        'flex h-[30px] w-[150px] items-center gap-1.5 rounded-md border px-2 shadow-sm transition-opacity',
        d.fading && 'opacity-40',
      )}
      style={{ borderColor: `${AGENT_PINK}`, background: `color-mix(in oklch, ${AGENT_PINK} 16%, transparent)` }}
    >
      <Handle type="target" position={Position.Left} className="!border-0 !bg-transparent" />
      <span
        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', !d.fading && 'animate-pulse')}
        style={{ backgroundColor: AGENT_PINK }}
      />
      <span className="truncate font-mono text-[10px] font-semibold" style={{ color: AGENT_PINK }}>
        {d.agentType}
      </span>
      {d.model && (
        <span className="ml-auto shrink-0 truncate text-[9px] text-muted-foreground">
          {d.model.replace(/^claude-/, '')}
        </span>
      )}
    </div>
  )
}
