/**
 * The launch-profile "Project URI" control.
 *
 * Normal operation is a plain text field -- type a URI directly. The Build
 * button toggles an inline ProjectUriBuilder (sentinel + cwd wizard) right
 * below the row, which writes the composed URI back into the field.
 */

import { Hammer } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { LabeledRow } from './editor-shell'
import { ProjectUriBuilder } from './project-uri-builder'

interface Props {
  value: string
  onChange: (value: string) => void
}

export function ProjectUriField({ value, onChange }: Props) {
  const [building, setBuilding] = useState(false)
  return (
    <div className="space-y-2">
      <LabeledRow label="Project URI" subtitle="Type a URI, or Build one from a sentinel + directory">
        <div className="flex items-center gap-1.5" style={{ maxWidth: 360, flex: 1 }}>
          <input
            aria-label="Project URI"
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder="claude://default/path"
            spellCheck={false}
            className="flex-1 min-w-0 text-xs font-mono bg-surface-inset border border-primary/20 px-2 py-1 outline-none"
          />
          <button
            type="button"
            onClick={() => setBuilding(o => !o)}
            className={cn(
              'flex items-center gap-1 px-2 py-1 text-[10px] border transition-colors shrink-0',
              building
                ? 'border-primary/50 text-primary bg-primary/10'
                : 'border-primary/20 text-muted-foreground hover:text-foreground',
            )}
          >
            <Hammer className="size-3" />
            Build
          </button>
        </div>
      </LabeledRow>
      {building && (
        <ProjectUriBuilder
          initialUri={value}
          onApply={uri => {
            onChange(uri)
            setBuilding(false)
          }}
          onClose={() => setBuilding(false)}
        />
      )}
    </div>
  )
}
