/**
 * Shared status styling for plan blocks (FileTree, DataModel).
 * Mirrors the diff/change vocabulary: added / modified / removed / unchanged.
 */
import type { FileTreeStatus } from '../types'

export const STATUS_DOT: Record<FileTreeStatus, string> = {
  added: 'bg-emerald-500',
  modified: 'bg-amber-500',
  removed: 'bg-destructive',
  unchanged: 'bg-muted-foreground/40',
}

export const STATUS_TEXT: Record<FileTreeStatus, string> = {
  added: 'text-emerald-500',
  modified: 'text-amber-500',
  removed: 'text-destructive line-through',
  unchanged: 'text-foreground/70',
}
