# Ayarlar, dil, tema ve MCP entegrasyonları

## Ayarları açma

Giriş ekranının sol altındaki satır ayarlar panelini açar (altındaki satır bir AI'nin bağlı olup olmadığını gösterir). Beş bölümü vardır: Hesap, AI, Genel, Entegrasyonlar ve Hakkında.

Ayarları herhangi bir sekmeden **⌘,** ile de açabilirsiniz (Windows ve Linux’ta Ctrl+,). Mac’te menü çubuğunun solundaki uygulama adlı menüden **Ayarlar…**, Windows ve Linux’ta **Menü (☰) ▸ Ayarlar…** ile de açılır. Word sekmesinde ⌘, (Ctrl+,) alt simge olduğundan orada menüyü kullanın.

**Hesap**, Claude, ChatGPT ve Codex bağlantılarınızın durumunu gösterir; **Bağlantıları yönet** AI bölümüne götürür. AI’ın kendi makaleleri var: [Abonelik bağlantısı](help://subscription) ve [AI modelleri ve ayarlar](help://ai-models).

## Dil

- Ayarlar **22 arayüz dili** sunar: İngilizce, Basitleştirilmiş Çince, Japonca, Korece, Fransızca, Almanca, İspanyolca, Tayca, Endonezce, Rusça, Arapça, Portekizce, İtalyanca, Lehçe, Çekçe, Felemenkçe, Malayca, İbranice, Hintçe, Geleneksel Çince, Vietnamca, Türkçe.
- Dili değiştirmek hemen uygulanır ve kalıcı olur; yerel menü çubuğu da dille birlikte yeniden kurulur.

## Tema

Açık / Koyu / Sistem. Sistem, işletim sisteminin görünümünü izler ve düzenleyiciler titremeden eşzamanlı olarak yeni görünüme geçer.

## Genel

- **AI kenar çubuğu konumu** (sol veya sağ), **AI paneli yazı boyutu** ve **AI sohbetinde yazım denetimi**.
- **AI paneli** — Kapalı, Daraltılmış veya Son durum.
- **Tüm belgeleri otomatik kaydet**, her düzenleyicide otomatik kaydetmeyi varsayılan olarak açar; yine de tek bir pencere için kapatabilirsiniz.
- **Kayıt konumu** ve bir **Değiştir** düğmesi, ayrıca `.docx` / `.xlsx` / `.pptx` dosyalarını GenOffice’e bağlamak için **Office belgeleri için varsayılan uygulama**.
- **Yeni HWP belgeleri için kaydetme biçimi**, yeni bir belgeyi ilk kaydettiğinizde önce HWP’nin mi HWPX’in mi sunulacağını seçer. Açtığınız belgeler kendi biçimlerini korur.
- **AI slayt yazı tipleri**, isteğiniz yazı tipi belirtmediğinde AI’ın yeni bir sunum için kullandığı yazı tiplerini ayarlar. Otomatik, Tırnaksız, Tırnaklı veya Tırnaklı başlıklar’ı seçin ve tırnaksız ile tırnaklı yazı tipini ayrı ayrı değiştirin. Seçtiğiniz bir tasarım şablonu kendi yazı tiplerini kullanır ve bir sunuma başka yazı tipleriyle eklenen sayfalar o sunumu izler.

GenOffice kullanım istatistiği toplamaz veya göndermez, bu yüzden bunun için bir anahtar yoktur.

## Düzenleyiciler ve AI

Burada hangi düzenleyicileri kullandığınızı ve AI kullanıp kullanmayacağınızı seçersiniz. Aynı liste iki yerde daha birer kez çıkar: ilk açılıştaki karşılama ekranlarının **Kullanacağınız düzenleyicileri seçin** adımında ve bu ayar gelmeden önce de GenOffice kullananlara Giriş ekranında bir kez gösterilen pencerede. Başta her şey açıktır; hiçbir şeye dokunmazsanız hiçbir şey değişmez. Yaptığınız değişiklik açık tüm pencerelerde hemen geçerli olur.

- **Düzenleyiciler**: Word, Excel, PowerPoint, PDF, PDF araçları, Markdown ve metin, HTML, Zihin haritası, Diyagram, HWP (Hangıl) ve E-kitap (EPUB). PDF araçları, PDF düzenleyicisinden ayrı açılıp kapatılır. En az bir düzenleyici açık kalmalıdır.
- **Kapattığınız düzenleyici** yeni belge listelerinden çıkar: Giriş ekranındaki kartlar, sekme çubuğunun **+** menüsü, Dosya ▸ Yeni ve varsayılan uygulama listesi. Zaten açık olan belgeler açık kalır, kurtarma kopyaları da korunur.
- **Kapalı bir düzenleyicinin dosyasını açtığınızda** (çift tıklama, sürükleyip bırakma, Dosya ▸ Aç, son dosyalar) **Etkinleştir ve aç** ile **İptal** arasında seçim yapmanız istenir. Onun birden çok dosyasını aynı anda açarsanız yalnızca bir kez sorulur.
- **Sonucunu kapalı bir düzenleyicide açacak diğer özellikler**, örneğin bir PDF'yi o biçime dönüştürmek, başlamadan önce sorar: **Etkinleştir ve aç**, **Yalnızca dosyayı oluştur** (dosya oluşturulur ve klasöründe gösterilir, düzenleyici kapalı kalır) ya da **İptal**.
- **AI özellikleri kapalıyken** AI panelleri, AI düğmeleri ve menüleri, Giriş ekranındaki soru paneli, ajan penceresi ve AI bağlama uyarıları kaybolur; Hesap, AI ve Beceriler sekmeleri de ayarlardan çıkar. GenOffice ekranlarından hiçbir AI programını başlatmaz. Oturum açma bilgileri, anahtarlar, beceriler ve ayarlar korunur ve AI'ı yeniden açtığınızda geri gelir. Hâlâ çalışan bir AI işi varsa önce **Durdur ve kapat** isteyip istemediğiniz sorulur.
- Komut satırı, MCP ve bu kılavuz, düzenleyiciler ya da AI açık olsun kapalı olsun aynı şekilde çalışır.

AI açıkken bile AI, kapalı bir düzenleyici için yeni belge oluşturmaz; o düzenleyiciyi burada açmanızı söyler.

## AI ▸ Gelişmiş

Siz açana kadar kapalıdır; çoğu kişi hiç ihtiyaç duymaz. **AI Modeli** sekmesi sohbet için API anahtarlarını ve kendi çalıştırdığınız sunucuları barındırır. **AI Medya ve Arama** sekmesinde her yetenek onu sunan sağlayıcıyı seçer; bir sağlayıcının anahtarı ve temel URL’si bir kez girilir ve paylaşılır:

- **Web araması**, **Görsel oluşturma**, **Görsel analizi** ve **Video analizi**; her biri bir sağlayıcı, bir model, bir anahtar ve bir temel URL ile.
- **Yerel dosya araması** bu makinede çalışır. Altındaki **Jev arama yeniden sıralaması** varsayılan olarak **kapalıdır**. Açtığınızda en iyi 20 yerel isabetin özetleri — her belgeden en fazla 1.200 karakter, ayrıca dosya ve klasör adları — seçtiğiniz karar uç noktasına (OpenRouter üzerinden Jev veya TypeSafe, Perplexity, Liquid AI d1, Cloudflare, yerel bir motor ya da özel bir URL) gidip ilgililik sırasına göre yeniden dizilir. Kapalıyken cihazdan hiçbir şey çıkmaz.
- **Otomatik istekler abonelik kullanabilsin** varsayılan olarak **kapalıdır**. Komut satırından veya bağlı bir kodlama ajanından gelen bir isteğin Claude ya da Codex aboneliğinizi kullanıp kullanamayacağını belirler; bkz. [Bir kodlama ajanı bağlama](help://mcp).

## Hakkında

- **Sürüm**, projenin GitHub adresi ve bu uygulamanın temel aldığı açık kaynak projeyi adlandıran bir satır.
- **Güncelleme kanalı**: Kararlı veya Beta. Değiştirmek hemen etkili olur ve bir güncelleme denetler; Beta kurulumunu Kararlı’ya geri düşürmez.

## Varsayılan uygulama bağlantıları

Ayarlar, GenOffice’i `.docx` / `.xlsx` / `.pptx` / `.pdf` ve benzerleri için işleyici olarak kaydedebilir (platform düzeyinde varsayılan uygulama kaydı; istendiğinde onaylayın).

## Üçüncü taraf bildirimleri ve güncellemeler

- Yardım ▸ Üçüncü taraf bildirimleri: uygulamayla birlikte gelen tam açık kaynak lisans envanteri.
- Menü (☰) ▸ Güncellemeleri denetle (Mac’te Yardım ▸ Güncellemeleri denetle): elle bir denetim başlatır; daha yeni bir sürüm varsa kurmayı önerir. Mac’te bu komut uygulama menüsünde, GenOffice hakkında öğesinin hemen altında da bulunur.

## MCP entegrasyonu (ileri düzey kullanıcılar / AI istemcileri için)

**Entegrasyonlar**, GenOffice’i bir kodlama ajanına bağlayan bölmedir ve kendi makalesi vardır: Bir kodlama ajanı bağlama. Kısa hali — bir yol seçin (komut satırı ya da MCP), o bölümü izleyin, sonra yeni bir sohbet başlatıp sorun.

**Yerel HTTP sunucusu** altında uygulama sunucuyu kendisi çalıştırabilir — bir açma anahtarı, bir bağlantı noktası — ve **Gelişmiş** durum denetimi URL’sini ve günlük dosyasını ekler. Yalnızca localhost üzerinde dinler.

**Ayarlar ▸ Entegrasyonlar** üst kısmındaki **Bağlı hizmetler** bölümü; Google Drive, Notion, Canva, Obsidian Kasası, Korean Law MCP, kordoc MCP ve özel MCP sunucularını kodlama ajanı bölümünün üzerinde bir araya getirir.

## Komut satırı kısa başvurusu

| Komut               | Ne yapar                      |
| ------------------- | ----------------------------- |
| `ieumoffice <file>` | bir dosyayı açar              |
| `ieumoffice mcp`    | yerel MCP sunucusunu başlatır |
| `ieumoffice --help` | tüm komutlar ve bayraklar     |
