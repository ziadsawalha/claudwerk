/**
 * Daemon backend -- claudewerk conversations hosted on a Claude Code daemon
 * worker (subscription-billed), driven by `src/daemon-agent-host/`.
 *
 * The dashboard requests `backend: 'daemon'`. The broker tags the spawn
 * `agentHostType: 'daemon'`; the sentinel dispatches a `claude --bg` worker,
 * captures its short id, and launches `bin/daemon-host` which attaches to that
 * worker's PTY over the daemon control socket. From the broker's point of view
 * the daemon-agent-host is an ordinary socket-based agent host -- it sends
 * `agent_host_boot`, transcript entries and terminal data exactly like the
 * Claude agent host.
 *
 * MVP constraint: `claude --bg` dispatches a job with a prompt, so a daemon
 * spawn requires an initial prompt. Promptless interactive daemon spawns are a
 * follow-up (Phase 3, the socket `dispatch` op).
 *
 * See `.claude/docs/plan-claude-agents-integration.md` sections 6.1-6.3.
 */

import { randomUUID } from 'node:crypto'
import { generateConversationName } from '../../shared/conversation-names'
import { cwdToProjectUri } from '../../shared/project-uri'
import type { LaunchProgressEvent, LaunchStep, SpawnResult as SentinelSpawnResult } from '../../shared/protocol'
import { deriveConversationName, validateConversationName } from '../../shared/spawn-naming'
import type { SpawnRequest } from '../../shared/spawn-schema'
import type { ConversationStore } from '../conversation-store'
import type { ConversationBackend, InputResult, SpawnDeps, SpawnResult } from './types'

/** agentHostMeta key -- the broker core never reads it; only this file does. */
const META_BACKEND = 'backend'

function emitProgress(
  conversationStore: ConversationStore,
  jobId: string | undefined,
  step: LaunchStep,
  status: LaunchProgressEvent['status'],
  extra?: Partial<LaunchProgressEvent>,
): void {
  if (!jobId) return
  conversationStore.forwardJobEvent(jobId, { type: 'launch_progress', jobId, step, status, t: Date.now(), ...extra })
}

export const daemonBackend: ConversationBackend = {
  type: 'daemon',
  scheme: 'daemon',
  // bin/daemon-host connects back to the broker over a per-conversation
  // WebSocket, exactly like the Claude and OpenCode agent hosts.
  requiresAgentSocket: true,

  async spawn(req: SpawnRequest, deps: SpawnDeps): Promise<SpawnResult> {
    return spawnDaemon(req, deps)
  },

  async handleInput(): Promise<InputResult> {
    // Same contract as the Claude backend: input is forwarded over the agent
    // host socket by the unified send_input handler (the daemon-agent-host
    // writes it to the worker PTY).
    return { ok: false, useSocket: true, error: 'Daemon input is handled via the agent host socket' }
  },
}

async function spawnDaemon(req: SpawnRequest, deps: SpawnDeps): Promise<SpawnResult> {
  // claude --bg dispatches a job with a prompt -- a daemon spawn needs one.
  if (!req.prompt?.trim()) {
    return { ok: false, error: 'Daemon spawn requires an initial prompt', statusCode: 400 }
  }

  const sentinelResult = resolveSentinel(req, deps)
  if (!sentinelResult.ok) return sentinelResult.error
  const { sentinel, resolvedSentinelId } = sentinelResult

  if (resolvedSentinelId && !deps.conversationStore.isSentinelAlive(resolvedSentinelId)) {
    return { ok: false, error: 'Sentinel not responding (no heartbeat received recently)', statusCode: 503 }
  }

  const usedNames = new Set(
    deps.conversationStore
      .getAllConversations()
      .map(s => s.title)
      .filter(Boolean) as string[],
  )
  if (req.name) {
    const nameErr = validateConversationName(req.name, usedNames)
    if (nameErr) return { ok: false, error: nameErr, statusCode: 400 }
  }

  const requestId = randomUUID()
  const conversationId = randomUUID()
  const jobId = req.jobId ?? randomUUID()
  const conversationName = deriveConversationName(req) ?? generateConversationName(usedNames)
  const project = cwdToProjectUri(req.cwd, 'daemon')

  deps.conversationStore.createJob(jobId, conversationId)
  emitProgress(deps.conversationStore, jobId, 'job_created', 'done', { conversationId })

  const result = await dispatchToSentinel({
    sentinel,
    deps,
    req,
    requestId,
    conversationId,
    jobId,
    conversationName,
  })

  if (!result.success) {
    const errorMsg = result.error || 'Spawn failed'
    emitProgress(deps.conversationStore, jobId, 'failed', 'error', { error: errorMsg })
    deps.conversationStore.failJob(jobId, errorMsg)
    return { ok: false, error: errorMsg, statusCode: 500 }
  }

  // Pre-tag the conversation so boot/input messages route to this backend
  // before the daemon-agent-host's agent_host_boot arrives and fills the rest.
  let conv = deps.conversationStore.getConversation(conversationId)
  if (!conv) {
    conv = deps.conversationStore.createConversation(conversationId, project, req.model || '', [], ['terminal'])
  }
  conv.agentHostType = 'daemon'
  conv.agentHostMeta = { [META_BACKEND]: 'daemon' }
  conv.project = project
  conv.title = req.name || conversationName
  if (req.description) conv.description = req.description
  deps.conversationStore.persistConversationById(conversationId)

  emitProgress(deps.conversationStore, jobId, 'agent_acked', 'done')
  return { ok: true, conversationId, jobId, tmuxSession: result.tmuxSession }
}

/** Resolve the target sentinel for this spawn (explicit alias or the default). */
function resolveSentinel(
  req: SpawnRequest,
  deps: SpawnDeps,
):
  | { ok: true; sentinel: NonNullable<ReturnType<ConversationStore['getSentinel']>>; resolvedSentinelId?: string }
  | { ok: false; error: SpawnResult } {
  if (req.sentinel) {
    const sentinel = deps.conversationStore.getSentinelByAlias(req.sentinel)
    if (!sentinel) {
      const available = deps.conversationStore
        .getConnectedSentinels()
        .map(s => s.alias)
        .join(', ')
      return {
        ok: false,
        error: {
          ok: false,
          error: `Sentinel "${req.sentinel}" is offline. Available: ${available || 'none'}`,
          statusCode: 503,
        },
      }
    }
    const resolvedSentinelId = deps.conversationStore
      .getConnectedSentinels()
      .find(s => s.alias === req.sentinel)?.sentinelId
    return { ok: true, sentinel, resolvedSentinelId }
  }
  const sentinel = deps.conversationStore.getSentinel()
  if (!sentinel) return { ok: false, error: { ok: false, error: 'No sentinel connected', statusCode: 503 } }
  return { ok: true, sentinel, resolvedSentinelId: deps.conversationStore.getDefaultSentinelId() }
}

/** Send the spawn message to the sentinel and await its spawn_result. */
function dispatchToSentinel(opts: {
  sentinel: NonNullable<ReturnType<ConversationStore['getSentinel']>>
  deps: SpawnDeps
  req: SpawnRequest
  requestId: string
  conversationId: string
  jobId: string
  conversationName: string
}): Promise<SentinelSpawnResult> {
  const { sentinel, deps, req, requestId, conversationId, jobId, conversationName } = opts
  return new Promise<SentinelSpawnResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      deps.conversationStore.removeSpawnListener(requestId)
      reject(new Error('Sentinel did not respond (15s timeout)'))
    }, 15000)

    deps.conversationStore.addSpawnListener(requestId, msg => {
      clearTimeout(timeout)
      resolve(msg as SentinelSpawnResult)
    })

    emitProgress(deps.conversationStore, jobId, 'spawn_sent', 'active')
    deps.conversationStore.recordJobConfig(jobId, {
      cwd: req.cwd,
      worktree: req.worktree,
      mkdir: req.mkdir,
      mode: req.mode || 'fresh',
      headless: true,
      model: req.model,
      bare: false,
      repl: false,
      name: req.name,
    })

    try {
      sentinel.send(
        JSON.stringify({
          type: 'spawn',
          requestId,
          conversationId,
          jobId,
          // The sentinel routes daemon-tagged spawns to its `claude --bg`
          // dispatch + bin/daemon-host launch path.
          agentHostType: 'daemon',
          cwd: req.cwd,
          mkdir: req.mkdir || false,
          mode: req.mode || 'fresh',
          model: req.model || undefined,
          conversationName,
          conversationDescription: req.description || undefined,
          prompt: req.prompt,
          env: req.env || undefined,
        }),
      )
    } catch {
      clearTimeout(timeout)
      deps.conversationStore.removeSpawnListener(requestId)
      reject(new Error('Sentinel offline (send failed)'))
    }
  }).catch(
    (err: unknown): SentinelSpawnResult => ({
      type: 'spawn_result',
      requestId,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }),
  )
}
