/**
 * Universal control-debug modal (CMD+P -> "Debug: control...").
 *
 * Pick a CC control / daemon command, edit its JSON payload (pre-filled from the
 * shared registry), send it to the selected conversation, and watch the live
 * WEB -> BROKER -> AGENT HOST -> CC/daemon trace waterfall + response. This is a
 * poke-and-see tool: mismatched transports come back as a clean
 * unsupported_transport result rather than being hidden.
 */

import { CONTROL_COMMANDS, getControlCommandSpec } from '@shared/cc-control-commands'
import { Bug } from 'lucide-react'
import { useMemo, useState, useSyncExternalStore } from 'react'
import { getDebugTraces, getVersion, startDebugTrace, subscribe as subscribeTraces } from '@/hooks/debug-control-store'
import { useConversationsStore, wsSend } from '@/hooks/use-conversations'
import { useCommand } from '@/lib/commands'
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog'
import { DebugTraceWaterfall } from './debug-trace-waterfall'

function randomTraceId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `trace-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

export function DebugControlModal() {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState(`${CONTROL_COMMANDS[0]?.channel}:${CONTROL_COMMANDS[0]?.command}`)
  const [payloadText, setPayloadText] = useState('{}')
  const [payloadError, setPayloadError] = useState<string | null>(null)

  const selectedConversationId = useConversationsStore(s => s.selectedConversationId)
  useSyncExternalStore(subscribeTraces, getVersion, getVersion)

  const [channel, command] = key.split(':') as ['cc_control' | 'daemon_op', string]
  const spec = getControlCommandSpec(channel, command)

  function selectCommand(nextKey: string) {
    setKey(nextKey)
    const [ch, cmd] = nextKey.split(':') as ['cc_control' | 'daemon_op', string]
    const s = getControlCommandSpec(ch, cmd)
    setPayloadText(JSON.stringify(s?.payloadTemplate ?? {}, null, 2))
    setPayloadError(null)
  }

  useCommand('debug-control', () => setOpen(true), { label: 'Debug: control...', group: 'Developer' })

  function send() {
    if (!selectedConversationId || !spec) return
    let payload: Record<string, unknown>
    try {
      payload = payloadText.trim() ? JSON.parse(payloadText) : {}
    } catch (e) {
      setPayloadError(e instanceof Error ? e.message : 'invalid JSON')
      return
    }
    if (spec.danger && !window.confirm(`Send DANGER command "${spec.command}"?\n\n${spec.description}`)) return
    const traceId = randomTraceId()
    startDebugTrace({ traceId, conversationId: selectedConversationId, channel, command })
    wsSend('debug_control_send', { traceId, targetConversation: selectedConversationId, channel, command, payload })
  }

  const traces = selectedConversationId ? getDebugTraces(selectedConversationId) : []
  const grouped = useMemo(() => {
    return {
      cc_control: CONTROL_COMMANDS.filter(c => c.channel === 'cc_control'),
      daemon_op: CONTROL_COMMANDS.filter(c => c.channel === 'daemon_op'),
    }
  }, [])

  if (!selectedConversationId) return null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-3xl flex flex-col p-0 top-[8vh] translate-y-0 max-h-[84vh]">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
          <Bug className="size-4 text-accent" />
          <DialogTitle className="text-xs">Debug: control</DialogTitle>
          <span className="text-[10px] text-muted-foreground ml-1 truncate">{selectedConversationId.slice(0, 12)}</span>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* command picker */}
          <div className="w-56 border-r border-border overflow-y-auto shrink-0 text-[11px] font-mono">
            {(['cc_control', 'daemon_op'] as const).map(ch => (
              <div key={ch}>
                <div className="px-2 py-1 text-[9px] uppercase tracking-wider text-muted-foreground/60 sticky top-0 bg-background">
                  {ch === 'cc_control' ? 'cc_control (headless)' : 'daemon_op (daemon)'}
                </div>
                {grouped[ch].map(c => {
                  const k = `${c.channel}:${c.command}`
                  return (
                    <button
                      type="button"
                      key={k}
                      onClick={() => selectCommand(k)}
                      className={`w-full text-left px-2 py-1 flex items-center gap-1.5 hover:bg-muted/50 ${k === key ? 'bg-accent/15 text-accent' : ''}`}
                    >
                      <span className="truncate flex-1">{c.command}</span>
                      {c.readOnly && <span className="text-[8px] text-emerald-400/60">RO</span>}
                      {c.danger && <span className="text-[8px] text-red-400/80">DANGER</span>}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          {/* editor + waterfall */}
          <div className="flex-1 flex flex-col min-w-0 p-3 gap-2 overflow-y-auto">
            {spec && (
              <>
                <div className="text-[10px] text-muted-foreground">{spec.description}</div>
                <textarea
                  value={payloadText}
                  onChange={e => {
                    setPayloadText(e.target.value)
                    setPayloadError(null)
                  }}
                  spellCheck={false}
                  className="w-full h-28 bg-muted/40 border border-border text-[11px] font-mono px-2 py-1.5 outline-none focus:border-accent resize-none"
                />
                {payloadError && <div className="text-[10px] text-red-400">{payloadError}</div>}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={send}
                    className={`px-3 py-1 text-xs font-bold transition-colors ${spec.danger ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30' : 'bg-accent/20 text-accent hover:bg-accent/30'}`}
                  >
                    Send{spec.danger ? ' (DANGER)' : ''}
                  </button>
                  <span className="text-[10px] text-muted-foreground/60">
                    {spec.channel} · {spec.transports.join(',')}
                  </span>
                </div>
              </>
            )}

            <div className="text-[9px] uppercase tracking-wider text-muted-foreground/50 mt-1">Traces</div>
            <div className="flex flex-col gap-2">
              {traces.length === 0 && (
                <div className="text-[10px] text-muted-foreground/50">No traces yet -- send a command.</div>
              )}
              {traces.map(t => (
                <DebugTraceWaterfall key={t.traceId} trace={t} />
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
