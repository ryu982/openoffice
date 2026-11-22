import type { zh } from './zh'

export const pl = {
  attachMenuLabel: 'Dodaj załącznik',
  attachFromPc: 'Załącz plik z komputera',
  attachFromDocs: 'Załącz z dokumentów GenOffice (@)',
  attachFromDrive: 'Załącz z Dysku Google',
  skillButtonLabel: 'Otwórz umiejętności (/)',
  noEnabledSkills: 'Brak włączonych umiejętności dla tego edytora.',
  scrollToBottom: 'Przewiń na dół',
  copyReply: 'Kopiuj odpowiedź',
  copiedReply: 'Skopiowano',
  regenerateReply: 'Wygeneruj ponownie',
  workingSteps: 'Przetwarzanie…',
  workedSteps: 'Zakończono · {n} kroków',
  workedStepOne: 'Zakończono · 1 krok',
  hintSkill: '/ Umiejętności',
  hintDocMention: '@ Załącz dokument',
} as const satisfies Record<keyof typeof zh, string>
