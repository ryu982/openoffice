import type { zh } from './zh'

export const tr = {
  item_docs: 'Word düzenleyicisi',
  item_sheets: 'Excel düzenleyicisi',
  item_slides: 'PowerPoint düzenleyicisi',
  item_pdf: 'PDF düzenleyicisi',
  item_pdfTools: 'PDF araçları',
  item_markdown: 'Markdown ve metin düzenleyicisi',
  item_html: 'HTML düzenleyicisi',
  item_mindmap: 'Zihin haritası düzenleyicisi',
  item_diagram: 'Diyagram düzenleyicisi',
  item_hwp: 'Hangul (HWP) düzenleyicisi',
  item_epub: 'EPUB düzenleyicisi',
  offMessage: '{item} kapalı. Etkinleştirilip açılsın mı?',
  offDetailFiles: 'Bununla {count} dosya açılacak.',
  turnOnAndOpen: 'Etkinleştir ve aç',
  fileOnly: 'Yalnızca dosyayı oluştur',
  cancel: 'İptal',
  aiOffSkillMessage: 'AI kapalı. AI etkinleştirilip beceri içe aktarılsın mı?',
  aiOnAndImport: "AI'yı etkinleştir ve içe aktar",
  fileOnlyDetail:
    'Yalnızca dosyayı oluştur: düzenleyici kapalı kalır ve yeni dosya klasöründe gösterilir.',
  entranceDetail: 'Bu özellik için {item} açık olmalıdır.',
  genAiOffConvert: 'AI kapalı: yalnızca AI kullanmayan dönüştürmeler kullanılabilir.',
  genAiOffNoConversion:
    'AI kapalı. AI olmadan dönüştürmek için tek bir zihin haritası veya Markdown dosyası ekleyin.',
} satisfies Record<keyof typeof zh, string>
