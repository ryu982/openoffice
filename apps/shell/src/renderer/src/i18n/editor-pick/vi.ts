import type { zh } from './zh'

export const vi = {
  pickTitle: 'Chọn trình soạn thảo bạn dùng',
  pickBody:
    'Tắt các trình soạn thảo và AI bạn không dùng, chúng sẽ biến khỏi màn hình. Bạn có thể đổi bất cứ lúc nào trong Cài đặt → Trình soạn thảo và AI.',
  pickOneTimeTitle: 'Chọn trình soạn thảo và AI',
  pickOneTimeBody:
    'Giờ bạn có thể tắt các trình soạn thảo và AI không dùng. Những gì bạn tắt sẽ biến khỏi màn hình; tài liệu đang mở vẫn mở. Bạn có thể đổi sau trong Cài đặt → Trình soạn thảo và AI.',
  pickSave: 'Lưu',
  pickClose: 'Đóng',
  pickEditorsLabel: 'Trình soạn thảo',
  pickAiName: 'Tính năng AI',
  pickAiHint: 'Bảng AI, nút AI và hướng dẫn kết nối AI',
  pickLastEditor: 'Phải bật ít nhất một trình soạn thảo.',
  pickOpenDocs: 'Có tài liệu đang mở',
  pickDoneAiOff:
    'AI đã tắt. Bạn có thể bật lại bất cứ lúc nào trong Cài đặt → Trình soạn thảo và AI.',
  settingsTabName: 'Trình soạn thảo và AI',
  itemDocs: 'Word',
  itemSheets: 'Excel',
  itemSlides: 'PowerPoint',
  itemPdf: 'PDF',
  itemPdfTools: 'Công cụ PDF',
  itemPdfToolsHint: 'Thao tác PDF như gộp, tách và nén',
  itemMarkdown: 'Markdown và văn bản',
  itemHtml: 'HTML',
  itemMindmap: 'Sơ đồ tư duy',
  itemDiagram: 'Sơ đồ',
  itemHwp: 'HWP (Hangul)',
  itemEpub: 'Sách điện tử (EPUB)',
} satisfies Record<keyof typeof zh, string>
