import type { zh } from './zh'

export const tr = {
  noticeText:
    'Beceriler artık Ayarlar → Beceriler bölümünden açılıp kapatılıyor. Claude ve Codex beceri klasörlerindeki beceriler kapalı başlar.',
  noticeOpenSettings: 'Ayarları aç',
  noticeClose: 'Kapat',
  nextSession: 'Değiştirilen beceriler bir sonraki oturumdan itibaren geçerli olur',
  templateLabel: 'Şablon olarak kaydedilecek belge',
  templateNone: 'Şablon yok',
  templateFromTab: 'Bir sekmede açık',
  templateFromProject: 'Proje klasörü',
  templateUnsaved: 'Bu sekmede kaydedilmemiş değişiklikler var. Kaydedilmiş dosya şablon olur.',
  templateChecking: 'Gizlenen içerik denetleniyor…',
  templateUnknown:
    'Bu biçimde uygulama, burada herhangi bir şeyin gizlenip gizlenmediğini anlayamaz, bu yüzden olduğu gibi kaydedilemez. Boş bir şablon oluşturup onu kaydedin.',
  templateTooLarge: 'Bu belge şablon olarak kaydedilemeyecek kadar büyük',
  installTitle: 'AI bu beceriyi yüklemeyi öneriyor',
  installHint:
    'İçeriğini görmek için önizlemeyi açın, sonra yükleyip yüklemeyeceğinize karar verin. Yüklenen beceri bir sonraki oturumdan itibaren kullanılabilir.',
  installOpen: 'Önizlemeyi aç',
  installDismiss: 'Kapat',
  installDismissed: 'Yüklenmedi',
  installCancel: 'İptal',
  actProposeSkill: 'Beceri öner',
} satisfies Record<keyof typeof zh, string>
