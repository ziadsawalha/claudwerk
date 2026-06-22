// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { clearPref, getPref, resetDialogPrefsCache, setPref } from './live-dialog-prefs'

beforeEach(() => {
  localStorage.clear()
  resetDialogPrefsCache()
})

describe('live-dialog-prefs', () => {
  it('round-trips a minimize pref through localStorage', () => {
    setPref('conv1', { dialogId: 'd1', collapsed: true })
    resetDialogPrefsCache() // force a re-read from storage, not the in-memory cache
    expect(getPref('conv1')).toEqual({ dialogId: 'd1', collapsed: true })
  })

  it('keeps prefs isolated per conversation', () => {
    setPref('conv1', { dialogId: 'd1', collapsed: true })
    setPref('conv2', { dialogId: 'd2', collapsed: false })
    expect(getPref('conv1')?.collapsed).toBe(true)
    expect(getPref('conv2')?.collapsed).toBe(false)
  })

  it('clears a pref', () => {
    setPref('conv1', { dialogId: 'd1', collapsed: true })
    clearPref('conv1')
    expect(getPref('conv1')).toBeUndefined()
  })

  it('returns undefined for an unknown conversation', () => {
    expect(getPref('nope')).toBeUndefined()
  })

  it('survives malformed storage without throwing', () => {
    localStorage.setItem('claudewerk.dialogView.v1', '{not json')
    resetDialogPrefsCache()
    expect(getPref('conv1')).toBeUndefined()
    setPref('conv1', { dialogId: 'd1', collapsed: true })
    expect(getPref('conv1')?.collapsed).toBe(true)
  })
})
