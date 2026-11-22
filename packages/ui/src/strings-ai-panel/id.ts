import type { zh } from './zh'

export const id = {
  attachMenuLabel: 'Tambah lampiran',
  attachFromPc: 'Lampirkan file dari komputer',
  attachFromDocs: 'Lampirkan dari dokumen GenOffice (@)',
  attachFromDrive: 'Lampirkan dari Google Drive',
  skillButtonLabel: 'Buka keterampilan (/)',
  noEnabledSkills: 'Tidak ada keterampilan yang aktif untuk editor ini.',
  scrollToBottom: 'Gulir ke bawah',
  copyReply: 'Salin balasan',
  copiedReply: 'Disalin',
  regenerateReply: 'Buat ulang',
  workingSteps: 'Memproses…',
  workedSteps: 'Selesai · {n} langkah',
  workedStepOne: 'Selesai · 1 langkah',
  hintSkill: '/ Keterampilan',
  hintDocMention: '@ Lampirkan dokumen',
} as const satisfies Record<keyof typeof zh, string>
