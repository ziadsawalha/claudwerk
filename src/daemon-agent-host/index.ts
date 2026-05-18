#!/usr/bin/env bun
/**
 * daemon-agent-host -- the agent host that ATTACHES to a Claude Code daemon
 * worker instead of spawning `claude` itself.
 *
 * The Claude Code 2.1.143+ supervisor daemon (`claude daemon`) hosts background
 * `claude` workers as PTY processes billed against the Anthropic subscription.
 * This host does not spawn a process: the sentinel has already dispatched a
 * `claude --bg` worker, and this host attaches to that worker's PTY over the
 * daemon control socket, mirroring it to the broker exactly like a normal
 * agent host. The broker cannot tell it apart from claude-agent-host.
 *
 * Because the daemon -- not claudewerk -- owns the worker process, claudewerk's
 * SessionStart hook never fires. The worker's `ccSessionId` is therefore
 * DERIVED, not observed via a hook: `session-observer.ts` polls the daemon's
 * `list` op and reads `JobRecord.sessionId` for our worker short.
 *
 * Lifecycle:
 *   1. parseDaemonHostConfig()      -- env -> config
 *   2. resolveControlSocket()       -- locate the daemon control.sock
 *   3. createHostTransport()        -- connect to the broker, emit boot events
 *   4. observeDaemonSession()       -- poll for the worker's ccSessionId
 *   5. first ccSessionId            -- attach the PTY, wire the bridges
 *   6. ccSessionId rotates (/clear) -- conversation_reset, re-point transcript
 *   7. worker gone / SIGTERM        -- close everything, exit
 *
 * The transcript watch, dialect translation and broker transport are reused
 * verbatim from claude-agent-host -- the daemon worker IS `claude`, so its
 * transcript JSONL and tool vocabulary are identical. This host only replaces
 * the front end (attach instead of spawn). See
 * `.claude/docs/plan-claude-agents-integration.md` section 6.1.
 *
 * Env vars (set by the sentinel's `spawnDaemonHostDirect`):
 *   CLAUDWERK_BROKER / RCLAUDE_BROKER   ws://broker
 *   CLAUDWERK_SECRET / RCLAUDE_SECRET   broker auth token
 *   RCLAUDE_CONVERSATION_ID             stable conversation id (broker key)
 *   CLAUDWERK_DAEMON_SHORT              the 8-hex daemon worker short id
 *   RCLAUDE_CWD                         worker cwd (transcript-path slug source)
 */

import { checkBunVersion } from '../shared/bun-version'

checkBunVersion()

import { type AttachHandle, attach } from '../shared/cc-daemon/attach'
import { resolveControlSocket } from '../shared/cc-daemon/socket-path'
import { createHostTransport, type HostTransport } from '../shared/host-transport'
import { cwdToProjectUri } from '../shared/project-uri'
import {
  AGENT_HOST_PROTOCOL_VERSION,
  type AgentHostBoot,
  type BootEvent,
  type BootStep,
  type BrokerMessage,
  type ConversationEnd,
  type ConversationMeta,
  type ConversationReset,
} from '../shared/protocol'
import { BUILD_VERSION } from '../shared/version'
import { type BrokerBridge, createBrokerBridge } from './broker-bridge'
import { type DaemonHostConfig, parseDaemonHostConfig } from './cli-args'
import { type DaemonSessionObserver, observeDaemonSession } from './session-observer'
import { createTranscriptBridge, type TranscriptBridge } from './transcript-bridge'

const log = (msg: string) => process.stderr.write(`[daemon-host] ${msg}\n`)
const debugEnabled = !!process.env.DAEMON_HOST_DEBUG || !!process.env.RCLAUDE_DEBUG
const debug = debugEnabled ? log : () => {}

/** Initial PTY size used for the first attach -- the broker resizes us once a
 *  terminal viewer opens. A sane 80x24 default keeps the worker readable until
 *  then. */
const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

const HOST_VERSION = `daemon-host/${BUILD_VERSION.gitHashShort}`

/** Build the boot message sent on the first broker connect (no session id yet). */
function buildBoot(cfg: DaemonHostConfig): AgentHostBoot {
  return {
    type: 'agent_host_boot',
    protocolVersion: AGENT_HOST_PROTOCOL_VERSION,
    conversationId: cfg.conversationId,
    project: cwdToProjectUri(cfg.cwd, 'daemon'),
    capabilities: ['terminal', 'boot_stream'],
    claudeArgs: [],
    version: HOST_VERSION,
    buildTime: BUILD_VERSION.buildTime,
    agentHostType: 'daemon',
    startedAt: Date.now(),
  }
}

/** Build the meta message sent on a reconnect once the ccSessionId is known. */
function buildMeta(cfg: DaemonHostConfig, ccSessionId: string): ConversationMeta {
  return {
    type: 'meta',
    protocolVersion: AGENT_HOST_PROTOCOL_VERSION,
    ccSessionId,
    conversationId: cfg.conversationId,
    project: cwdToProjectUri(cfg.cwd, 'daemon'),
    startedAt: Date.now(),
    capabilities: ['terminal', 'boot_stream'],
    version: HOST_VERSION,
    buildTime: BUILD_VERSION.buildTime,
    agentHostType: 'daemon',
  }
}

async function main(): Promise<void> {
  const cfg = parseDaemonHostConfig()
  log(`starting conv=${cfg.conversationId.slice(0, 8)} short=${cfg.daemonShort} cwd=${cfg.cwd} broker=${cfg.brokerUrl}`)

  const controlSock = resolveControlSocket()
  if (!controlSock) {
    log('FATAL: no Claude Code daemon control socket found (daemon not running?)')
    process.exit(1)
  }
  debug(`control socket: ${controlSock}`)

  // --- mutable host state ----------------------------------------------------
  let ccSessionId: string | null = null
  let attachHandle: AttachHandle | null = null
  let bridge: BrokerBridge | null = null
  let transcriptBridge: TranscriptBridge | null = null
  let observer: DaemonSessionObserver | null = null
  let shuttingDown = false

  // --- broker transport (created up front so boot events have a channel) -----
  const transport: HostTransport = createHostTransport({
    brokerUrl: cfg.brokerUrl,
    brokerSecret: cfg.brokerSecret,
    conversationId: cfg.conversationId,
    hostVersion: HOST_VERSION,
    buildInitialMessage: () => (ccSessionId ? buildMeta(cfg, ccSessionId) : buildBoot(cfg)),
    onMessage: handleInbound,
    onConnected: () => {
      debug('broker connected')
      emitBoot('broker_connected')
    },
    onDisconnected: () => debug('broker disconnected'),
    onError: err => debug(`transport error: ${err.message}`),
    onDiag: (_kind, m, args) => debug(`diag: ${m} ${args ? JSON.stringify(args) : ''}`),
  })

  /** Emit a structured boot-lifecycle event so the user sees host progress. */
  function emitBoot(step: BootStep, detail?: string): void {
    const ev: BootEvent = { type: 'boot_event', conversationId: cfg.conversationId, step, t: Date.now() }
    if (detail) ev.detail = detail
    transport.send(ev)
    debug(`boot_event: ${step}${detail ? ` (${detail})` : ''}`)
  }

  emitBoot('agent_host_started', HOST_VERSION)

  // --- inbound broker message routing ----------------------------------------
  function handleInbound(msg: BrokerMessage): void {
    const t = (msg as { type?: string }).type
    if (t === 'terminate_conversation') {
      log('broker requested termination')
      shutdown('dashboard-other', false)
      return
    }
    if (t === 'transcript_request' || t === 'transcript_kick') {
      transcriptBridge?.resend().catch((err: unknown) => debug(`resend failed: ${(err as Error).message}`))
      return
    }
    // terminal_data / input / terminal_resize / terminal_attach -> the worker PTY
    bridge?.handleMessage(msg)
  }

  // --- ccSessionId observation (the no-hook derivation) ----------------------
  /**
   * Fired by the session observer on the first ccSessionId and on every
   * rotation (a `/clear` inside the worker mints a new CC session). The first
   * call bootstraps the attach + bridges; later calls re-point the transcript
   * watcher and tell the broker to wipe ephemeral state.
   */
  function onSessionId(nextSessionId: string): void {
    if (shuttingDown) return
    const isFirst = ccSessionId === null
    ccSessionId = nextSessionId
    transport.setSessionId(nextSessionId, 'stream_json')

    if (isFirst) {
      emitBoot('init_received', nextSessionId)
      bootstrap(nextSessionId).catch((err: unknown) => {
        log(`FATAL: bootstrap failed: ${(err as Error).message}`)
        emitBoot('boot_error', (err as Error).message)
        shutdown('cc-exit-crash', true)
      })
      return
    }

    // /clear rotated the session id -- the worker is the same PTY, only its
    // transcript file changed. Tell the broker to wipe ephemeral state, then
    // re-point the transcript watcher at the new JSONL.
    log(`ccSessionId rotated -> ${nextSessionId.slice(0, 8)} (/clear)`)
    const reset: ConversationReset = {
      type: 'conversation_reset',
      conversationId: cfg.conversationId,
      project: cwdToProjectUri(cfg.cwd, 'daemon'),
    }
    transport.send(reset)
    transcriptBridge
      ?.watch(nextSessionId, cfg.cwd)
      .catch((err: unknown) => debug(`re-watch failed: ${(err as Error).message}`))
  }

  /** One-time setup after the worker's first ccSessionId is known. */
  async function bootstrap(firstSessionId: string): Promise<void> {
    attachHandle = await attach(controlSock as string, cfg.daemonShort, {
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      onData: pty => bridge?.feedPty(pty),
      onClose: reason => {
        // `client-closed` is our own shutdown; anything else means the worker
        // PTY went away (worker exited, daemon died, kicked).
        if (reason !== 'client-closed' && !shuttingDown) {
          log(`attach closed: ${reason}`)
          shutdown('daemon-job-gone', true)
        }
      },
      onError: err => debug(`attach error: ${err.message}`),
    })
    debug(`attached: state=${attachHandle.ack.state} via=${attachHandle.ack.via}`)

    bridge = createBrokerBridge({
      transport,
      attachHandle,
      conversationId: cfg.conversationId,
      debug,
    })
    transcriptBridge = createTranscriptBridge({
      transport,
      onError: err => debug(`transcript error: ${err.message}`),
      debug: debugEnabled ? (m: string) => debug(`[tx] ${m}`) : undefined,
    })
    await transcriptBridge.watch(firstSessionId, cfg.cwd)
    emitBoot('conversation_ready')
  }

  emitBoot('awaiting_init')
  observer = observeDaemonSession({
    controlSock,
    daemonShort: cfg.daemonShort,
    onSessionId,
    onGone: () => {
      if (!shuttingDown) {
        log('worker no longer in daemon roster')
        shutdown('daemon-job-gone', true)
      }
    },
    onError: err => debug(`observer error: ${err.message}`),
  })

  // --- shutdown --------------------------------------------------------------
  /**
   * Tear everything down. `emitEnd` controls whether a `ConversationEnd` wire
   * message is sent: true when the WORKER itself terminated (a genuine
   * conversation end), false when our own process is being reaped (SIGTERM /
   * broker terminate) -- the broker handles those via the WS close.
   */
  function shutdown(source: ConversationEnd['source'], emitEnd: boolean): void {
    if (shuttingDown) return
    shuttingDown = true
    log(`shutdown: ${source}`)
    if (emitEnd) {
      emitBoot('claude_exited', source)
      const end: ConversationEnd = {
        type: 'end',
        conversationId: cfg.conversationId,
        reason: `daemon worker ended: ${source}`,
        endedAt: Date.now(),
      }
      if (source) end.source = source
      transport.send(end)
    }
    observer?.stop()
    bridge?.stop()
    transcriptBridge?.stop()
    attachHandle?.close()
    transport.flush()
    setTimeout(() => {
      transport.close()
      process.exit(0)
    }, 200)
  }

  process.on('SIGINT', () => shutdown('sentinel-kill', false))
  process.on('SIGTERM', () => shutdown('sentinel-kill', false))
}

main().catch(err => {
  log(`FATAL: ${(err as Error).stack ?? err}`)
  process.exit(1)
})
