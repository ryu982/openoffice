# Abonelik bağlantısı

GenOffice, AI’ını zaten sahip olduğunuz bir abonelikle çalıştırır: bir Claude aboneliği (Anthropic) veya bir ChatGPT planı (OpenAI). ChatGPT doğrudan GenOffice içinde bağlanır; bu bilgisayarda OpenAI’nin Codex programını zaten kullanıyorsanız bunun yerine Codex üzerinden bağlanabilirsiniz. API anahtarına ihtiyacınız yoktur ve GenOffice’in kaydolabileceğiniz kendi hesabı yoktur.

## Nasıl çalışır

- AI, GenOffice’in içine gömülü değildir. Claude, bu bilgisayarda kurulu **Claude Code** programı üzerinden çalışır: GenOffice yanıtı o programdan ister ve program sizin kendi hesabınızla oturum açmıştır, bu yüzden her istek kendi planınızdan düşer.
- ChatGPT’yi program olmadan GenOffice’in kendisi bağlar. Tarayıcınızda açılan OpenAI’nin ChatGPT oturum açma sayfasında oturum açın ve bu uygulamanın ChatGPT planınızı kullanmasına izin verin. İstekler bu bilgisayardan doğrudan OpenAI’ye gider ve kullanım o ChatGPT planından düşer.
- **Codex**, OpenAI’nin programıdır. ChatGPT, Codex üzerinden bağlandığında GenOffice yanıtı Claude Code’da olduğu gibi Codex programından ister.
- GenOffice’in uygulama içinde kendi oturum açma formu yoktur. Oturumu şirketin kendi programında veya tarayıcınızda açılan şirketin web sayfasında açarsınız. GenOffice, Claude Code veya Codex oturum bilgisini asla okumaz veya saklamaz. GenOffice’in tuttuğu tek oturum, ChatGPT’yi doğrudan bağladığınızda OpenAI’nin bu uygulamaya verdiği oturumdur ve bu bilgisayarda kalır (Windows’ta şifrelenmiş olarak). GenOffice ChatGPT parolanızı asla görmez.

## Başlamadan önce

Bunlardan birine ihtiyacınız var. İkisine birden sahip olmanız sorun değil.

- Bir Claude aboneliği (Pro veya Max planı; ücretsiz bir Claude hesabı bağlanamaz) ve bu bilgisayarda kurulu, oturumu açılmış Claude Code programı.
- Bir ChatGPT planı. Doğrudan bağlandığında kurulacak bir program yoktur. Ücretsiz plan yalnızca az kullanıma izin verir. Bu bilgisayarda Codex programını zaten kullanıyorsanız bunun yerine Codex üzerinden bağlanabilirsiniz.

Claude Code veya Codex henüz kurulu değilse veya oturumu henüz açılmadıysa sonraki bölümdeki düğmeler bunu halleder.

## Bağlanma

1. Giriş ekranının sol altındaki satırdan **Ayarlar**’ı açın ve **AI** bölümünü seçin. **Abonelik bağlantısı** altında bu sırayla Claude, ChatGPT ve Codex için kartlar vardır. Bir ChatGPT planıyla ChatGPT kartında bağlanın. Codex kartı, bu bilgisayarda Codex programını kullananlar içindir.
2. Kartın ne yazdığını okuyun ve düğmesine basın. Aşağıdaki tablo her durumu açıklar.
3. GenOffice penceresine geri dönün. Kart kendiliğinden yeniden denetler; **Yeniden denetle** ise hemen denetler.

İlk açılıştaki karşılama ekranlarının AI bağlama adımı ve AI bağlı değilken AI paneli önce “Hangi AI’ı zaten kullanıyorsunuz?” diye sorar. Ücretli bir Claude aboneliği, ChatGPT ya da henüz hiçbiri seçeneğini seçin; yalnızca o yolun adımlarını ve tek kartını görürsünüz. Claude için adımlar programı kur → oturum aç → bağlandı; ChatGPT için oturum aç → bağlandı şeklindedir. ChatGPT yolunun altında **Bu bilgisayarda Codex programını zaten kullanıyor musunuz? Codex ile bağlanın** Codex yoluna (programı kur → oturum aç → bağlandı) geçer ve o yoldaki **Codex olmadan doğrudan uygulamada bağlan** sizi doğrudan bağlantıya geri getirir. Codex zaten bağlıysa Codex yolu baştan gösterilir. **Başka bir yol seç** yeniden seçmenizi sağlar; hepsini atlayıp sonra da bağlanabilirsiniz. Hâlâ bağlanmıyorsa **Yardım için ayrıntıları kopyala** düğmesine basın ve kopyaladığını size yardım eden kişiye gönderin. İçinde hesap ve dosya yolu yoktur.

| Kart ne diyor                             | Ne anlama geliyor                                                                                                       | Ne yapmalı                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Denetleniyor…**                         | GenOffice programa durumunu soruyor.                                                                                    | Biraz bekleyin.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Yüklü değil**                           | Program bu bilgisayarda bulunamadı.                                                                                     | **Yükle** düğmesine basın. Şirketin resmî yükleme komutu yeni bir terminal penceresinde çalışır, böylece ne yaptığını izleyebilirsiniz. GenOffice kendisi hiçbir şey indirmez. Elle kurmak isterseniz **Resmî yükleme kılavuzu** şirketin yönergelerini açar.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Oturum açılmadı**                       | Program burada ama oturumu yok.                                                                                         | **Oturum aç** düğmesine basın. Şirketin oturum açma sayfası tarayıcınızda açılır: orada oturum açın ve erişime izin verin; kart kendiliğinden bağlanır. Acele etmeyin; oturum açmak biraz sürebilir. Hiç tarayıcı açılmazsa karttaki **Tarayıcı açılmadı mı?** düğmesine basın (25 saniye sonra **Oturum açma penceresini aç** düğmesine dönüşür). Tarayıcıda hâlâ oturum açıyorsanız basmayın: o oturum açmayı durdurup baştan başlatır. Açılan oturum açma penceresi ne yapılacağını üstte sıralar. İçine kod yapıştırmak için pencerenin içine sağ tıklayın, sonra Enter’a basın. Yapıştırılan kodun görünmemesi normaldir; “Geçersiz kod” derse kodu aynı pencereye yeniden yapıştırın. Oturum açmayı durdurmak için **Oturum açmayı iptal et** düğmesine basın. |
| **Bağlı**                                 | Bir abonelik oturumu doğrulandı. Program bildirdiğinde plan adı gösterilir.                                             | Bir şey yapmanız gerekmez. AI kullanıma hazır.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Oturum açıldı, ancak abonelikle değil** | Program bir API anahtarıyla veya kullanım başına ödeme yapan bir hesapla oturum açmış ya da oturum türü doğrulanamamış. | Aşağıdaki “Kullanım başına ödeme yapan oturumlar” bölümüne bakın.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Bağlantı denetlenemedi**                | Denetimin kendisi başarısız oldu. Nedeni kartta gösterilir.                                                             | **Yeniden denetle** düğmesine basın. Programın çok eski olduğunu söylüyorsa **Güncelle** düğmesine basın: şirketin resmî güncellemesi yeni bir pencerede çalışır. Orada bitince GenOffice’e geri dönün.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Bu uygulamada kapalı**                  | Programı Ayarlar’da bu uygulama için kapattınız. Uygulama onu ne denetler ne de ona bir şey gönderir.                   | **Yeniden kullan** düğmesine basın. Uygulama programı yeniden denetler ve kullanır.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Claude kartı **Yüklü değil** demeye devam ederse veya programın çok eski olduğunu söylüyorsa Claude masaüstü uygulaması ile Claude Code karıştırılmış olabilir. Bunlar ayrı programlardır. GenOffice, bir terminalde kullanılan Claude Code’u çalıştırır; masaüstü uygulamasını kurmak veya güncellemek onu ne ekler ne de değiştirir. Programın çok eski olduğunu söyleyen bir kart, GenOffice’in çalıştırdığı dosyayı da gösterir. Bir bilgisayarda birkaç Claude Code kopyası varsa GenOffice yeterince yeni olanı kullanır. Mac’te Homebrew ile kurulan bir kopya `claude update` ile değişmez; bu yüzden kart bunun yerine bir terminalde `brew upgrade claude-code` çalıştırmanızı ister.

ChatGPT kartı hiçbir programdan geçmez; bu yüzden asla **Yüklü değil** veya **Oturum açıldı, ancak abonelikle değil** demez. **Oturum açılmadı** dediğinde **ChatGPT ile devam et** düğmesine basın: tarayıcınızda OpenAI’nin ChatGPT oturum açma sayfası açılır. Oturum açın ve bu uygulamanın ChatGPT planınızı kullanmasına izin verin; kart kendiliğinden **Bağlı** olur. İzin vermediyseniz veya 10 dakika içinde bitmediyse kart oturum açmanın tamamlanmadığını söyler; düğmeye yeniden basmak baştan başlatır. Oturum açma penceresi ve yapıştırılacak kod yoktur. Oturum açarken **Oturum açmayı iptal et** onu durdurur.

Oturum açtıktan sonra tarayıcıdaki OpenAI sayfası kuruluşunuzun bu uygulama için erişimi etkinleştirmediğini söyleyip `3p_delegated_access_policy_denied` gösterirse ChatGPT hesabı bir şirketin veya okulun yönettiği bir çalışma alanına aittir. OpenAI, ChatGPT dışındaki uygulamaların yalnızca kişisel ChatGPT planlarını (Go, Plus veya Pro) kullanmasına izin verir; bu yüzden bir çalışma alanı hesabı bu uygulamanın plan bağlantısını kullanamaz. Çalışma alanı yöneticisinin bu uygulamaya izin veren bir ayarı yoktur ve düğmeye yeniden basmak aynı sonucu verir. Kişisel bir ChatGPT hesabıyla oturum açın veya — bu bilgisayarda Codex programını kullanıyorsanız — Codex kartı üzerinden bağlanın. Çalışma alanı yöneticisinin Codex yerel kullanımına izin vermesi gerekebilir.

Bağlantı uygulama başlarken, Ayarlar’ı açtığınızda ve bir kurulum ya da oturum açma başlattıktan sonra pencereye döndüğünüzde denetlenir.

Claude veya Codex kartı bir oturum açmanın tamamlanmadığını söylüyorsa **Oturum açma penceresini aç** seçeneğini seçin. Tarayıcının gösterdiği kodun o pencereye yapıştırılması gerekir; daha önce gösterilen kod artık çalışmaz.

## Abonelik olmadan: ücretsiz AI

Claude veya ChatGPT aboneliğiniz yok mu? Ayarlar ▸ AI altında **Ücretsiz kullan** bunun yerine ücretsiz bir AI bağlar. Karşılama ekranlarının AI bağlama adımında **Henüz hiçbiri** seçeneğini seçmek aynı kartları gösterir; hiçbir şey bağlı değilken AI panelinde bunu seçmek **Ücretsiz AI bağla** seçeneğini sunar.

- **OpenRouter**: **Tarayıcıda bağlan** düğmesine basın. Tarayıcınız OpenRouter’ı açar; kaydolun veya oturum açın ve erişime izin verin. Tarayıcı bağlandığını söylediğinde sekmeyi kapatıp geri dönün. Kopyalanacak anahtar yoktur ve kart bugün kaç ücretsiz istek kaldığını gösterir.
- **Google Gemini**: **Anahtar al** düğmesine basın, Google AI Studio’da bir anahtar oluşturun, karta yapıştırın ve **Bağlan** düğmesine basın. Yalnızca 18 yaş ve üzeri için. Faturalandırması açık bir Google projesinde oluşturulan anahtar ücretlendirilebilir.
- Bağlandıktan sonra o AI **kullanılacak AI** olur. İkisi de bağlıyken karttaki **Bu AI’ı kullan** aralarında geçiş yapar. **Bağlantıyı kes** anahtarı GenOffice’ten kaldırır.
- Ücretsiz modeller abonelik modellerinden daha zayıftır ve her gün sınırlı sayıda isteğe izin verilir. Bir belgenin tek bir düzenlemesi birkaç istek alabilir. Bugünkü hak tükendiğinde AI paneli bunu ve ne zaman yeniden kullanılabileceğini söyler.
- Ücretsiz kullanırken gönderdikleriniz o şirketin AI’ını geliştirmek için kullanılabilir. Kişisel bilgi içeren belgelerde dikkatli olun.

## Kullanım başına ödeme yapan oturumlar

**Oturum açıldı, ancak abonelikle değil** diyen bir kartta bir uyarı vardır: “Bu bir abonelik değil: kullandığınız kadar ücretlendirilirsiniz.”

- GenOffice, siz **Yine de kullan** düğmesine basana kadar o oturumu kullanmaz. O andan sonra her istek o hesaba faturalandırılır.
- O zaman bile kendiliğinden seçilmez. **Kullanılacak AI** altında kendiniz seçin; orada **Ücretli** olarak işaretlenir.
- İzniniz yalnızca o program için hatırlanır. Programın oturumu kapatıldığında veya oturumu değiştiğinde silinir.
- Bunun yerine aboneliğinizi kullanmak için programda abonelik hesabınızla oturum açın ve **Yeniden denetle** düğmesine basın.

## Hesabı değiştirme veya oturumu kapatma

Oturum açmış bir kart, oturum açtığı hesabı gösterir. Claude ve Codex kartları, program bildirdiğinde plan adını da gösterir. Ayrıca iki düğme daha görünür.

- **Başka bir hesapla oturum aç** programın kendi oturum açmasını yeniden başlatır. Açılan pencerede diğer hesapla tamamlayın.
- **Oturumu kapat** programın kendi oturum kapatmasını çalıştırır. Kart sonra **Oturum açılmadı** yazar.
- Claude ve Codex kartlarında ikisi de yalnızca GenOffice için değil, bu bilgisayarın tamamında o program için geçerlidir. Claude Code veya Codex’i bir terminalde de kullanıyorsanız orada da oturum kapanır ya da diğer hesaba taşınır. GenOffice önce sizden onay ister.
- Claude ve Codex kartlarında ayrıca **Bu uygulamada kullanma** vardır. Programı ve oturumunu olduğu gibi bırakır ve yalnızca GenOffice’in onu kullanmasını durdurur: durum denetimi yok, istek yok ve **Otomatik** onu atlar. Programı kullanan bir terminal etkilenmez. Kart sonra **Bu uygulamada kapalı** yazar ve **Yeniden kullan** onu yeniden açar. GenOffice dışında hiçbir şey değişmediği için ikisi de onay istemez.
- ChatGPT kartı farklıdır. **Oturumu kapat** “Bu, ChatGPT’nin bu uygulamayla bağlantısını keser” diyerek onay ister; onayladığınızda GenOffice OpenAI’den bu uygulamanın bağlantısını sonlandırmasını ister ve bu bilgisayarda tuttuğu oturumu siler. **Başka bir hesapla oturum aç** sormadan hemen tarayıcınızda oturum açma sayfasını açar. İkisi de Codex dahil bu bilgisayardaki diğer programları etkilemez.
- Bağlı bir ChatGPT kartı “Bu uygulamadaki AI, ChatGPT planınızla çalışır” der ve bir **Kullanımı yönet** bağlantısı taşır. Bu, ChatGPT ayarlarınızın kullanım sayfasını açar; orada bu uygulamanın ne kadar kullandığını görebilir ve yalnızca bu uygulama için bir sınır koyabilirsiniz.
- Hesap ve bu iki düğme yalnızca burada, Ayarlar ▸ AI altında görünür. GenOffice hesabı gösterir ve hiçbir yerde saklamaz.

## Hangi AI kullanılır

Ayarlar ▸ AI altındaki **Kullanılacak AI** **Otomatik** ile başlar. Otomatik şu sırayla karar verir:

1. Kartı Bağlı diyorsa Claude.
2. Yoksa kartı Bağlı diyorsa ChatGPT.
3. Yoksa kartı Bağlı diyorsa Codex.
4. Yoksa hiçbir AI bağlı değildir ve AI paneli hata yerine bağlantı kılavuzunu gösterir.

Otomatik, ek para harcatan hiçbir şeyi asla seçmez: ne bir API anahtarını ne de kullanım başına ödeme yapan bir oturumu. Bunlar yalnızca kendiniz seçtiğiniz sürece kullanılır.

Aynı yerden ya da AI panelinin altındaki model listesinden bir AI’ı kendiniz de seçebilirsiniz. Seçtiğiniz AI çalışmayı bırakırsa GenOffice sessizce başka birine geçmez. Ne olduğunu söyler ve nasıl yeniden bağlanacağını gösterir.

Model listesi, programın kendisinin bildirdiği modelleri gösterir (ChatGPT için OpenAI’nin planınızın kullanabileceğini söylediği modeller; siz birini seçene kadar ilki kullanılır): her biri adıyla, yanında tam model kimliğiyle; **Varsayılan model** ise şu anda hangi modeli temsil ettiğiyle birlikte. AI panelinin altındaki rozet ve **Kullanılacak AI** da o modeli adlandırır. Listeyi okumak AI’a hiçbir şey sormaz, bu yüzden planınızdan düşmez. Program modellerini bildiremeyecek kadar eskiyse yerine kısa bir yerleşik liste gösterilir.

Codex’in seçilebildiği her yerde onunla birlikte tek satır gösterilir: “Bir Codex aboneliğini bir uygulama içinde kullanmak OpenAI’nin resmen önerdiği bir yöntem değildir.” Buna göre karar verin.

## İstek durdurulduğunda

Planın sınırı tükendiğinde, oturumun süresi dolduğunda veya program artık orada olmadığında istek durur. GenOffice kendiliğinden başka bir AI’a geçmez.

- Nedeni, yanıtın kesildiği yerde gösterilir. Tükenen bir sınır için, program bildirdiğinde sıfırlanacağı zaman da gösterilir.
- Doğrudan bağlanan ChatGPT, planınızın sınırı veya ChatGPT ayarlarınızda bu uygulama için koyduğunuz sınır tükendiğinde durur. Sıfırlanma zamanı gösterilmez. ChatGPT ayarlarınızda bu uygulamanın bağlantısını kestiyseniz kart **Oturum açılmadı** olur; yeniden oturum açın.
- Diğer aboneliğiniz bağlıysa **… ile devam et** düğmesi görünür, örneğin **ChatGPT ile devam et** veya **Codex ile devam et**. Basıldığında o AI kullanılacak AI olur — model listesi değişikliği gösterir — ve istek yeniden çalışır.
- Diğer tek bağlantı izin verdiğiniz kullanım başına ödeme yapan bir oturumsa aynı düğme maliyetle ilgili bir notla gelir.
- Sizi bir API anahtarına taşıyan bir düğme asla yoktur.

## Kullanım satırı

Bir sınırın %80’ini veya daha fazlasını kullandığınızda AI paneli “%85 kullanıldı · 15.00’te sıfırlanır” gibi bir satır gösterir. Claude 5 saatlik ve 7 günlük sınır bildirir; Codex de bildirdiğinde aynı şekilde gösterilir. %80’in altında ya da program hiçbir şey bildirmediğinde satır gösterilmez. Doğrudan bağlanan ChatGPT böyle bir satır göstermez; ne kullandığını ChatGPT kartındaki **Kullanımı yönet** üzerinden görün.

## Neyin nereye gönderildiği

Bir abonelik ilk kez kullanılabildiğinde GenOffice bir kez bir bildirim gösterir. Yeniden okumak için Ayarlar ▸ AI ▸ **İlk bağlantı bildirimi** bölümüne gidip **Yeniden görüntüle** düğmesine basın. Bildirim üç şey söyler:

- Belge içeriği ve sohbetiniz kendi hesabınız üzerinden Anthropic veya OpenAI’ye gönderilir.
- Bu içeriğin AI eğitiminde kullanılıp kullanılmayacağına GenOffice değil, o şirketteki kendi hesap ayarlarınız karar verir.
- GenOffice, Codex’te sohbet geçmişi kaydetmeyi kapatır, ancak Codex yine de bu bilgisayarda kendi tanılama günlüklerini tutabilir.

Doğrudan bağlanan ChatGPT üzerinden yapılan istekler Codex programından geçmez; bu bilgisayardan doğrudan OpenAI’ye gider.

**Seçimi AI’dan gizle** ile gizlediğiniz hiçbir şey, hangi AI’ı kullanırsanız kullanın gönderilmez.

## Bilinmesi iyi olanlar

- **Hız.** Claude Code veya Codex üzerinden yanıt, API anahtarı üzerinden yanıttan birkaç saniye sonra başlar, çünkü önce programın başlaması gerekir. Doğrudan bağlanan ChatGPT hiçbir program başlatmaz.
- **Ücretsiz ChatGPT planı.** Bağlı görünür, ancak sınırları küçüktür, bu yüzden istekler daha çabuk durur. Onun için kullanım satırı görünmez.
- **Görsel oluşturma.** Hangi AI ile sohbet ederseniz edin, görseller Codex programı üzerinden ChatGPT planınızla (Plus veya üstü) oluşturulur ve o plandan düşer. Ücretsiz planda görsel aracı yoktur, bu yüzden oluşturamaz. Doğrudan bağlanan ChatGPT görsel oluşturamaz, çünkü OpenAI buna izin vermez; ChatGPT planınızı görseller için kullanmak isterseniz Codex programını aynı ChatGPT hesabıyla bağlayın. Kullanıma göre ücretlendirilen bir oturum görseller için kullanılmaz. Bkz. [AI modelleri ve ayarlar](help://ai-models).
- **Vekil sunucular.** Claude Code ve Codex, vekil ayarlarını GenOffice’ten almaz. Bu bilgisayar için ayarlanmış vekili kullanırlar, örneğin `HTTPS_PROXY` ortam değişkenini; tıpkı onları bir terminalde çalıştırdığınızdaki gibi. Bir terminalde bağlanamıyorlarsa buradan da bağlanamazlar.
- **Komutlar ve diğer programlar.** `ieumoffice` komutundan veya bağlı bir kodlama ajanından gelen bir istek, siz izin vermedikçe aboneliğinizi kullanmaz. O zaman bile Claude Code veya Codex kullanır, doğrudan bağlanan ChatGPT’yi asla kullanmaz. Bkz. [Bir kodlama ajanı bağlama](help://mcp).
- **Ajan modu.** [Ajan modu](help://agent-mode) bu bilgisayarda Claude Code veya Codex çalıştırır. Doğrudan bağlanan ChatGPT ajanı çalıştıramaz.
