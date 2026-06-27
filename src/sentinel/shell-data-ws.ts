/**
 * Dedicated sentinel -> broker WebSocket for the host-shell DATA plane.
 *
 * Bytes get their own pipe so a shell flood never head-of-line-blocks
 * spawn/kill/roster on the control WS (plan-host-shell.md 2/3). Opened on the
 * first live shell, closed when the last one exits. While shells are live it
 * reconnects on drop (the broker may have restarted; on reconnect the broker
 * re-issues `shell_attach` for whatever is still expanded).
 *
 * sentinel -> broker over this socket: `shell_data`, `shell_replay`.
 * broker -> sentinel over this socket: `shell_input`, `shell_resize`,
 * `shell_attach`, `shell_detach`.
 */

import type { BrokerSentinelMessage, ShellData, ShellReplay } from '../shared/protocol'
import { SHELL_DATA_WS_FLAG, SHELL_DATA_WS_SENTINEL } from '../shared/protocol'

const RECONNECT_DELAY_MS = 2000

export interface ShellDataWsHandlers {
  onInput: (shellId: string, data: string) => void
  onResize: (shellId: string, cols: number, rows: number) => void
  onAttach: (shellId: string, cols: number, rows: number, replay: boolean) => void
  onDetach: (shellId: string) => void
}

export interface ShellDataWsOpts {
  brokerUrl: string
  secret: string
  sentinelId: string
  handlers: ShellDataWsHandlers
  log: (msg: string) => void
}

/** Build the dedicated data-WS URL: broker base + auth secret + the shell-data
 *  flag + sentinel id, so the broker can route + pair the socket. */
export function buildShellDataWsUrl(brokerUrl: string, secret: string, sentinelId: string): string {
  const url = new URL(brokerUrl)
  if (secret) url.searchParams.set('secret', secret)
  url.searchParams.set(SHELL_DATA_WS_FLAG, '1')
  url.searchParams.set(SHELL_DATA_WS_SENTINEL, sentinelId)
  return url.toString()
}

export class ShellDataWs {
  private ws: WebSocket | null = null
  private wantOpen = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly opts: ShellDataWsOpts) {}

  /** Open the socket if not already open/connecting. Idempotent. */
  ensureOpen(): void {
    this.wantOpen = true
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return
    this.connect()
  }

  /** Stop the socket for good (last shell exited). Cancels reconnect. */
  close(): void {
    this.wantOpen = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      try {
        this.ws.close()
      } catch {}
      this.ws = null
    }
  }

  /** PTY output for a subscribed shell. Dropped silently when the socket is not
   *  open (the broker has no subscribers to fan to in that window anyway). */
  sendData(shellId: string, data: string): void {
    this.send({ type: 'shell_data', shellId, data } satisfies ShellData)
  }

  /** Ring-buffer dump on attach. `done` marks the final chunk. */
  sendReplay(shellId: string, data: string, done: boolean): void {
    this.send({ type: 'shell_replay', shellId, data, done } satisfies ShellReplay)
  }

  private send(msg: ShellData | ShellReplay): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    try {
      this.ws.send(JSON.stringify(msg))
    } catch {}
  }

  private connect(): void {
    const url = buildShellDataWsUrl(this.opts.brokerUrl, this.opts.secret, this.opts.sentinelId)
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch (e) {
      this.opts.log(`[shell-data] connect threw: ${(e as Error).message}`)
      this.scheduleReconnect()
      return
    }
    this.ws = ws

    ws.onopen = () => {
      this.opts.log('[shell-data] data WS connected')
    }

    ws.onmessage = event => this.dispatch(String(event.data))

    ws.onclose = () => {
      if (this.ws === ws) this.ws = null
      if (this.wantOpen) {
        this.opts.log(`[shell-data] data WS closed; reconnecting in ${RECONNECT_DELAY_MS / 1000}s`)
        this.scheduleReconnect()
      }
    }

    ws.onerror = () => {
      // onclose follows; reconnect is handled there.
    }
  }

  /** Route a broker -> sentinel data-plane frame to the registry handlers via a
   *  type-keyed strategy map. Anything that is not a recognized shell control
   *  message is ignored (no map entry). */
  private dispatch(raw: string): void {
    let msg: BrokerSentinelMessage | { type: string }
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    const h = this.opts.handlers
    const routes: Record<string, () => void> = {
      shell_input: () => {
        const m = msg as Extract<BrokerSentinelMessage, { type: 'shell_input' }>
        h.onInput(m.shellId, m.data)
      },
      shell_resize: () => {
        const m = msg as Extract<BrokerSentinelMessage, { type: 'shell_resize' }>
        h.onResize(m.shellId, m.cols, m.rows)
      },
      shell_attach: () => {
        const m = msg as Extract<BrokerSentinelMessage, { type: 'shell_attach' }>
        h.onAttach(m.shellId, m.cols, m.rows, m.replay)
      },
      shell_detach: () => {
        const m = msg as Extract<BrokerSentinelMessage, { type: 'shell_detach' }>
        h.onDetach(m.shellId)
      },
    }
    routes[msg.type]?.()
  }

  private scheduleReconnect(): void {
    if (!this.wantOpen || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.wantOpen) this.connect()
    }, RECONNECT_DELAY_MS)
  }
}
