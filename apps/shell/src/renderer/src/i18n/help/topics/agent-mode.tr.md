# Ajan modu

Ajan, seçtiğiniz bir klasörü proje olarak alır ve bu bilgisayardaki Claude Code veya Codex’i o klasörde çalıştırır. AI klasördeki malzemeyi kendisi okur, yeni dosyalar oluşturur, becerileri ve betikleri kullanır ve GenOffice’te açık belgeleri düzenler. Bol malzeme gerektiren işler için kullanın.

## Başlamadan önce

- **Ayarlar ▸ AI** altında bağlanmış Claude Code veya Codex programı (bir Claude aboneliği ya da bir ChatGPT planıyla oturum açılmış). Uygulamada doğrudan bağlanan ChatGPT ajan tarafından kullanılmaz. "Abonelik bağlantısı" konusu bunun nasıl yapıldığını anlatır.
- İçinde malzemeniz olan bir klasör. Sürücünün tamamı, kullanıcı klasörünüzün tamamı ve oturum açma ya da uygulama verilerinin bulunduğu klasörler seçilemez.

## Oturum başlatma

1. Giriş ekranının solundaki kenar çubuğunda **Ajan** düğmesine tıklayın. Ajan penceresi kendi başına açılır.
2. Proje klasörünü seçmek için **Klasör seç…** düğmesine tıklayın. Son kullandığınız klasörler **Son klasörler** altında listelenir.
3. **Program** altında Claude Code veya Codex’i seçin. Bağlı olmayan bir program seçilemez.
4. **Ne zaman sorulsun** altında ajanın izni nasıl isteyeceğini seçin (aşağıdaki tablo).
5. İlk seferde **Başlamadan önce** bölümünü okuyup **Anladım** düğmesine tıklayın.
6. **Başlat** düğmesine tıklayın, ne yapılmasını istediğinizi yazın ve **Gönder** düğmesine tıklayın.

Bir pencere bir oturumdur. Pencereyi kapatmak veya **Durdur** düğmesine tıklamak oturumu bitirir ve GenOffice’in o oturum için başlattığı program da biter. Hiçbir şey gönderilmeden 30 dakika geçen bir oturum da biter.

## Ajan nasıl sorar

| Seçim                                              | Doğrudan yapar                                                        | Önce sorar                                                                 |
| -------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Her komuttan önce sor** (varsayılan)             | Proje klasöründeki dosyaları okuma ve yazma, açık belgeleri düzenleme | Komut veya betik çalıştırma, proje klasörü dışındaki dosyaları okuma       |
| **Dosya yazmadan ve komut çalıştırmadan önce sor** | Proje klasöründeki dosyaları okuma, açık belgeleri düzenleme          | Dosya yazma, komut veya betik çalıştırma, klasör dışındaki dosyaları okuma |
| **Bu projeye güven**                               | Neredeyse her şey                                                     | Proje klasörü dışındaki dosyaları okuma                                    |

Ajan sorduğunda pencere ne yapmak istediğini gösterir (komutun tamamı, dosya yolu). **İzin ver** veya **Reddet** düğmesine tıklayın.

Hangi seçeneği seçerseniz seçin, ajan şunları yapmaz:

- GenOffice sekmesinde açık bir belgenin dosyasının üzerine yazmaz. Açık belgeler uygulama üzerinden düzenlenir, böylece değişiklik düzenleyicide hemen görünür ve düzenleyicinin geri alması onu geri alır.
- Proje klasörünün dışına yazmaz.
- Claude veya Codex’in oturum açma verilerine ya da GenOffice’in veri klasörüne dokunmaz.

## Claude Code ve Codex

- **Codex** komutları, izin verdikleriniz de dahil, kendi yalıtılmış alanında çalıştırır. Yalnızca proje klasörüne yazabilir, siz açmadıkça internet engellidir ve proje dışındaki kişisel dosyalarınızı okuyamaz. Bir oturum başladığında GenOffice önce bu yalıtımın bu bilgisayarda çalıştığını denetler, çalışmıyorsa başlamaz.
- **Claude Code** Windows’ta komutları yalıtamaz. İzin verdiğiniz bir komut tüm bilgisayara ve internete erişebilir. Bu yüzden **Bu projeye güven** altında sizin yerinize Claude Code’un kendi denetleyicisi her işlemi denetler.

Size gönderilen bir belge, AI’a başka bir şey yapmasını söyleyen gizli yönergeler taşıyabilir. İçeriğini bilmediğiniz bir malzeme klasöründe soran seçeneklerden birini kullanın.

## Web araması ve internet

- **Claude Code** web’de arama yapabilir ve web sayfalarını okuyabilir, önce sorar. İlk aradığında ve sayfalarını okuduğu her site için sorar. Soruda **Bu oturumda aramalara izin ver** veya **Bu oturumda bu siteye izin ver** seçeneği, oturumun geri kalanında yeniden sormasını durdurur. **Bu projeye güven** altında Claude Code’un kendi denetleyicisi karar verir.
- **Codex**’i seçtiğinizde başlangıç ekranı iki ayar daha gösterir.

| Ayar                               | Seçenekler                        | İlk durumda      |
| ---------------------------------- | --------------------------------- | ---------------- |
| **Web’de arama**                   | Kayıtlı sonuçlar / Canlı / Kapalı | Kayıtlı sonuçlar |
| **Komutlar için internet erişimi** | Kapalı / Açık                     | Kapalı           |

- Kayıtlı sonuçlar önceden toplanmış web içeriğinden gelir; Canlı, web’i şu andaki haliyle arar.
- İki ayar da her proje klasörü için hatırlanır. İlk kez kullanılan bir klasör yukarıdaki değerlerle başlar.
- Komutlar için internet erişimi açıkken Codex’in çalıştırdığı komutlar internete erişebilir. **Bu projeye güven** altında sormadan erişirler ve aldığınız bir belgedeki gizli yönergeler verilerinizi dışarı göndermelerine yol açabilir. Bu uyarı açtığınızda görünür. Yalnızca ihtiyacınız olduğunda açın. "Beceri bul" yerleşik becerisi yalnızca bu ayar açıkken çalışır.

## Proje notları ve beceriler

- Klasörde bir `CLAUDE.md` veya `AGENTS.md` varsa içeriği ajana yönerge olarak verilir. Her seferinde geçerli olması gerekenleri yazın: ton, terimler, üretilecek belgelerin biçimi.
- Ajan penceresi **Ayarlar ▸ Beceriler** bölümünde açılan becerileri kullanır. Claude Code ve Codex aynı listeyi alır. Beceriler hakkında daha fazlası [Beceriler](help://skills) bölümünde.
- Proje klasörünün `.claude/skills` ve `.agents/skills` klasörlerindeki beceriler o oturumda açılmadan kullanılır.
- Giriş kutusunda `/` veya `$` ile bir beceri seçin; isteğinizin önüne o beceriyi okuyup izleme yönergesi konur.
- Beceri listesi oturum başladığında sabitlenir. Bir oturum sırasında becerileri açıp kapatırsanız "Değişen beceriler sonraki oturumdan itibaren geçerli olur" yazar.
- Ajan bir beceri oluşturduğunda pencerede bir beceri kartı, kurmaya değer bir beceri bulduğunda ise bir kurulum önizlemesi görünür. **Kaydet** veya **Yükle** düğmesine tıklayana kadar hiçbir şey kaydedilmez ya da kurulmaz; kurulan beceri sonraki oturumdan itibaren kullanılabilir.
- Bir becerinin betiklerinin kullandığı programlar (Python ve benzerleri) bu bilgisayarda kurulu olmalıdır.
- Ajanı daha eski bir sürümde kullandıysanız ajan penceresini ilk açtığınızda bir kerelik bir not şunu söyler: "Beceriler artık Ayarlar → Beceriler bölümünde açılıp kapatılıyor. Claude ve Codex beceri klasörlerindeki beceriler kapalı olarak başlar." **Ayarları aç** sizi doğrudan oraya götürür.

## Yeni dosyalar ve açık belgeler

- Ajanın oluşturduğu yeni dosyalar proje klasörüne kaydedilir. Dosyayı bir GenOffice sekmesinde açmak için ilerleme günlüğünün o satırındaki **Aç** düğmesine tıklayın.
- Açık bir belgenin düzenlenmesini istemek için önce onu GenOffice’te açın ve isteğinizde adını verin.
- Bir oturum sırasında açtığınız bir belge, sonraki mesajınızdan itibaren düzenlenebilir.

## Gizlilik ve kullanım

- AI’dan gizledikleriniz yalnızca uygulama, GenOffice’te açık bir belgeyi ajan için okuduğunda gizli kalır. Ajanın klasörün kendisinden okuduğu dosyalar olduğu gibi gönderilir.
- Web arama terimleri ve okunan sayfaların adresleri programın şirketine ve o sitelere gider. Codex’in komutlar için internet erişimi açıkken veriler bir komutun bağlandığı her yere gidebilir.
- Ajan birçok adımda çalışır, bu yüzden abonelik sınırınızı AI panelinden daha çok kullanır. Sınır tükendiğinde istek başarısız olur; ajan hiçbir zaman başka bir AI’a veya ücretlendirilen bir bağlantıya geçmez.

## Bir sorun çıkarsa

| Pencerenin söylediği                | Ne yapmalı                                                        |
| ----------------------------------- | ----------------------------------------------------------------- |
| **Bağlı değil**                     | **Ayarlar ▸ AI** altında o programa oturum açın.                  |
| **Bu klasör kullanılamaz**          | Yalnızca çalışma malzemenizi barındıran bir klasör seçin.         |
| **Codex korumalı alanı açamıyor**   | Windows’u güncelleyin veya Claude Code’u seçin.                   |
| **Abonelik sınırınız tükendi**      | Sınır sıfırlandıktan sonra yeniden gönderin.                      |
| **Program ajan modu için çok eski** | O programı güncelleyin, sonra **Yeni oturum** düğmesine tıklayın. |
