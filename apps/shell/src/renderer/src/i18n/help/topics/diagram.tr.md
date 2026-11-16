# Diyagramlar: draw.io dosyalarını çizme ve düzenleme

Diyagram düzenleyici draw.io dosyalarını bir sekmede açar. Akış şemaları, mimari diyagramlar ve başka diyagramlar çizer, onları geldikleri biçimde kaydeder, resim veya PDF olarak dışa aktarır ve AI’ın onları okumasına, değiştirmesine ve çizmesine izin verirsiniz. Düzenleyici tamamen bilgisayarınızda çalışır.

## Bir diyagramı açma

- Düzenleyici `.drawio`, `.dio`, `.drawio.svg` ve `.drawio.png` dosyalarını açar: açma penceresinden, bir dosyayı pencereye sürükleyerek, son kullanılan dosyalardan, klasör ağacından veya (`.drawio` ve `.dio` için) Google Drive listesinden. Windows’ta GenOffice kurulunca `.drawio` ve `.dio` dosyalarını açan program olur.
- Bir `.drawio.svg` veya `.drawio.png` dosyası yalnızca diyagram resmin içinde saklıysa açılır. Sıradan bir SVG veya PNG resmi diyagram olarak açılmaz. Bozuk dosyalar da açılmaz ve nedeni gösterilir.
- Bir Visio dosyası (`.vsdx`) adsız, yeni bir diyagram olarak içe aktarılır. İlk kaydetme, Visio dosyasının klasöründe bir `.drawio` dosyası önerir; Visio dosyasının kendisi değişmez. İçindeki bazı resimler dönüştürülemediyse düzenleyici kaç tane olduğunu söyler. Windows’ta `.vsdx` dosyaları yalnızca "Birlikte aç" altında sunulur.
- Yeni, boş bir diyagram Giriş ekranındaki **Diyagram** kutucuğundan veya Dosya menüsündeki Yeni’den başlar.
- Diyagram zaten açıksa sekmesi öne gelir.

## Düzenleme

- Düzenleme ekranı draw.io ekranının kendisidir: üstte menüler, solda şekiller, sağda biçim paneli ve altta sayfa sekmeleri.
- Kaydet (Ctrl+S), Farklı Kaydet (Ctrl+Shift+S) ve Yazdır (Ctrl+P) GenOffice’e gider. Sekme değiştirme ve uygulama genelindeki diğer kısayollar çalışmaya devam eder. Geri al (Ctrl+Z) dahil diğer tüm kısayollar düzenleyicinin kendisinindir.
- Düzenleyicinin menülerindeki **Yardım** (F1) bu sayfayı açar.
- Düzenleyici GenOffice’in dilini kullanır. Dili değiştirdiğinizde düzenleyici yeniden başlar: kaydedilmemiş değişiklikler kalır, ancak geri alma geçmişi kaybolur.
- Düzenleyici GenOffice’in temasını izler. Koyu temada çizim de koyu renklerle gösterilir, ancak kaydedilen dosya, PNG, PDF ve çıktılar açık temadakiyle tamamen aynıdır.

## Kaydetme

- Kaydet, Farklı Kaydet, durum satırındaki **Otomatik kaydet** ve kapatmadan önceki soru diğer düzenleyicilerdeki gibi çalışır.
- Bir diyagram açıldığı biçimde kaydedilir. Farklı Kaydet `.drawio`, `.dio`, `.drawio.svg` ve `.drawio.png` sunar. Yeni bir diyagram önce `.drawio` olarak kaydedilir.
- Hiçbir şey değişmediyse dosya yeniden yazılmaz. Dosyada sıkıştırılmış saklanan sayfalar sıkıştırılmış kalır.
- Bir `.drawio.png` dosyasının resmi ilk sayfayı gösterir; diyagramın tamamı onun içinde saklanır.
- Bir diyagramda kaydedilmemiş değişiklikler varken uygulamanın veri klasöründe bir kurtarma kopyası tutulur, böylece iş bir çökmeden sağ çıkar.

## Dışa aktarma ve yazdırma

- Dosya menüsünden PNG, SVG veya PDF dışa aktarmayı seçin (düzenleyicinin kendi menülerindeki dışa aktarma öğeleri aynı pencereyi açar). Ardından **Tüm sayfalar** (varsayılan) veya **Yalnızca geçerli sayfa** seçin.
- Tüm sayfalarla PNG ve SVG her sayfa için bir dosya verir ve adı `<ad>-p<sayfa numarası>` olur. Bir PDF’de diyagramda ayarlanan sayfa boyutunda her sayfa için bir yaprak bulunur.
- Yazdır (Ctrl+P) de her sayfa için bir yaprak yazdırır. Dışa aktarmalar ve çıktılar tema ne olursa olsun her zaman açık renkleri kullanır.

## AI paneli

- AI’dan bir akış şeması, bir sıralama diyagramı veya bir organizasyon şeması çizmesini, diyagramı açıklamasını, bir sayfayı toparlamasını ya da seçtiğiniz şekillerden sonra bir sonraki adımı eklemesini isteyin.
- AI diyagramı metin olarak okur: sayfaları ve her şekil ile bağlayıcı için kimliğini, metnini, şeklini, konumunu ve bağlantılarını, ayrıca hangi şekilleri seçtiğinizi. Diyagramı resim olarak görmez.
- AI’ın yaptığı değişiklikler hemen görünür. Her değişiklik bir geri alma adımıdır (Ctrl+Z), AI’ın değiştirdiği şekiller ve bağlayıcılar sarı çerçeveyle gösterilir ve yanıtın altındaki karttaki **Bu değişiklikleri geri al** bir AI turunun tamamını geri alır. Bir değişikliğin herhangi bir parçası reddedilirse diyagram olduğu gibi kalır.
- Yeni bir akış şeması, sıralama diyagramı veya benzeri için AI Mermaid yazar ve GenOffice bunu bilgisayarınızda şekillere dönüştürür. Yerleşim, draw.io web sitesinin yaptığından biraz farklı olabilir.
- Diyagramlar diğer düzenleyicilerin AI panelinde de eklenebilir, `@` ile seçilebilir ve Giriş ekranındaki dosya aramasıyla bulunabilir. [Terminal komutları](help://cli) da diyagramları okur, düzenler ve oluşturur (`ieumoffice diagram read`, `ieumoffice diagram apply`, `ieumoffice create --type drawio`).

## İnternet kullanımı

- Diyagram sekmesi internete hiçbir şey göndermez. Düzenleyici GenOffice ile kurulan dosyalardan çalışır; bulut depolaması, paylaşma, eklentileri ve kendi AI’ı kapalıdır.
- Bir diyagramın internetten aldığı resimler ve yazı tipleri yüklenmez; dosya açıldığında bir not bunu söyler. Bir şekildeki web veya e-posta bağlantısı yalnızca tıkladığınızda varsayılan tarayıcınızda açılır.
- Karalama defteri, eklediğiniz şekil kitaplıkları ve son renkler bu bilgisayarda, uygulamanın veri klasöründe kalır. AI paneli, diğer düzenleyicilerde olduğu gibi diyagramın metnini seçtiğiniz AI’a gönderir.

## Kullanılamayanlar

- PlantUML ekleme veya düzenleme. Bir dosyadaki PlantUML şekilleri saklanan resimleriyle gösterilir.
- ELK kullanan otomatik yerleşimler ve şekillerin etrafından dolaşan bağlayıcılar. Bu tür bağlayıcılar sıradan bağlayıcılar olarak çizilir.
- Eski Visio biçimleri (`.vsd`, `.vss`) ve `.vsdx` olarak geri kaydetme.
- Bulut depolaması, paylaşma, yayımlama, eklentiler ve düzenleyicinin kendi AI özellikleri.
- Bir diyagramın bölümlerini AI’dan gizleme.
