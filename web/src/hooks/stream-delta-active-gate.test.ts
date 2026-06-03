import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useConversationsStore } from './use-conversations'
import { handlers } from './use-websocket-handlers'

/**
 * Cold-load duplicate-bubble guard: a `content_block_delta` for a conversation
 * that is NOT active is a stale tail (e.g. the live delta that lands just after
 * the isInitial HTTP snapshot already committed the assistant entry). Accepting
 * it repopulates `streamingText` with nothing left to clear it -> an orphaned
 * streaming bubble duplicated below the committed text. Only an ACTIVE turn may
 * grow the buffer. message_start / message_stop stay ungated (reset/clear).
 */
describe('handleStreamDelta -- active-status gate', () => {
  const sid = 'conv_gate_test'

  function setStatus(status: string) {
    useConversationsStore.setState({
      conversationsById: { [sid]: { id: sid, status } } as never,
    })
  }

  function textDelta(text: string) {
    handlers.stream_delta({
      type: 'stream_delta',
      conversationId: sid,
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text } },
    } as never)
  }

  beforeEach(() => {
    useConversationsStore.setState({ streamingText: {}, streamingThinking: {} })
  })
  afterEach(() => {
    useConversationsStore.setState({ streamingText: {}, streamingThinking: {}, conversationsById: {} as never })
  })

  it('drops a text delta when the conversation is idle', () => {
    setStatus('idle')
    textDelta('orphan tail')
    expect(useConversationsStore.getState().streamingText[sid]).toBeUndefined()
  })

  it('drops a text delta when the conversation is ended', () => {
    setStatus('ended')
    textDelta('orphan tail')
    expect(useConversationsStore.getState().streamingText[sid]).toBeUndefined()
  })

  it('accumulates a text delta while the conversation is active', () => {
    setStatus('active')
    textDelta('hello ')
    textDelta('world')
    expect(useConversationsStore.getState().streamingText[sid]).toBe('hello world')
  })

  it('still clears the buffer on message_stop even when no longer active', () => {
    setStatus('active')
    textDelta('partial response')
    expect(useConversationsStore.getState().streamingText[sid]).toBe('partial response')
    // Turn ends: status flips, then message_stop arrives. The clear must run
    // regardless of status -- it is not behind the content-delta gate.
    setStatus('idle')
    handlers.stream_delta({
      type: 'stream_delta',
      conversationId: sid,
      event: { type: 'message_stop' },
    } as never)
    expect(useConversationsStore.getState().streamingText[sid]).toBeUndefined()
  })
})
