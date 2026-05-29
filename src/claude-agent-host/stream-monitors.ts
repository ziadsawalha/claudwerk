/**
 * Monitor task tracking for the stream-json backend.
 * Tracks non-agent background tasks (Monitor tool) and correlates
 * task_started events with cached tool_use inputs.
 */

export interface MonitorInfo {
  toolUseId: string
  description: string
  command?: string
  persistent?: boolean
  timeoutMs?: number
  eventCount: number
}

export interface MonitorInput {
  command?: string
  persistent?: boolean
  timeoutMs?: number
  description?: string
}

export function deriveMonitorOutputPath(command: string | undefined, monitorTaskId: string): string | undefined {
  if (!command) return undefined
  const match = command.match(/(\S+\/tasks\/)[\w-]+\.output/)
  if (match) return `${match[1]}${monitorTaskId}.output`
  return undefined
}

export interface MonitorTracker {
  /** Inline-agent tool_use id -> task id. Built at `task_started` for
   *  `local_agent` tasks. The ONLY agent-routing map (collapsed from the former
   *  two-map hazard): assistant/user subagent entries carry `parent_tool_use_id`
   *  (= the tool_use id) and resolve their scope (= the task id) through this.
   *  task_progress/task_notification carry `task_id` directly, so they need no
   *  lookup -- the task id IS the agent scope. */
  agentToolUseToTask: Map<string, string>
  monitorTasks: Map<string, MonitorInfo>
  pendingMonitorInputs: Map<string, MonitorInput>
}

export function createMonitorTracker(): MonitorTracker {
  return {
    agentToolUseToTask: new Map(),
    monitorTasks: new Map(),
    pendingMonitorInputs: new Map(),
  }
}
