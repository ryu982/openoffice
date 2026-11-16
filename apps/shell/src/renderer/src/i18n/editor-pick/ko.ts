import type { zh } from './zh'

export const ko = {
  pickTitle: '쓸 편집기 고르기',
  pickBody:
    '쓰지 않는 편집기와 AI를 끄면 화면에서 빠집니다. 설정 → 편집기와 AI에서 언제든지 바꿀 수 있습니다.',
  pickOneTimeTitle: '쓸 편집기와 AI를 고르세요',
  pickOneTimeBody:
    '이제 쓰지 않는 편집기와 AI를 끌 수 있습니다. 끈 것은 화면에서 빠지고, 열려 있는 문서는 닫히지 않습니다. 나중에 설정 → 편집기와 AI에서 바꿀 수 있습니다.',
  pickSave: '저장',
  pickClose: '닫기',
  pickEditorsLabel: '편집기',
  pickAiName: 'AI 기능',
  pickAiHint: 'AI 창과 AI 단추, AI 연결 안내',
  pickLastEditor: '편집기는 하나 이상 켜 두어야 합니다.',
  pickOpenDocs: '열린 문서 있음',
  pickDoneAiOff: 'AI를 껐습니다. 설정 → 편집기와 AI에서 언제든지 다시 켤 수 있습니다.',
  settingsTabName: '편집기와 AI',
  itemDocs: '워드',
  itemSheets: '엑셀',
  itemSlides: '파워포인트',
  itemPdf: 'PDF',
  itemPdfTools: 'PDF 도구',
  itemPdfToolsHint: '합치기·나누기·용량 줄이기 같은 PDF 작업',
  itemMarkdown: '마크다운·텍스트',
  itemHtml: 'HTML',
  itemMindmap: '마인드맵',
  itemDiagram: '다이어그램',
  itemHwp: '한글',
  itemEpub: '전자책(EPUB)',
} satisfies Record<keyof typeof zh, string>
