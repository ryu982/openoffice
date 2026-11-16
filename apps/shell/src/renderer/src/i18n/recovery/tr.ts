import type { zh } from './zh'

export const tr = {
  title: 'Kaydedilmemiş içeriği olan belgeler',
  intro:
    'Bu belgelerde henüz kaydetmediğiniz içerik var. Her biri için geri yükleme veya atma arasında seçim yapın. Atılan içerik geri getirilemez.',
  restore: 'Geri yükle',
  discard: 'At',
  restoreAll: 'Tümünü geri yükle',
  discardAll: 'Tümünü at',
  confirm: 'Tamam',
  later: 'Sonra karar ver',
  laterHint: 'Bu listeyi kapatmak hiçbir şeyi silmez; daha sonra yeniden sorulur.',
  untitledFolder: 'Yeni belge, hiç kaydedilmedi',
  lastCopy: 'Saklandığı zaman: {time}',
  changedAfter: 'Dosya daha sonra değişti',
  changedAfterNote:
    'Başka bir program veya bulut eşitlemesi değiştirmiş olabilir. Dosya olduğu gibi kalsın diye “At” seçilidir.',
  missing: 'Orijinal dosya bulunamadı',
  missingNote:
    'Geri yüklerseniz yeni, başlıksız bir belge olarak açılır. Kaydederken orijinal konum önerilir.',
  choiceLabel: '{name} için seçim',
} satisfies Record<keyof typeof zh, string>
