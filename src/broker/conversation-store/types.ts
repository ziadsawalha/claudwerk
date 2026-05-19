import type {
  ClaudeEfficiencyUpdate,
  ClaudeHealthUpdate,
  ConversationSummary,
  LaunchProfile,
  SelectionMode,
  SentinelProfileInfo,
  TerminationDetail,
  TerminationSource,
} from '../../shared/protocol'

export type { ConversationSummary }

export interface SentinelStatusInfo {
  sentinelId: string
  alias: string
  hostname?: string
  connected: boolean
  isDefault?: boolean
  color?: string
  /** Sentinel-reported profile NAMES + display only (Profile-Env Boundary).
   *  Only present when the sentinel is connected AND reported a non-empty
   *  profiles list. Consumed by the control panel for profile pickers /
   *  badges. NEVER contains `configDir` or `env`. */
  profiles?: SentinelProfileInfo[]
  /** What this sentinel does on a no-profile spawn (`default` | `balanced` |
   *  `random`). Read-only display; configured via the sentinel CLI. */
  defaultSelection?: SelectionMode
}

export interface ControlPanelMessage {
  type:
    | 'conversation_update'
    | 'conversation_created'
    | 'conversation_ended'
    | 'conversation_terminated'
    | 'event'
    | 'conversations_list'
    | 'sentinel_status'
    | 'toast'
    | 'settings_updated'
    | 'project_settings_updated'
    | 'clipboard_capture'
    | 'usage_update'
    | 'claude_health_update'
    | 'claude_efficiency_update'
    | 'launch_profiles_updated'
    // Observability events (LOG EVERYTHING covenant)
    | 'conversation_status_transition'
    | 'socket_replaced'
    | 'phantom_reap_candidate'
  conversationId?: string
  previousConversationId?: string
  conversation?: ConversationSummary
  conversations?: ConversationSummary[]
  event?: unknown
  connected?: boolean
  machineId?: string
  hostname?: string
  sentinels?: SentinelStatusInfo[]
  title?: string
  message?: string
  settings?: unknown
  claudeHealth?: ClaudeHealthUpdate
  claudeEfficiency?: ClaudeEfficiencyUpdate
  userName?: string
  launchProfiles?: LaunchProfile[]
  // Termination metadata (only on conversation_terminated)
  source?: TerminationSource | string
  initiator?: string
  detail?: TerminationDetail
  endedAt?: number
  // Observability event fields (status transition, socket replace, reap candidate)
  from?: string
  to?: string
  reason?: string
  liveSockets?: number
  ccSessionId?: string
  lastActivityAgoMs?: number
  at?: number
  connectionId?: string
  oldReadyState?: number
  oldBufferedAmount?: number
  newReadyState?: number
  via?: string
  status?: string
  willEnd?: boolean
}
