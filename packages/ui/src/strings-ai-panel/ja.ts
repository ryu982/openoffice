import type { zh } from './zh'

export const ja = {
  attachMenuLabel: 'ファイルを添付',
  attachFromPc: 'パソコンからファイルを添付',
  attachFromDocs: 'GenOffice の文書から添付 (@)',
  attachFromDrive: 'Google ドライブから添付',
  skillButtonLabel: 'スキルを開く (/)',
  noEnabledSkills: 'このエディターで有効なスキルはありません。',
  scrollToBottom: '最下部へ移動',
  copyReply: '回答をコピー',
  copiedReply: 'コピーしました',
  regenerateReply: '再生成',
  workingSteps: '作業中…',
  workedSteps: '作業完了 · {n}ステップ',
  workedStepOne: '作業完了 · 1ステップ',
  hintSkill: '/ スキルを呼び出す',
  hintDocMention: '@ 開いている文書を添付',
} as const satisfies Record<keyof typeof zh, string>
