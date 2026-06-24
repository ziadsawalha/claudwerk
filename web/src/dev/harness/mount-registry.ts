/**
 * Component mount registry for the dev harness.
 *
 * Each entry mounts ONE component in isolation against the real broker. Adding
 * a new mountable component is a one-liner here (a label + a lazy import); the
 * route renders whichever `?mount=<id>` resolves.
 */
import { type ComponentType, type LazyExoticComponent, lazy } from 'react'

export interface MountDef {
  label: string
  Component: LazyExoticComponent<ComponentType>
}

export const MOUNTS: Record<string, MountDef> = {
  'dispatch-overlay': {
    label: 'Dispatch overlay',
    Component: lazy(() => import('./mounts/dispatch-overlay-mount')),
  },
}

export const MOUNT_IDS = Object.keys(MOUNTS)
