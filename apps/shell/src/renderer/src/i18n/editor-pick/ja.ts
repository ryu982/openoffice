import type { zh } from './zh'

export const ja = {
  pickTitle: '使うエディターを選ぶ',
  pickBody:
    '使わないエディターと AI をオフにすると、画面から消えます。「設定 → エディターと AI」でいつでも変更できます。',
  pickOneTimeTitle: '使うエディターと AI を選んでください',
  pickOneTimeBody:
    '使わないエディターと AI をオフにできるようになりました。オフにしたものは画面から消えますが、開いている文書は閉じません。あとで「設定 → エディターと AI」で変更できます。',
  pickSave: '保存',
  pickClose: '閉じる',
  pickEditorsLabel: 'エディター',
  pickAiName: 'AI 機能',
  pickAiHint: 'AI パネル、AI ボタン、AI 接続の案内',
  pickLastEditor: 'エディターは少なくとも 1 つオンにしておく必要があります。',
  pickOpenDocs: '開いている文書あり',
  pickDoneAiOff: 'AI をオフにしました。「設定 → エディターと AI」でいつでもオンに戻せます。',
  settingsTabName: 'エディターと AI',
  itemDocs: 'Word',
  itemSheets: 'Excel',
  itemSlides: 'PowerPoint',
  itemPdf: 'PDF',
  itemPdfTools: 'PDF ツール',
  itemPdfToolsHint: '結合・分割・圧縮などの PDF 作業',
  itemMarkdown: 'Markdown・テキスト',
  itemHtml: 'HTML',
  itemMindmap: 'マインドマップ',
  itemDiagram: 'ダイアグラム',
  itemHwp: 'HWP（ハングル）',
  itemEpub: '電子書籍（EPUB）',
} satisfies Record<keyof typeof zh, string>
