/**
 * Audio-player bus. Pure non-component module (stays in the main bundle so the
 * transcript can call playAudio without pulling the player chunk).
 *
 * Audio plays in ONE persistent player docked in the app chrome -- not inline in
 * the transcript. The transcript renders a play-button chip; tapping it calls
 * playAudio(), which loads the track into the floating player. The player itself
 * (audio-player.tsx) is lazy-loaded by audio-player-host.tsx on first play, so
 * the <audio> element + controls cost nothing until someone hits play.
 *
 * Why a single chrome player instead of inline <audio> per message: playback
 * survives scrolling and conversation switches, only one track plays at a time,
 * and the controls are always reachable.
 */

import { create } from 'zustand'

export interface AudioTrack {
  url: string
  label: string
}

interface AudioPlayerState {
  /** The loaded track, or null when nothing is playing (player chunk unloaded). */
  track: AudioTrack | null
  play: (track: AudioTrack) => void
  close: () => void
}

export const useAudioPlayer = create<AudioPlayerState>(set => ({
  track: null,
  play: track => set({ track }),
  close: () => set({ track: null }),
}))

export function playAudio(url: string, label: string) {
  useAudioPlayer.getState().play({ url, label })
}
