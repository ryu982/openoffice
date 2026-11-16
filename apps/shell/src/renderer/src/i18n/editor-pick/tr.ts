import type { zh } from './zh'

export const tr = {
  pickTitle: 'Kullanacağınız düzenleyicileri seçin',
  pickBody:
    'Kullanmadığınız düzenleyicileri ve yapay zekâyı kapatın; ekrandan kalkarlar. Bunu istediğiniz zaman Ayarlar → Düzenleyiciler ve AI bölümünden değiştirebilirsiniz.',
  pickOneTimeTitle: 'Düzenleyicileri ve AI’ı seçin',
  pickOneTimeBody:
    'Artık kullanmadığınız düzenleyicileri ve AI’ı kapatabilirsiniz. Kapattıklarınız ekrandan kalkar; açık belgeler açık kalır. Bunu daha sonra Ayarlar → Düzenleyiciler ve AI bölümünden değiştirebilirsiniz.',
  pickSave: 'Kaydet',
  pickClose: 'Kapat',
  pickEditorsLabel: 'Düzenleyiciler',
  pickAiName: 'AI özellikleri',
  pickAiHint: 'AI panelleri, AI düğmeleri ve AI bağlama yönlendirmeleri',
  pickLastEditor: 'En az bir düzenleyici açık kalmalıdır.',
  pickOpenDocs: 'Açık belgeler var',
  pickDoneAiOff:
    'AI kapatıldı. İstediğiniz zaman Ayarlar → Düzenleyiciler ve AI bölümünden yeniden açabilirsiniz.',
  settingsTabName: 'Düzenleyiciler ve AI',
  itemDocs: 'Word',
  itemSheets: 'Excel',
  itemSlides: 'PowerPoint',
  itemPdf: 'PDF',
  itemPdfTools: 'PDF araçları',
  itemPdfToolsHint: 'Birleştirme, bölme ve sıkıştırma gibi PDF işleri',
  itemMarkdown: 'Markdown ve metin',
  itemHtml: 'HTML',
  itemMindmap: 'Zihin haritası',
  itemDiagram: 'Diyagram',
  itemHwp: 'HWP (Hangıl)',
  itemEpub: 'E-kitap (EPUB)',
} satisfies Record<keyof typeof zh, string>
