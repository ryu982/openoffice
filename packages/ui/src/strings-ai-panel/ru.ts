import type { zh } from './zh'

export const ru = {
  attachMenuLabel: 'Добавить вложение',
  attachFromPc: 'Прикрепить файл с компьютера',
  attachFromDocs: 'Прикрепить из документов GenOffice (@)',
  attachFromDrive: 'Прикрепить с Google Диска',
  skillButtonLabel: 'Открыть навыки (/)',
  noEnabledSkills: 'Для этого редактора не включено ни одного навыка.',
  scrollToBottom: 'Прокрутить вниз',
  copyReply: 'Копировать ответ',
  copiedReply: 'Скопировано',
  regenerateReply: 'Сгенерировать заново',
  workingSteps: 'Выполняется…',
  workedSteps: 'Готово · {n} шагов',
  workedStepOne: 'Готово · 1 шаг',
  hintSkill: '/ Навыки',
  hintDocMention: '@ Прикрепить документ',
} as const satisfies Record<keyof typeof zh, string>
