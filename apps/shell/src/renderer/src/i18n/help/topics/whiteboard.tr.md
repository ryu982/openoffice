# Beyaz Tahta: beyin fırtınası, çizim ve açıklama

Beyaz tahta düzenleyicisi `.whiteboard` dosyalarını bir sekmede açar. Sonsuz serbest tahtalar veya sabit sayfalar üzerinde yapışkan notlar, metin, şekiller, bağlayıcılar, tablolar, çıkartmalar, resimler, bağlantı kartları ve basınca duyarlı serbest çizimler düzenleyebilir, PDF sayfalarını arka plan olarak ekleyebilir, resim veya PDF olarak dışa aktarabilir ve yapay zeka paneliyle çalışabilirsiniz. Her şey bilgisayarınızda yerel olarak çalışır.

## Açma ve oluşturma

- Yeni bir tahta, Ana Sayfa'daki **Beyaz Tahta** kutucuğundan veya Dosya menüsündeki Yeni seçeneğinden sonsuz serbest tahta olarak başlar.
- Düzenleyici `.whiteboard` dosyalarını açma penceresinden, pencereye sürükleyip bırakarak, son dosyalardan, klasör ağacından, Hızlı Önizleme'den (Boşluk) veya Google Drive'dan açar. Windows'ta GenOffice kurulduğunda `.whiteboard` için varsayılan program olarak kaydedilir.
- Excalidraw dosyaları (`.excalidraw`, `.excalidraw.png`, `.excalidraw.svg`) yeni, adsız bir beyaz tahta olarak içe aktarılır. Özgün dosya asla üzerine yazılmaz, değişiklik yapmadan kapatıldığında kaydetme sorulmaz ve ilk kayıtta aynı klasörde `.whiteboard` önerilir. Web yerleştirmeleri gibi desteklenmeyen öğeler atlanır ve sayıları bir uyarı şeridinde gösterilir. Windows'ta `.excalidraw` yalnızca "Birlikte aç" listesinde yer alır.
- Beyaz tahta zaten açıksa, yeniden açmak ilgili sekmeyi öne getirir.

## Düzenleme ve araçlar

- Tek bir `.whiteboard` dosyası sayfa şeridinde serbest tahtalar ile sabit sayfaları (16:9 ekran, dikey ve yatay A4 veya özel PDF sayfa boyutları) bir arada barındırabilir.
- Araçlar arasında seçim, yapışkan not, zengin metin, sekiz şekil, bağlayıcılar ve oklar, basınca duyarlı kalem, fosforlu kalem ve silgi, resim, tablo, yerleşik çıkartmalar ve bağlantı kartları bulunur.
- Açık bir beyaz tahtanın üzerine `.pdf` dosyası sürükleyip bırakın veya **PDF İçe Aktar** seçeneğini kullanarak seçtiğiniz PDF sayfalarını üzerine not ve çizim yapabileceğiniz sabit arka plan sayfalarına dönüştürün. Ana Sayfa'dan veya Dosya menüsünden `.pdf` açmak yine PDF düzenleyicisini açar.
- Tahtayı tam ekran sunmak ve ok tuşlarıyla sayfalar arasında geçmek için F5'e basın veya **Sun** düğmesine tıklayın.
- Koyu temada yalnızca araç çubukları, paneller ve sayfa dışındaki arka plan koyulaşır; kağıt, yapışkan notlar, şekiller ve mürekkep özgün belge renklerini korur.

## Kaydetme, dışa aktarma ve yazdırma

- Kaydet, Farklı Kaydet, Otomatik Kaydetme, çökme kurtarma kopyaları ve bölünmüş görünüm çakışma denetimi diğer düzenleyicilerle aynıdır. Değişiklik yoksa dosya yeniden yazılmaz.
- **Tüm sayfalar** veya **Yalnızca geçerli sayfa** için PNG, SVG ya da PDF olarak dışa aktarın. Serbest tahtada dışa aktarma ve yazdırma, tüm nesneleri kenar boşluğuyla sığdırır; tahta boşsa varsayılan başlangıç alanını kullanır.
- Yazdırma (Ctrl+P) hem standart yazdırmayı hem de gelişmiş çoklu sayfa yerleşimini destekler. Dışa aktarma ve yazdırma sonuçları açık ve koyu temalarda aynıdır.

## Yapay zeka paneli

- Yapay zekadan yapışkan notları düzenlemesini, atölye veya retrospektif şablonu kurmasını, şekil, bağlayıcı, tablo ya da resim eklemesini veya tahtayı özetlemesini isteyin.
- Yapay zekaya tahtanın yapılandırılmış metin tablosu gönderilir; seçili model görüntü destekliyorsa geçerli sayfanın görüntüsü de otomatik olarak eklenir. Yalnızca metin destekleyen modeller tek başına metin tablosuyla çalışır.
- Her yapay zeka düzenleme çağrısı tek bir geri alma adımıdır (Ctrl+Z), değişen nesneleri kaydedilen dosyayı değiştirmeden yalnızca ekranda vurgular ve yanıt kartında **Bu değişiklikleri geri al** seçeneği sunar.
- `.whiteboard` dosyaları diğer düzenleyicilerin yapay zeka panellerine eklenebilir, `@` ile seçilebilir, Ana Sayfa'da aranabilir, **Bu belgeden başka belge oluştur** içinde (yapay zeka olmadan Markdown dönüştürme dahil) kullanılabilir ve [terminal komutlarıyla](help://cli) (`ieumoffice whiteboard read`, `ieumoffice whiteboard apply`, `ieumoffice create --type whiteboard`) işlenebilir.

## İnternet kullanımı ve bağlantı kartları

- Açma, düzenleme, dışa aktarma, yazdırma, Excalidraw içe aktarma ve PDF sayfası içe aktarma internete hiçbir veri göndermez.
- Bir bağlantı kartına tıklamak `http`, `https` veya `mailto` adreslerini varsayılan tarayıcınızda açar.
- GenOffice yalnızca bağlantı kartı eklerken veya düzenlerken **Başlık ve önizleme görüntüsünü getir** seçeneğini açıkça etkinleştirdiğinizde o sayfaya bir kez bağlanır ve önizleme görüntüsünü `.whiteboard` dosyasının içine kaydeder.
