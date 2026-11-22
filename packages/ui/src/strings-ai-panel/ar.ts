import type { zh } from './zh'

export const ar = {
  attachMenuLabel: 'إضافة مرفق',
  attachFromPc: 'إرفاق ملف من الكمبيوتر',
  attachFromDocs: 'إرفاق من مستندات GenOffice (@)',
  attachFromDrive: 'إرفاق من Google Drive',
  skillButtonLabel: 'فتح المهارات (/)',
  noEnabledSkills: 'لا توجد مهارات مفعّلة لهذا المحرر.',
  scrollToBottom: 'الانتقال إلى الأسفل',
  copyReply: 'نسخ الرد',
  copiedReply: 'تم النسخ',
  regenerateReply: 'إعادة الإنشاء',
  workingSteps: 'جارٍ العمل…',
  workedSteps: 'مكتمل · {n} خطوات',
  workedStepOne: 'مكتمل · خطوة واحدة',
  hintSkill: '/ المهارات',
  hintDocMention: '@ إرفاق مستند',
} as const satisfies Record<keyof typeof zh, string>
