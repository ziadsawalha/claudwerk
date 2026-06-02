import { lazy, Suspense } from 'react'

const Inner = lazy(() => import('./project-settings-editor').then(m => ({ default: m.ProjectSettingsEditor })))

/**
 * Lazy drop-in for ProjectSettingsEditor. Every call site already renders it
 * conditionally (`{open && <ProjectSettingsEditor .../>}`), so React.lazy defers
 * its ~22KB chunk until the editor is first opened. Used from the header, the
 * project node, and the conversation item -- all eager surfaces that would
 * otherwise pin it in the index chunk.
 */
export function ProjectSettingsEditor(props: { project: string; onClose: () => void }) {
  return (
    <Suspense fallback={null}>
      <Inner {...props} />
    </Suspense>
  )
}
