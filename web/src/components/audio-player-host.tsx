/**
 * AudioPlayerHost - app-root gate that lazy-loads the floating audio player.
 *
 * Mounted once at the app root. Renders nothing (and never fetches the player
 * chunk) until a track is loaded via playAudio(). On first play it pulls
 * audio-player.tsx via lazy()/Suspense -- so the <audio> element + controls cost
 * zero bytes for users who never play audio.
 */

import { lazy, Suspense } from 'react'
import { useAudioPlayer } from './audio-player-bus'

const AudioPlayer = lazy(() => import('./audio-player').then(m => ({ default: m.AudioPlayer })))

export function AudioPlayerHost() {
  const track = useAudioPlayer(s => s.track)
  if (!track) return null
  return (
    <Suspense fallback={null}>
      <AudioPlayer />
    </Suspense>
  )
}
