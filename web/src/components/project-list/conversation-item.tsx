import { formatResetIn } from '@shared/format-reset-time'
import { projectIdentityKey } from '@shared/project-uri'
import { Clock } from 'lucide-react'
import { memo, type ReactNode, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useConversationsStore } from '@/hooks/use-conversations'
import { useGhostShort } from '@/hooks/use-ghost-sessions'
import { formatCost, getCacheTimerInfo, getConversationCost, getCostBgColor } from '@/lib/cost-utils'
import type { Conversation } from '@/lib/types'
import { projectPath } from '@/lib/types'
import { cn, contextWindowSize, formatAge, formatPermissionMode, haptic, projectDisplayName } from '@/lib/utils'
import { useIsMobile } from '../input-editor/shell/use-is-mobile'
import { ProjectSettingsButton, ProjectSettingsEditor, renderProjectIcon } from '../project-settings-editor'
import { BackendIcon } from './backend-icon'
import { ConversationContextMenu } from './conversation-context-menu'
import { ConversationInfoButton } from './conversation-info-dialog'
import { ConversationItemFull } from './conversation-item-full'
import {
  ConversationAttentionBadges,
  ConversationItemShell,
  ConversationItemTasksBlock,
  DismissButton,
  InlineDescription,
  InlineRename,
  isDaemonTransport,
  SpawnedFromSubtext,
} from './conversation-item-helpers'
import { GhostAttachButton, GhostBadge, GhostStatusDot } from './ghost-attach'
import { SentinelProfileBadge } from './sentinel-profile-badge'
import { StatusIndicator } from './status-indicator'

export { SpawnRootStub } from './conversation-item-helpers'

// ─── Compact conversation card (used inside CWD groups) ───────────────

export const ConversationItemCompact = memo(function ConversationItemCompact({
  conversation,
}: {
  conversation: Conversation
}) {
  const isSelected = useConversationsStore(s => s.selectedConversationId === conversation.id)
  const selectedSubagentId = useConversationsStore(s =>
    s.selectedConversationId === conversation.id ? s.selectedSubagentId : null,
  )
  const selectConversation = useConversationsStore(s => s.selectConversation)

  const ps = useConversationsStore(s => s.projectSettings[projectIdentityKey(conversation.project)])
  const showCost = useConversationsStore(s => s.controlPanelPrefs.showCostInList)
  const showContextBar = useConversationsStore(s => s.controlPanelPrefs.showContextInList)
  const isRenaming = useConversationsStore(s => s.renamingConversationId === conversation.id)
  const isEditingDescription = useConversationsStore(s => s.editingDescriptionConversationId === conversation.id)
  const displayColor = ps?.color
  const isMobile = useIsMobile()
  // Ghost: live daemon worker in the roster, not hosted by us (see Full card).
  const ghostShort = useGhostShort(conversation.id)
  const isGhost = !!ghostShort && (conversation.connectionIds?.length ?? 0) === 0

  function handleClick() {
    haptic('tap')
    selectConversation(conversation.id, 'click')
  }

  // Compute identity/state values once -- consumed by meta footer (desktop) or
  // subtitle prefix (mobile).
  // Permission-mode badges (B/E/A) intentionally suppressed -- they repeat
  // across most cards and dilute the meta line. Plan mode is the exception:
  // it materially changes behavior and stays visible.
  const permissionBadge =
    conversation.permissionMode === 'plan' ? formatPermissionMode(conversation.permissionMode) : null
  const planModeBadge =
    !permissionBadge && conversation.planMode
      ? { label: 'P', color: 'text-blue-400', title: 'Plan mode -- requires plan approval' }
      : null
  const cacheInfo =
    conversation.status === 'idle'
      ? getCacheTimerInfo(
          conversation.lastTurnEndedAt,
          conversation.tokenUsage,
          conversation.model,
          conversation.cacheTtl,
        )
      : null
  const costInfo = (() => {
    if (!showCost || !conversation.stats) return null
    const { cost, exact } = getConversationCost(conversation.stats, conversation.model)
    if (cost < 0.5) return null
    return { cost, exact, colorClass: getCostBgColor(cost).split(' ')[1] }
  })()
  const showHostAlias = conversation.hostSentinelAlias && conversation.hostSentinelAlias !== 'default'

  // Context % (used by both layouts on the title row)
  const ctx = (() => {
    if (!showContextBar || !conversation.tokenUsage) return null
    const { input, cacheCreation, cacheRead } = conversation.tokenUsage
    const total = input + cacheCreation + cacheRead
    if (total === 0) return null
    const maxTokens = conversation.contextWindow ?? contextWindowSize(conversation.model)
    const pct = Math.min(100, Math.round((total / maxTokens) * 100))
    const threshold = conversation.autocompactPct || 83
    const warnAt = threshold - 5
    const color = pct < warnAt ? 'text-emerald-400/60' : pct < threshold ? 'text-amber-400/60' : 'text-red-400/70'
    const barColor = pct < warnAt ? 'bg-emerald-400/60' : pct < threshold ? 'bg-amber-400/60' : 'bg-red-400/70'
    return { pct, color, barColor }
  })()

  // Mobile state prefix: small chips/text rendered BEFORE the subtitle.
  // Encoded as renderable nodes so coloring/styling per item is preserved.
  const mobilePrefix: ReactNode[] = []
  if (cacheInfo?.state === 'expired') mobilePrefix.push(<span className="text-red-400/70 font-bold">EXPIRED</span>)
  else if (cacheInfo?.state === 'critical') mobilePrefix.push(<span className="text-red-400 font-bold">CACHE</span>)
  else if (cacheInfo?.state === 'warning') mobilePrefix.push(<span className="text-amber-400 font-bold">CACHE</span>)
  if (permissionBadge)
    mobilePrefix.push(<span className={cn('font-bold', permissionBadge.color)}>{permissionBadge.label}</span>)
  else if (planModeBadge)
    mobilePrefix.push(<span className={cn('font-bold', planModeBadge.color)}>{planModeBadge.label}</span>)
  if (conversation.adHocWorktree) mobilePrefix.push(<span className="text-orange-400 font-bold">WT</span>)
  if (costInfo)
    mobilePrefix.push(
      <span className={cn('font-bold font-mono', costInfo.colorClass)}>
        {formatCost(costInfo.cost, costInfo.exact)}
      </span>,
    )

  return (
    <ConversationItemShell
      conversation={conversation}
      isSelected={isSelected}
      displayColor={displayColor}
      variant="compact"
      ghost={isGhost}
      onClick={handleClick}
    >
      {/* ── TITLE ROW: status, backend, title, action/attention badges, %, info ─ */}
      <div className="flex items-center gap-1.5">
        {isGhost ? (
          <GhostStatusDot />
        ) : (
          <StatusIndicator status={conversation.status} adHoc={conversation.capabilities?.includes('ad-hoc')} />
        )}
        <BackendIcon backend={conversation.backend} transport={conversation.transport} size={11} />
        {isRenaming ? (
          <div className="flex-1 min-w-0">
            <InlineRename conversation={conversation} />
          </div>
        ) : (
          <span
            className={cn(
              'font-mono text-[11px] font-semibold flex-1 truncate',
              isSelected ? 'text-accent' : 'text-foreground',
            )}
          >
            {(conversation.title || conversation.agentName || '').slice(0, 24) || conversation.id.slice(0, 8)}
          </span>
        )}
        {/* Action / attention badges -- always on title row in both layouts */}
        {isGhost && <GhostBadge compact />}
        {isGhost && <GhostAttachButton conversationId={conversation.id} compact />}
        {!isGhost && isDaemonTransport(conversation) && (
          <span className="text-[9px] text-sky-400 font-bold" title="Native claude agents session -- read-only mirror">
            NATIVE
          </span>
        )}
        {conversation.compacting && <span className="text-[9px] text-amber-400 font-bold animate-pulse">COMPACT</span>}
        {conversation.lastError && <span className="text-[9px] text-destructive font-bold">ERROR</span>}
        {conversation.rateLimit && !conversation.lastError && (
          <span
            title={`Rate limited: ${conversation.rateLimit.message}${formatResetIn(conversation.rateLimit.resetsAt) ? ` (${formatResetIn(conversation.rateLimit.resetsAt)})` : ''}`}
          >
            <Clock size={11} className="text-amber-400" />
          </span>
        )}
        <ConversationAttentionBadges conversation={conversation} />
        {/* Context % -- mobile-only on title row (desktop docks it at the bar's right edge) */}
        {isMobile && ctx && (
          <span className={cn('text-[9px] font-mono tabular-nums shrink-0', ctx.color)}>{ctx.pct}%</span>
        )}
        <ConversationInfoButton conversation={conversation} visible={isSelected} />
        {conversation.status === 'ended' && <DismissButton conversationId={conversation.id} />}
      </div>
      {conversation.gitBranch && conversation.gitBranch !== 'main' && conversation.gitBranch !== 'master' && (
        <div className="pl-4 flex items-center gap-1">
          <span
            className={cn(
              'text-[9px] font-mono truncate',
              conversation.adHocWorktree ? 'text-orange-400/70' : 'text-purple-400/60',
            )}
          >
            {conversation.adHocWorktree ? '⎇ ' : '⌥ '}
            {conversation.gitBranch}
          </span>
        </div>
      )}
      <SpawnedFromSubtext conversation={conversation} padClass="pl-4" />
      {/* ── SUBTITLE: description / summary / recap (mobile prepends state prefix) ── */}
      {isEditingDescription ? (
        <div className="mt-0.5 pl-4">
          <InlineDescription conversation={conversation} />
        </div>
      ) : (
        (() => {
          const subtitle = conversation.description || conversation.summary || conversation.recap?.title
          // Mobile chip prefixes -- profile first (identity), then host alias, then state.
          const mobileChips: ReactNode[] = []
          if (isMobile) {
            mobileChips.push(
              <SentinelProfileBadge
                resolvedProfile={conversation.resolvedProfile}
                hostSentinelAlias={conversation.hostSentinelAlias}
                launchConfig={conversation.launchConfig}
              />,
            )
            if (showHostAlias)
              mobileChips.push(
                <span className="text-muted-foreground/60 font-medium">{conversation.hostSentinelAlias}</span>,
              )
            mobileChips.push(...mobilePrefix)
          }
          if (!subtitle && mobileChips.length === 0) return null
          const baseColor = conversation.description
            ? 'text-muted-foreground/70'
            : conversation.summary
              ? 'text-muted-foreground/50'
              : 'text-zinc-400/80'
          return (
            <div className={cn('mt-0.5 pl-4 text-[9px] truncate flex items-center gap-1', baseColor)} title={subtitle}>
              {mobileChips.map((node, i) => (
                <span key={i} className="contents">
                  {i > 0 && <span className="text-muted-foreground/30">·</span>}
                  {node}
                </span>
              ))}
              {subtitle && mobileChips.length > 0 && <span className="text-muted-foreground/30">·</span>}
              {subtitle && <span className="truncate">{subtitle}</span>}
            </div>
          )
        })()
      )}
      {/* Desktop-only: separate summary + recap lines (mobile collapses them into the single subtitle above) */}
      {!isMobile && conversation.description && conversation.summary && (
        <div className="mt-0.5 pl-4 text-[9px] text-muted-foreground/50 truncate" title={conversation.summary}>
          {conversation.summary}
        </div>
      )}
      {!isMobile && (conversation.description || conversation.summary) && conversation.recap?.title && (
        <div className="mt-0.5 pl-4 text-[9px] text-zinc-400/80 truncate">{conversation.recap.title}</div>
      )}
      {/* ── DESKTOP ONLY: progress bar + % flexed to the bar's right edge ── */}
      {!isMobile && ctx && (
        <div className="mt-0.5 pl-4 flex items-center gap-1.5">
          <div className="flex-1 h-1 bg-muted/50 rounded-full overflow-hidden">
            <div className={cn('h-full rounded-full transition-all', ctx.barColor)} style={{ width: `${ctx.pct}%` }} />
          </div>
          <span className={cn('text-[9px] font-mono tabular-nums shrink-0', ctx.color)}>{ctx.pct}%</span>
        </div>
      )}
      {/* ── DESKTOP ONLY: meta footer -- profile chip first, then state, dot-separated ── */}
      {!isMobile &&
        (() => {
          const items: ReactNode[] = []
          // Profile pill always leads -- identity over state.
          items.push(
            <SentinelProfileBadge
              key="profile"
              resolvedProfile={conversation.resolvedProfile}
              hostSentinelAlias={conversation.hostSentinelAlias}
              launchConfig={conversation.launchConfig}
            />,
          )
          if (showHostAlias)
            items.push(
              <span key="host" className="px-1 py-0.5 text-[8px] rounded bg-muted text-muted-foreground font-medium">
                {conversation.hostSentinelAlias}
              </span>,
            )
          if (permissionBadge)
            items.push(
              <span key="pm" className={cn('font-bold', permissionBadge.color)} title={permissionBadge.title}>
                {permissionBadge.label}
              </span>,
            )
          else if (planModeBadge)
            items.push(
              <span key="pm" className={cn('font-bold', planModeBadge.color)} title={planModeBadge.title}>
                {planModeBadge.label}
              </span>,
            )
          if (cacheInfo?.state === 'expired')
            items.push(
              <span key="cache" className="text-red-400/70 font-bold">
                EXPIRED
              </span>,
            )
          else if (cacheInfo?.state === 'critical')
            items.push(
              <span key="cache" className="text-red-400 font-bold animate-pulse">
                CACHE
              </span>,
            )
          else if (cacheInfo?.state === 'warning')
            items.push(
              <span key="cache" className="text-amber-400 font-bold">
                CACHE
              </span>,
            )
          if (costInfo)
            items.push(
              <span key="cost" className={cn('font-bold font-mono', costInfo.colorClass)}>
                {formatCost(costInfo.cost, costInfo.exact)}
              </span>,
            )
          if (conversation.adHocWorktree)
            items.push(
              <span key="wt" className="text-orange-400 font-bold">
                WT
              </span>,
            )
          if (items.length === 0) return null
          return (
            <div className="mt-1 pl-4 flex items-center gap-1.5 text-[9px]">
              {items.map((node, i) => (
                <span key={i} className="contents">
                  {i > 0 && <span className="text-muted-foreground/30">·</span>}
                  {node}
                </span>
              ))}
            </div>
          )
        })()}
      <ConversationItemTasksBlock conversation={conversation} selectedSubagentId={selectedSubagentId} />
    </ConversationItemShell>
  )
})

// ─── Conversation card with settings button ─────────────────────────────

export const ConversationCard = memo(function ConversationCard({ conversation }: { conversation: Conversation }) {
  const [showSettings, setShowSettings] = useState(false)
  const isSelected = useConversationsStore(s => s.selectedConversationId === conversation.id)
  return (
    <ConversationContextMenu conversation={conversation} onOpenSettings={() => setShowSettings(true)}>
      <div>
        <div className="relative group/card">
          <ConversationItemFull conversation={conversation} />
          <div
            className={cn(
              'absolute top-2 right-2 transition-opacity',
              isSelected ? 'opacity-100' : 'opacity-0 [@media(hover:hover)]:group-hover/card:opacity-100',
            )}
          >
            <ProjectSettingsButton
              onClick={e => {
                e.stopPropagation()
                setShowSettings(!showSettings)
              }}
            />
          </div>
        </div>
        {showSettings && (
          <ProjectSettingsEditor project={conversation.project} onClose={() => setShowSettings(false)} />
        )}
      </div>
    </ConversationContextMenu>
  )
})

// ─── Compact peek (used for the "selected conversation" preview inside a
// collapsed group). Subscribes to a single conversation by id so the peek
// re-renders independently of ProjectList. ──────────────────────────

export const ConversationCompactPeek = memo(function ConversationCompactPeek({
  conversationId,
}: {
  conversationId: string
}) {
  const conversation = useConversationsStore(s => s.conversationsById[conversationId])
  if (!conversation) return null
  return <ConversationItemCompact conversation={conversation} />
})

// ─── Inactive project item ────────────────────────────────────────

export const InactiveProjectItem = memo(
  function InactiveProjectItem({ conversationIds }: { conversationIds: string[] }) {
    const [showSettings, setShowSettings] = useState(false)
    const selectConversation = useConversationsStore(s => s.selectConversation)
    const conversations = useConversationsStore(
      useShallow(s => conversationIds.map(id => s.conversationsById[id]).filter(Boolean) as Conversation[]),
    )
    const latest =
      conversations.length > 0 ? conversations.reduce((a, b) => (a.lastActivity > b.lastActivity ? a : b)) : null
    const ps = useConversationsStore(s => (latest ? s.projectSettings[projectIdentityKey(latest.project)] : undefined))
    if (!latest) return null
    const displayName = projectDisplayName(projectPath(latest.project), ps?.label)
    const displayColor = ps?.color

    return (
      <ConversationContextMenu conversation={latest} onOpenSettings={() => setShowSettings(true)}>
        <div>
          <div
            data-conversation-id={latest.id}
            role="button"
            tabIndex={0}
            onClick={() => {
              haptic('tap')
              selectConversation(latest.id, 'click')
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                haptic('tap')
                selectConversation(latest.id, 'click')
              }
            }}
            className="w-full text-left border border-border hover:border-primary p-2 pl-3 transition-colors cursor-pointer"
            style={displayColor ? { borderLeftColor: displayColor, borderLeftWidth: '3px' } : undefined}
            title={`${conversations.length} conversation${conversations.length > 1 ? 's' : ''}\n${projectPath(latest.project)}`}
          >
            <div className="flex items-center gap-1.5">
              {ps?.icon && (
                <span className="text-muted-foreground" style={displayColor ? { color: displayColor } : undefined}>
                  {renderProjectIcon(ps.icon)}
                </span>
              )}
              <span
                className="font-mono text-xs text-muted-foreground truncate flex-1"
                style={displayColor ? { color: `${displayColor}99` } : undefined}
              >
                {displayName}
              </span>
              <span className="text-[10px] text-muted-foreground/60 font-mono shrink-0">
                {formatAge(latest.lastActivity)}
              </span>
            </div>
          </div>
          {showSettings && <ProjectSettingsEditor project={latest.project} onClose={() => setShowSettings(false)} />}
        </div>
      </ConversationContextMenu>
    )
  },
  (prev, next) => {
    if (prev.conversationIds.length !== next.conversationIds.length) return false
    for (let i = 0; i < prev.conversationIds.length; i++) {
      if (prev.conversationIds[i] !== next.conversationIds[i]) return false
    }
    return true
  },
)
