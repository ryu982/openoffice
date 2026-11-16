import type { zh } from './zh'

export const en = {
  sectionDesc:
    'Editors you turn off leave the new-document lists, and opening one of their files asks whether to turn the editor on. Documents already open stay open.',
  aiOffKeeps:
    'Turning AI off keeps your sign-ins, keys, skills and settings; turning it back on brings everything back. Terminal commands and MCP keep working while AI is off.',
  aiOffAsk: 'AI jobs running: {count}. Stop them and turn AI off?',
  aiOffStop: 'Stop and turn off',
  aiOffCancel: 'Cancel',
  saveFailed: 'Could not change it. Try again.',
} satisfies Record<keyof typeof zh, string>
