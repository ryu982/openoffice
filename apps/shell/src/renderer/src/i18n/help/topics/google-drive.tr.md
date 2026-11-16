# Google Drive

Seçtiğiniz Drive dosyalarını GenOffice içinde açıp düzenlemek için Google Drive’ı bağlayın. Kaydettiğinizde dosya Drive’a geri gider. GenOffice yalnızca Google’ın penceresinde seçtiğiniz dosyaları açabilir; Drive’ınızın geri kalanını görmez.

## Bağlanma

1. **Ayarlar ▸ Entegrasyonlar** bölümünü açın.
2. **Drive dosyalarını AI ile kullanmadan önce** bölümünü okuyun, Drive dosyalarıyla kullandığınız AI hesaplarında model eğitimini kapatın, sonra o öğeyi işaretleyin.
   - Claude: Claude’un **Ayarlar ▸ Gizlilik** bölümünde model eğitimini kapatın.
   - ChatGPT ve Codex: ChatGPT’nin **Ayarlar ▸ Veri kontrolleri** bölümünde **Modeli herkes için geliştir** seçeneğini kapatın.
   - API anahtarı sağlayıcıları API verilerini varsayılan olarak eğitim için kullanmaz.
   - Ücretsiz AI bağlantılarına (OpenRouter ücretsiz modelleri, Gemini) hiçbir zaman Drive dosyası verilmez.
3. **Google Drive’a bağlan** düğmesine basın. Tarayıcınızda Google’ın oturum açma sayfası açılır. Oturum açın ve erişime izin verin.
4. GenOffice’e geri dönün. Kart, bağladığınız hesabı gösterir.

Google, Drive dosyalarının onları model eğitiminde kullanan bir AI hizmetine gitmesine izin vermez; bu yüzden öğe işaretlenene kadar bağlanamaz veya dosya seçemezsiniz.

Oturum bilgisi bu bilgisayarda, işletim sisteminizin kullanıcı hesabınız için sunduğu şifrelemeyle (Windows’un kendi koruması, macOS anahtar zinciri veya Linux’ta bir masaüstü anahtarlığı) saklanır. Bu bilgisayar onu şifreleyemiyorsa bağlantı yalnızca uygulamayı kapatana kadar sürer.

## Drive dosyalarını açma

- Giriş ekranının kenar çubuğunda **Google Drive**’a, ardından **Google Drive’dan seç**’e basın.
- Tarayıcınızda Google’ın dosya seçicisi açılır. Açılacak dosyaları seçin (birkaçını birden seçebilirsiniz); GenOffice geri gelir ve onları doğru düzenleyicide açar.
- Bir kez seçtiğiniz dosyalar **Seçtiğiniz dosyalar** listesinde kalır. Onları oradan yeniden açın ya da ada ve içeriğe göre arayın.
- GenOffice’in açamadığı biçimler soluk gösterilir. Google Docs, Sheets ve Slides belgeleri Word, Excel ve PowerPoint dosyaları olarak açılır.

## Drive’a geri kaydetme

- Her zamanki gibi kaydedin. Bir an sonra dosya Drive’a yüklenir.
- Dosyayı açtıktan sonra Drive’da biri onu değiştirdiyse Drive’daki dosyanın üzerine yazmak mı, Drive’a bir kopya kaydetmek mi yoksa değişikliği yalnızca bu bilgisayarda tutmak mı istediğiniz sorulur.
- Yalnızca görüntüleyebildiğiniz bir dosya Drive’a kopya olarak kaydedilir ya da bu bilgisayarda tutulur.
- Google belgesi olduğu gibi bırakılır. Değişiklikleriniz aynı klasöre, o klasöre yazılamıyorsa Drive’ım’a bir Office dosyası olarak kaydedilir.
- Bir yükleme başarısız olursa değişiklikleriniz bu bilgisayarda kalır ve GenOffice, uygulamanın bir sonraki açılışı da dahil olmak üzere yeniden dener.

## AI ve Drive

- Word, Excel, PowerPoint, HTML, zihin haritası ve Hangul düzenleyicilerinin AI panelinde, ekleme düğmesinin yanındaki **Google Drive’dan ekle**’ye basarak tarayıcınızda Google’ın penceresinde dosya seçin ve onları bu bilgisayardaki dosyalar gibi ekleyin. Bir seferde en fazla 20 dosya.
- **AI’ın Drive’daki dosyaları bulup okumasına izin ver** açıkken (bağlandığınızda açılır) her düzenleyicideki AI, GenOffice’te seçtiğiniz Drive dosyalarında arama yapabilir ve onları okuyabilir. Örneğin: “Drive’ımda geçen ayın toplantı notlarını bul ve özetle.” Dosya bulunamazsa önce onu Giriş ekranında seçin.
- AI’ın okuduğu şeyler kullandığınız AI sağlayıcısına gider. AI’dan gizlenen bölümler gizli kalır.
- Kullanılan AI ücretsiz bir bağlantıyken Drive’dan ekleme ve AI’ın Drive okuması çalışmaz.
- AI, Drive dosyalarını değiştiremez, silemez veya paylaşamaz.
- Drive’dan okunan içerik bir sohbete girdikten sonra o sohbet web aramasını, görsel aramasını, sayfaları web adresinden okumayı ve web adresinden görsel eklemeyi kullanmayı bırakır. Bunları yeniden kullanmak için yeni bir sohbet başlatın.

## Bağlantıyı kesme

**Ayarlar ▸ Entegrasyonlar** altında **Bağlantıyı kes**’e basın. GenOffice oturum bilgisini bu bilgisayardan kaldırır ve Google’dan erişimi iptal etmesini ister. Bu bilgisayarda zaten bulunan dosya kopyaları kalır. Erişimi istediğiniz zaman Google Hesabınızdaki **Üçüncü taraf bağlantıları** altından da kaldırabilirsiniz.
