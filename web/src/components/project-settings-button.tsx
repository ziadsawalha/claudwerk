import { Pencil } from 'lucide-react'

/** Lightweight gear/pencil trigger for the project settings editor. Lives apart
 *  from the heavy ProjectSettingsEditor so eager surfaces (project node,
 *  conversation item) can render the button without pulling the editor's ~22KB
 *  chunk into the index bundle -- the editor loads lazily on click. */
export function ProjectSettingsButton({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-muted-foreground hover:text-accent transition-colors p-0.5"
      title="Edit project settings"
    >
      <Pencil className="size-3" />
    </button>
  )
}
