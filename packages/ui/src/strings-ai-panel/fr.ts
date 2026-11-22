import type { zh } from './zh'

export const fr = {
  attachMenuLabel: 'Ajouter une pièce jointe',
  attachFromPc: 'Joindre un fichier depuis l’ordinateur',
  attachFromDocs: 'Joindre depuis les documents GenOffice (@)',
  attachFromDrive: 'Joindre depuis Google Drive',
  skillButtonLabel: 'Ouvrir les compétences (/)',
  noEnabledSkills: 'Aucune compétence activée pour cet éditeur.',
  scrollToBottom: 'Aller en bas',
  copyReply: 'Copier la réponse',
  copiedReply: 'Copié',
  regenerateReply: 'Régénérer',
  workingSteps: 'En cours…',
  workedSteps: 'Terminé · {n} étapes',
  workedStepOne: 'Terminé · 1 étape',
  hintSkill: '/ Compétences',
  hintDocMention: '@ Joindre un document',
} as const satisfies Record<keyof typeof zh, string>
