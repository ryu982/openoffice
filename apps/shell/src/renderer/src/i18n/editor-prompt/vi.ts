import type { zh } from './zh'

export const vi = {
  item_docs: 'Trình soạn thảo Word',
  item_sheets: 'Trình soạn thảo Excel',
  item_slides: 'Trình soạn thảo PowerPoint',
  item_pdf: 'Trình soạn thảo PDF',
  item_pdfTools: 'Công cụ PDF',
  item_markdown: 'Trình soạn thảo Markdown và văn bản',
  item_html: 'Trình soạn thảo HTML',
  item_mindmap: 'Trình soạn thảo sơ đồ tư duy',
  item_diagram: 'Trình soạn thảo sơ đồ',
  item_hwp: 'Trình soạn thảo Hangul (HWP)',
  item_epub: 'Trình soạn thảo EPUB',
  offMessage: '{item} đang tắt. Bật lên và mở?',
  offDetailFiles: '{count} tệp sẽ mở bằng trình này.',
  turnOnAndOpen: 'Bật và mở',
  fileOnly: 'Chỉ tạo tệp',
  cancel: 'Hủy',
  aiOffSkillMessage: 'AI đang tắt. Bật AI và nhập kỹ năng?',
  aiOnAndImport: 'Bật AI và nhập',
  fileOnlyDetail: 'Chỉ tạo tệp: trình soạn thảo vẫn tắt và tệp mới được hiển thị trong thư mục.',
  entranceDetail: 'Tính năng này cần bật {item}.',
  genAiOffConvert: 'AI đang tắt: chỉ có thể dùng các chuyển đổi không cần AI.',
  genAiOffNoConversion:
    'AI đang tắt. Hãy thêm đúng một tệp sơ đồ tư duy hoặc Markdown để chuyển đổi mà không cần AI.',
} satisfies Record<keyof typeof zh, string>
