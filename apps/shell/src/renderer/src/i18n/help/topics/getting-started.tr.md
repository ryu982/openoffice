# Hızlı başlangıç: arayüz ve temeller

GenOffice, kendi bilgisayarınızda çalışan bir ofis paketidir: tek pencere, tek sekme sırası ve içinde sekiz düzenleyici — Docs (kelime işlem), Sheets (elektronik tablo), Slides (sunum), PDF, Markdown ve düz metin, HTML, HWP/HWPX (Hangul belgeleri) ve Zihin Haritası (.xmind). Her düzenleyici dosyaları kendi biçiminde açar ve kaydeder: .docx, .xlsx, .pptx, .pdf, .md, .html, .hwp/.hwpx ve .xmind. Düzenleme için ağ gerekmez; AI özellikleri için gerekir. Zihin haritası düzenleyicisi FreeMind ve Freeplane dosyalarını (.mm) da yeni haritalar olarak içe aktarır; bunlar .xmind olarak kaydedilir.

## Arayüze genel bakış

Pencerenin üç bölümü vardır:

- **Sekme şeridi (üst)**: açık her dosya bir sekmedir. En soldaki Giriş sekmesi her zaman bulunur ve kapatılamaz; öteki sekmeler sizin belgelerinizdir. Bir sekmeyi çift tıklayarak dosyasını yerinde yeniden adlandırın.
- **İçerik alanı**: etkin sekmeye ait düzenleyici (ya da Giriş).
- **Menü çubuğu**: macOS'ta sistem menü çubuğunda, Windows/Linux'ta pencerenin üstünde. Dosya/Düzenle/Görünüm menüleri etkin düzenleyiciye göre değişir.

## Belge oluşturma

Şunlardan biriyle:

- **Giriş** ekranındaki [Hızlı başlangıç](help://getting-started) bölümünde bir hızlı oluşturma kartına tıklayın (AI Docs, AI Sheets, AI Slides, ...).
- **Dosya ▸ Yeni** menüsü: Docs (⌘N/ctrl+N), Sheets, Slides, Markdown, HTML veya PDF.
- Bir dosyayı pencerenin üzerine sürükleyin ya da dosya yöneticisinde çift tıklayın (GenOffice varsayılan uygulamaysa).

Yeni belge adsız açılır; diskteki dosya ancak ilk kaydetmede oluşturulur.

## Dosya açma

- **Dosya ▸ Aç** (⌘O/ctrl+O) sistem seçicisini açar: .docx / .doc / .odt / .xlsx / .xls / .csv / .tsv / .pptx / .ppt / .pdf / .md / .html.
- Giriş ekranındaki **Son kullanılanlar** listesinde herhangi bir öğeye tıklayın.
- Terminalden `ieumoffice <file>` komutu da dosya açar.

## ODT belgeleri

.odt dosyaları (OpenDocument metni; Hancom Office, LibreOffice ve başkalarının kaydettiği biçim) Docs sekmesinde, .docx'in açıldığı her yerden açılır. Yeni belge yine .docx olarak oluşturulur.

- **Her zamanki gibi çalışır**: metin düzenleme, karakter ve paragraf biçimlendirme, tablolar (satır ve sütun ekleme, silme, hücre birleştirme ve bölme), resimler, üstbilgi ve altbilgi, dipnotlar ve sonnotlar, sayfa yapısı ve bölümler, madde işaretleri ve numaralandırma, başlık stilleri, bağlantılar, bul ve değiştir, yazım denetimi, yazdırma, PDF ve HTML dışa aktarma ve AI ile düzenleme.
- **ODT'de kapalı**: açıklamalar, değişiklikleri izleme, karşılaştırma, filigran, mürekkep, içindekiler tablosu, denklem, şekil, metin kutusu veya grafik ekleme, sütunlar, alıntılar ve kaynakça, başlık yazıları ve çapraz başvurular, sayfa rengi, parola ve düzenleme kısıtlamaları, salt okunur önerisi, tema yazı tipleri ve renkleri, aynalı kenar boşlukları. Düğmeleri gri görünür; kullanmak için .docx olarak kaydedin.
- **Olduğu gibi korunur**: özgün belgedeki denklemler, grafikler ve çizimler silebildiğiniz ama düzenleyemediğiniz kilitli resimler olarak görünür, kilitli tablo hücreleri de kilitli kalır. Dokunmadığınız bölümler değişmeden geri kaydedilir. Parola korumalı bir ODT açılmaz; önce parolayı kaldırın.
- **Farklı Kaydet** .docx ve .odt sunar. Biçimi değiştirmeden önce nelerin değişeceğini ya da kaybolacağını listeler, sonra sekmeyi yeni dosyada yeniden açar. Markdown ve HTML de **ODT olarak dışa aktar…** komutunu sunar.

## Kaydetme modeli

- **Elle kaydetme**: ⌘S/ctrl+S ya da Dosya ▸ Kaydet / Farklı Kaydet. İlk kaydetme konum ve ad sorar.
- **Otomatik kaydetme** her düzenleyicinin kendi anahtarına (ve uygulama geneli varsayılana) uyar. Yalnızca okuduğunuz bir PDF sessizce yeniden yazılmaz ve kendi dosyası olmayan yeni bir belge, ilk kaydetmesinden sonra otomatik kaydetmeye başlar.
- Kaydedilmemiş değişiklikleri olan bir sekmeyi kapatmak önce Kaydet / Kaydetme / İptal diye sorar.
- Her yazma atomik gerçekleşir (geçici dosya + yeniden adlandırma), böylece elektrik kesintisi yarım bir dosya bırakamaz.

## Sık kullanılan kısayollar

| Eylem          | macOS | Windows / Linux |
| -------------- | ----- | --------------- |
| Yeni belge     | ⌘N    | ctrl+N          |
| Aç             | ⌘O    | ctrl+O          |
| Kaydet         | ⌘S    | ctrl+S          |
| Sekmeyi kapat  | ⌘W    | ctrl+W          |
| Bu kılavuzu aç | F1    | F1              |
| Şeridi katla   | ⌥⌘R   | Ctrl+F1         |

**Şeridi katlamak** her düzenleyicide çalışır. Sekme sırası kalır, altındaki komut bandı gizlenir; seçili sekme aynı zamanda katlama denetimi olur, yani şerit katlıyken hiçbir sekme seçili değildir ve herhangi bir sekmeye basmak bandı geri getirir. Bir sekmeyi çift tıklamak da aynı işi yapar. Bıraktığınız durum her düzenleyici için ayrı hatırlanır. Docs ayrıca ara bir yoğunluk ekler: **⌥⌘K** / Ctrl+Alt+K bandı yalnızca simgelere indirger ve o da aynı biçimde hatırlanır.

Her düzenleyicinin kendi içindeki kısayollar (biçim boyacısı, bul ve değiştir, tablo işlemleri, ...) o düzenleyicinin bölümünde; Docs ayrıca kendi tuş birleşimlerinin tamamını kapsayan, aranabilir bir klavye kısayolları penceresi (**⌘/**) sunar.

## Option+Command birleşimleri

Option+Command, Word'ün yapısal atlamalar için ayırdığı katmandır ve GenOffice onu aynı biçimde doldurur. Çoğunu Docs alır; Sheets Excel ile uyum için kendine iki tane alır; bir birleşim her yerde çalışır.

**Docs**

| Birleşim (macOS) | Ne yapar             | Windows / Linux    |
| ---------------- | -------------------- | ------------------ |
| ⌥⌘1 / ⌥⌘2 / ⌥⌘3  | Başlık 1 / 2 / 3     | Ctrl+Alt+1 / 2 / 3 |
| ⌥⌘0              | Normal (gövde metni) | Ctrl+Alt+0         |
| ⌥⌘M              | Paragraf penceresi   | Ctrl+Alt+M         |
| ⌥⌘A              | Yeni açıklama        | Ctrl+Alt+A         |
| ⌥⌘F              | Dipnot ekle          | Ctrl+Alt+F         |
| ⌥⌘E              | Sonnot ekle          | Ctrl+Alt+D         |
| ⌥⌘G              | Git                  | Ctrl+G             |

Bunlardan ikisi Windows'ta yer değiştirir; Word'ün onları ayırmasının nedeni de aynıdır. **⌥⌘D macOS'a aittir** — Dock'u gösterip gizler — bu yüzden sonnot Mac'te ⌥⌘E, diğer her yerde Ctrl+Alt+D olur. **Git** ise Alt'ı bırakır: Mac birleşiminde Alt'ı taşıdığı hâlde Windows'ta yalnızca Ctrl+G olur.

**Sheets**, ızgara odaktayken

| Birleşim (macOS) | Ne yapar        | Windows / Linux |
| ---------------- | --------------- | --------------- |
| ⌥⌘0              | Dış kenarlıklar | Ctrl+Shift+7    |
| ⌥⌘−              | Kenarlık yok    | Ctrl+Shift+−    |

Windows, Mac çiftinin yeniden yazımı değildir. Mac için Excel, Sheets'e **ikisini birden** verir — ⌘⇧7 ve ⌥⌘0 aynı dış kenarlık için iki tuştur — bu yüzden Windows'ta komut zaten sahip olduğu Ctrl+Shift yerini korur ve Option katmanı hiç bulunmaz.

**⌥⌘0 Docs'ta Normal, Sheets'te Dış kenarlıklar demektir**. İkisi hiçbir zaman aynı düzenleyicide görünmez, bu yüzden kullanımda çakışma olmaz; ama ⌥⌘0 sahiplenilmiştir ve genel bir birleşim olarak kullanılamaz.

**Her düzenleyici**: **⌥⌘R / Ctrl+F1** şeridi yukarıda anlatıldığı gibi katlar.

Böylece ⌥⌘D, ileride bir komut isterse GenOffice'in macOS'ta kullanması için boşta kalır.

## Bundan sonra nereye

- Dosyaların nerede durduğu: [Giriş ekranı](help://home-screen).
- Çok sayıda açık dosyayı yönetmek: [Sekmeler ve pencere yönetimi](help://tabs-and-windows).
- İşi AI'ya yaptırmak: [AI yardımcı paneli](help://ai-panel).
- Önce AI'yı bağlamak: [Abonelik bağlantısı](help://subscription).
- Dil, tema, varsayılan uygulamalar: [Ayarlar, dil, tema ve MCP entegrasyonları](help://settings-integrations).
