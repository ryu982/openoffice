import type { zh } from './zh'

export const ko = {
  attachMenuLabel: '자료 첨부',
  attachFromPc: 'PC에서 파일 첨부',
  attachFromDocs: 'GenOffice 문서에서 첨부 (@)',
  attachFromDrive: 'Google 드라이브에서 첨부',
  skillButtonLabel: '스킬 열기 (/)',
  noEnabledSkills: '이 편집기에서 켜진 스킬이 없습니다.',
  scrollToBottom: '맨 아래로 이동',
  copyReply: '답변 복사',
  copiedReply: '복사됨',
  regenerateReply: '다시 생성',
  workingSteps: '작업 중…',
  workedSteps: '작업 완료 · {n}단계',
  workedStepOne: '작업 완료 · 1단계',
  hintSkill: '/ 스킬 불러오기',
  hintDocMention: '@ 열린 문서 첨부',
} as const satisfies Record<keyof typeof zh, string>
