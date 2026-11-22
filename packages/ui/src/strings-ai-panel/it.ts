import type { zh } from './zh'

export const it = {
  attachMenuLabel: 'Aggiungi allegato',
  attachFromPc: 'Allega file dal computer',
  attachFromDocs: 'Allega dai documenti GenOffice (@)',
  attachFromDrive: 'Allega da Google Drive',
  skillButtonLabel: 'Apri competenze (/)',
  noEnabledSkills: 'Nessuna competenza abilitata per questo editor.',
  scrollToBottom: 'Scorri in fondo',
  copyReply: 'Copia risposta',
  copiedReply: 'Copiato',
  regenerateReply: 'Rigenera',
  workingSteps: 'In corso…',
  workedSteps: 'Completato · {n} passaggi',
  workedStepOne: 'Completato · 1 passaggio',
  hintSkill: '/ Competenze',
  hintDocMention: '@ Allega documento',
} as const satisfies Record<keyof typeof zh, string>
