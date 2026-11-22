import type { zh } from './zh'

export const de = {
  attachMenuLabel: 'Anhang hinzufügen',
  attachFromPc: 'Datei vom Computer anhängen',
  attachFromDocs: 'Aus GenOffice-Dokumenten anhängen (@)',
  attachFromDrive: 'Aus Google Drive anhängen',
  skillButtonLabel: 'Skills öffnen (/)',
  noEnabledSkills: 'Für diesen Editor sind keine Skills aktiviert.',
  scrollToBottom: 'Nach unten scrollen',
  copyReply: 'Antwort kopieren',
  copiedReply: 'Kopiert',
  regenerateReply: 'Neu generieren',
  workingSteps: 'Wird bearbeitet…',
  workedSteps: 'Abgeschlossen · {n} Schritte',
  workedStepOne: 'Abgeschlossen · 1 Schritt',
  hintSkill: '/ Skills',
  hintDocMention: '@ Dokument anhängen',
} as const satisfies Record<keyof typeof zh, string>
