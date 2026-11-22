import type { zh } from './zh'

export const es = {
  attachMenuLabel: 'Añadir archivo adjunto',
  attachFromPc: 'Adjuntar archivo desde el equipo',
  attachFromDocs: 'Adjuntar desde documentos de GenOffice (@)',
  attachFromDrive: 'Adjuntar desde Google Drive',
  skillButtonLabel: 'Abrir habilidades (/)',
  noEnabledSkills: 'No hay habilidades activadas para este editor.',
  scrollToBottom: 'Ir al final',
  copyReply: 'Copiar respuesta',
  copiedReply: 'Copiado',
  regenerateReply: 'Regenerar',
  workingSteps: 'Trabajando…',
  workedSteps: 'Completado · {n} pasos',
  workedStepOne: 'Completado · 1 paso',
  hintSkill: '/ Habilidades',
  hintDocMention: '@ Adjuntar documento',
} as const satisfies Record<keyof typeof zh, string>
