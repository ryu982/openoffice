# Markdown düzenleyici

Markdown düzenleyici .md / .markdown dosyalarını, ayrıca .txt / .json dosyalarını doğrudan kaynak görünümünde açar ve kaynak ile işlenmiş önizlemeyi bir arada sunar.

- **Açma**: Giriş ekranından veya Dosya ▸ Aç ile; CLI de çalışır.
- **Düzenleme**: düz metin düzenlemesi; GFM uzantıları (tablolar, görev listeleri, üstü çizili metin, otomatik bağlantılar) önizlemede işlenir.
- **Önizleme**: canlı; görseller gibi göreli varlıklar belgenin yanında çözümlenir.
- **Kaydetme**: bayt düzeyinde birebir — BOM, CRLF ve dosya sonundaki yeni satırın varlığı korunur; değişiklik yapılmamış bir kaydetme dosyayı yeniden yazmaz.
- **Bul ve değiştir**: Ctrl+F kaynakta arar; Tümünü değiştir dosyaya geri yazar.
- **AI**: hazır düğmeler asistanın belgeyi yeniden yazmasına, genişletmesine veya çevirmesine olanak tanır. Bir seçim AI’dan gizlenebilir (bkz. AI paneli bölümü).
- **Bağlantıları açma**: düzenlerken bir bağlantıya Ctrl+tıklayın (Mac’te ⌘), tarayıcınızda açılır; düz tıklama imleci bağlantı metnine koyar, böylece metni düzenleyebilirsiniz. Sunum modunda (F5) düz tıklama bağlantıyı açar.

## Araç çubuğu

Düzenleyicinin üstünde tek satır düğme (ipuçları için üzerine gelin):

- **Dosya ve geçmiş**: Kaydet, Farklı kaydet, Geri al, Yinele, Bul; sağdaki **Otomatik kaydet** anahtarı değişiklikleri belirli aralıklarla diske yazar.
- **AI düğmesi**: AI panelini açar; yanında yeniden yazma / genişletme / çeviri hazır ayarları bulunur.
- **Paragraf stili** (açılır liste): gövde metni ile başlık düzeyleri arasında geçiş yapın.
- **Satır içi biçimlendirme**: **kalın**, _italik_, ~~üstü çizili~~, `satır içi kod`, bağlantı.
- **Listeler**: madde işaretli, numaralı, görev listesi.
- **Ekle**: tablo, görsel, yatay çizgi.
- **Özellikler**: dosyanın başındaki YAML ön bilgi bloğunu ekleyin veya oraya gidin.
- **Anahat**: başlık hiyerarşisine göre gidin.
- **Yazım denetimi**: bu belge için yazım denetimini açıp kapatın.
- **Görsel sunucusu ayarları**: yapıştırılan ve sürüklenen resimleri önce kendi depolamanıza gönderin — S3 uyumlu (R2/OSS/COS/MinIO), SM.MS veya GitHub — yerel varlık kopyası yedek olarak kalır.

Üç kısa örnek:

- **Başlık**: imleci satıra koyun ▸ paragraf stili açılır listesinden "Başlık 1"i seçin.
- **Tablo**: **Tablo ekle** düğmesine tıklayın ▸ satır/sütun sayısını sürükleyin ▸ hücrelere yazın; önizleme tabloyu hemen işler.
- **Görev listesi**: birkaç satır seçin ▸ **Görev listesi** düğmesine tıklayın ▸ her satır `- [ ]` olur ve önizlemede onay kutuları olarak görünür.

## Dışa aktarma

Dosya menüsünde, hepsi yerel çalışır ve hepsi sonucu nereye koyacağınızı sorar:

- **Word olarak dışa aktar…** ve **PDF olarak dışa aktar…** gerçek bir .docx veya .pdf yazar.
- **ODT olarak dışa aktar…** bir .odt (OpenDocument metni) dosyası yazar; Word dışa aktarmasıyla aynı dönüşümü kullanır ve yolda bir şey değişir veya düşerse önce listeyi görüp onaylarsınız.
- **HWP belgesi olarak dışa aktar…** aynı dönüşümle bir Hangul belgesi (.hwp veya .hwpx) yazar; başlıklar, listeler ve tablolar Hangul belgesinin kendi öğeleri olarak gelir ve uzun bir tablo sonraki sayfada devam eder. Aktarılamayan bir şey varsa önce listeyi görür ve onaylarsınız.
- **Görsel olarak dışa aktar…** her içerik öğesi için seçtiğiniz klasöre bir PNG yazar.
- **Dönüştür ve Docs’ta aç** belgeyi .docx’e çevirir ve uygulamanın içindeki yerleşik Docs sekmesinde açar — buluttaki bir yere devredilmez ve dönüştürülen kopya, yaklaşık bir hafta sonra temizlenen bir önbellek klasöründe durur.

## Kaynak görünümü

Şeritte, uygulamanın diline çevrilen bir **Kaynak** anahtarı vardır. Açtığınızda düzenleyicinin yerini ham Markdown alır: bir kaydetmenin yazdığı metnin aynısı; süslenmiş ya da arka planda normalleştirilmiş bir hali değil.

- **Klavye**: Ctrl+E (Mac’te ⌘E) kaynak görünümü ile işlenmiş düzenleme tuvali arasında geçiş yapar. Tam ekran okumak için F5’e basın.
- **Düzenleme bayt düzeyinde birebirdir.** Kaynak görünümünden yapılan kaydetme, düzenleyiciden yapılanla aynı baytları üretir — BOM, CRLF ve dosya sonundaki yeni satırın varlığı korunur.
- **Aynı belgedir.** Serbestçe ileri geri geçin; kaynak, birleştirilmesi gereken bir kopya değil düzenleyicinin kendi metnidir.
- **Biçimlendirme araç çubuğu kullanılamaz**, çünkü o düğmelerin çoğu yalnızca işlenmiş tarafta anlam taşıyan düzenleyici yapıları ekler. Görünümü kapattığınızda geri gelir.
- **.txt ve .json** burada doğrudan kaynak görünümünde açılır: işlenecek bir şey yoktur, yani kaynak _belgenin kendisidir_.
