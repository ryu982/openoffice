import type { zh } from './zh'

export const id = {
  pickTitle: 'Pilih editor yang Anda pakai',
  pickBody:
    'Matikan editor dan AI yang tidak Anda pakai, maka semuanya hilang dari layar. Anda dapat mengubahnya kapan saja di Pengaturan → Editor dan AI.',
  pickOneTimeTitle: 'Pilih editor dan AI yang Anda pakai',
  pickOneTimeBody:
    'Sekarang Anda dapat mematikan editor dan AI yang tidak Anda pakai. Yang dimatikan hilang dari layar; dokumen yang sedang terbuka tetap terbuka. Anda dapat mengubahnya nanti di Pengaturan → Editor dan AI.',
  pickSave: 'Simpan',
  pickClose: 'Tutup',
  pickEditorsLabel: 'Editor',
  pickAiName: 'Fitur AI',
  pickAiHint: 'Panel AI, tombol AI, dan petunjuk menghubungkan AI',
  pickLastEditor: 'Setidaknya satu editor harus tetap aktif.',
  pickOpenDocs: 'Ada dokumen terbuka',
  pickDoneAiOff:
    'AI dimatikan. Anda dapat menyalakannya lagi kapan saja di Pengaturan → Editor dan AI.',
  settingsTabName: 'Editor dan AI',
  itemDocs: 'Word',
  itemSheets: 'Excel',
  itemSlides: 'PowerPoint',
  itemPdf: 'PDF',
  itemPdfTools: 'Alat PDF',
  itemPdfToolsHint: 'Pekerjaan PDF seperti menggabungkan, memisahkan, dan mengompres',
  itemMarkdown: 'Markdown dan teks',
  itemHtml: 'HTML',
  itemMindmap: 'Peta pikiran',
  itemDiagram: 'Diagram',
  itemHwp: 'HWP (Hangul)',
  itemEpub: 'Buku elektronik (EPUB)',
} satisfies Record<keyof typeof zh, string>
