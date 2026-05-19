/**
 * Sentinel-profile picker for the spawn dialog.
 *
 * Three modes (mutually exclusive radio) per the sentinel-profiles plan:
 *
 *   - Fixed N: pick a specific named profile (one option per reported profile)
 *   - Balanced: sentinel picks the least-loaded pooled profile at spawn time
 *   - Random:   sentinel picks a uniformly random pooled profile each launch
 *
 * Rendered only when the target sentinel reports >1 profile -- single-profile
 * (or unknown) sentinels have nothing to choose between, so the field hides
 * entirely. The user's choice is the launch INTENT; the sentinel resolves it
 * at spawn time and the resolved name lands in the conversation URI userinfo.
 *
 * PROFILE-ENV BOUNDARY: this component renders NAME + label + color + pooled
 * + authed only. configDir / env are sentinel-local and never reach the UI.
 */

import type { SentinelProfileInfo } from '@shared/protocol'
import { Shuffle, User } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SentinelProfileRadioProps {
  /** Profiles reported by the target sentinel (NAMES + display only). */
  profiles: SentinelProfileInfo[]
  /** Sentinel's `defaultSelection` -- used as the default radio when the
   *  user hasn't explicitly chosen. */
  defaultSelection?: 'default' | 'balanced' | 'random'
  /** Current selection. `''` = follow sentinel default. Otherwise either a
   *  literal profile name (Fixed) or `'balanced'` / `'random'`. */
  value: string
  onChange: (next: string) => void
  disabled?: boolean
}

export function SentinelProfileRadio({
  profiles,
  defaultSelection,
  value,
  onChange,
  disabled,
}: SentinelProfileRadioProps) {
  // Hide entirely when the sentinel has nothing meaningful to offer. The
  // implicit `default` profile (sentinel has no config) reports zero
  // profiles; a config with only `default` reports one. Both -> no picker.
  if (profiles.length < 2) return null

  const pool = profiles.filter(p => p.pooled)
  const showSelectionModes = pool.length > 0
  const resolvedValue = value || (defaultSelection && defaultSelection !== 'default' ? defaultSelection : '')

  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-mono text-muted-foreground">
        Sentinel profile
        {defaultSelection && defaultSelection !== 'default' && !value && (
          <span className="ml-1.5 text-[9px] text-comment">
            (sentinel default:{' '}
            <span className="text-foreground" style={{ textTransform: 'lowercase' }}>
              {defaultSelection}
            </span>
            )
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {profiles.map(p => (
          <ProfilePill
            key={p.name}
            profile={p}
            active={resolvedValue === p.name}
            disabled={disabled}
            onClick={() => onChange(p.name)}
          />
        ))}
      </div>
      {showSelectionModes && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          <SelectionPill
            label="Balanced"
            title="Sentinel picks the least-loaded pooled profile"
            icon
            active={resolvedValue === 'balanced'}
            disabled={disabled}
            onClick={() => onChange('balanced')}
          />
          <SelectionPill
            label="Random"
            title="Uniformly random pooled profile each launch"
            icon
            active={resolvedValue === 'random'}
            disabled={disabled}
            onClick={() => onChange('random')}
          />
        </div>
      )}
    </div>
  )
}

interface ProfilePillProps {
  profile: SentinelProfileInfo
  active: boolean
  disabled?: boolean
  onClick: () => void
}

function buildProfilePillTitle(profile: SentinelProfileInfo): string {
  return [profile.label, profile.pooled ? 'pooled' : 'pinned', profile.authed ? 'authed' : 'not authed']
    .filter(Boolean)
    .join(' - ')
}

function ProfilePill({ profile, active, disabled, onClick }: ProfilePillProps) {
  const title = buildProfilePillTitle(profile)
  const colorStyle = profile.color ? { borderColor: profile.color } : undefined
  const fgColor = profile.color ? { color: profile.color } : undefined
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'px-2 py-1 text-[10px] font-mono border rounded flex items-center gap-1.5 cursor-pointer transition-colors',
        active
          ? 'border-primary bg-primary/15 text-foreground'
          : 'border-primary/20 bg-surface-inset text-muted-foreground hover:text-foreground hover:bg-primary/5',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
      style={active ? undefined : colorStyle}
    >
      <User className={cn('w-3 h-3', profile.authed ? '' : 'text-destructive/70')} style={fgColor} />
      <span style={fgColor}>{profile.name}</span>
      {!profile.pooled && <span className="text-[8px] text-comment uppercase">pinned</span>}
      {!profile.authed && <span className="text-[8px] text-destructive/70 uppercase">unauth</span>}
    </button>
  )
}

interface SelectionPillProps {
  label: string
  title: string
  icon: boolean
  active: boolean
  disabled?: boolean
  onClick: () => void
}

function SelectionPill({ label, title, icon, active, disabled, onClick }: SelectionPillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'px-2 py-1 text-[10px] font-mono border rounded flex items-center gap-1.5 cursor-pointer transition-colors',
        active
          ? 'border-primary bg-primary/15 text-foreground'
          : 'border-primary/20 bg-surface-inset text-muted-foreground hover:text-foreground hover:bg-primary/5',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      {icon && <Shuffle className="w-3 h-3" />}
      <span>{label}</span>
    </button>
  )
}
