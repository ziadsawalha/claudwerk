const CODE_LABELS: Record<string, string> = {
  ShiftLeft: 'Left Shift',
  ShiftRight: 'Right Shift',
  ControlLeft: 'Left Ctrl',
  ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt',
  AltRight: 'Right Alt',
  MetaLeft: 'Left Cmd',
  MetaRight: 'Right Cmd',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Backspace: 'Backspace',
  Delete: 'Del',
  Insert: 'Ins',
  Home: 'Home',
  End: 'End',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  PrintScreen: 'PrtSc',
  ScrollLock: 'ScrLk',
  Pause: 'Pause',
  NumLock: 'NumLk',
  ContextMenu: 'Menu',
  Space: 'Space',
  CapsLock: 'Caps',
  Enter: 'Enter',
  Tab: 'Tab',
}

export function formatKeyCode(code: string): string {
  if (code in CODE_LABELS) return CODE_LABELS[code]
  const fKey = code.match(/^F(\d{1,2})$/)
  if (fKey) return `F${fKey[1]}`
  const numpad = code.match(/^Numpad(.+)$/)
  if (numpad) return `Num ${numpad[1]}`
  const letter = code.match(/^Key([A-Z])$/)
  if (letter) return letter[1]
  const digit = code.match(/^Digit(\d)$/)
  if (digit) return digit[1]
  return code
}
