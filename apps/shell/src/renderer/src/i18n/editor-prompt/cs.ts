import type { zh } from './zh'

export const cs = {
  item_docs: 'Editor Word',
  item_sheets: 'Editor Excel',
  item_slides: 'Editor PowerPoint',
  item_pdf: 'Editor PDF',
  item_pdfTools: 'Nástroje PDF',
  item_markdown: 'Editor Markdownu a textu',
  item_html: 'Editor HTML',
  item_mindmap: 'Editor myšlenkových map',
  item_diagram: 'Editor diagramů',
  item_hwp: 'Editor hangul (HWP)',
  item_epub: 'Editor EPUB',
  offMessage: '{item}: vypnuto. Zapnout a otevřít?',
  offDetailFiles: 'Počet souborů, které se v něm otevřou: {count}.',
  turnOnAndOpen: 'Zapnout a otevřít',
  fileOnly: 'Jen vytvořit soubor',
  cancel: 'Zrušit',
  aiOffSkillMessage: 'AI je vypnutá. Zapnout AI a importovat dovednost?',
  aiOnAndImport: 'Zapnout AI a importovat',
  fileOnlyDetail: 'Jen vytvořit soubor: editor zůstane vypnutý a nový soubor se zobrazí ve složce.',
  entranceDetail: 'Tato funkce vyžaduje zapnutí: {item}.',
  genAiOffConvert: 'AI je vypnutá: k dispozici jsou jen převody bez AI.',
  genAiOffNoConversion:
    'AI je vypnutá. Přidejte jediný soubor myšlenkové mapy nebo Markdown a převeďte ho bez AI.',
} satisfies Record<keyof typeof zh, string>
