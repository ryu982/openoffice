# Dosya işlemleri: yeniden adlandırma, silme, dışa aktarma

Bu bölüm her düzenleyicinin ortak kullandığı dosya işlemlerini anlatır; her düzenleyicinin kendi dışa aktarma seçenekleri kendi bölümündedir.

Bir dosya satırının üzerine geldiğinizde çıkan **⋯ menüsü** bu işlemleri bir araya toplar:

![Dosya satırının ⋯ menüsü](img/file-ops.png)

## Yeniden adlandırma

İki giriş noktası, tek bir dizi denetim:

- Giriş ekranındaki satırda **⋯ ▸ Yeniden adlandır**.
- **Bir dosya sekmesine çift tıklayın** ve adı yerinde değiştirin ([Sekmeler ve pencere yönetimi](help://tabs-and-windows) bölümüne bakın).

Kurallar: uzantı kendiliğinden korunur; geçersiz karakterler, sonu noktayla biten adlar ve ayrılmış adlar (CON/NUL ve benzerleri) bir iletiyle reddedilir; aynı klasörde ad çakışması da engellenir. Diskteki gerçek dosya yeniden adlandırılır, son kullanılanlar ve yıldızlılar da bunu izler.

## Silme

- Giriş ekranında **⋯ ▸ Sil**: hangi dosyaların silineceğini sorar, sonra onları işletim sisteminin geri getirebildiği **sistem çöp kutusuna** taşır. GenOffice bunun için kendi geri alma kaydını tutmaz — kurtarma, bir bildirimin değil çöp kutusunun işidir.

## Kopyasını oluşturma

**⋯ ▸ Kopyasını oluştur** aynı klasörde <ad> kopyası oluşturur; ad çakışmalarında kendiliğinden bir sayaç eklenir. Kopya önünüze açılmak yerine **Son kullanılanlar** listesine eklenir, böylece bir tık uzağınızda olur.

## Kaydetme ve Farklı Kaydetme

- **⌘S / ctrl+S** geçerli dosyayı kaydeder; dosyası olmayan bir belge önce konum ve ad sorar.
- Çoğu düzenleyicide Farklı Kaydet penceresindeki dosya türü listesi dışa aktarma biçimlerini de (PDF, resimler, diğer belge biçimleri) sunar. Bunlardan birini seçmek yalnızca bir kopya yazar; açık belge ve sekmesi özgün dosyada kalır. Birkaç sayfalık resimler `ad-01.png`, `ad-02.png`, … olarak bölünür.
- **Docs**: Farklı Kaydet listesi .hwp ve .hwpx de sunar (Dosya ▸ HWP Belgesi Olarak Dışa Aktar… aynı işi yapar). Açıklamalar, denklemler veya metin kutuları gibi bir şey aktarılamıyorsa dosya yazılmadan önce size söylenir.
- **Farklı kaydet** yeni bir dosya yazar, özgün dosyaya dokunmaz; sonraki düzenlemeler yeni dosyaya gider.
- Her kayıt atomiktir (geçici dosya + yeniden adlandırma); yazma sırasında kapanma dosyayı bozamaz.
- Otomatik kaydetme her düzenleyicinin kendi anahtarını izler; kendi dosyası olmayan yeni bir belge ilk kaydından sonra başlar ([Hızlı başlangıç](help://getting-started) bölümüne bakın).

## PDF olarak dışa aktarma

- **Docs**: Dosya ▸ PDF olarak dışa aktar (veya şerit düğmesi), sayfa düzeni korunarak sayfalanır.
- **Slides**: dışa aktarma her sayfayı ayrı ayrı görüntüye dönüştürür; büyük sunumlarda ilerleme gösterilir.
- **Sheets**: dışa aktarma yazdırma sayfalamasını izler.
- Dışa aktarmalar gizli bir pencerede işlenir ve seçtiğiniz yere yazılır.

## Word / görüntü olarak dışa aktarma

- **PDF ▸ Word’e dönüştür**: PDF’yi .docx dosyasına çevirir (dönüştürme yerelde yapılır; karmaşık düzenler elden geldiğince aktarılır).
- **Docs** sayfaları görüntü olarak dışa aktarabilir (her sayfa için bir PNG).

## Yazdırma

Her düzenleyicide Dosya ▸ Yazdır (⌘P/ctrl+P) bir yazdırma penceresi açar. **Sayfa düzeni** bölümü Docs, PDF, Sheets, Slides ve Markdown’da alışılmış yazdırma penceresinde, HWP’de baskı önizlemesinde, HTML, zihin haritası ve diyagramda ise yeni küçük bir yazdırma penceresinde bulunur. Sayfa düzeninde hiçbir şey seçmezseniz yazdırma eskisi gibi yapılır.

- **Yerleşim**: Kâğıt başına bir sayfa, Kâğıt başına birden çok sayfa (2, 4, 6, 9 veya 16), Kitapçık (soldan veya sağdan cilt), Afiş (yatayda ve dikeyde kâğıt sayısı, bindirme, kesim çizgileri) ya da Etiketler (her etikete bir sayfa veya her etikette aynı sayfa, başlangıç etiketi, yaygın bir A4 ölçüsü ya da özel ölçü) arasından birini seçin.
- **Yalnızca tek yüzler, yalnızca çift yüzler, ters sırada yazdırma**: yüzler, yerleşim uygulandıktan sonra yazıcıdan gerçekten çıkanlara göre sayılır. Çift taraflı yazdıramayan bir yazıcıda önce ön yüzleri basıp kâğıdı çevirerek arka yüzleri basmak için kullanılır.
- **Kâğıda sığacak şekilde küçült**: yalnızca seçilen kâğıttan büyük sayfalar küçültülür; küçük sayfalar büyütülmez. Sheets ve Markdown kendi kâğıt ve ölçek alanlarını kullanır.
- **Gri tonlama ve görüntü çözünürlüğü**: Sayfa düzeni seçenekleriyle yazdırırken her sayfa yazıcıya gitmeden önce görüntüye dönüştürülür. Çözünürlük Otomatik, 150, 300 veya 600 dpi arasından seçilir.
- **Yalnızca seçim**: Docs ve Markdown yalnızca seçili metni ilk sayfadan başlayarak yeniden sayfalayıp yazdırır; Slides seçili slaytları, PDF seçili sayfaları yazdırır. Sheets seçili aralığı eskisi gibi yazdırır.
- **Yerleşim şeması ve sonuç önizlemesi**: şema, her sayfa numarasının kâğıtta nereye düştüğünü hemen gösterir; **Sonucu önizle** ise gerçekten oluşturulan sonucu gösterir. **Düzenlenmiş sonucu PDF olarak kaydet** ile aynı yerleşimi başka bir bilgisayarda ya da matbaada basabilirsiniz.
- **Sistemin yazdırma penceresi**: kitapçık için çift taraflı yazdırmayı kısa kenardan çevirme olarak seçin. Sayfa aralığını ve kâğıt başına sayfa sayısını sistem penceresinde değiştirmeden bırakın.

PDF’ler geçerli sayfa sırası ve döndürmelerle yazdırılır.

## Dosyası olmayan belgeler nerede durur

İlk kayıtta seçtiğiniz konum belgenin evidir. O ana kadar belgenin kendi dosyası yoktur: kaydedilmemiş içerik yalnızca uygulamanın veri klasöründe bir kurtarma kopyası olarak tutulur, böylece uygulama aniden kapanırsa geri gelebilir ([Sekmeler ve pencereler](help://tabs-and-windows) bölümüne bakın). Otomatik kaydetme ancak bu ilk kayıttan sonra devralır.
