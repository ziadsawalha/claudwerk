import { describe, expect, it } from 'bun:test'
import { voiceTools } from './voice-tools'

describe('voice tool contract', () => {
  it('exposes the dispatch verbs + screen control', () => {
    expect(voiceTools.map(t => t.name)).toEqual([
      'dispatch',
      'conversation_select',
      'confirm_expensive',
      'control_screen',
    ])
  })

  it('every tool is a strict function schema', () => {
    for (const t of voiceTools) {
      expect(t.type).toBe('function')
      expect(t.parameters.type).toBe('object')
      expect(t.parameters.strict).toBe(true)
    }
  })

  // OpenAI Realtime strict mode requires `required` to list EVERY property.
  it('required lists every property (strict-mode rule)', () => {
    for (const t of voiceTools) {
      const props = Object.keys(t.parameters.properties).sort()
      expect([...t.parameters.required].sort()).toEqual(props)
    }
  })
})
