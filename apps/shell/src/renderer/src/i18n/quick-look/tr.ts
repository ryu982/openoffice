import type { zh } from './zh'

export const tr = {
  windowTitle: 'Hızlı Bakış',
  openInEditor: 'GenOffice’te aç',
  revealInFolder: 'Klasörde göster',
  close: 'Kapat',
  prevFile: 'Önceki dosya (↑)',
  nextFile: 'Sonraki dosya (↓)',
  shortcutHint: 'Boşluk / Esc kapatır · ↑↓ değiştirir · Enter açar',
  loading: 'Önizleme yükleniyor…',
  empty: 'Bu belgenin önizlenebilir metni yok.',
  encrypted: 'Parola korumalı belge. Kilidi açmak için GenOffice’te açın.',
  unsupported: 'Bu dosya biçimi doğrudan önizlenemiyor.',
  failed: 'Dosya önizlemesi okunamadı.',
  truncated: 'Bu belgenin başı gösteriliyor. Tümünü görmek için GenOffice’te açın.',
  slideLabel: 'Slayt {n}',
  sheetCount: '{n} çalışma sayfası',
  slideCount: '{n} slayt',
  lineCount: '{n} satır',
  charCount: '{n} karakter',
  tabThumbnail: 'Önizleme görseli',
  tabContent: 'Belge metni',
  setQuickLookTitle: 'Hızlı Bakış önizlemesi (Boşluk tuşu)',
  setQuickLookHint:
    'GenOffice listelerindeki herhangi bir dosyada Boşluk tuşuna basarak içeriğini sekme açmadan önizleyin.',
  setExplorerSpace: 'Windows Dosya Gezgini ve masaüstünde dosyaları Boşluk tuşuyla önizle',
  setExplorerSpaceDesc:
    'Dosya Gezgini’nde veya masaüstünde seçili bir dosyada Boşluk tuşuna basarak Hızlı Bakış penceresini açın.',
  setKeepInTray: 'Pencere kapanınca sistem tepsisinde çalışmayı sürdür',
  setKeepInTrayDesc:
    'GenOffice’i arka planda hazır tutarak ana pencere kapandıktan sonra da Dosya Gezgini’nde Boşluk tuşuyla önizlemenin çalışmasını sağlar.',
  trayOpen: 'GenOffice’i aç',
  trayQuit: 'GenOffice’ten çık',
} satisfies Record<keyof typeof zh, string>
