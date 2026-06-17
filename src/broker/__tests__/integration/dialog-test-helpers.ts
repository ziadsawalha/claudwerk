/**
 * Shared scaffold for the dialog integration tests (one-shot + live). Keeps the
 * boot-to-active boilerplate in one place so each suite stays about its own
 * assertions.
 */

import type { MockWs, TestHarness } from './test-harness'
import { testId } from './test-harness'

/** Boot an agent host for `convId` and promote it to active via `meta`. */
export function bootActiveAgent(h: TestHarness, convId: string, project: string): MockWs {
  const agent = h.bootAgentHost({ conversationId: convId, project })
  h.agentSend(agent, {
    type: 'meta',
    conversationId: convId,
    ccSessionId: testId('cc'),
    project,
    cwd: '/home/user/proj',
    startedAt: Date.now(),
  })
  return agent
}
