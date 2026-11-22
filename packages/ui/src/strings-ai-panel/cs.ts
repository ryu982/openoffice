import type { zh } from './zh'

export const cs = {
  attachMenuLabel: 'Přidat přílohu',
  attachFromPc: 'Přiložit soubor z počítače',
  attachFromDocs: 'Přiložit z dokumentů GenOffice (@)',
  attachFromDrive: 'Přiložit z Disku Google',
  skillButtonLabel: 'Otevřít dovednosti (/)',
  noEnabledSkills: 'Pro tento editor nejsou povoleny žádné dovednosti.',
  scrollToBottom: 'Přejít dolů',
  copyReply: 'Kopírovat odpověď',
  copiedReply: 'Zkopírováno',
  regenerateReply: 'Vygenerovat znovu',
  workingSteps: 'Pracuji…',
  workedSteps: 'Dokončeno · {n} kroků',
  workedStepOne: 'Dokončeno · 1 krok',
  hintSkill: '/ Dovednosti',
  hintDocMention: '@ Přiložit dokument',
} as const satisfies Record<keyof typeof zh, string>
