import type { zh } from './zh'

export const pt = {
  attachMenuLabel: 'Adicionar anexo',
  attachFromPc: 'Anexar arquivo do computador',
  attachFromDocs: 'Anexar dos documentos do GenOffice (@)',
  attachFromDrive: 'Anexar do Google Drive',
  skillButtonLabel: 'Abrir habilidades (/)',
  noEnabledSkills: 'Nenhuma habilidade ativada para este editor.',
  scrollToBottom: 'Rolar para o final',
  copyReply: 'Copiar resposta',
  copiedReply: 'Copiado',
  regenerateReply: 'Gerar novamente',
  workingSteps: 'Trabalhando…',
  workedSteps: 'Concluído · {n} etapas',
  workedStepOne: 'Concluído · 1 etapa',
  hintSkill: '/ Habilidades',
  hintDocMention: '@ Anexar documento',
} as const satisfies Record<keyof typeof zh, string>
