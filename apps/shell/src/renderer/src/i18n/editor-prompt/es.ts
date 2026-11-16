import type { zh } from './zh'

export const es = {
  item_docs: 'Editor de Word',
  item_sheets: 'Editor de Excel',
  item_slides: 'Editor de PowerPoint',
  item_pdf: 'Editor de PDF',
  item_pdfTools: 'Herramientas PDF',
  item_markdown: 'Editor de Markdown y texto',
  item_html: 'Editor de HTML',
  item_mindmap: 'Editor de mapas mentales',
  item_diagram: 'Editor de diagramas',
  item_hwp: 'Editor de Hangul (HWP)',
  item_epub: 'Editor de EPUB',
  offMessage: '{item} está desactivado. ¿Activarlo y abrir?',
  offDetailFiles: 'Se abrirán {count} archivos con él.',
  turnOnAndOpen: 'Activar y abrir',
  fileOnly: 'Solo crear el archivo',
  cancel: 'Cancelar',
  aiOffSkillMessage: 'La IA está desactivada. ¿Activar la IA e importar la habilidad?',
  aiOnAndImport: 'Activar la IA e importar',
  fileOnlyDetail:
    'Solo crear el archivo: el editor sigue desactivado y el archivo nuevo se muestra en su carpeta.',
  entranceDetail: 'Esta función necesita que el {item} esté activado.',
  genAiOffConvert: 'La IA está desactivada: solo están disponibles las conversiones sin IA.',
  genAiOffNoConversion:
    'La IA está desactivada. Añade un solo mapa mental o archivo Markdown para convertirlo sin IA.',
} satisfies Record<keyof typeof zh, string>
