import type { zh } from './zh'

export const tr = {
  pageSelDelete: '{n} sayfayı sil',
  pageSelExtract: '{n} sayfayı çıkar',
  pageCut: 'Kes',
  pageCopy: 'Kopyala',
  pagePaste: 'Yapıştır',
  pagesCopied: 'Kopyalanan sayfa: {n}',
  pagesCut: 'Kesilen sayfa: {n}',
  pagesPasted: 'Yapıştırılan sayfa: {n}',
  pageClipEmpty:
    'Kopyalanmış sayfa yok. Küçük resimlerde sayfaları seçip kopyalayın, sonra yapıştırın.',
  pageClipProtected:
    'Parola korumalı bir PDF’ten sayfa kopyalanamaz veya içine sayfa yapıştırılamaz.',
} satisfies Record<keyof typeof zh, string>
