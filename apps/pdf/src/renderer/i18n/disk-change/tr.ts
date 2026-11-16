import type { zh } from './zh'

export const tr = {
  diskChanged: 'Bu dosya değiştirildi. Yeniden yüklensin mi?',
  diskChangedUnsaved:
    'Bu dosya değiştirildi. Yeniden yüklemek kaydedilmemiş düzenlemelerinizi atar.',
  diskMissing: 'Bu dosya silindi veya yeniden adlandırıldı. Ekrandaki içerik olduğu gibi kalır.',
  diskReload: 'Yeniden yükle',
  diskIgnore: 'Yok say',
  diskDismiss: 'Tamam',
  diskReloadFailed: 'Dosya yeniden yüklenemedi: {detail}',
} satisfies Record<keyof typeof zh, string>
