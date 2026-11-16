import type { zh } from './zh'

export const tr = {
  editUndo: 'Geri Al',
  editRedo: 'Yinele',
  editBold: 'Kalın',
  editItalic: 'İtalik',
  editReplace: 'Değiştir',
  editReplaceWith: 'Şununla değiştir',
  editReplaceOne: 'Değiştir',
  editReplaceAll: 'Tümünü değiştir',
  editReplaceDone: '{count} yer değiştirildi',
  editReplaceSkipped: 'Salt okunur bölümlerde {count} yer atlandı',
  editReplaceFailed: '{count} yer değiştirilemedi',
  editReplaceNone: 'Değiştirilecek bir şey yok',
  editReplaceNotHere: 'Bu eşleşme değiştirilemiyor',
  editAutoSave: 'Otomatik kaydet',
  editAutoSaveTip: '30 saniyede bir ve pencere odağı kaybettiğinde kaydeder',
  editUnsaved: 'Kaydedilmemiş değişiklikler',
  editLocked: 'Kitap çevrilirken düzenleme kullanılamaz',
  editRefused: 'Bu değişiklik yapılamadı',
  editHistoryFailed: 'Geri alma geçmişi artık kitapla eşleşmediği için temizlendi',
} satisfies Record<keyof typeof zh, string>
