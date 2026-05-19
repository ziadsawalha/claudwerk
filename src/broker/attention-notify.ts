/**
 * Attention-notify: push notification when dialog or AskUserQuestion
 * has been waiting for user input for 4 minutes with no interaction.
 *
 * Timer state is in-memory (lost on broker restart). Acceptable -- the UI
 * still shows pending state; the user just won't get a push for items that
 * were already pending before the restart.
 */

import { extractProjectLabel } from '../shared/project-uri'
import { isPushConfigured, sendPushToAll } from './push'

const NOTIFY_DELAY_MS = 4 * 60 * 1000

// One dialog per conversation at a time.
const dialogTimers = new Map<string, ReturnType<typeof setTimeout>>()
// One AskUserQuestion per conversation at a time (CC blocks until answered).
const askTimers = new Map<string, ReturnType<typeof setTimeout>>()

interface BaseParams {
  conversationId: string
  project: string
}

export function scheduleDialogNotify(params: BaseParams & { dialogTitle: string }): void {
  cancelDialogNotify(params.conversationId)
  const { conversationId, project, dialogTitle } = params
  const label = extractProjectLabel(project) || conversationId.slice(0, 8)
  const timer = setTimeout(() => {
    dialogTimers.delete(conversationId)
    if (!isPushConfigured()) return
    sendPushToAll({
      title: 'Input needed',
      body: `${dialogTitle} -- ${label}`,
      conversationId,
      project,
      tag: `dialog-${conversationId}`,
    }).catch(() => {})
  }, NOTIFY_DELAY_MS)
  dialogTimers.set(conversationId, timer)
}

/** Restart the dialog notification clock (called on keepalive -- user is actively looking). */
export function resetDialogNotifyTimer(params: BaseParams & { dialogTitle: string }): void {
  scheduleDialogNotify(params)
}

export function cancelDialogNotify(conversationId: string): void {
  const t = dialogTimers.get(conversationId)
  if (t !== undefined) {
    clearTimeout(t)
    dialogTimers.delete(conversationId)
  }
}

export function scheduleAskNotify(params: BaseParams & { question: string }): void {
  cancelAskNotify(params.conversationId)
  const { conversationId, project, question } = params
  const label = extractProjectLabel(project) || conversationId.slice(0, 8)
  const timer = setTimeout(() => {
    askTimers.delete(conversationId)
    if (!isPushConfigured()) return
    sendPushToAll({
      title: 'Question for you',
      body: `${question} -- ${label}`,
      conversationId,
      project,
      tag: `ask-${conversationId}`,
    }).catch(() => {})
  }, NOTIFY_DELAY_MS)
  askTimers.set(conversationId, timer)
}

export function cancelAskNotify(conversationId: string): void {
  const t = askTimers.get(conversationId)
  if (t !== undefined) {
    clearTimeout(t)
    askTimers.delete(conversationId)
  }
}
