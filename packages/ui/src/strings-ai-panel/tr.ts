import type { zh } from './zh'

export const tr = {
  attachMenuLabel: 'Ek ekle',
  attachFromPc: 'Bilgisayardan dosya ekle',
  attachFromDocs: 'GenOffice belgelerinden ekle (@)',
  attachFromDrive: 'Google Drive’dan ekle',
  skillButtonLabel: 'Becerileri aç (/)',
  noEnabledSkills: 'Bu düzenleyici için etkinleştirilmiş beceri yok.',
  scrollToBottom: 'En alta kaydır',
  copyReply: 'Yanıtı kopyala',
  copiedReply: 'Kopyalandı',
  regenerateReply: 'Yeniden oluştur',
  workingSteps: 'Çalışıyor…',
  workedSteps: 'Tamamlandı · {n} adım',
  workedStepOne: 'Tamamlandı · 1 adım',
  hintSkill: '/ Beceriler',
  hintDocMention: '@ Belge ekle',
} as const satisfies Record<keyof typeof zh, string>
