# HTML düzenleyici

HTML düzenleyici .html / .htm dosyalarını iki modda açar: **önizleme** (işlenmiş sayfa) ve **kaynak**.

- **Önizleme**: gerçek işleme; göreli stil sayfaları ve görseller dosyanın yanından yüklenir.
- **Önizleme denetçisi**: bir öğeyi seçmek için tıklayın, metnini yerinde düzenlemek için çift tıklayın, araç çubuğundan silin ve seçim üzerinde AI’a sorun.
- **Slaytlar**: slaytlardan oluşan bir sayfada önizlemenin solunda, sayfanın kendisi tarafından çizilen bir slayt listesi belirir; birine tıklayarak o slaytı gösterin. Önizlemeyi yeniden yükleyen bir düzenleme sizi üzerinde olduğunuz slayda geri getirir ve bir slaydın metnine yazdığınız tuşlar slaytı asla değiştirmez.
- **Kaynak modu**: HTML’i düzenleyin; Ctrl+F bulur, Tümünü değiştir yeniden yazılan işaretlemeyi kaydeder.
- **Kaydetme**: bayt düzeyinde birebir (BOM/CRLF/sondaki yeni satır korunur); değişiklik yapılmamış kaydetmeler dosyayı yeniden yazmaz.
- **Yakınlaştırma**: Ctrl+tekerlek / iki parmakla önizlemeyi ölçekleyin; önizleme içinde Ctrl+Z son düzenlemeyi geri alır.
- **AI’dan gizleme**: kaynak modunda bir seçime sağ tıklayın — öğe içerikleri, öznitelik değerleri, betik dizeleri — model bunların yerine bir yer tutucu görür; işlenmiş sayfa hiç değişmez (ayrıntılar AI paneli bölümünde).

## Araç çubuğu

Önizlemede herhangi bir öğeye tıklayın, üzerinde bir araç çubuğu belirir:

![Seçili bir öğenin üzerindeki yüzen araç çubuğu](img/html-toolbar.png)

- **Dosya ve geçmiş**: Kaydet, Farklı kaydet, Geri al, Yinele, Bul; **Otomatik kaydet** anahtarı değişiklikleri belirli aralıklarla yazar.
- **Önizleme / Kaynak** geçişi; **Sunum** sayfayı tam ekran gösterir.
- **Biçimlendirme**: kalın, italik, yazı tipi boyutunu büyüt/küçült; seçili öğe için **stil paneli** (renkler ve daha fazlası).
- **Ekle**: başlık, paragraf, tablo, görsel (bağlantıyla), daha fazlası.
- **Görsel işlemleri** (bir görsel seçiliyken): kırp, **arka planı kaldır**, değiştir, en-boy oranını kilitle.
- **Öğe işlemleri** (önizleme denetçisinde bir öğe seçiliyken): sil, çoğalt, yukarı/aşağı taşı.
- **AI düğmesi**: AI panelini açar; doğrudan seçili öğe hakkında soru sorun.

## Dışa aktarma

Dosya menüsünde, hepsi yerel çalışır ve hepsi sonucu nereye koyacağınızı sorar:

- **Word olarak dışa aktar…** ve **PDF olarak dışa aktar…** gerçek bir .docx veya .pdf yazar.
- **ODT olarak dışa aktar…** bir .odt (OpenDocument metni) dosyası yazar; Word dışa aktarmasıyla aynı dönüşümü kullanır ve yolda bir şey değişir veya düşerse önce listeyi görüp onaylarsınız.
- **Tek dosyalık HTML olarak dışa aktar…** görsellerin içine gömüldüğü tek bir .html yazar. Açık olan dosyanın üzerine yazmaz ve gömemediği görsellerin sayısını söyler.

## İskelet ekle

Boş bir sayfa için **Ekle ▸ İskelet ekle** asgari bir standartlar kipi belgesi yazar:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title></title>
  </head>
  <body></body>
</html>
```

Her parça bir nedenle oradadır; bu yüzden yazılacak bir şey değil, bir komuttur:

- **doctype** olmadan önizleme quirks modunda çalışır; orada kutu boyutlandırma ve tablo yerleşimi beklediğinizden farklı kurallara uyar;
- **`lang`** olmadan ekran okuyucunun sayfayı okuyacağı bir dil olmaz ve tarayıcı yanlış dil için bir yazı tipi ve yazım denetleyicisi seçer;
- **charset** olmadan Latin alfabesi dışı bir metin sayfası bozuk karakterlerle çözülebilir.

Viewport meta bilerek yoktur: bu, etkileyeceği bir mobil görünüm alanı olmayan bir masaüstü bölmesinde işlenir.

`lang`, uygulamanın arayüz dilini izler; böylece eklediğiniz iskelet, araçlarınızın zaten hazır olduğu dildir. Sonrasında serbestçe düzenleyin.

Bu öğe yalnızca düzenleme modunda ve yalnızca belge boşken görünür — içerik olduktan sonra iskeletin _içine_ ekleneceği bir şey yoktur.

## Denklemi düzenle

Görsel olarak yazın veya LaTeX düzenleyin. Kaydedilen HTML, sonradan düzenleyebilmeniz için kaynağı korur.

Araç çubuğunda Denklem ekle’yi seçin. Görsel alanı, şablonları veya LaTeX’i kullanın, ardından uygulayın. Bir kaydedilmiş denklemi yeniden düzenlemek için önizlemede ona tıklayın. Satır içi matematik için bir paragraf seçin ve ayrı satır seçeneğini kapatın; denklem o paragrafın sonuna eklenir.

Dizgi motorunun işleyemediği bir ifade kaybolmaz: denklem LaTeX kaynağını korur ve ham metni sayfada gösterir; böylece onu yeniden açıp düzeltebilirsiniz.
