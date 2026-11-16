# Sekmeler ve pencere yönetimi

Açık her dosya tek bir pencereyi paylaşır; üstteki sekme şeridi tarayıcıdaki gibi aralarında geçiş yapar.

![Sekme şeridi: Giriş ve iki belge](img/tabs.png)

## Temeller

- **Geçiş**: bir sekmeye tıklayın, **Ctrl+Tab** (sonraki) / **Ctrl+Shift+Tab** (önceki) tuşlarına basın ya da şeridin üzerinde fare tekerleğini kaydırın.
- **Kapatma**: sekmedeki × ya da ⌘W/ctrl+W. Kaydedilmemiş değişiklikler önce sorulur.
- **Yeni**: şeridin sağ ucundaki +.
- **Etkinleştirme anındadır**: bir sekmeye basıldığı anda geçiş yapılır, tıklamanın tamamlanması beklenmez.

## Yeniden adlandırma: bir sekmeyi çift tıklayın

**Herhangi bir dosya sekmesini çift tıklayın** ve başlık yerinde bir giriş alanına dönüşür: Enter onaylar, Escape iptal eder, odak kaybı onaylar; bir IME adayını onaylayan Enter, onay sanılmaz. Yeniden adlandırma, Giriş ekranındaki satır yeniden adlandırmasının güvenlik denetimlerinden (geçersiz karakterler, ad çakışmaları) geçer, dosyayı diskte yeniden adlandırır ve son kullanılanlar listesini tazeler.

## Sürükleyerek sıralama

Bir sekmeyi tutup yana sürükleyerek sıralayın; komşular canlı olarak kayar ve sıra bırakınca oturur. 4 piksellik bir ölü bölge, düz tıklamaların sekmeleri oynatmasını engeller.

## Sağ tık menüsü

Bir sekmeye sağ tıklayın: **Yeni pencerede aç** — ayrılabilecek her belge sekmesinde sunulur — ve **Kapat**, kapatılamayan sekmede gri görünür. İkisi de uygulamanın diline uyar.

## Pencereye ayırma

**Bir sekmeyi şeritten dışarı sürükleyin** (ya da Yeni pencerede aç'ı kullanın); canlı belgeyi taşıyan kendi penceresi olur. Geri sürükleyerek yeniden şeride yerleştirin. Ayrılmış pencere tam bir eşdeğerdir — orada düzenlemeye ve kaydetmeye devam edin.

## Tüm sekmeler listesi

Sekmeler taştığında, şeridin sağ ucundaki küçük sekme çubuğu simgesi tam listeyi açar (yerel bir menü, içerik alanı onu asla örtmez); ok tuşlarıyla seçin.

## Her düzenleyicinin içindeki araç çubuğu satırı

Her düzenleyici sekmesinin üstünde bir araç çubuğu satırı vardır (kesin yerleşim düzenleyiciye göre biraz değişir):

- **Kaydet** (⌘S/ctrl+S) ve **Farklı Kaydet**.
- **Geri Al / Yinele**: çok düzeyli; her düzenleyici kendi geçmişini tutar.
- **Bul** (ctrl+F): o düzenleyicinin bul panelini açar.
- **Otomatik Kaydet** anahtarı: açıkken değişiklikler zamanlayıcıyla diske yazılır; kapalıyken yalnızca elle kaydetmeler yazar (sekmedeki ve başlıktaki kaydedilmemiş işareti size hatırlatır).

## Giriş sekmesi

En soldaki Giriş sekmesi kapatılamaz; herhangi bir düzenleyiciden dönmek için ona tıklayın ya da Dosya ▸ **Giriş'e dön** komutunu kullanın.

## Bölünmüş görünüm: iki bölme

**Bir sekmeyi pencerenin sağ kenarına sürükleyin**: sekme küçük, yüzen bir kopya olarak izler, kenara yakın "Burada böl" ipucu belirir ve bıraktığınızda yan yana iki bölme elde edersiniz. Alt kenara bırakırsanız üst üste iki bölme olur. Sekmenin sağ tık menüsü de aynısını **Sağa böl** ve **Aşağı böl** ile yapar ve bir bölmede yaşayan sekmede **Bölmeyi kaldır** seçeneğini de sunar.

- Sürüklenen sekme, üzerine bıraktığınız bölmeye gider; öbür bölme bir an önce görüntülediğiniz belgeyi korur.
- Açık tek belge oysa aynı belge her iki bölmeye bir kopya olarak yerleşir, böylece başını ve sonunu birlikte görebilirsiniz. Hiç kaydedilmemiş yeni bir belge de aynı biçimde bölünür.
- Bölmeler arasındaki **ayırıcıyı** sürükleyerek paylarını değiştirin, eşit bölme için çift tıklayın ya da bir uca kadar iterek o bölmeyi kapatın; belge sekme olarak açık kalır.

## Odağı izleyen tek AI penceresi

- Yalnızca bir AI penceresi görünür. Çalıştığınız bölme kendi AI penceresini gösterir; öbür bölmeninki bir şeride katlanır ve bir bölmeye tıklamak o bölmenin AI penceresini öne getirir.
- Katlıyken o bölmenin sohbeti ve süren AI işi yaşamaya devam eder. Sohbetler belge başına tutulur.
- **Aynı belgenin iki kopyası**: bir bölmede kaydettikten sonra öbüründen kaydetmek, yazmadan önce "Bu belge başka bir yerde değişti" diye sorar. Otomatik kaydetme bunun yerine sessizce bekler.
- Normal kapanıştan sonra uygulamayı dosyasız başlatmak, son bölünmüş belge çiftini tam bırakıldığı gibi geri getirir; bir dosyayla başlatmak yalnızca o dosyayı açar. Ani kapanıştan sonra önceki sekmeler aşağıda anlatıldığı gibi geri gelir.
- Giriş, yardım ve sunum (önizleme) sekmeleri bir bölmeye giremez; bunlardan biri açıkken bölmeler o an gizlenir ve bir belge sekmesine döndüğünüzde geri gelir.

Üç ya da daha çok bölme, ayrılmış bir pencerenin içinde bölme ve iki kopyayı canlı eşitlemede tutma sonraya bırakıldı.

## Uygulama ya da bilgisayar aniden kapandığında

Bir belgede kaydedilmemiş değişiklikler varken GenOffice, uygulamanın kendi veri klasöründe yaklaşık 30 saniyede bir kurtarma kopyası tutar. Her düzenleyici bunu yapar, hiç kaydetmediğiniz yeni bir belge için de. Dosyanız siz kaydedene kadar değişmez.

- **Sekmeleriniz geri gelir**: uygulama ya da bilgisayar normal kapanmadan kapanırsa (elektrik kesintisi, çökme, uygulamanın zorla kapatılması, bilgisayarın güncelleme için kapanması veya yeniden başlaması), açık olan belge sekmeleri GenOffice'i bir sonraki açılışınızda aynı sırayla ve bölünmüş görünüm varsa onunla birlikte geri gelir. Bir dosyayı açarak başlattığınızda da böyle olur.
- **Giriş ekranında tek liste**: kaydedilmemiş içeriği kalan belgeler Giriş ekranında birlikte listelenir. Her biri için **Geri yükle** ya da **At** seçin, veya **Tümünü geri yükle** / **Tümünü at** kullanıp **Tamam** düğmesine basın. Dosyayı sonradan başka bir program ya da eşitleme hizmeti değiştirdiyse, dosya olduğu gibi kalsın diye **At** baştan seçilidir. Özgün dosya artık bulunamıyorsa geri yüklemek içeriği yeni, adsız bir belge olarak açar.
- **Sonra karar ver**: listeyi kapatmak hiçbir şeyi silmez. O belgelerden birini ilk açtığınızda adını taşıyan bir kutu yeniden sorar; Esc'ye basmak ya da kutuyu kapatmak onu geri yükler. Geri yüklenen içeriğe ihtiyacınız yoksa belgeyi **Kaydetme** ile kapatın.
- **Sekmeler açtığınızda yüklenir**: geri yüklenen sekmeler başlıklarını hemen gösterir, ama her belge ancak sekmesine ilk tıkladığınızda yüklenir. Her şeyi bir anda açmak, belleği dar bir bilgisayarı yeniden kapatabilir.
- **Bilgisayar kapanırken**: belgeler kaydedilmemişse GenOffice kaydetmek isteyip istemediğinizi sormaz. Kopyaları tutar, kapanır ve bir sonraki açılışta onları önerir.
- **Kopyası olmayan belgeler**: parola korumalı Excel, HWP ve PDF dosyaları kurtarma kopyası almaz, bu yüzden kaydedilmemiş değişiklikleri geri getirilemez; böyle bir belge açıldığında bir bildirim bunu bir kez söyler. Bunları sık sık kaydedin. Parola korumalı Word ve PowerPoint belgeleri aynı parolayla kilitlenmiş bir kopya alır.
- **CSV, eski .xls ve .tsv dosyaları**: elektronik tablo düzenleyicisi bunların kopyasını adsız bir çalışma kitabı olarak tutar. Geri yüklemek adsız bir çalışma kitabı açar ve ilk kaydetme özgün dosyanın klasörünü ve adını .xlsx olarak önerir.

Kopya, belgeyi kaydettiğinizde, **Kaydetme** ile kapattığınızda ya da **At** seçeneğini seçtiğinizde ve ayrıca 30 gün değişmeden kaldığında silinir. Normal kapanıştan sonra GenOffice eskisi gibi başlar ve hiçbir sekmeyi geri getirmez.

**Bu, Otomatik Kaydet değildir.** Otomatik Kaydet değişikliklerinizi dosyanın kendisine yazar ve bunu yalnızca bir kez kaydettikten sonra yapar. Kurtarma kopyası dosyanıza asla dokunmaz; yalnızca henüz kaydetmediğiniz şeyi, siz kaydedene ya da atana kadar tutar.
