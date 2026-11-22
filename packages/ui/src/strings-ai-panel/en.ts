import type { zh } from './zh'

export const en = {
  attachMenuLabel: 'Add attachment',
  attachFromPc: 'Attach file from computer',
  attachFromDocs: 'Attach from GenOffice documents (@)',
  attachFromDrive: 'Attach from Google Drive',
  skillButtonLabel: 'Open skills (/)',
  noEnabledSkills: 'No skills enabled for this editor.',
  scrollToBottom: 'Scroll to bottom',
  copyReply: 'Copy reply',
  copiedReply: 'Copied',
  regenerateReply: 'Regenerate',
  workingSteps: 'Working…',
  workedSteps: 'Worked · {n} steps',
  workedStepOne: 'Worked · 1 step',
  hintSkill: '/ Skills',
  hintDocMention: '@ Attach document',
} as const satisfies Record<keyof typeof zh, string>
