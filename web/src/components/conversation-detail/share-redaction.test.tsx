/**
 * Share-link guests must never see host disk paths. ProjectPathRow and
 * CurrentPathRow render normally for the owner but collapse to nothing in a
 * share view. (Defense in depth alongside the broker channel gating.)
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Conversation } from '@/lib/types'
import { CurrentPathRow, ProjectPathRow } from './header-info-rows'

let share = false
vi.mock('@/lib/share-mode', () => ({
  isShareView: () => share,
}))

afterEach(cleanup)
beforeEach(() => {
  share = false
})

const PROJECT = 'claude://default/Users/jonas/temp'
function conv(currentPath: string): Conversation {
  return { project: PROJECT, currentPath } as unknown as Conversation
}

describe('ProjectPathRow share redaction', () => {
  test('shows the disk path for the owner', () => {
    render(<ProjectPathRow project={PROJECT} />)
    expect(screen.getByText('/Users/jonas/temp')).toBeDefined()
  })

  test('renders nothing for a share-link guest', () => {
    share = true
    const { container } = render(<ProjectPathRow project={PROJECT} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('CurrentPathRow share redaction', () => {
  test('shows the diverged cwd for the owner', () => {
    render(<CurrentPathRow conversation={conv('/Users/jonas/temp/.claude/worktrees/foo')} />)
    expect(screen.getAllByText(/foo/).length).toBeGreaterThan(0)
  })

  test('renders nothing for a share-link guest', () => {
    share = true
    const { container } = render(<CurrentPathRow conversation={conv('/Users/jonas/temp/.claude/worktrees/foo')} />)
    expect(container.firstChild).toBeNull()
  })
})
