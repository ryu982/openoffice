import type { zh } from './zh'

export const ms = {
  attachMenuLabel: 'Tambah lampiran',
  attachFromPc: 'Lampirkan fail dari komputer',
  attachFromDocs: 'Lampirkan daripada dokumen GenOffice (@)',
  attachFromDrive: 'Lampirkan daripada Google Drive',
  skillButtonLabel: 'Buka kemahiran (/)',
  noEnabledSkills: 'Tiada kemahiran didayakan untuk editor ini.',
  scrollToBottom: 'Tatal ke bawah',
  copyReply: 'Salin jawapan',
  copiedReply: 'Disalin',
  regenerateReply: 'Jana semula',
  workingSteps: 'Sedang memproses…',
  workedSteps: 'Selesai · {n} langkah',
  workedStepOne: 'Selesai · 1 langkah',
  hintSkill: '/ Kemahiran',
  hintDocMention: '@ Lampirkan dokumen',
} as const satisfies Record<keyof typeof zh, string>
