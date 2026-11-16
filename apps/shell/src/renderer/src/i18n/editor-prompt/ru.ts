import type { zh } from './zh'

export const ru = {
  item_docs: 'Редактор Word',
  item_sheets: 'Редактор Excel',
  item_slides: 'Редактор PowerPoint',
  item_pdf: 'Редактор PDF',
  item_pdfTools: 'Инструменты PDF',
  item_markdown: 'Редактор Markdown и текста',
  item_html: 'Редактор HTML',
  item_mindmap: 'Редактор интеллект-карт',
  item_diagram: 'Редактор диаграмм',
  item_hwp: 'Редактор хангыль (HWP)',
  item_epub: 'Редактор EPUB',
  offMessage: '{item}: выключено. Включить и открыть?',
  offDetailFiles: 'С его помощью откроется файлов: {count}.',
  turnOnAndOpen: 'Включить и открыть',
  fileOnly: 'Только создать файл',
  cancel: 'Отмена',
  aiOffSkillMessage: 'ИИ выключен. Включить ИИ и импортировать навык?',
  aiOnAndImport: 'Включить ИИ и импортировать',
  fileOnlyDetail:
    'Только создать файл: редактор останется выключенным, а новый файл будет показан в папке.',
  entranceDetail: 'Для этого нужно включить: {item}.',
  genAiOffConvert: 'ИИ выключен: доступны только преобразования без ИИ.',
  genAiOffNoConversion:
    'ИИ выключен. Добавьте один файл интеллект-карты или Markdown, чтобы преобразовать его без ИИ.',
} satisfies Record<keyof typeof zh, string>
