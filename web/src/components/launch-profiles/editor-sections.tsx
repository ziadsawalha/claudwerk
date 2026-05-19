import type { LaunchProfile } from '@shared/launch-profile'
import { LAUNCH_PROFILE_MAX_APPEND_SP } from '@shared/launch-profile'
import type { ComponentProps } from 'react'
import { LaunchConfigFields, type LaunchFieldsValue } from '@/components/launch-config-fields'
import { type BackendKind, BackendSelect } from '@/components/spawn-dialog/backend-select'
import { TogglePill } from '@/components/ui/toggle-pill'
import { formatShortcut } from '@/lib/commands'
import { LabeledRow, Section } from './editor-shell'
import { ProjectUriField } from './project-uri-field'

type LaunchFieldsShow = ComponentProps<typeof LaunchConfigFields>['show']

const DEFAULT_FIELDS_SHOW: LaunchFieldsShow = {
  model: true,
  effort: true,
  permissionMode: true,
  agent: true,
  autocompactPct: true,
  maxBudgetUsd: true,
}

type PatchProfile = (next: Partial<LaunchProfile>) => void

export function IdentitySection({ profile, onPatch }: { profile: LaunchProfile; onPatch: PatchProfile }) {
  return (
    <Section title="Identity">
      <LabeledRow label="Name">
        <TextInput
          value={profile.name}
          onChange={v => onPatch({ name: v })}
          placeholder="Profile name"
          maxWidth={260}
        />
      </LabeledRow>
      <LabeledRow label="Short label" subtitle="Shown on the spawn-dialog dropdown chip">
        <TextInput
          value={profile.shortLabel ?? ''}
          onChange={v => onPatch({ shortLabel: v || undefined })}
          placeholder={profile.name.slice(0, 12)}
          maxWidth={220}
        />
      </LabeledRow>
      <LabeledRow label="Chord key" subtitle={profile.chord ? formatShortcut(`mod+j ${profile.chord}`) : '(no chord)'}>
        <TextInput
          value={profile.chord ?? ''}
          onChange={v => onPatch({ chord: v.toLowerCase().slice(0, 3) || undefined })}
          placeholder="o"
          width={64}
        />
      </LabeledRow>
    </Section>
  )
}

export function BehaviorSection({ profile, onPatch }: { profile: LaunchProfile; onPatch: PatchProfile }) {
  const immediate = profile.immediate ?? true
  return (
    <Section title="Behavior">
      <LabeledRow
        label="Immediate launch"
        subtitle={immediate ? 'Fires straight to the broker on chord' : 'Opens the spawn dialog pre-filled'}
      >
        <TogglePill
          small
          label={immediate ? 'On' : 'Off'}
          active={immediate}
          onClick={() => onPatch({ immediate: !immediate })}
        />
      </LabeledRow>
    </Section>
  )
}

export function BackendSection({
  backend,
  onChange,
  hasIncompatibleFields,
}: {
  backend: BackendKind
  onChange: (next: BackendKind) => void
  hasIncompatibleFields: boolean
}) {
  function handleChange(next: BackendKind) {
    if (next === backend) return
    if (hasIncompatibleFields) {
      const ok = window.confirm('Switching backend will clear fields the new backend cannot use. Continue?')
      if (!ok) return
    }
    onChange(next)
  }
  return (
    <Section title="Backend">
      <BackendSelect value={backend} onChange={handleChange} chatAvailable hermesAvailable />
    </Section>
  )
}

export function LaunchFieldsSection({
  value,
  onPatch,
  show = DEFAULT_FIELDS_SHOW,
}: {
  value: LaunchFieldsValue
  onPatch: (p: Partial<LaunchFieldsValue>) => void
  show?: LaunchFieldsShow
}) {
  return (
    <Section title="Launch fields">
      <LaunchConfigFields value={value} onChange={onPatch} show={show} />
    </Section>
  )
}

export function AppendSystemPromptSection({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  return (
    <Section
      title="System prompt suffix"
      subtitle="Appended to CC's generated system prompt. CC: --append-system-prompt"
    >
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={6}
        placeholder="e.g. Be terse. Prefer bullet points. Skip apologies."
        className="w-full text-xs font-mono bg-surface-inset border border-primary/20 px-2 py-1 outline-none resize-y"
        maxLength={LAUNCH_PROFILE_MAX_APPEND_SP}
      />
      <div className="text-[10px] text-muted-foreground text-right">
        {value.length} / {LAUNCH_PROFILE_MAX_APPEND_SP}
      </div>
    </Section>
  )
}

export function HiddenAppendPromptNotice({ backend, hasValue }: { backend: BackendKind; hasValue: boolean }) {
  return (
    <Section title="System prompt suffix">
      <div className="text-[11px] text-muted-foreground">
        Hidden because the <span className="text-foreground">{backend}</span> backend cannot honor an appended system
        prompt at spawn time.
      </div>
      {hasValue && (
        <div className="text-[11px] text-warning">
          A suffix is already saved; it will be ignored on launch until you switch to claude or chat-api.
        </div>
      )}
    </Section>
  )
}

// A daemon launch profile only ever persists `new` / `resume` -- `attach`
// targets an ephemeral roster worker and is a per-launch-only choice.
const DAEMON_PROFILE_MODES: Array<{ value: 'new' | 'resume'; label: string; hint: string }> = [
  { value: 'new', label: 'New', hint: 'claude --bg with a fresh prompt (entered at launch)' },
  { value: 'resume', label: 'Resume', hint: 'claude --bg --resume -- the session id is entered at launch' },
]

/**
 * Daemon-specific launch config for a profile: the launch mode (new/resume)
 * plus the sentinel-host config paths injected into `claude --bg`. Rendered
 * only when the profile's backend is `daemon`. The per-launch-only
 * `daemonResumeSessionId` / `daemonAttachShort` are deliberately absent --
 * they are stripped by `profileSpawnSchema` and supplied in the spawn dialog.
 */
export function DaemonConfigSection({
  spawn,
  onPatch,
}: {
  spawn: LaunchProfile['spawn']
  onPatch: (next: Partial<LaunchProfile['spawn']>) => void
}) {
  const mode = spawn.daemonMode === 'resume' ? 'resume' : 'new'
  const modeHint = DAEMON_PROFILE_MODES.find(m => m.value === mode)?.hint
  return (
    <Section title="Daemon launch" subtitle="Attach mode is per-launch only and is never saved to a profile.">
      <LabeledRow label="Mode" subtitle={modeHint}>
        <div className="flex gap-1.5">
          {DAEMON_PROFILE_MODES.map(m => (
            <TogglePill
              key={m.value}
              small
              label={m.label}
              title={m.hint}
              active={mode === m.value}
              onClick={() => onPatch({ daemonMode: m.value })}
            />
          ))}
        </div>
      </LabeledRow>
      <LabeledRow label="Settings path" subtitle="Absolute path on the sentinel host. claude --bg --settings">
        <TextInput
          value={spawn.daemonSettingsPath ?? ''}
          onChange={v => onPatch({ daemonSettingsPath: v || undefined })}
          placeholder="/abs/path/to/settings.json"
          maxWidth={260}
        />
      </LabeledRow>
      <LabeledRow label="MCP config path" subtitle="Absolute path on the sentinel host. claude --bg --mcp-config">
        <TextInput
          value={spawn.daemonMcpConfigPath ?? ''}
          onChange={v => onPatch({ daemonMcpConfigPath: v || undefined })}
          placeholder="/abs/path/to/mcp.json"
          maxWidth={260}
        />
      </LabeledRow>
    </Section>
  )
}

export function PinningSection({ profile, onPatch }: { profile: LaunchProfile; onPatch: PatchProfile }) {
  return (
    <Section title="Pinning" subtitle="Optional. Empty = pick at launch time. The URI authority is the sentinel.">
      <ProjectUriField value={profile.project ?? ''} onChange={v => onPatch({ project: v || undefined })} />
    </Section>
  )
}

function TextInput({
  value,
  onChange,
  placeholder,
  maxWidth,
  width,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  maxWidth?: number
  width?: number
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={maxWidth ? { maxWidth, flex: 1 } : width ? { width } : undefined}
      className="text-xs font-mono bg-surface-inset border border-primary/20 px-2 py-1 outline-none"
    />
  )
}
