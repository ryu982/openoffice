# Sheets: elektronik tablolar

Sheets elektronik tablo düzenleyicisidir; hesaplama ayrı bir Rust motoru sürecinde çalışır (orada bir çökme uygulamayı asla düşürmez). .xlsx dosyalarını açar ve kaydeder; .csv ve .tsv tablo olarak açılır.

## Arayüz

- **Şerit**: sekiz sekme, aşağıda tek tek sıralanmıştır.
- **Formül çubuğu**: etkin hücrenin formülünü gösterir ve düzenler; yaygın işlevler desteklenir.
- **Sayfa sekmeleri** (alt): sayfa ekle / yeniden adlandır / sil / taşı.
- **Hücre düzenleme**: çift tıklayın ya da doğrudan yazın; Enter onaylar ve aşağı iner, Tab sağa gider, Escape iptal eder (Excel alışkanlıkları).
- **Kısayollar**: Excel ailesiyle uyumlu (ctrl+C/V/X, ctrl+Z/Y, ctrl+F, ...).

## Şerit sekmeleri

- **Giriş**: yazı tipi, dolgu, kenarlıklar, sayı biçimleri (para birimi/yüzde/binlik, ondalık artır/azalt), hizalama, birleştirme, satır/sütun ekleme ve boyutu, koşullu biçimlendirme, tablo olarak biçimlendirme, hücre stilleri, pano ve biçim boyacısı, sıralama ve filtreleme.
- **Ekle**: resimler, şekiller, metin kutuları, bağlantılar, açıklamalar, onay kutusu, üstbilgi/altbilgi, simgeler, denklemler; **dokuz grafik türü** (sütun, çubuk, çizgi, alan, pasta, dağılım, radar, halka ve sütun+çizgi bileşimi) ile seçim için türleri sıralayıp önizleyen **Önerilen Grafikler**; bulunduğunuz hücreden **Pivot Grafik**; **Mini Grafikler** (çizgi, sütun, kazanç/kayıp); bir PivotTable'ı filtrelemek için **Dilimleyici** ve **Zaman Çizelgesi**.
  - Grafikler, pivot grafikler ve mini grafikler kaydedilen çalışma kitabında gerçek nesnelerdir.
  - **Dilimleyici** ve **Zaman Çizelgesi** oturum denetimleridir: yaptıkları filtreleme kaydedilir ve Excel aynı filtrelenmiş PivotTable'ı gösterir, ama dilimleyici düğmesinin kendisi dosyanın parçası değildir.
- **Sayfa Düzeni**: tema renkleri ve yazı tipleri, kılavuz çizgilerini ve başlıkları yazdırma anahtarları, sayfa sonu önizlemesi.
- **Formüller**: AutoSum ve işlev ekleme, ad tanımlama (seçimden de), öncülleri ve bağımlıları izleme, İzleme Penceresi, sayfayı veya çalışma kitabını yeniden hesaplama.
- **Veri**: sıralama ve filtreleme (gelişmiş filtre ve filtreyi temizle dahil), metni sütunlara bölme, çalışma kitaplarını birleştirme, tümünü yenile.
- **Gözden Geçir**: açıklamalara göz atma (göster, önceki/sonraki), çeviri ve bir **Koruma** grubu — **Sayfayı Koru**, **Çalışma Kitabını Koru** ve **Düzenleme Aralıklarına İzin Ver**.
  - Koruma .xlsx içine yazılır ve bu uygulamanın uyguladığı korumada parola yoktur, bu yüzden aynı düğme **Korumayı Kaldır …** hâline gelir ve korumayı geri alır. Başka bir programın parola taşıyan koruması buradan kaldırılamaz.
  - İki koruma düğmesi hemen uygulanır — iptal edilecek bir pencere yoktur, yalnızca kaydederken yazılacağını söyleyen bir durum çubuğu notu vardır.
  - **Düzenleme Aralıklarına İzin Ver**, sayfanın geri kalanı kilitliyken düzenlenebilir kalan hücreleri işaretler.
- **Görünüm**: kılavuz çizgileri, formül çubuğu, başlıklar ve çapraz vurgulama anahtarları; yakınlaştırma; **Normal** ve **Sayfa Sonu Önizlemesi**. Kılavuz çizgileri ve başlıklar sayfayla birlikte kaydedilir; çapraz vurgulama sizin kendi tercihinizdir.
- **Grafik Tasarımı**: bir grafik seçiliyken görünür — grafik türü, stiller ve renkler, veri aralığını düzenleme.

Veri sekmesi, düğme düğme (resimde soldan sağa):

![Veri sekmesi](img/sheets-data.png)

- **Pivot tablo**: geçerli aralıktan bir pivot oluşturun; toplamak için alanları sürükleyin.
- **Yenile**: geçerli pivotun verisini yeniden hesaplayın.
- **Metinden/CSV'den**: bir .csv/.txt dosyasını yeni sayfa olarak içe aktarın, ayırıcıya göre bölün.
- **Çalışma kitaplarını birleştir**: başka .xlsx dosyalarındaki sayfaları bu dosyaya alın.
- **Tümünü yenile**: her pivotu ve dış veri kümesini yeniden hesaplayın.
- **Sırala** (açılır): artan / azalan / özel sıralama (çok sütunlu kurallar).
- **Filtre**: başlık satırına ▼ açılır listeleri ekler; tutmak istediğiniz değerleri işaretleyin.
- Yanındaki küçük yığılmış düğmeler: **Temizle** (her satırı geri getirir), **Yeniden uygula** (geçerli filtreyi tekrar çalıştırır), **Gelişmiş** (ölçüt aralığıyla filtreler).
- **Metni sütunlara böl** (açılır): bir sütunu ayırıcıya ya da sabit genişliğe göre birkaç sütuna bölün.
- **Hızlı doldurma**: bir örnek verin, sütunun geri kalanı örneğe göre dolsun (ctrl+E).
- **Yinelenenleri kaldır**: seçili sütunlara göre yinelenen satırları atın.
- **Veri doğrulama** (açılır): seçim için giriş kuralları (açılır listeler, sayı aralıkları...).
- **Birleştir**: birkaç aralığı kategoriye göre tek bir yerde toplayın.
- **Durum Çözümlemesi** (açılır): Hedef Ara — bir formül hücresi hedefe ulaşsın diye tek bir giriş hücresini çözün.
- **Grupla / Grubu kaldır** (açılır): daraltılıp genişletilebilen satır/sütun grupları.
- **Alt toplam**: kategori başına alt toplam satırları ekleyin.

Formüller sekmesi, düğme düğme:

![Formüller sekmesi](img/sheets-formulas.png)

- **İşlev ekle** (fx): bağımsız değişken sihirbazıyla işlev arayın.
- **AutoSum** (açılır): tek tıkla TOPLA, ayrıca ortalama/sayım/maks/min.
- **Son kullanılanlar / Finansal / Mantıksal / Metin / Tarih ve saat / Arama ve başvuru / Matematik ve trigonometri / Diğer**: işlevlere kategoriye göre göz atın ve ekleyin.
- **Ad yöneticisi**: adlandırılmış aralıkları görüntüleyin, oluşturun ve silin.
- **Ad tanımla** (açılır): seçimi adlandırın; **Formülde kullan** var olan bir adı ekler; **Seçimden oluştur** aralıkları başlık satırından veya sütunundan adlandırır.
- **Öncülleri izle / Bağımlıları izle**: bir formülün verisinin nereden geldiğini ve nereyi beslediğini gösteren mavi oklar; **Okları kaldır** onları temizler.
- **Formülleri göster**: hücreler sonuç yerine formülün kendisini gösterir.
- **Hata denetimi**: formül hatalarını bulun ve açıklayın.
- **İzleme penceresi**: önemsediğiniz hücreleri sabitleyin ve canlı değerlerini izleyin.
- **Hesaplama seçenekleri** (açılır): otomatik ya da elle yeniden hesaplama; elle kipte **Şimdi hesapla / Sayfayı hesapla** hesaplamayı elle tetikler.

## Sayılar ve biçimlendirme

- Sayı biçimleri: genel, sayı, para birimi, yüzde, tarih/saat, kesir, bilimsel ve daha fazlası.
- Hizalama, kaydırma, birleştirilmiş hücreler, kenarlıklar ve dolgular.
- Satır yükseklikleri ve sütun genişlikleri sürükleyerek; otomatik sığdırmak için bir sınıra çift tıklayın.

## Veri

**Sıralama ve filtreleme** (örneğin tek bir sütuna göre azalan):

1. **O sütundaki herhangi bir hücreye** tıklayın (tüm sütunu seçmeye gerek yok).
2. Giriş sekmesi ▸ **Sırala ve Filtrele** ▸ **Azalan**; tüm satırlar birlikte yeniden sıralanır (alan bir bütün olarak sıralanır).
3. Özel kurallar için (birden çok sütun, renge göre): aynı yol, **Özel Sıralama**.
4. Filtre: başlık satırını seçin ve **Sırala ve Filtrele ▸ Filtre**'ye tıklayın — her başlık, tutmak istediğiniz değerleri işaretlediğiniz bir ▼ açılır listesi alır; her şeyi geri getirmek için filtreyi temizleyin.

- Sıralama ve filtreleme.
- Sabitlenmiş bölmeler.
- .csv / .tsv: doğrudan tablo olarak açılır (sekme ayırıcılı tsv tek parça olarak ayrıştırılır); kaydetmek özgün biçimi geri yazar.

## Sağ tık menüleri

- **Izgarada**: düzenleyicinin (Univer'in) kendi menüsü — kes/kopyala/yapıştır, satır/sütun ekle ve sil, gizle, hücreleri birleştir, bölmeleri sabitle ve diğer gündelik öğeler.
- **Alttaki durum şeridinde**: durum çubuğunun hangi istatistikleri göstereceğini seçin (ortalama / sayım / toplam, ...); seçim kalıcıdır.
- **Alttaki bir sayfa sekmesinde**: sayfa ekle / yeniden adlandır / sil / renklendir / gizle (Univer'in sekme menüsü).
- Üstteki sekme şeridinin sağ tık menüsü [Sekmeler ve pencere yönetimi](help://tabs-and-windows) bölümünde anlatılır.

## AI

- Yan AI paneli: bir aralık seçin ve düz dille talimat verin (yeniden biçimlendir, veri üret, formül yaz).
- 📎 düğmesiyle bir isteme dosya ekleyin ya da panelin üzerine sürükleyin; soruyla birlikte giderler ve resimler küçük resim olarak geri döner.
- Bir yanıt bir hücreye atıfta bulunabilir — başvuruya tıklayın, ızgara oraya atlar.
- AI düzenlemeleri panelden geri alınabilir.

## Kaydetme ve dışa aktarma

- .xlsx kaydeder (formüller ve biçimler korunur); Farklı Kaydet; PDF'e dışa aktarma yazdırma sayfalamasını izler.
- Otomatik kaydetme genel kurala uyar (ilk elle kaydetmeden sonra açık).

## Kararlılık

- Rust hesaplama yardımcı süreci arayüzden süreç düzeyinde yalıtılmıştır: aşırı veri onu öldürürse bir ileti ve oturum kurtarma denemesi alırsınız — uygulama çökmesi değil.
