import { describe, expect, it } from 'bun:test'
import { permissionDecisionToText } from './permission-decision'

describe('permissionDecisionToText', () => {
  it('maps allow -> 1 (CC PTY menu "Allow once")', () => {
    expect(permissionDecisionToText('allow')).toBe('1')
  })

  it('maps allow_session -> 2 (CC PTY menu "Allow for this session")', () => {
    expect(permissionDecisionToText('allow_session')).toBe('2')
  })

  it('maps deny -> 3 (CC PTY menu "Cancel / Deny")', () => {
    expect(permissionDecisionToText('deny')).toBe('3')
  })
})
