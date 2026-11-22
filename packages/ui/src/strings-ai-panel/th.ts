import type { zh } from './zh'

export const th = {
  attachMenuLabel: 'แนบไฟล์',
  attachFromPc: 'แนบไฟล์จากคอมพิวเตอร์',
  attachFromDocs: 'แนบจากเอกสาร GenOffice (@)',
  attachFromDrive: 'แนบจาก Google ไดรฟ์',
  skillButtonLabel: 'เปิดทักษะ (/)',
  noEnabledSkills: 'ไม่มีทักษะที่เปิดใช้งานสำหรับตัวแก้ไขนี้',
  scrollToBottom: 'เลื่อนลงด้านล่างสุด',
  copyReply: 'คัดลอกคำตอบ',
  copiedReply: 'คัดลอกแล้ว',
  regenerateReply: 'สร้างคำตอบใหม่',
  workingSteps: 'กำลังทำงาน…',
  workedSteps: 'เสร็จสิ้น · {n} ขั้นตอน',
  workedStepOne: 'เสร็จสิ้น · 1 ขั้นตอน',
  hintSkill: '/ เรียกใช้ทักษะ',
  hintDocMention: '@ แนบเอกสารที่เปิดอยู่',
} as const satisfies Record<keyof typeof zh, string>
