import type { zh } from './zh'

export const tr = {
  windowTitle: 'Ajan',
  homeCardSub: 'Claude Code veya Codex ile bir klasörde çalışın',
  intro:
    'Ajan, seçtiğiniz klasörde Claude Code veya Codex programınızı çalıştırır. Oradaki dosyaları okuyabilir, yenilerini oluşturabilir, becerilerinizi kullanabilir, betikler çalıştırabilir ve GenOffice içinde açık belgeleri değiştirebilir.',
  folderLabel: 'Proje klasörü',
  folderPick: 'Klasör seç…',
  folderNone: 'Henüz klasör seçilmedi',
  recentLabel: 'Son klasörler',
  providerLabel: 'Program',
  providerClaude: 'Claude Code',
  providerCodex: 'Codex',
  providerClaudeNote:
    'Windows’ta izin verdiğiniz komutlar yalıtım olmadan çalışır ve tüm bilgisayarınıza ve internete erişebilir.',
  providerCodexNote:
    'Komutlar Codex’in yalıtılmış alanında çalışır: yalnızca proje klasörüne yazılabilir ve internet erişimi yoktur.',
  providerBlocked:
    'Henüz kullanılamıyor: Codex’in kendi oturum açma dosyasını okuması şu an engellenemiyor.',
  connChecking: 'Bağlantı denetleniyor…',
  connUnavailable: 'Bağlı değil. Ayarlar → AI bölümünde oturum açın.',
  connMetered: 'Kabul ettiğiniz, kullanım başına ödeme yapan oturumla giriş yapıldı.',
  modeLabel: 'Ne zaman sorulsun',
  modeAskCommands: 'Her komuttan önce sor',
  modeAskCommandsDesc:
    'Proje klasöründeki dosyaları okuma ve yazma doğrudan yapılır. Bir komut veya betik çalıştırmadan önce sorulur.',
  modeAskWrites: 'Dosya yazmadan ve komut çalıştırmadan önce sor',
  modeAskWritesDesc:
    'Yalnızca okuma doğrudan yapılır. Dosya yazma ve komut çalıştırma öncesinde sorulur.',
  modeTrust: 'Bu projeye güven',
  modeTrustDesc:
    'Hiçbir şey sorulmaz. Codex yine yalıtılmış alanında kalır; Claude Code’da ise kendi denetleyici modeli her işlemi sizin yerinize denetler.',
  warningTitle: 'Başlamadan önce',
  warningCommands:
    'Ajanın çalıştırdığı komutlar dosyaları değiştirebilir ve interneti kullanabilir. Birinin size gönderdiği belgede gizli yönergeler olabilir.',
  warningRedaction:
    'AI’dan gizlediğiniz bölümler yalnızca GenOffice içinde açık belgelerde gizli kalır. Ajanın klasörden doğrudan okuduğu dosyalar olduğu gibi gönderilir.',
  warningUsage: 'Ajan birçok adımda çalışır ve AI panelinden daha fazla abonelik kotası tüketir.',
  warningAccept: 'Anladım',
  start: 'Başlat',
  starting: 'Başlatılıyor…',
  stop: 'Durdur',
  newSession: 'Yeni oturum',
  send: 'Gönder',
  inputPlaceholder: 'Ajan ne yapsın?',
  you: 'Siz',
  agent: 'Ajan',
  startedLine: '{program}, {folder} klasöründe başlatıldı',
  skillsLine: '{n} beceri kullanılabilir',
  skillsLineOne: '{n} beceri kullanılabilir',
  toolRunning: 'Sürüyor',
  toolDone: 'Tamamlandı',
  toolFailed: 'Başarısız',
  toolDenied: 'Reddedildi',
  actRead: 'Oku',
  actWrite: 'Yaz',
  actCommand: 'Çalıştır',
  actAppTool: 'Açık bir belgeyi düzenle',
  actSkill: 'Beceri kullan',
  actOther: 'Araç kullan',
  openFile: 'Aç',
  permTitle: 'Ajan şunu istiyor:',
  permCommand: 'Bu komutu çalıştır',
  permWrite: 'Bu dosyayı yaz',
  permRead: 'Proje klasörü dışındaki bir dosyayı oku',
  permOther: '“{tool}” aracını kullan',
  permReason: 'Neden: {reason}',
  permAllow: 'İzin ver',
  permDeny: 'Reddet',
  turnFailed: 'Ajan bu isteği tamamlayamadı.',
  ended: 'Oturum sona erdi.',
  errBadFolder:
    'Bu klasör kullanılamaz. Kendi çalışma klasörünüzü seçin: sürücünün tamamı, kullanıcı klasörünüz veya oturum açma ve uygulama verilerinin bulunduğu klasör olamaz.',
  errNotConnected: 'Bu program bağlı değil. Ayarlar → AI bölümünde oturum açıp yeniden deneyin.',
  errNotAccepted: 'Önce yukarıdaki notları okuyup onaylayın.',
  errUnsafeTools: 'Program, uygulamanın vermediği araçlarla başladığı için durduruldu.',
  errRateLimit: 'Abonelik kotanız tükendi. Daha sonra yeniden deneyin.',
  errSignedOut: 'Programın oturumu kapatılmış. Ayarlar → AI bölümünde oturum açın.',
  errMetered: 'Program, izin vermediğiniz kullanım başına ödeme yapan bir oturumla giriş yapmış.',
  errSandboxUnavailable:
    'Codex, komutlarını yalıtmak için kullandığı korumalı alanı bu bilgisayarda açamadığı için başlamadı. Windows’u güncelleyin veya Claude Code’u seçin.',
  errNeedsUpdate: 'Program ajan modu için çok eski. Güncelleyip yeniden deneyin.',
  errNotInstalled: 'Bu program yüklü değil.',
  errGeneric: 'Bir sorun oluştu. Yeniden deneyin.',
  errUnsupportedPath:
    'Codex, adında [ ] * veya ? bulunan bir klasör ya da dosyayla çalışamaz. Proje klasörünü yeniden adlandırın veya bu tür adlı belgeleri kapatın, sonra yeniden başlatın.',
  errProgramExited:
    'Oturum başlatılırken program kapandı. Programı güncelleyin, bir terminalde açıldığını denetleyin, sonra yeniden deneyin.',
  errProgramNoAnswer: 'Oturum başlatılırken program zamanında yanıt vermedi. Yeniden deneyin.',
  errProgramRefused:
    'Program oturum ayarlarını kabul etmedi. Programı güncelleyip yeniden deneyin.',
  errNoModel:
    'Program kullanılabilecek bir model sunmadı. Ayarlar → AI bölümünden bir model seçip yeniden deneyin.',
  errPrepareFailed: 'Uygulama oturumu hazırlayamadı. Yeniden deneyin.',
  errCode: 'Bu durum sürerse geri bildirim gönderirken bu kodu ekleyin: {code}',
  documentsUnprotected:
    'Oturum başladıktan sonra açılan belgeler ({n}) programın kendi yazma korumasının dışında kalır. Bunları korumak için oturumu durdurup yeniden başlatın.',
  connOff: 'Bu uygulamada kapatıldı. Ayarlar → AI bölümünden yeniden açın.',
  errOffInApp:
    'Bu program bu uygulamada kapalı olduğu için başka bir şey gönderilmedi. Ayarlar → AI bölümünden yeniden açın.',
} satisfies Record<keyof typeof zh, string>
