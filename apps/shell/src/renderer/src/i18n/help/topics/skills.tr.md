# Beceriler

Beceri, AI için bir dizi çalışma yönergesidir. Tekrar tekrar yaptığınız bir şeyi bir kez yazın — toplantı notlarını toparlama adımları, bir raporun tonu, her seferinde denetlenecek noktalar — ve onu AI panelinde çağırın ya da AI uygun olduğunda kendisi kullansın. Beceri, açık bir biçimde tanımlanmış bir `SKILL.md` dosyası içeren bir klasördür; bu yüzden GenOffice’te yapılan bir beceri Claude Code veya Codex’te de olduğu gibi çalışır.

## Becerileri açma ve kapatma

**Ayarlar ▸ Beceriler** bu bilgisayardaki becerileri geldikleri yere göre gruplayarak listeler. Her beceri, kodlama ajanlarının gösterdiği gibi adıyla görünür. Birini adına veya açıklamasına göre bulmak için üstteki arama kutusunu kullanın. Başlığı olan bir becerim bu listede, `/` listesinde ve çiplerde başlığıyla, yanında küçük yazıyla adıyla görünür. Başlığa göre de arayabilirsiniz. Uygulamanın kendisinin verdiği bir ad (`skill-…`) başlığın yanında gösterilmez.

| Kaynak                    | Neleri barındırır                                                  | İlk durumda |
| ------------------------- | ------------------------------------------------------------------ | ----------- |
| **Yerleşik**              | GenOffice ile gelen beceriler                                      | Açık        |
| **Becerilerim**           | Eklediğiniz veya oluşturduğunuz beceriler (`~/.ieumoffice/skills`) | Açık        |
| **Claude beceri klasörü** | `~/.claude/skills` içindeki beceriler                              | Kapalı      |
| **Claude eklentileri**    | Kurulu Claude eklentilerinin becerileri                            | Kapalı      |
| **Codex beceri klasörü**  | `~/.agents/skills` içindeki beceriler                              | Kapalı      |

- Anahtar bir beceriyi açar veya kapatır. Aynı ayar her düzenleyicinin AI panelinde, Giriş ekranındaki AI’a sor bölümünde ve ajan penceresinde geçerlidir.
- Açık bir beceri için **AI karar verir** veya **Yalnızca çağrıldığında** seçin. AI karar verir olarak başlar. Yalnızca çağrıldığında seçiliyken beceri yalnızca siz çağırdığınızda kullanılır. Kapalı bir beceri bu seçimi soluk olarak korur; böylece beceriyi yeniden açmadan önce ayarlayabilirsiniz.
- Farklı kaynaklardan gelen beceriler aynı adı paylaşabilir. Her satırdaki kaynak etiketi onları ayırır. Aynı adlı iki beceri birden açıksa `/` altında yalnızca biri listelenir ve kullanılır: Becerilerim, Yerleşik, Claude beceri klasörü, Codex beceri klasörü, Claude eklentileri sırasında önce gelen. Diğerinin satırı onun yerine hangi becerinin kullanıldığını söyler.
- Daha fazla menüsünde **İçeriği görüntüle**, **Düzenle** (yalnızca becerilerim), **Dışa aktar (zip)** (yalnızca becerilerim) ve **Klasörü aç** bulunur. Yerleşik becerilerde **Klasörü aç** yoktur. **Nerede kullanılır**, becerinin kullanılacağı düzenleyicileri seçtiğiniz yeri doğrudan açar.
- Becerilerim `~/.ieumoffice/skills` klasöründe tutulur. Windows’ta bu `C:Users<kullanıcı adınız>.ieumofficeskills` olur. Daha fazla menüsündeki **Klasörü aç** becerinin klasörünü açar.
- **Geri Dönüşüm Kutusu’na taşı** becerilerimden birini sistem geri dönüşüm kutusuna taşır; oradan geri yükleyebilirsiniz. Başka bir kaynaktan aynı adı taşıyan bir beceri kapalıysa onay penceresinde onu yeniden açmak için işaretli bir kutu görünür. Kapalı bırakmak için işareti kaldırın.
- Yerleşik bir beceri kaldırılmak yerine gizlenir: **Gizle** seçin. Listenin altındaki **Yeniden göster** onu ilk durumundaki gibi geri getirir.
- Yerleşik bir beceriyi veya başka bir programdan gelen bir beceriyi değiştirmek için **Becerilerime kopyala** seçin. Kopya becerilerimde görünür ve özgün beceri kapatılır.
- Bir beceriyi şablonuyla dışa aktarmak, şablon belgesini de zip dosyasına koyar. Dışa aktarmadan önce belgede kişisel bilgi olmadığını denetleyin.
- Sayfanın üstündeki **Birkaçını dışa aktar**, işaretlediğiniz becerileri her beceri için bir klasörle tek bir zip dosyasına koyar. Zip’i alan kişi onu her beceri zip’i gibi ekler ve içindeki becerilerden hangilerini kuracağını seçebilir.

## Beceri ekleme

1. **Ayarlar ▸ Beceriler** bölümünde **Ekle** düğmesine tıklayın.
2. **Klasörden**, **Zip dosyasından**, **Yapıştırılan metinden** veya **GitHub bağlantısından** seçin. Yapıştırılan metin için `SKILL.md` dosyasının tamamını ilk `---` satırından başlayarak yapıştırın ve **Önizle**’ye tıklayın. GitHub için herkese açık bir deponun adresini, `owner/repo` ya da bir becerinin skills.sh sayfasını girin ve **Bul**’a tıklayın.
3. Önizlemede bulunan becerileri denetleyin. Dosyaların sayısını ve boyutunu, betik olup olmadığını, metindeki web adreslerini, lisans dosyasını ve kurmadan önce okumaya değer satırları gösterir. Bir becerinin altındaki **İçeriği görüntüle**, `SKILL.md` metnini ve metin dosyalarını açar; böylece kurmadan önce okuyabilirsiniz.
4. Yalnızca kurulacak becerileri işaretleyin ve **Yükle** düğmesine tıklayın. Kurulan beceriler açık olarak başlar.

Önizlemenin altında her zaman şu yazar: "Becerileri yalnızca güvendiğiniz kaynaklardan yükleyin. Bir beceri AI’a yönergeler verir ve ajan penceresinde betik çalıştırabilir." Bilmediğiniz bir kaynaktan gelen beceriyi kurmadan önce okuyun.

- Becerilerimde aynı adı taşıyan bir beceri varsa o satırda **Değiştir** veya **Atla** seçin. **Değiştir** becerinin ayarlarını korur: açık ya da kapalı olması, AI karar verir / Yalnızca çağrıldığında seçimi ve nerede kullanıldığı.
- Bir becerinin zip dosyasını veya bir `SKILL.md` dosyasını herhangi bir GenOffice penceresine de bırakabilirsiniz. **Ayarlar ▸ Beceriler** aynı önizlemeyle açılır. Bir zip, en üstünde `SKILL.md` varsa ya da en üstteki her klasör bir tane barındırıyorsa beceri sayılır; tek başına bırakılan başka bir zip için **Ayarlar ▸ Beceriler** "Beceri bulunamadı" der. Bir `SKILL.md` dosyası tek başına gelir: daha fazla dosyası olan bir beceriyi bir zip’e koyun.
- **Okumaya değer satırlar**, AI’dan önceki yönergeleri yok saymasını, sizden bir şey saklamasını veya dış bir adresten yönerge almasını isteyen satırlar ile beceri klasörünün dışını gösteren `../` yollarıdır. Her biri dosyasını ve satırını gösterir. Kurulumu durdurmazlar ve böyle satırı olmayan bir beceri bu yüzden güvenli sayılmaz.
- GitHub’dan indirirken GenOffice yalnızca `github.com`, `api.github.com` ve `codeload.github.com` adreslerine bağlanır ve hiçbir oturum açma verisi göndermez. Arşiv çok büyükse veya güvenlik denetimlerinden geçemezse hiçbir şey kurulmaz.
- Bir becerinin skills.sh sayfası (`https://skills.sh/owner/repo/skill`), `owner/repo` GitHub deposundaki o beceri olarak okunur. GenOffice skills.sh’ye bağlanmaz.
- **Yeni beceri** adı, açıklamayı ve yönergeleri kendiniz yazacağınız boş bir düzenleyici açar. Üstteki **Başlık** alanı herhangi bir dilde başlık alır; ad başlıktan doldurulur ve değiştirebilirsiniz. Başka bir kaynaktan gelen açık bir beceri aynı adı taşıyorsa kaydetmeden önce size sorulur ve kaydetmek o beceriyi kapatır. Başlıkta Latin harfi veya rakam yoksa ad `skill-` ve ardından birkaç karakter olarak doldurulur. Ad, diğer programların ve `/` çağrısının kullandığı şeydir; bu yüzden olduğu gibi kalabilir.

## Güncellemeleri denetleme

- GitHub’dan kurulmuş bir beceri için daha fazla menüsündeki **Güncellemeleri denetle** yeni içerik arar. GitHub’a yalnızca tıkladığınızda bağlanılır.
- Hiçbir şey değişmediyse "Güncel" yazar. Değiştiyse değişen dosyaları ve önizlemeyi gözden geçirin, sonra **Güncelle** düğmesine tıklayın.
- Beceriyi kurduktan sonra kendiniz düzenlediyseniz ayrıca "Kendi düzenlemeleriniz kaybolur" gösterilir.
- Güncelleme becerinin açık/kapalı durumunu, AI karar verir / Yalnızca çağrıldığında seçimini ve nerede kullanıldığını korur.

## Önceki bir sürüme geri dönme

Becerilerimden birini düzenlediğinizde, aynı adla üzerine başka bir beceri yüklediğinizde veya onu güncellediğinizde önceki sürüm saklanır. Geri dönüşüm kutusuna gitmez.

- **İçeriği görüntüle** veya **Düzenle** ekranının altındaki **Önceki sürümler**, saklanan sürümleri en yeniden başlayarak her birinin ne zaman ve neden saklandığı ve boyutuyla listeler.
- **Farkları gör**, `SKILL.md` dosyasının hangi satırlarının geri geleceğini ve hangilerinin kaybolacağını, başka hangi dosyaların değişeceğini gösterir.
- **Bu sürüme geri dön**, o sürümün dosyalarını tam olarak oldukları gibi geri koyar. Şu anki sürüm de saklanır; ona yeniden dönebilirsiniz. Becerinin açık olup olmadığı ve ne zaman kullanıldığı sizin ayarladığınız gibi kalır.
- Saklanan sürümler siz silene kadar kalır. **Sil** bir sürümü kalıcı olarak siler.
- Sürümler `~/.ieumoffice/skill-history` klasöründedir. Bir becerideki **Geri Dönüşüm Kutusu’na taşı**, saklanan sürümlerini de geri dönüşüm kutusuna taşır.

## AI panelinde beceri çağırma

1. AI giriş kutusunun başında veya bir boşluktan hemen sonra `/` ya da `$` yazın. Açık olan becerilerin listesi görünür.
2. Yazmaya devam ederek listeyi daraltın. Örneğin `/meet` `meeting-minutes` becerisini bulur. Açıklamadaki sözcükler de işe yarar.
3. Ok tuşlarıyla birini seçin ve Enter ya da Tab’a basın. Beceri giriş kutusunun üstünde bir çip olur.
4. Ne istediğinizi yazın ve gönderin. GenOffice becerinin içeriğini isteğe ekler.

- Excel AI panelinde `$` listeyi yalnızca giriş kutusunun en başında açar, böylece `$A$1` gibi hücre adreslerinin yolunu kesmez.
- Birkaç çip ekleyebilir, birini × ile kaldırabilirsiniz. Esc yalnızca listeyi kapatır; bir AI çalışmasını durdurmaz.
- Listenin altındaki **Becerileri yönet…** düğmesi **Ayarlar ▸ Beceriler** bölümünü açar.
- Çipler gönderdiğiniz mesajda ve kaydedilen sohbette kalır. Bir sohbeti yeniden açıp tekrar gönderdiğinizde becerinin güncel içeriği yeniden okunur. Bu arada kaldırılan veya kapatılan bir beceri çipinde "Kullanılamıyor" olarak görünür.
- Birlikte gönderilecek beceri metni çok uzunsa "Beceriler birlikte gönderilemeyecek kadar büyük" yazar ve hiçbir şey gönderilmez.

## AI’ın kendi kullandığı beceriler

- Açık olan ve AI karar verir olarak ayarlanmış becerilerin adları ve açıklamaları AI’a liste olarak verilir. Biri isteğe uyduğunda AI içeriğini alır ve kullanır.
- AI bir beceri kullandığında sohbet "〈ad〉 becerisi kullanıldı" der.
- AI bir beceriyi kullanıp kullanmayacağına açıklamadan karar verir. Becerinin ne zaman kullanılacağını söyleyen bir açıklama iyi seçim yapmasına yardımcı olur.

## Sorarak beceri oluşturma

1. AI panelinde "Az önce yaptığımızı bir beceri olarak kaydet" veya "Bizim üslubumuzla rapor yazan bir beceri oluştur" gibi bir şey söyleyin.
2. AI tekrarlanmaya değer adımları ve kuralları seçip bir **Yeni beceri** kartı gösterir. Adlar ve tarihler gibi yalnızca o sefer kullanılan değerler yönergelerin dışında kalır.
3. Karttaki adı, açıklamayı ve yönergeleri denetleyip düzenleyin. Ad, beceri listesinde görünen ve `/` sonrasında yazdığınız şeydir: küçük İngilizce harfler, rakamlar ve kısa çizgiler. Adın üstündeki **Başlık** alanı, listenin gösterdiği başlığı herhangi bir dilde alır.
4. **Kaydet** düğmesine tıklayın. Yeni beceri becerilerime eklenir, açılır ve hemen `/` listesinde görünür.

- **Kaydet** düğmesine tıklayana kadar hiçbir dosya yazılmaz. **İptal** düğmesine tıklarsanız sohbet bunu yalnızca "Kaydedilmemiş beceri önerisi" olarak saklar.
- Var olan bir beceriyi değiştirmeyi de isteyebilirsiniz, örneğin "Toplantı tutanağı becerisini bizim yaptığımız gibi değiştir". O zaman kartın başlığı **Beceriyi değiştir** olur. Becerilerimden biri **Değiştir** ile üzerine yazılır; yerleşik bir beceri veya başka bir programdan gelen beceri becerilerimde kopya olarak kaydedilir ve özgün beceri kapatılır.

## Bir becerinin nerede kullanılacağını seçme

Slaytları biçimlendirmek veya bir elektronik tabloyu toparlamak gibi yalnızca tek bir belge türüne uyan bir beceri yalnızca o düzenleyicinin AI panelinde gösterilebilir. Diğer düzenleyicilerde `/` listesi ve AI’ın kendi kullandığı becerilerin listesi kısalır; böylece AI doğru beceriyi daha sık seçer.

- Becerilerimden biri için **Düzenle**’yi açın ve **Nerede kullanılır** altında **Her düzenleyici** veya **Yalnızca bu düzenleyiciler**’i seçin. Seçtiğiniz düzenleyiciler becerinin dosyasına yazılır; böylece beceriyi dışa aktardığınızda veya başka bir programa taşıdığınızda onunla birlikte gider. **Yalnızca bu düzenleyiciler** hiçbiri işaretli olmadan başlar; **Tümünü seç** ve **Tümünü temizle** hepsini birden değiştirir.
- Yerleşik bir beceri veya başka bir programdan gelen bir beceri için bunu **İçeriği görüntüle** içindeki **Nerede kullanılır** altında değiştirin. Bu yalnızca bu bilgisayarın ayarlarında tutulur; becerinin dosyası olduğu gibi kalır.
- Her düzenleyicide kullanılmayan bir beceri bunu kendi satırında söyler, örneğin "Kullanıldığı yer: Slides".
- AI yalnızca tek bir biçime uyan bir beceri yaptığında nerede kullanılacağını önerir; aksi hâlde her düzenleyiciyi bırakır. Kaydetmeden önce karttaki **Nerede kullanılır** altında değiştirebilirsiniz.
- Giriş ekranındaki AI’a sor ve ajan penceresi, nerede kullanılacağı nasıl ayarlanmış olursa olsun açık olan her beceriyi kullanır.

## Belgeyi şablon olarak ekleme

Bir düzenleyicinin AI panelinde beceri oluştururken açık belge bir şablon olarak birlikte gidebilir. Kartta **Bu belgeyi şablon olarak birlikte kaydet** seçeneğini işaretleyin, düğme ikiye ayrılır.

- **Boş bir şablon oluştur**: belgenin bir kopyası yeni bir sekmede, "Şablon önizlemesi - 〈başlık〉" olarak açılır ve o sekmedeki AI adlar, tarihler ve kişisel bilgiler gibi doldurulmuş değerleri temizler. Sekmeyi gözden geçirin, elle daha fazlasını değiştirin, sonra **Bu sekmeyi şablon olarak kaydet** düğmesine tıklayın; sekme o anda olduğu gibi şablon olur.
- **Belgeyi olduğu gibi kaydet**: açık belgeyi değiştirmeden şablon olarak kaydeder. Belgede AI’dan gizlediğiniz kısımlar varsa bu düğme engellenir, böylece gizli içerik olduğu gibi şablona girmez.
- Şablon, beceri klasörünün içinde belgenin bir kopyası olarak saklanır. Özgün belge değişmez.

## Şablonlu bir beceriyi kullanma

- Şablonu olan bir beceri listede **Şablonu var** olarak görünür.
- Çip olarak çağırıp gönderin, şablonun bir kopyası yeni, adsız bir belge olarak açılır; o sekmedeki AI isteğinizle devam eder. Özgün panel "Şablonla yeni bir sekmede çalışılıyor" ve **Sekmeye git** bilgisini korur.
- AI bir şablon becerisini kendisi seçtiğinde hemen bir sekme açılmaz. Sohbet bunun yerine bir **Bu şablondan yeni bir belge aç** düğmesi gösterir.
- Zaten içeriği olan bir belgede çağrıldığında hemen bir sekme açmak yerine nerede çalışılacağını sorar. **Bu belgede yap**, yeni bir sekme olmadan geçerli belgeyi beceriye göre düzenler (şablon dosyası açılmaz). **Şablondan yeni belge (bunu ekle)** şablon kopyasını yeni bir sekmede açar ve geçerli belgeyi o sekmenin AI paneline ek olarak gönderir. Eklemek için geçerli belgenin kaydedilmiş olması gerekir. Hiç kaydedilmemişse veya kaydedilmemiş değişiklikleri varsa panel bunu söyler ve **Eklemeden aç** kopyayı ek olmadan açar. AI bir şablon becerisini kendisi seçtiğinde gösterilen düğme de içeriği olan bir belgeyi ekler. Markdown ve PDF düzenleyicileri ek almaz; bu yüzden orada açılan bir şablona hiçbir şey eklenmez.
- Yeni belgenin nereye gideceğini genellikle ilk kaydettiğinizde seçersiniz. Markdown ve HTML düzenleyicileri her zamanki gibi varsayılan klasöre kaydeder. Şablon dosyasının kendisi olduğu gibi kalır.

## Betikli beceriler

- Normal AI panelinde ve Giriş ekranındaki AI’a sor bölümünde bir becerinin betikleri asla çalışmaz. AI’a yalnızca becerinin metni ulaşır.
- Betikli bir beceri **Betikleri var · ajan penceresinde tam olarak çalışır** olarak görünür ve çip olarak eklendiğinde "Bu becerinin betikleri normal AI panelinde çalışmaz" yazar. Gönderme engellenmez.
- Betikleri de kullanmak için beceriyi ajan penceresinde çağırın. Bkz. [Ajan modu](help://agent-mode).

## Yerleşik beceriler

| Beceri                        | Ne yapar                                                                                                                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meeting-minutes`             | Toplantı notlarını kararları ve eylem maddelerini gösteren tutanaklara çevirir                                                                                                                                        |
| `internal-comms`              | Duyurular, bültenler, ilerleme güncellemeleri, SSS’ler ve diğer iç mesajları yazar                                                                                                                                    |
| `humanizer`                   | AI yazılmış gibi duran ifadeleri bulur ve doğallaştırır                                                                                                                                                               |
| `copy-editing`                | Yazdığınız İngilizce metni gözden geçirir, daha açık ve daha derli toplu yapar                                                                                                                                        |
| `find-skills`                 | Ajan penceresinde ihtiyaç duyduğunuz becerileri bulur ve kurmayı önerir                                                                                                                                               |
| `administration-report`       | Bir raporu İçişleri ve Güvenlik Bakanlığı yönergesine uydurur: düz yazı, standart numaralandırma, her yerde açılan yazı tipleri, sade tablolar                                                                        |
| `administration-report-draft` | Bakanlık biçiminde sıfırdan idari rapor yazar: bölümler, Ⅰ·1·가 numaralandırması, düz yazı, tablo başlıkları ve uyumlu yazı tipleri                                                                                   |
| `docx`                        | Yalnızca ajan penceresinde çalışır. Proje klasöründeki .docx dosyalarını oluşturmak, düzenlemek ve okumak için betik çalıştırır. Bu bilgisayarda Python ve başka programlar kurulu olmalıdır                          |
| `pptx`                        | Yalnızca ajan penceresinde çalışır. Proje klasöründeki .pptx dosyalarını oluşturmak, düzenlemek ve okumak için betik çalıştırır. Bu bilgisayarda Python ve başka programlar kurulu olmalıdır                          |
| `xlsx`                        | Yalnızca ajan penceresinde çalışır. Proje klasöründeki .xlsx dosyalarını oluşturmak ve düzenlemek, formüllerini yeniden hesaplamak için betik çalıştırır. Bu bilgisayarda Python ve başka programlar kurulu olmalıdır |
| `pdf`                         | Yalnızca ajan penceresinde çalışır. Proje klasöründeki .pdf dosyalarını okumak, birleştirmek ve bölmek, formları doldurmak için betik çalıştırır. Bu bilgisayarda Python ve başka programlar kurulu olmalıdır         |
| `hwp-document`                | Yeni bir .hwp veya .hwpx belgesini sıfırdan yazar: rapor, plan, duyuru, resmî yazı veya tutanak için bölümleri seçer, belge üslubuyla yazar ve sonunda denetler                                                       |
| `mindmap`                     | Bir konudan veya malzemeden zihin haritası kurar: üç ila yedi dengeli ana dal, ayrıntısı notlarda duran kısa başlıklar ve sonunda yapı denetimi                                                                       |
| `diagram`                     | Anlaşılır bir diyagram çizer: uygun türü seçer, tek yönü, kısa etiketleri ve az rengi korur, çakışmaları ve bağlantısız şekilleri denetler                                                                            |
| `html-document`               | Ekranda rahat okunan ve temiz basılan bir HTML belgesi hazırlar: önce okuru, uzunluğu ve kâğıdı belirler, sonra sayfaları ve içeriği denetler                                                                         |

`copy-editing` İngilizce pazarlama metinleri için yapılmıştır. `find-skills` yalnızca ajan penceresinde çalışır. Yerleşik bir becerinin **İçeriği görüntüle** bölümünde açıklama arayüz dilindedir; yönergeler ise AI’a verilen metindir ve yazıldığı gibi (İngilizce) gösterilir. `docx`, `pptx`, `xlsx` ve `pdf` yalnızca ajan penceresinde çalışır; betik çalıştırdıkları için bu bilgisayarda Python ve başka programlar kurulu olmalıdır. `hwp-document`, `mindmap`, `diagram` ve `html-document` yalnızca yazıldıkları düzenleyicide kullanılır.

## Ajan penceresinde

- Ajan penceresi **Ayarlar ▸ Beceriler** bölümündeki aynı açma/kapama ayarlarını izler ve becerileri giriş kutusunda aynı şekilde `/` veya `$` ile çağırırsınız.
- Proje klasörünün `.claude/skills` ve `.agents/skills` klasörlerindeki beceriler o oturumda açılmadan kullanılır.
- Beceri listesi oturum başladığında sabitlenir. Bir oturum sırasında becerileri açıp kapatırsanız "Değişen beceriler sonraki oturumdan itibaren geçerli olur" yazar.
- Ajan bir beceri oluşturduğunda pencerede aynı kart görünür. Şablon için sekmelerde açık belgeler ve proje klasöründeki dosyalar arasından seçin.
- Ajan kurmaya değer bir beceri bulduğunda bir kurulum önerisi görünür. **Önizlemeyi aç** ile açın ve **Yükle** düğmesine kendiniz tıklayın; aksi halde hiçbir şey kurulmaz. Kurulan beceri sonraki oturumdan itibaren kullanılabilir.
