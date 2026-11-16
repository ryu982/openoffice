import type { zh } from './zh'

export const ko = {
  item_docs: '워드 편집기',
  item_sheets: '엑셀 편집기',
  item_slides: '파워포인트 편집기',
  item_pdf: 'PDF 편집기',
  item_pdfTools: 'PDF 도구',
  item_markdown: '마크다운·텍스트 편집기',
  item_html: 'HTML 편집기',
  item_mindmap: '마인드맵 편집기',
  item_diagram: '다이어그램 편집기',
  item_hwp: '한글 편집기',
  item_epub: '전자책(EPUB) 편집기',
  offMessage: '{item}가 꺼져 있습니다. 켜고 열까요?',
  offDetailFiles: '이 편집기로 열 파일이 {count}개 있습니다.',
  turnOnAndOpen: '켜고 열기',
  fileOnly: '파일만 만들기',
  cancel: '취소',
  aiOffSkillMessage: 'AI가 꺼져 있습니다. AI를 켜고 스킬을 가져올까요?',
  aiOnAndImport: 'AI 켜고 가져오기',
  fileOnlyDetail: '파일만 만들면 편집기는 꺼 둔 채 만든 파일을 폴더에서 보여 줍니다.',
  entranceDetail: '이 기능은 {item}를 켜야 쓸 수 있습니다.',
  genAiOffConvert: 'AI가 꺼져 있어 AI 없이 바꾸기만 할 수 있습니다.',
  genAiOffNoConversion:
    'AI가 꺼져 있습니다. 마인드맵이나 마크다운 파일 하나만 넣으면 AI 없이 바꿀 수 있습니다.',
} satisfies Record<keyof typeof zh, string>
