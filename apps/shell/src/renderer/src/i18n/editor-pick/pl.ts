import type { zh } from './zh'

export const pl = {
  pickTitle: 'Wybierz edytory',
  pickBody:
    'Wyłącz edytory i AI, z których nie korzystasz, a znikną z ekranu. Możesz to zmienić w każdej chwili w sekcji Ustawienia → Edytory i AI.',
  pickOneTimeTitle: 'Wybierz edytory i AI',
  pickOneTimeBody:
    'Teraz możesz wyłączyć edytory i AI, z których nie korzystasz. To, co wyłączysz, zniknie z ekranu; otwarte dokumenty pozostaną otwarte. Możesz to zmienić później w sekcji Ustawienia → Edytory i AI.',
  pickSave: 'Zapisz',
  pickClose: 'Zamknij',
  pickEditorsLabel: 'Edytory',
  pickAiName: 'Funkcje AI',
  pickAiHint: 'Panele AI, przyciski AI i wskazówki dotyczące łączenia AI',
  pickLastEditor: 'Co najmniej jeden edytor musi pozostać włączony.',
  pickOpenDocs: 'Otwarte dokumenty',
  pickDoneAiOff:
    'AI jest wyłączona. Możesz ją ponownie włączyć w każdej chwili w sekcji Ustawienia → Edytory i AI.',
  settingsTabName: 'Edytory i AI',
  itemDocs: 'Word',
  itemSheets: 'Excel',
  itemSlides: 'PowerPoint',
  itemPdf: 'PDF',
  itemPdfTools: 'Narzędzia PDF',
  itemPdfToolsHint: 'Zadania PDF, takie jak łączenie, dzielenie i kompresja',
  itemMarkdown: 'Markdown i tekst',
  itemHtml: 'HTML',
  itemMindmap: 'Mapa myśli',
  itemDiagram: 'Diagram',
  itemHwp: 'HWP (Hangul)',
  itemEpub: 'E-book (EPUB)',
} satisfies Record<keyof typeof zh, string>
