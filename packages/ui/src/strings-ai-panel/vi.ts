import type { zh } from './zh'

export const vi = {
  attachMenuLabel: 'Thêm tệp đính kèm',
  attachFromPc: 'Đính kèm tệp từ máy tính',
  attachFromDocs: 'Đính kèm từ tài liệu GenOffice (@)',
  attachFromDrive: 'Đính kèm từ Google Drive',
  skillButtonLabel: 'Mở kỹ năng (/)',
  noEnabledSkills: 'Chưa bật kỹ năng nào cho trình chỉnh sửa này.',
  scrollToBottom: 'Cuộn xuống cuối',
  copyReply: 'Sao chép phản hồi',
  copiedReply: 'Đã sao chép',
  regenerateReply: 'Tạo lại',
  workingSteps: 'Đang xử lý…',
  workedSteps: 'Hoàn tất · {n} bước',
  workedStepOne: 'Hoàn tất · 1 bước',
  hintSkill: '/ Kỹ năng',
  hintDocMention: '@ Đính kèm tài liệu',
} as const satisfies Record<keyof typeof zh, string>
