import type { zh } from './zh'

export const pl = {
  sectionDesc:
    'Wyłączone edytory znikają z list nowych dokumentów, a przy otwieraniu ich pliku aplikacja zapyta, czy je włączyć. Otwarte dokumenty pozostają otwarte.',
  aiOffKeeps:
    'Wyłączenie AI nie usuwa logowań, kluczy, umiejętności ani ustawień; po ponownym włączeniu wszystko wraca. Polecenia terminala i MCP działają dalej.',
  aiOffAsk: 'Uruchomione zadania AI: {count}. Zatrzymać je i wyłączyć AI?',
  aiOffStop: 'Zatrzymaj i wyłącz',
  aiOffCancel: 'Anuluj',
  saveFailed: 'Nie udało się zmienić. Spróbuj ponownie.',
} satisfies Record<keyof typeof zh, string>
