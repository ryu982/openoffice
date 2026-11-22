import type { zh } from './zh'

export const zhTW = {
  attachMenuLabel: '加入附件',
  attachFromPc: '從電腦附加檔案',
  attachFromDocs: '從 GenOffice 文件附加 (@)',
  attachFromDrive: '從 Google 雲端硬碟附加',
  skillButtonLabel: '開啟技能 (/)',
  noEnabledSkills: '此編輯器中沒有已啟用的技能。',
  scrollToBottom: '捲動至底部',
  copyReply: '複製回覆',
  copiedReply: '已複製',
  regenerateReply: '重新產生',
  workingSteps: '處理中…',
  workedSteps: '已完成 · {n} 步',
  workedStepOne: '已完成 · 1 步',
  hintSkill: '/ 呼叫技能',
  hintDocMention: '@ 附加已開啟文件',
} as const satisfies Record<keyof typeof zh, string>
