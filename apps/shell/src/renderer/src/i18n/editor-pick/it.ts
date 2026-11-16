import type { zh } from './zh'

export const it = {
  pickTitle: 'Scegli i tuoi editor',
  pickBody:
    'Disattiva gli editor e l’IA che non usi: spariranno dallo schermo. Puoi cambiare in qualsiasi momento in Impostazioni → Editor e IA.',
  pickOneTimeTitle: 'Scegli gli editor e l’IA',
  pickOneTimeBody:
    'Ora puoi disattivare gli editor e l’IA che non usi. Ciò che disattivi sparisce dallo schermo; i documenti aperti restano aperti. Puoi cambiare più tardi in Impostazioni → Editor e IA.',
  pickSave: 'Salva',
  pickClose: 'Chiudi',
  pickEditorsLabel: 'Editor',
  pickAiName: 'Funzioni IA',
  pickAiHint: 'Pannelli IA, pulsanti IA e inviti a collegare un’IA',
  pickLastEditor: 'Almeno un editor deve restare attivo.',
  pickOpenDocs: 'Documenti aperti',
  pickDoneAiOff:
    'L’IA è disattivata. Puoi riattivarla in qualsiasi momento in Impostazioni → Editor e IA.',
  settingsTabName: 'Editor e IA',
  itemDocs: 'Word',
  itemSheets: 'Excel',
  itemSlides: 'PowerPoint',
  itemPdf: 'PDF',
  itemPdfTools: 'Strumenti PDF',
  itemPdfToolsHint: 'Operazioni PDF come unire, dividere e comprimere',
  itemMarkdown: 'Markdown e testo',
  itemHtml: 'HTML',
  itemMindmap: 'Mappa mentale',
  itemDiagram: 'Diagramma',
  itemHwp: 'HWP (Hangul)',
  itemEpub: 'E-book (EPUB)',
} satisfies Record<keyof typeof zh, string>
