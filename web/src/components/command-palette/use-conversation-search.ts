import { projectIdentityKey } from '@shared/project-uri'
import { Fzf } from 'fzf'
import { useMemo } from 'react'
import { type Conversation, projectPath } from '@/lib/types'
import { fuzzyMultiplier, matchStrength, projectNameStrength, scoreConversationMatch } from './conversation-ranking'
import type { MergedItem } from './types'

const str = (v?: string) => v || ''

type ProjectSettings = Record<string, { label?: string }>

export interface ConversationSearchInputs {
  filter: string
  isConversationMode: boolean
  allConversations: Conversation[]
  projectSettings: ProjectSettings
  mruIndex: Map<string, number>
  freqMap: Record<string, { count: number }>
  maxFreq: number
}

/**
 * Fzf-matched conversations for the current filter, each tiered (see RANK_TIER) by whether
 * the query hit the conversation's own name (T1), its project's name (T2), or neither (fuzzy).
 * The fzf selector is field-weighted: title 3x > label 2x > path/recap/agent/idSuffix 1x.
 */
export function useConversationSearch({
  filter,
  isConversationMode,
  allConversations,
  projectSettings,
  mruIndex,
  freqMap,
  maxFreq,
}: ConversationSearchInputs): MergedItem[] {
  const conversationFzf = useMemo(
    () =>
      new Fzf(allConversations, {
        selector: (s: Conversation) => {
          const ps = projectSettings[projectIdentityKey(s.project)]
          const title = str(s.title)
          const label = str(ps?.label)
          return `${title} ${title} ${title} ${label} ${label} ${projectPath(s.project)} ${str(s.recap?.title)} ${str(s.agentName)} ${s.id.slice(-8)}`
        },
        casing: 'case-insensitive',
      }),
    [allConversations, projectSettings],
  )

  return useMemo<MergedItem[]>(() => {
    if (!isConversationMode || !filter) return []
    // Cyclomatic is inflated by `??`/`||` defaults; cognitive complexity is 2 (a flat map).
    // fallow-ignore-next-line complexity
    return conversationFzf.find(filter).map(r => {
      const conv = r.item
      const ps = projectSettings[projectIdentityKey(conv.project)]
      const active = conv.status !== 'ended'
      const { tier, score } = scoreConversationMatch({
        nameStrength: matchStrength(filter, str(conv.title)),
        projStrength: projectNameStrength(filter, ps?.label, conv.project),
        isActive: active,
        fzfScore: r.score,
        fuzzyMultiplier: fuzzyMultiplier({
          mruRank: mruIndex.get(conv.id) ?? -1,
          freqCount: freqMap[conv.project]?.count || 0,
          maxFreq,
          isActive: active,
        }),
      })
      return { kind: 'conversation' as const, conversation: conv, tier, score, live: active }
    })
  }, [isConversationMode, filter, conversationFzf, projectSettings, mruIndex, freqMap, maxFreq])
}
