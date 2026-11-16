import type { zh } from './zh'

export const fr = {
  sectionDesc:
    'Les éditeurs désactivés disparaissent des listes de nouveaux documents ; à l’ouverture d’un de leurs fichiers, l’app demande s’il faut les réactiver. Les documents déjà ouverts restent ouverts.',
  aiOffKeeps:
    'Désactiver l’IA conserve vos connexions, clés, compétences et réglages ; en la réactivant, tout revient. Les commandes du terminal et MCP continuent de fonctionner.',
  aiOffAsk: 'Tâches d’IA en cours : {count}. Les arrêter et désactiver l’IA ?',
  aiOffStop: 'Arrêter et désactiver',
  aiOffCancel: 'Annuler',
  saveFailed: 'Modification impossible. Réessayez.',
} satisfies Record<keyof typeof zh, string>
