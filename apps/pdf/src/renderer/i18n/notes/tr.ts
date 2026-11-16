import type { zh } from './zh'

export const tr = {
  ntOpen: 'Notu aç',
  ntOpenTip: 'Bu PDF dosyasına bağlı Markdown notunu aç',
  ntInsert: 'Nota ekle',
  ntInsertTip: 'Bunu notun sonuna ekler. Not sekmesinde kaydedin',
  ntSaveFirst: 'Önce PDF dosyasını kaydedin',
  ntUnavailable: 'Notlar yalnızca GenOffice uygulaması içinde açılır',
  ntFailed: 'Not açılamadı. {reason}',
  ntInserted: 'Nota eklendi',
} satisfies Record<keyof typeof zh, string>
