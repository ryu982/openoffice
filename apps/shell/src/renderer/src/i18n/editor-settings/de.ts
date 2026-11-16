import type { zh } from './zh'

export const de = {
  sectionDesc:
    'Ausgeschaltete Editoren verschwinden aus den Listen für neue Dokumente; beim Öffnen einer ihrer Dateien wird gefragt, ob der Editor eingeschaltet werden soll. Bereits geöffnete Dokumente bleiben offen.',
  aiOffKeeps:
    'Beim Ausschalten der KI bleiben Anmeldungen, Schlüssel, Skills und Einstellungen erhalten; nach dem Einschalten ist alles wieder da. Terminalbefehle und MCP funktionieren weiterhin.',
  aiOffAsk: 'Laufende KI-Aufgaben: {count}. Anhalten und KI ausschalten?',
  aiOffStop: 'Anhalten und ausschalten',
  aiOffCancel: 'Abbrechen',
  saveFailed: 'Konnte nicht geändert werden. Bitte erneut versuchen.',
} satisfies Record<keyof typeof zh, string>
