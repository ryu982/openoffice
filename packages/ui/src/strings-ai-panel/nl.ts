import type { zh } from './zh'

export const nl = {
  attachMenuLabel: 'Bijlage toevoegen',
  attachFromPc: 'Bestand van computer bijvoegen',
  attachFromDocs: 'Bijvoegen uit GenOffice-documenten (@)',
  attachFromDrive: 'Bijvoegen uit Google Drive',
  skillButtonLabel: 'Vaardigheden openen (/)',
  noEnabledSkills: 'Geen vaardigheden ingeschakeld voor deze editor.',
  scrollToBottom: 'Naar beneden scrollen',
  copyReply: 'Antwoord kopiëren',
  copiedReply: 'Gekopieerd',
  regenerateReply: 'Opnieuw genereren',
  workingSteps: 'Bezig…',
  workedSteps: 'Voltooid · {n} stappen',
  workedStepOne: 'Voltooid · 1 stap',
  hintSkill: '/ Vaardigheden',
  hintDocMention: '@ Document bijvoegen',
} as const satisfies Record<keyof typeof zh, string>
