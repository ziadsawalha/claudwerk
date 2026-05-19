import type { LaunchProfile } from '@shared/launch-profile'
import { backendSupportsAppendSystemPrompt } from '@shared/launch-profile'
import type { BackendKind } from '@/components/spawn-dialog/backend-select'
import { launchFieldsFromProfile, spawnPatchFromLaunchFields } from './editor-mapping'
import {
  AppendSystemPromptSection,
  BackendSection,
  BehaviorSection,
  DaemonConfigSection,
  HiddenAppendPromptNotice,
  IdentitySection,
  LaunchFieldsSection,
  PinningSection,
} from './editor-sections'

interface Props {
  profile: LaunchProfile
  onChange: (next: LaunchProfile) => void
}

export function ManagerEditor({ profile, onChange }: Props) {
  const backend = (profile.spawn.backend ?? 'claude') as BackendKind
  const isDaemon = backend === 'daemon'
  const showAppendSp = backendSupportsAppendSystemPrompt(backend)
  const hasIncompatibleFields = !showAppendSp ? false : hasBackendIncompatibleFields(profile, backend)

  function patch(next: Partial<LaunchProfile>) {
    onChange({ ...profile, ...next, updatedAt: Date.now() })
  }

  function patchSpawn(next: Partial<LaunchProfile['spawn']>) {
    patch({ spawn: { ...profile.spawn, ...next } })
  }

  function switchBackend(next: BackendKind) {
    const cleared: Partial<LaunchProfile['spawn']> = { backend: next === 'claude' ? undefined : next }
    if (!backendSupportsAppendSystemPrompt(next)) cleared.appendSystemPrompt = undefined
    if (next !== 'opencode') {
      cleared.openCodeModel = undefined
      cleared.toolPermission = undefined
    }
    // Daemon launch config is daemon-only: seed `daemonMode` when entering the
    // daemon backend, drop it (and the injected paths) when leaving.
    if (next === 'daemon') {
      cleared.daemonMode = profile.spawn.daemonMode ?? 'new'
    } else {
      cleared.daemonMode = undefined
      cleared.daemonSettingsPath = undefined
      cleared.daemonMcpConfigPath = undefined
    }
    patchSpawn(cleared)
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5">
      <IdentitySection profile={profile} onPatch={patch} />
      <BehaviorSection profile={profile} onPatch={patch} />
      <BackendSection backend={backend} onChange={switchBackend} hasIncompatibleFields={hasIncompatibleFields} />
      {isDaemon && <DaemonConfigSection spawn={profile.spawn} onPatch={patchSpawn} />}
      <LaunchFieldsSection
        value={launchFieldsFromProfile(profile)}
        onPatch={p => patchSpawn(spawnPatchFromLaunchFields(p))}
        show={launchFieldsShowFor(backend)}
      />
      {showAppendSp ? (
        <AppendSystemPromptSection
          value={profile.spawn.appendSystemPrompt ?? ''}
          onChange={text => patchSpawn({ appendSystemPrompt: text || undefined })}
        />
      ) : (
        <HiddenAppendPromptNotice backend={backend} hasValue={!!profile.spawn.appendSystemPrompt} />
      )}
      <PinningSection profile={profile} onPatch={patch} />
    </div>
  )
}

/**
 * Which `LaunchConfigFields` rows a profile editor shows per backend. Daemon
 * `claude --bg` dispatch only takes `--model`; effort / permission mode /
 * agent / budgets are claude/headless concepts. headless / repl / bare /
 * partial-messages are claude-agent-host runtime flags.
 */
function launchFieldsShowFor(backend: BackendKind) {
  const isClaude = backend === 'claude'
  const isDaemon = backend === 'daemon'
  return {
    model: true,
    effort: !isDaemon,
    permissionMode: !isDaemon,
    agent: !isDaemon,
    autocompactPct: !isDaemon,
    maxBudgetUsd: !isDaemon,
    headless: isClaude,
    repl: isClaude,
    bare: isClaude,
    includePartialMessages: isClaude,
  }
}

function hasBackendIncompatibleFields(profile: LaunchProfile, backend: BackendKind): boolean {
  const s = profile.spawn
  // Daemon-only injected paths are dropped by `switchBackend` on any move off
  // the daemon backend -- warn so the user does not lose them silently.
  if (backend === 'daemon') return !!(s.daemonSettingsPath || s.daemonMcpConfigPath)
  if (backend === 'opencode') return false
  return !!(s.appendSystemPrompt || s.openCodeModel || s.toolPermission)
}
