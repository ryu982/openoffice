# AI asistan paneli

Her düzenleyici AI panelini çağırabilir: bir şey seçin, bir yönerge verin, akan sonucu izleyin.

## Açma ve kullanma

- Panelin bağlı bir AI’a ihtiyacı vardır. Hiçbiri bağlı değilken hata yerine bağlantı kartlarını gösterir; bkz. [Abonelik bağlantısı](help://subscription).
- Girişler: her düzenleyicinin şeridindeki **AI düğmesi**, sağ tık menülerindeki **AI’a sor** veya işaretleme çubuğundaki AI’a sor.
- Görevi sade bir dille anlatın (bunu yeniden yaz / bu sütunu yüzdelere çevir / bu sayfayı yeniden yerleştir…) ve Enter’a basın.
- Yanıtlar **akar** biçimde görünür; AI’ın araçlara ihtiyacı olduğunda (belgeyi oku, düzenle) aracı çalıştırır ve iş bitene kadar devam eder.
- **Durdur**: geçerli turu istediğiniz an kesin.
- **Sıraya alma**: bir yanıt akarken Enter mesajınızı sıraya alır — girişin üstündeki bir şerit bunları sayar; düzenlemek, kaldırmak, yeniden sıralamak, duraklatmak veya temizlemek için açın. Tur bitince sıradaki mesaj kendini gönderir; Esc yine turu durdurur.

## Hangi AI yanıtlıyor

- Panelin altındaki model listesi kullanılan AI’ı gösterir ve başka birini seçmenizi sağlar: önce abonelikleriniz, sonra kurduğunuz anahtar sağlayıcılar.
- Bir abonelik sınırının %80’ini veya daha fazlasını kullandıysanız panelde "%85 kullanıldı · saat 15.00’te sıfırlanır" gibi bir satır belirir.
- Bir istek durdurulduysa — sınır tükendi ya da oturumun süresi doldu — panel nedenini söyler ve kendiliğinden başka bir AI’a geçmez. Diğer aboneliğiniz bağlıysa **… ile devam et** düğmesi onu önerir.

## Neler yapabilir

- **Docs**: yeniden yazma/genişletme/çevirme/özetleme, tablo ve resim ekleme, biçimlendirme ayarlama; her tur önce anlık görüntü alır.
- **Sheets**: formüller, veri doldurma, toplu dönüşümler, biçimlendirme.
- **Slides**: tüm sunum üretimi, yerleşim ayarı, metin yeniden yazımı.
- **PDF**: seçili metne veya sayfalara göre soru-cevap ve özetler.
- **Markdown / HTML**: yeniden yazma, genişletme, çeviri.
- **Giriş ▸ AI’a sor** yıldızlı dosyalarınızdan yanıtlar ve onları kaynak olarak gösterir — bilgi tabanı panelinin Giriş ekranında kendi bölümü vardır ve Docs AI paneli aynı beceriyi taşır.

## Açık belgeleri ekleme

Docs, Sheets, Slides, Hangul, HTML ve zihin haritası düzenleyicilerinin AI panelinde GenOffice’te açtığınız veya yakın zamanda açtığınız diğer belgeleri malzeme olarak ekleyebilirsiniz. Eklenen belge, bilgisayarınızdan seçilen bir dosyayla tamamen aynı şekilde ele alınır.

- **Girişte `@`**: girişin başında veya bir boşluktan sonra `@` yazın, belge listesi açılır. Pencere bölünmüşse önce diğer bölmedeki belge, sonra diğer açık belgeler ve son kullanılanlar gelir; bulunduğunuz belge listeye girmez. Adının birkaç harfiyle daraltın (boşluklar sorun değil) ve Enter ya da tıklamayla seçin: `@belge adı` girişe yazılır ve belge eklenir. Alttaki **Daha fazla bul…** aşağıdaki belge seçiciyi açar.
- **GenOffice belgelerinden ekle**: ekle düğmesinin yanındaki bu düğme aynı listeyi bir pencerede açar; orada birkaç belgeyi işaretleyip hepsini birden ekleyebilirsiniz.
- Kaydedilmemiş değişiklikleri olan belgeler ve hiç kaydedilmemiş yeni belgeler soluk görünür, seçilemez. Kaydedin ve yeniden seçin — AI kaydedilmiş dosyayı okur.
- İki belge aynı adı taşıyıp farklı klasörlerdeyse hemen üstündeki klasörün adı eklenir, örneğin `@plan.docx(2. dönem)`, ve o klasör adı AI’a da verilir.
- PDF ve Markdown düzenleyicilerinde henüz ek yoktur, bu yüzden orada iki yol da kullanılamaz.

## Projeler

- Bir proje (bilgisayarınızdaki bir klasör) seçmek için girişin altında, soldaki proje adına tıklayın. AI bundan sonra o klasörün dosyalarını, yönergelerini ve belleğini bilerek yanıtlar ve sohbet klasörde tutulur; böylece başka bir düzenleyicide devam edebilirsiniz. Bkz. [Projeler](help://projects).
- Bir proje seçiliyken geçerli sohbetin başlığı panelin üstünde görünür. Bu projenin sohbet listesi ve **Yeni sohbet** için ona tıklayın.
- Girişteki `@` listesi açık belgelerden sonra "Bu projedeki dosyalar" gösterir.
- Proje seçiliyken yapılan bir istek, o projenin yönergelerini (klasörün en üstündeki `AGENTS.md` ve `CLAUDE.md` ile birlikte; bunları projenin sayfasından kapatabilirsiniz), belleğini ve dosya adları listesini, AI klasörde arama yaptığında bulduğu her dosyadan kısa bir alıntıyı ve AI’ın okuduğu her dosyanın metnini de kullandığınız AI’a gönderir.

## Geri alma ve güvenlik

- AI’ın belgeyi değiştirdiği bir turda yanıtın altında **Belgede yapılan değişiklikler: N** kartı çıkar ve değişen yerler belgede sarıyla işaretlenir. İşaretler yalnızca ekranda görünür — asla kaydedilmez, yazdırılmaz ya da dışa aktarılmaz — ve bir sonraki isteği gönderdiğinizde ya da **İşaretleri gizle** düğmesine bastığınızda kaybolur. **Bu değişiklikleri geri al** turun tamamını tek seferde geri alır. Docs, Markdown, HTML, Slides, zihin haritası ve diyagramda daha önceki bir turu geri almak, ondan sonraki turları da geri alır; Hangul, Sheets, PDF ve EPUB’de yalnızca son tur geri alınabilir, o da ancak ondan sonra belge düzenlenmediyse. Geri alınamadığında düzenleyicinin kendi Geri al komutunu (Ctrl+Z) kullanın.
- AI düzenlemeleri elle yapılanlarla aynı düzenleme hattından geçer (geri alınabilir, kaydetme onayına bağlı) — hiçbir şey kaydetme onayınızı atlamaz.

## Bir seçimi AI’dan gizleme

- Slides, HTML ve Markdown’da bir seçim modelin gözünden uzak tutulabilir: üzerine sağ tıklayın ▸ **Seçimi AI’dan gizle**, yer tutucuyu adlandırın ve model onun yerine `{{ad}}` okur. (Markdown öğeyi şeridindeki gözü kapalı anahtarla etkinleştirir; HTML’in öğesi kaynak panelindedir.)
- Dosya gerçek metni korur — kaydetme, dışa aktarma ve yazdırma etkilenmez, işaret yeniden açılışta da kalır. Aynı öğe gizliliği kaldırır (Markdown ayrı bir **Seçimi yeniden AI’a göster** girdisi alır).
- HTML öğe içeriklerini, öznitelik değerlerini ve betik dize sabitlerini gizler; işlenmiş sayfa hiç değişmez.
- Slides ayrıca resimlerin, videoların ve seslerin tamamını gizler ve gizli içerik barındıran bir slayt hiçbir zaman ekran görüntüsü olarak gönderilmez: otomatik yerleşim denetimi o sayfayı atlar ve bunu söyler.
- Bu yalnızca uygulama içindeki AI içindir — CLI, MCP araçları ve penceresiz dışa aktarma dosyayı doğrudan okur ve metni yine görür.

## Gizlilik

- Yönergeler ve ilgili belge içeriği **kullandığınız AI’a** gider: abonelik kullanıyorsanız kendi hesabınız altında Anthropic veya OpenAI’a, ya da anahtarını girdiğiniz sağlayıcıya. Bağlı AI yoksa hiçbir şey gönderilmez.
- Bir aboneliğin içeriğinin AI eğitimi için kullanılıp kullanılmayacağına o şirketteki kendi hesap ayarlarınız karar verir.
- Yerel dosyalar başka hiçbir yere yüklenmez; API anahtarları bu makinede uygulamanın ayar dosyasında saklanır ve yalnızca istek başlıklarında gönderilir.
