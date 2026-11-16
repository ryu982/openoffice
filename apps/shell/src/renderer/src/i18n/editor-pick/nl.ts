import type { zh } from './zh'

export const nl = {
  pickTitle: 'Kies je editors',
  pickBody:
    'Zet editors en AI die je niet gebruikt uit, dan verdwijnen ze van het scherm. Je kunt dit altijd wijzigen via Instellingen → Editors en AI.',
  pickOneTimeTitle: 'Kies je editors en AI',
  pickOneTimeBody:
    'Je kunt nu editors en AI die je niet gebruikt uitzetten. Wat je uitzet, verdwijnt van het scherm; geopende documenten blijven open. Je kunt dit later wijzigen via Instellingen → Editors en AI.',
  pickSave: 'Opslaan',
  pickClose: 'Sluiten',
  pickEditorsLabel: 'Editors',
  pickAiName: 'AI-functies',
  pickAiHint: 'AI-panelen, AI-knoppen en meldingen om een AI te verbinden',
  pickLastEditor: 'Er moet ten minste één editor aan blijven.',
  pickOpenDocs: 'Documenten geopend',
  pickDoneAiOff:
    'AI staat uit. Je kunt het altijd weer aanzetten via Instellingen → Editors en AI.',
  settingsTabName: 'Editors en AI',
  itemDocs: 'Word',
  itemSheets: 'Excel',
  itemSlides: 'PowerPoint',
  itemPdf: 'PDF',
  itemPdfTools: 'PDF-hulpmiddelen',
  itemPdfToolsHint: 'PDF-taken zoals samenvoegen, splitsen en comprimeren',
  itemMarkdown: 'Markdown en tekst',
  itemHtml: 'HTML',
  itemMindmap: 'Mindmap',
  itemDiagram: 'Diagram',
  itemHwp: 'HWP (Hangul)',
  itemEpub: 'E-book (EPUB)',
} satisfies Record<keyof typeof zh, string>
