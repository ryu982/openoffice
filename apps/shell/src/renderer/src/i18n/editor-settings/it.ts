import type { zh } from './zh'

export const it = {
  sectionDesc:
    'Gli editor disattivati spariscono dagli elenchi dei nuovi documenti e, aprendo un loro file, l’app chiede se riattivarli. I documenti già aperti restano aperti.',
  aiOffKeeps:
    'Disattivare l’IA non elimina accessi, chiavi, skill e impostazioni; riattivandola torna tutto com’era. I comandi da terminale e MCP continuano a funzionare.',
  aiOffAsk: 'Attività IA in corso: {count}. Fermarle e disattivare l’IA?',
  aiOffStop: 'Ferma e disattiva',
  aiOffCancel: 'Annulla',
  saveFailed: 'Impossibile modificare. Riprova.',
} satisfies Record<keyof typeof zh, string>
