import { projectIdentityKey } from '@shared/project-uri'
import { useMemo } from 'react'
import { updateProjectSettings, useConversations, useConversationsStore } from '@/hooks/use-conversations'
import { cn, projectDisplayName } from '@/lib/utils'

/**
 * Dispatch scope: the dispatcher only routes among projects opted into its feed
 * (`dispatchSubscribed`). Without this control the cockpit shows a full fleet
 * but dispatch "sees" nothing -- so surface every project the fleet touches as a
 * toggle pill (lit = in scope). Reuses the existing update_project_settings WS
 * path; no new backend.
 */
export function DispatchScopeBar() {
  const conversations = useConversations()
  const projectSettings = useConversationsStore(s => s.projectSettings)

  const projects = useMemo(() => {
    const seen = new Map<string, string>() // identityKey -> raw project uri
    for (const c of conversations) {
      if (c.status === 'ended') continue
      const key = projectIdentityKey(c.project)
      if (!seen.has(key)) seen.set(key, c.project)
    }
    return [...seen.values()].sort((a, b) => projectDisplayName(a).localeCompare(projectDisplayName(b)))
  }, [conversations])

  const subscribedCount = projects.filter(p => projectSettings[projectIdentityKey(p)]?.dispatchSubscribed).length

  if (projects.length === 0) return null

  return (
    <div className="flex flex-none items-center gap-2 border-b border-border px-5 py-2">
      <span className="flex-none text-[10px] font-semibold uppercase tracking-[0.18em] text-comment">
        Scope
        <span className="ml-1.5 text-comment/70">
          {subscribedCount}/{projects.length}
        </span>
      </span>
      <div className="dispatch-scroll flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
        {projects.map(p => {
          const on = !!projectSettings[projectIdentityKey(p)]?.dispatchSubscribed
          return (
            <button
              key={projectIdentityKey(p)}
              type="button"
              onClick={() => updateProjectSettings(p, { dispatchSubscribed: !on })}
              title={on ? 'In dispatch scope -- click to remove' : 'Not in scope -- click to let dispatch route here'}
              className={cn(
                'flex-none rounded-full border px-2.5 py-0.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                on
                  ? 'border-primary/40 bg-primary/15 text-primary'
                  : 'border-border bg-transparent text-comment hover:border-foreground/30 hover:text-foreground',
              )}
            >
              {projectDisplayName(p)}
            </button>
          )
        })}
      </div>
      {subscribedCount === 0 && (
        <span className="flex-none text-[10px] text-warning">dispatch can't route until a project is lit</span>
      )}
    </div>
  )
}
