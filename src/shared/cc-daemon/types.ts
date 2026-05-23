/**
 * Wire types for the Claude Code background-session daemon (`claude daemon`)
 * control socket. Reverse-engineered from the 2.1.143 binary and live-verified
 * against a running daemon -- see `.claude/docs/plan-claude-agents-integration.md`.
 *
 * THIS MODULE IS THE PROTO-FRAGILE SURFACE. The daemon stamps every frame with a
 * `proto` version and hard-rejects mismatches on gated ops with EPROTO. When
 * Claude Code bumps the protocol this module must break loudly -- by design.
 */

/** Control-socket wire-protocol version. Verified: proto 1 on CC 2.1.143. */
export const CC_DAEMON_PROTO = 1

/**
 * Error codes the daemon returns in `{ ok: false, code }`. The full set
 * recovered from the 2.1.143 binary -- `ENOREPLY` / `EUNVERIFIED` / `EALIVE` /
 * `ESTALE` surface from the mutating + attach ops.
 */
export type DaemonErrorCode =
  | 'EPROTO'
  | 'ENOJOB'
  | 'ENOCONN'
  | 'ETIMEOUT'
  | 'ESTARTING'
  | 'ERESPAWNING'
  | 'ETOOLARGE'
  | 'EPEERUID'
  | 'EKICKED'
  | 'ESTALLED'
  | 'ENOREPLY'
  | 'EUNVERIFIED'
  | 'EALIVE'
  | 'ESTALE'
  | 'EUNKNOWN'

/** A request to the control socket. `proto` is stamped by the client. */
export interface ControlRequest {
  op: string
  [field: string]: unknown
}

/** A successful response: `{ ok: true, op, ... }`. */
export interface DaemonOk {
  ok: true
  op: string
  [field: string]: unknown
}

/** A failure response: `{ ok: false, error, code? }`. */
export interface DaemonErr {
  ok: false
  error: string
  code?: DaemonErrorCode
}

export type DaemonResponse = DaemonOk | DaemonErr

/**
 * Compact job record returned inline by `list` and by the `subscribe` snapshot.
 * A subset of the on-disk `~/.claude/jobs/<id>/state.json`.
 */
export interface JobRecord {
  short: string
  sessionId: string
  cwd: string
  state: string
  nonce?: string
  pid?: number
  attempt?: number
  startedAt?: number
  backend?: string
  tempo?: string
  detail?: string
  intent?: string
  name?: string
  cliVersion?: string
  source?: string
  needs?: string
}

/** Response shape of the `list` op. */
export interface ListResponse extends DaemonOk {
  op: 'list'
  jobs: JobRecord[]
}

/**
 * Attacher capabilities, sent in the `attach` request. Live-verified: when
 * `caps` is present the daemon REQUIRES `terminal`, `mux` and `ssh`; the rest
 * are optional. Recovered from the 2.1.143 `attach` request schema.
 */
export interface AttachCaps {
  /** Terminal type (e.g. `xterm-256color`), or null if unknown. */
  terminal: string | null
  /** Terminal multiplexer the attacher runs inside, or null. */
  mux: 'tmux' | 'screen' | 'zellij' | null
  /** Whether the attacher is reached over SSH. */
  ssh: boolean
  wheelFlood?: boolean
  hyperlinks?: boolean
  progressReporting?: boolean
  wtSession?: boolean
  isVscodeTerm?: boolean
  browser?: string | null
  colorLevel?: 0 | 1 | 2 | 3
  editor?: string | null
}

/**
 * Successful `attach` ack on the control socket. The daemon answers the attach
 * request with this newline-JSON frame, then -- on the same connection --
 * streams raw PTY bytes. The clean framed duplex lives on the worker `ptySock`.
 */
export interface AttachAck extends DaemonOk {
  op: 'attach'
  /** DEC private mode numbers the worker terminal has enabled. */
  decModes: number[]
  /** Provenance of the worker PTY (e.g. `spare`). */
  via: string
  /** Coarse activity tempo at attach time. */
  tempo: string
  /** Job state at attach time (see the `state` vocab). */
  state: string
}

/**
 * The `launch` discriminator of a `DispatchSpec` -- how the daemon starts the
 * worker process.
 *
 * - `prompt`: a fresh worker. `args` is the worker's `claude` argv -- flags
 *   (`--model`, `--settings`, `--mcp-config`, `--append-system-prompt`) first,
 *   the initial-turn prompt as the trailing positional. An empty `args` is a
 *   PROMPTLESS dispatch (live-verified 2026-05-23, CC 2.1.148/2.1.150).
 * - `resume`: re-open `sessionId`. `fork` selects the legacy
 *   `claude --bg --resume` fork-to-fresh semantics (`true`) vs in-place
 *   continuation (`false`). `flagArgs` carries the worker flags (no prompt).
 * - `exec`: run an arbitrary `cmd`+`args` under daemon supervision (not a
 *   `claude` worker). Not used by claudewerk today; in the spec for completeness.
 */
export type DispatchLaunch =
  | { mode: 'prompt'; args: string[] }
  | { mode: 'resume'; sessionId: string; fork: boolean; flagArgs: string[] }
  | { mode: 'exec'; cmd: string; args: string[] }

/** Provenance of a dispatch. Claudewerk stamps `fleet` (not shell/slash/spare/respawn). */
export type DispatchSource = 'shell' | 'slash' | 'fleet' | 'spare' | 'respawn'

/**
 * The `d` payload of the socket `dispatch` op. Field-for-field from the
 * 2.1.145 binary schema (protocol doc § 5.5), live-verified end-to-end against
 * 2.1.148/2.1.150 (`scripts/spike-dispatch-op.ts`,
 * `scripts/spike-dispatch-phase4.ts`). The client stamps the inner `proto`.
 *
 * `short`/`nonce`/the resumed `sessionId` are 8/8/32-hex; `short` and `nonce`
 * match `/^[a-f0-9]{8}$/`. The top-level `sessionId` BECOMES the worker's
 * ccSessionId (its transcript is written to `<slug>/<sessionId>.jsonl`), so
 * claudewerk mints it for a NEW dispatch -- it is deterministic, not
 * daemon-assigned.
 */
export interface DispatchSpec {
  /** 8-hex worker short id. Claudewerk mints it (the daemon no longer prints it). */
  short: string
  /** 8-hex client nonce. The daemon redispatches with the same nonce on ack-timeout. */
  nonce?: string
  /** The worker's ccSessionId. 32-hex random for a NEW dispatch. */
  sessionId: string
  /** Unix ms. */
  createdAt: number
  /** Dispatch provenance. Claudewerk stamps `fleet`. */
  source: DispatchSource
  /** Worker cwd -- also the transcript-slug source. */
  cwd: string
  /** How to start the worker (prompt / resume / exec). */
  launch: DispatchLaunch
  /** Env for the worker process. Defaults daemon-side to `{}`. */
  env: Record<string, string>
  /** Env applied on reattach/respawn, if it must differ from `env`. */
  reattachEnv?: Record<string, string>
  /** Worktree isolation target -- `ownershipToken` gates concurrent adoption. */
  worktree?: { path: string; ownershipToken: string }
  /** Worktree isolation mode. Defaults daemon-side to `none`. */
  isolation: 'none' | 'worktree'
  /** Flags reused when the daemon respawns the worker (no prompt). */
  respawnFlags: string[]
  /** Per-dispatch override of the attach-stall respawn count. */
  attachStallRespawns?: number
  /** Sub-agent kind -- surfaces on JobRecord.agent. */
  agent?: string
  /** Routine label -- surfaces on JobRecord.routine. */
  routine?: string
  /** Seed metadata -- `intent`/`name` surface on the JobRecord + `claude agents` UI. */
  seed?: { intent: string; name?: string }
  /** Initial PTY columns (int, max 10000). */
  cols?: number
  /** Initial PTY rows (int, max 10000). */
  rows?: number
}

/**
 * Successful `dispatch` response. `messagingSock` is `""` in practice (the
 * cross-session teammate channel, not written for an ordinary spawn); `via` is
 * `spare` (claimed a pre-warmed worker) or `cold` (started fresh).
 */
export interface DispatchResponse extends DaemonOk {
  op: 'dispatch'
  short: string
  pid: number
  messagingSock: string
  via: string
}
