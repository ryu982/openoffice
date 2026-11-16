import type { zh } from './zh'

export const ms = {
  pickTitle: 'Pilih editor yang anda gunakan',
  pickBody:
    'Matikan editor dan AI yang tidak anda gunakan, lalu ia akan hilang daripada skrin. Anda boleh menukarnya bila-bila masa di Tetapan → Editor dan AI.',
  pickOneTimeTitle: 'Pilih editor dan AI yang anda gunakan',
  pickOneTimeBody:
    'Kini anda boleh mematikan editor dan AI yang tidak anda gunakan. Yang dimatikan akan hilang daripada skrin; dokumen yang sedang dibuka tidak akan ditutup. Anda boleh menukarnya kemudian di Tetapan → Editor dan AI.',
  pickSave: 'Simpan',
  pickClose: 'Tutup',
  pickEditorsLabel: 'Editor',
  pickAiName: 'Ciri AI',
  pickAiHint: 'Panel AI, butang AI dan panduan menyambung AI',
  pickLastEditor: 'Sekurang-kurangnya satu editor mesti kekal dihidupkan.',
  pickOpenDocs: 'Dokumen sedang dibuka',
  pickDoneAiOff:
    'AI telah dimatikan. Anda boleh menghidupkannya semula bila-bila masa di Tetapan → Editor dan AI.',
  settingsTabName: 'Editor dan AI',
  itemDocs: 'Word',
  itemSheets: 'Excel',
  itemSlides: 'PowerPoint',
  itemPdf: 'PDF',
  itemPdfTools: 'Alat PDF',
  itemPdfToolsHint: 'Kerja PDF seperti menggabung, memisah dan memampatkan',
  itemMarkdown: 'Markdown dan teks',
  itemHtml: 'HTML',
  itemMindmap: 'Peta minda',
  itemDiagram: 'Rajah',
  itemHwp: 'HWP (Hangul)',
  itemEpub: 'E-buku (EPUB)',
} satisfies Record<keyof typeof zh, string>
