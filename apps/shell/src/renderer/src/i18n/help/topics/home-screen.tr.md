# Giriş ekranı: dosyalarınız nerede durur

Giriş, GenOffice'in başlangıç sayfasıdır: solda bir gezinme kenar çubuğu, sağda dosya listeleri ve hızlı oluşturma kartları.

## Kenar çubuğu gezinmesi

- **Son kullanılanlar**: yakın zamanda açtığınız dosyalar. Her satırda ne zaman açıldığı yazar — bugün, dün ya da tarih.
- **Yıldızlılar**: yıldız eklediğiniz dosyalar. Bir dosya satırının üzerine gelip yıldıza tıklayarak ekleyin ya da kaldırın. ⋯ menüsündeki **Gruba taşı** yıldızlı dosyaları adlandırılmış gruplara ayırır; Yıldızlılar görünümü bunlara göre filtreler.
- **Kullanım Kılavuzu**: bu kılavuzu açar.
- **AI'ya sor**: bilgi tabanı paneli — soru sorun, yıldızlı dosyalarınızdan alıntılanan yanıtlar alın (aşağıya bakın).
- **Projeler**: AI’ın birlikte çalışabileceği klasörler (projeler). Bir proje oluşturun veya var olan bir klasörü kullanın ve yönergelerini, belleğini, dosyalarını ve sohbetlerini yönetmek için birini açın. Bkz. [Projeler](help://projects).
- **Klasörler**: kenar çubuğuna **Klasör ekle…** ile eklediğiniz ya da dosya yöneticisinden sürüklediğiniz dizinler. Her biri açabildiğiniz, içinde alt klasör oluşturabildiğiniz, yeniden adlandırıp kaldırabildiğiniz bir kök olur; çevrimdışı kalan bir klasör kullanılamıyor olarak görünür ve listeden çıkarılabilir. **Yeni klasör** bir tane daha oluşturur.
- **Alttaki satır**: AI'nın bağlı olup olmadığını gösterir — **AI bağla** ya da bağlı aboneliğin adı — ve Ayarlar'ı açar.

Burada Çöp Kutusu girdisi yoktur. Silinen dosyalar sistem çöp kutusuna gider ve birini geri getirmek işletim sisteminin işidir.

## Dosya listesi

Her satır bir simge, dosya adı, değiştirilme zamanı ve daha fazlasını gösterir. Satırın **⋯ menüsü** şunları sunar:

- **Aç** ve dosyayı dosya yöneticinizde bulmak için **Klasörde göster**.
- **Yolu kopyala**.
- **Klasöre taşı…**: bir klasör seçici açar ve dosyayı gerçekten taşır; hedefte o adla bir dosya varsa atla / üzerine yaz / yeniden adlandır seçeneklerini sunar.
- **Yeniden adlandır**: yerinde yapılır, uzantı kendiliğinden korunur.
- **Yıldızla / Yıldızı kaldır** — yıldızlar yeniden başlatmalar arasında kalır ve dosyayı yeniden adlandırdığınızda onu izler.
- **Çoğalt**: aynı klasörde bir kopya oluşturur.
- **Sil**: dosyayı sistem çöp kutusuna taşır — kalıcı silme değildir.
- Üst düzey Son kullanılanlar görünümünde **Listeden kaldır**, dosyaya dokunmadan bir girdiyi listeden düşürür.

### Birden çok dosyayla çalışma

Bir satırdaki onay kutusunu işaretleyin ya da ⌘/ctrl tuşuyla tıklayın ve bir seçim oluşturun; başlıktaki onay kutusu o anda listelenen her şeyi seçer, listenin üstündeki çubuk kaç öğe seçildiğini bildirir ve tüm küme için **Klasöre taşı…** ile **Dosyaları sil** sunar. Çoklu seçimi kenar çubuğundaki bir klasörün üzerine de sürükleyebilirsiniz.

## Arama

Üstteki arama kutusu aynı anda iki şeyle eşleşir:

- **Dosya adları**: ada göre hızlı filtreleme.
- **Dosya içerikleri**: GenOffice dosyalarınızı arka planda dizinler (docx/odt/xlsx/pptx/pdf/md/html içindeki metin), böylece gövde metninde arama da dosya bulur. Kapsam ve anahtarlar arama ayarlarındadır.

## Hızlı başlangıç kartları

Listelerin üstündeki kartlar tek adımda yeni bir belge oluşturur. Bir karta tıklamak o türde bir dosya oluşturur ve düzenleyicisini açar — hemen yazmaya başlayın ya da AI sizin için taslak çıkarsın (her düzenleyicinin şeridinde bir **AI düğmesi**, seçim sağ tık menüsünde de **AI'ya sor** vardır).

Yeni dosya, kenar çubuğunda o anda seçili olan klasöre gider; seçim yoksa varsayılan klasöre gider.

Kartları gizlemek veya sıralarını değiştirmek için Ayarlar → Genel altındaki **Giriş ekranındaki yeni belgeler**’i kullanın. Kapattığınız bir tür yalnızca kartlardan ve Yeni menülerinden çıkar; o türdeki dosyalar eskisi gibi açılır. Giriş ekranında ⌘N/Ctrl+N hâlâ gösterilen ilk türü oluşturur. Ayarlar → Düzenleyiciler ve AI altında bir düzenleyiciyi kapatmak farklıdır: onun kartları ve menü öğeleri de kaybolur, dosyalarını açarken önce sorulur.

Kartların her birinin yaptığı iş:

- **AI Docs** (.docx): Docs düzenleyicisinde boş bir metin belgesi. Dosya diske yalnızca **ilk kaydetmede** yazılır; yeni belgeler AI paneli açık olarak başlar (istemiyorsanız Ayarlar → "AI paneli" altından Kapalı ya da Katlanmış seçin).
- **AI Sheets** (.xlsx): Sheets düzenleyicisinde boş bir elektronik tablo. Kaydedene kadar diskte dosya yoktur — ad ilk kaydetmeye ayrılır; ilk AI üretiminden sonra dosya içeriğinden otomatik olarak da yeniden adlandırılabilir.
- **AI Slides** (.pptx): Slides düzenleyicisinde boş bir sunum.
- **AI Markdown** (.md): Markdown düzenleyicisinde boş bir Markdown belgesi.
- **AI HTML** (.html): HTML düzenleyicisinde boş bir web sayfası.
- **AI PDF** (.pdf): diğerlerinden farklı — hedef klasörde **hemen** gerçek, tek sayfalık boş bir PDF oluşturur ve onu sıradan bir dosya olarak açar (PDF düzenleyicisi gerçek dosyalarla çalışır). Not eklemek, karartmak veya metin eklemek için uygundur; dosya ilk kaydetmede içeriğinden otomatik olarak yeniden adlandırılabilir.
- **Yerel dosyaları aç**: Word (.docx/.doc/.odt), Excel (.xlsx/.xlsm/.xls/.csv/.tsv), PowerPoint (.pptx/.ppt), PDF, Markdown (.md/.markdown) ve web sayfaları (.html/.htm) için sistem dosya seçicisi. Çoklu seçim çalışır; her dosya kendi sekmesini alır. Düz metin dosyaları (.txt, .json) da burada açılır — Markdown düzenleyicisinin kaynak görünümüne düşerler.

> İpucu: Menü çubuğundaki Dosya ▸ Yeni aynı belge türlerini oluşturur (⌘N/Ctrl+N metin belgesi açar); bir dosyayı pencerenin içine sürüklemek onu açar.

## Bilgi tabanınıza sorun

- Önce dosyaları yıldızlayın (uygulamanın okuduğu her tür); panel başlığı derlemin büyüklüğünü sayar ve boş bir bilgi tabanı size gidip bir şeyi yıldızlamanızı söyler.
- Yanıtlar hangi dosyalardan geldiğini belirtir; bir kaynağa tıklayarak dosyayı düzenleyicisinde açın.
- Bağlı bir AI gerekir; bkz. [Abonelik bağlantısı](help://subscription). Sohbet yalnızca bellekte yaşar — uygulamayı kapatmak onu bitirir.
- Girişin altında bir proje seçin; klasörün dosyaları da aranır ve okunur, sohbet de o klasörde tutulur; böylece başka bir düzenleyicide devam edebilirsiniz. Proje olmadan sohbet, yukarıdaki gibi yalnızca bellekte yaşar.
- Arama, Giriş araması gibi yerel dosya dizininde çalışır; kaybolan dosyalar derlemden sessizce düşer.
- Gruplar yalnızca Yıldızlılar listesini düzenler — bilgi tabanı her zaman yıldızlı bütün dosyaları kapsar.
