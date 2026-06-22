/**
 * Lazy-mount arming bus for the dispatch overlay. The overlay's heavy chunk
 * stays out of the index bundle until the cockpit is first summoned: the eager
 * gate (lazyModule) subscribes to `dispatchBus.useArmed`, and `openOverlay()`
 * (in the store) fires `dispatchBus.open()` to arm it. Visibility itself is the
 * store's `open` flag; this bus only triggers the one-time mount.
 */

import { createLazyBus } from '@/lib/lazy-bus'

export const dispatchBus = createLazyBus<void>()
