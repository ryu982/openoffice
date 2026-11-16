import type { zh } from './zh'

export const pl = {
  item_docs: 'Edytor Word',
  item_sheets: 'Edytor Excel',
  item_slides: 'Edytor PowerPoint',
  item_pdf: 'Edytor PDF',
  item_pdfTools: 'Narzędzia PDF',
  item_markdown: 'Edytor Markdown i tekstu',
  item_html: 'Edytor HTML',
  item_mindmap: 'Edytor map myśli',
  item_diagram: 'Edytor diagramów',
  item_hwp: 'Edytor hangul (HWP)',
  item_epub: 'Edytor EPUB',
  offMessage: '{item}: wyłączony. Włączyć i otworzyć?',
  offDetailFiles: 'Liczba plików, które się w nim otworzą: {count}.',
  turnOnAndOpen: 'Włącz i otwórz',
  fileOnly: 'Utwórz tylko plik',
  cancel: 'Anuluj',
  aiOffSkillMessage: 'AI jest wyłączona. Włączyć AI i zaimportować umiejętność?',
  aiOnAndImport: 'Włącz AI i zaimportuj',
  fileOnlyDetail:
    'Tylko utwórz plik: edytor pozostaje wyłączony, a nowy plik zostanie pokazany w folderze.',
  entranceDetail: 'Ta funkcja wymaga włączenia: {item}.',
  genAiOffConvert: 'AI jest wyłączona: dostępne są tylko konwersje bez AI.',
  genAiOffNoConversion:
    'AI jest wyłączona. Dodaj jeden plik mapy myśli lub Markdown, aby przekonwertować go bez AI.',
} satisfies Record<keyof typeof zh, string>
