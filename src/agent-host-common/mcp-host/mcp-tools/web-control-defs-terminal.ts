/**
 * Web-control host tool descriptors -- host-shell terminal subset.
 *
 * Descriptions copied verbatim from the broker MCP site (mcp-server.ts). Split
 * from web-control-defs.ts to keep both files under the size bar.
 */

import { str, type WebToolDescriptor } from './web-control-defs-base'

export const TERMINAL_TOOL_DEFS: readonly WebToolDescriptor[] = [
  {
    name: 'web_terminal_list',
    op: 'terminal_list',
    description:
      'List host shells visible to the opted-in browser. Returns shellId, title, path, projectUri, status, agentAttached (driven by you, off-screen) and readable (has a live buffer you can read now). Start a new one with web_terminal_start or attach an existing one with web_terminal_attach.',
    properties: {},
  },
  {
    name: 'web_terminal_start',
    op: 'terminal_start',
    description:
      'Open a NEW host shell in the given project and attach to it detached (off-screen, never pops the overlay). Title is prefixed "[debug] ". Returns shellId. After ~1.5s the buffer is ready for web_terminal_read. projectUri is claude://sentinel/path -- discover via list_hosts / list_conversations.',
    properties: {
      projectUri: str('claude://sentinel/path -- where to run the shell.'),
      title: str('Label (will be prefixed "[debug] ").'),
    },
    required: ['projectUri'],
    buildArgs: p => ({ projectUri: p.projectUri, title: p.title }),
  },
  {
    name: 'web_terminal_attach',
    op: 'terminal_attach',
    description:
      "Attach to an EXISTING host shell (by shellId from web_terminal_list) detached/off-screen so you can read and write it without taking over the user's screen. Wait ~1.5s after attaching before web_terminal_read.",
    properties: { shellId: str('Shell to attach (from web_terminal_list).') },
    required: ['shellId'],
    buildArgs: p => ({ shellId: p.shellId }),
  },
  {
    name: 'web_terminal_detach',
    op: 'terminal_detach',
    description:
      'Detach from a host shell (unmounts the off-screen pane / unsubscribes). The shell keeps running; you just stop reading it.',
    properties: { shellId: str('Shell to detach.') },
    required: ['shellId'],
    buildArgs: p => ({ shellId: p.shellId }),
  },
  {
    name: 'web_terminal_read',
    op: 'terminal_read',
    description:
      "Read a host shell's terminal buffer (scrollback + viewport) as plain text. The shell must be attached first (web_terminal_start / web_terminal_attach). Capped to the last maxLines rows (default 2000).",
    properties: {
      shellId: str('Shell to read.'),
      maxLines: { type: 'number', description: 'Cap on rows returned (default 2000, from the bottom).' },
    },
    required: ['shellId'],
    buildArgs: p => ({ shellId: p.shellId, maxLines: p.maxLines }),
  },
  {
    name: 'web_terminal_write',
    op: 'terminal_write',
    description:
      'Write raw bytes to a host shell (keystrokes / input). Text is sent EXACTLY as given -- append "\\n" (or "\\r") yourself to submit a command. Control chars work too (e.g. "\\x03" for Ctrl-C). The shell need not be attached to write, but attach to read the result.',
    properties: {
      shellId: str('Shell to write to.'),
      data: str('Raw bytes to send. Include the trailing newline to submit.'),
    },
    required: ['shellId', 'data'],
    buildArgs: p => ({ shellId: p.shellId, data: p.data }),
  },
  {
    name: 'web_terminal_screenshot',
    op: 'terminal_screenshot',
    description:
      "Screenshot a host shell's terminal surface and return a public image URL. The shell must be attached first. Usually web_terminal_read (text) is more useful; use this for TUIs / rendering issues.",
    properties: { shellId: str('Shell to screenshot.') },
    required: ['shellId'],
    buildArgs: p => ({ shellId: p.shellId }),
  },
]
