import type { zh } from './zh'

export const he = {
  attachMenuLabel: 'הוסף קובץ מצורף',
  attachFromPc: 'צרף קובץ מהמחשב',
  attachFromDocs: 'צרף ממסמכי GenOffice (@)',
  attachFromDrive: 'צרף מ-Google Drive',
  skillButtonLabel: 'פתח מיומנויות (/)',
  noEnabledSkills: 'אין מיומנויות מופעלות עבור עורך זה.',
  scrollToBottom: 'גלול לתחתית',
  copyReply: 'העתק תשובה',
  copiedReply: 'הועתק',
  regenerateReply: 'צור מחדש',
  workingSteps: 'עובד…',
  workedSteps: 'הושלם · {n} שלבים',
  workedStepOne: 'הושלם · שלב אחד',
  hintSkill: '/ מיומנויות',
  hintDocMention: '@ צרף מסמך',
} as const satisfies Record<keyof typeof zh, string>
