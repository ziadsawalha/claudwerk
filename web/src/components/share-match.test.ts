import { describe, expect, it } from 'vitest'
import { conversationShareMatches } from './share-panel'

const PROJECT = 'claude://default/Users/jonas/projects/portal2'
const CONV = '0aa20b3c-d837-4319-a247-ed46fb1a22f2'
const future = Date.now() + 60_000
const past = Date.now() - 60_000

describe('conversationShareMatches', () => {
  it('matches a conversation-kind share bound to this conversation', () => {
    expect(
      conversationShareMatches(
        { project: PROJECT, expiresAt: future, conversationId: CONV, targetKind: 'conversation' },
        PROJECT,
        CONV,
      ),
    ).toBe(true)
  })

  it('treats a missing targetKind as a conversation share (legacy/back-compat)', () => {
    expect(conversationShareMatches({ project: PROJECT, expiresAt: future, conversationId: CONV }, PROJECT, CONV)).toBe(
      true,
    )
  })

  it('does NOT match a recap share (no conversationId, project-scoped) -- the leak', () => {
    expect(conversationShareMatches({ project: PROJECT, expiresAt: future, targetKind: 'recap' }, PROJECT, CONV)).toBe(
      false,
    )
  })

  it('does NOT match a sibling conversation in the same project', () => {
    expect(
      conversationShareMatches(
        { project: PROJECT, expiresAt: future, conversationId: 'other-conv-id', targetKind: 'conversation' },
        PROJECT,
        CONV,
      ),
    ).toBe(false)
  })

  it('does NOT match an expired share', () => {
    expect(
      conversationShareMatches(
        { project: PROJECT, expiresAt: past, conversationId: CONV, targetKind: 'conversation' },
        PROJECT,
        CONV,
      ),
    ).toBe(false)
  })

  it('does NOT match a share for a different project', () => {
    expect(
      conversationShareMatches(
        { project: 'claude://default/other', expiresAt: future, conversationId: CONV, targetKind: 'conversation' },
        PROJECT,
        CONV,
      ),
    ).toBe(false)
  })
})
