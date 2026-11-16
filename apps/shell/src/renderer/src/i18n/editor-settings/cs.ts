import type { zh } from './zh'

export const cs = {
  sectionDesc:
    'Vypnuté editory zmizí ze seznamů nových dokumentů a při otevření jejich souboru se aplikace zeptá, zda je zapnout. Otevřené dokumenty zůstanou otevřené.',
  aiOffKeeps:
    'Vypnutím AI se nesmažou přihlášení, klíče, dovednosti ani nastavení; po zapnutí se vše vrátí. Příkazy terminálu a MCP fungují dál.',
  aiOffAsk: 'Běžící úlohy AI: {count}. Zastavit je a vypnout AI?',
  aiOffStop: 'Zastavit a vypnout',
  aiOffCancel: 'Zrušit',
  saveFailed: 'Změna se nezdařila. Zkuste to znovu.',
} satisfies Record<keyof typeof zh, string>
