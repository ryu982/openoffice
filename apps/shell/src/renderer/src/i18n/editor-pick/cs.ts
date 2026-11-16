import type { zh } from './zh'

export const cs = {
  pickTitle: 'Vyberte editory',
  pickBody:
    'Vypněte editory a AI, které nepoužíváte, a zmizí z obrazovky. Kdykoli to můžete změnit v Nastavení → Editory a AI.',
  pickOneTimeTitle: 'Vyberte editory a AI',
  pickOneTimeBody:
    'Nyní můžete vypnout editory a AI, které nepoužíváte. Co vypnete, zmizí z obrazovky; otevřené dokumenty zůstanou otevřené. Později to můžete změnit v Nastavení → Editory a AI.',
  pickSave: 'Uložit',
  pickClose: 'Zavřít',
  pickEditorsLabel: 'Editory',
  pickAiName: 'Funkce AI',
  pickAiHint: 'Panely AI, tlačítka AI a výzvy k připojení AI',
  pickLastEditor: 'Alespoň jeden editor musí zůstat zapnutý.',
  pickOpenDocs: 'Otevřené dokumenty',
  pickDoneAiOff: 'AI je vypnutá. Kdykoli ji můžete znovu zapnout v Nastavení → Editory a AI.',
  settingsTabName: 'Editory a AI',
  itemDocs: 'Word',
  itemSheets: 'Excel',
  itemSlides: 'PowerPoint',
  itemPdf: 'PDF',
  itemPdfTools: 'Nástroje PDF',
  itemPdfToolsHint: 'Práce s PDF jako spojení, rozdělení a komprese',
  itemMarkdown: 'Markdown a text',
  itemHtml: 'HTML',
  itemMindmap: 'Myšlenková mapa',
  itemDiagram: 'Diagram',
  itemHwp: 'HWP (hangul)',
  itemEpub: 'E-kniha (EPUB)',
} satisfies Record<keyof typeof zh, string>
