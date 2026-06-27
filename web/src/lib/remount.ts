let trigger: (() => void) | null = null

export function setRemountTrigger(fn: () => void): void {
  trigger = fn
}

export function remountApp(): void {
  trigger?.()
}
