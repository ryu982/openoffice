# MCP sunucularını bağlama

MCP sunucusu, AI’ın uygulamanın dışından kullanabileceği araçlar sunan bir hizmettir; örneğin yasaları aramak veya ekibinizin işlettiği malzemede arama yapmak gibi. Bir sunucuyu bağladığınızda GenOffice’teki AI pencereleri sohbet sırasında onun araçlarını çağırabilir. AI’ın neyi ve nasıl kullanabileceğine araç araç siz karar verirsiniz.

## Sunucu ekleme

1. **Ayarlar ▸ Entegrasyonlar**’ı açın ve **MCP sunucuları** kartında **Sunucu ekle**’ye basın.
2. Nasıl ekleyeceğinizi seçin.
   - **Ayar metnini yapıştır**: sunucunun kılavuzundaki ayar metninin tamamını yapıştırın ve **Oku**’ya basın. GenOffice alanları doldurur. Bir metin birkaç sunucu içeriyorsa onları tek tek onaylarsınız. Metin bir anahtarı veya değeri bir bilgisayar değişkeninden (`${NAME}`) okuyorsa o alan sizin doldurmanız için boş bırakılır.
   - **Elle gir**: bir ad ve adresi yazın. Sunucunun kılavuzu size bir anahtar veriyorsa onu **Anahtar** alanına koyun.
3. Ekle düğmesinin üstündeki notu okuyun ve **Ekle**’ye basın.
4. Kaydettiğiniz anda GenOffice bağlantıyı hemen denetler ve araç listesini alır. Oturum açma gerektiren bir sunucu tarayıcıyı açmak yerine sizi bekler. Sunucunun sunduğu araçların listesini görmek için **Bağlantıyı denetle**’ye basın. Oturum açma gerektiren bir sunucu için **Tarayıcıyla oturum aç**’a basın ve oturum açmayı orada bitirin.

Bir sunucu adı harfler, rakamlar, `-` ve `_` kullanır, en fazla 24 karakterdir. AI bu sunucunun araçlarını `mcp__ad__araç` biçimindeki adlarla görür. Bir beceri araçları bu biçimdeki adlarla çağırıyorsa sunucuyu becerinin kullandığı adla ekleyin.

## Adresle bağlanan sunucular ve bu bilgisayardaki sunucular

- **Adresle** bağlanan bir sunucuya bir web adresi üzerinden ulaşılır. İnternet adresleri `https://` ile başlamalıdır. `http://` yalnızca bu bilgisayar ve evdeki ya da işteki özel ağ adresleri için çalışır ve anahtarların ve belge içeriğinin şifrelenmeden gideceğini önce onaylarsınız.
- **Bu bilgisayardaki** bir sunucu, GenOffice’in bu bilgisayarda çalıştırdığı bir programdır. Ekleme ekranı tam programı, bağımsız değişkenlerini ve ona geçirilen ortam değişkenlerinin adlarını gösterir. İlk kez yalnızca siz **Çalışmasına izin ver**’e bastıktan sonra çalışır. Komut sonradan değişirse sunucu siz yeniden izin verene kadar durur.
- Bu bilgisayardaki bir sunucu bu bilgisayarda olmayan bir programa (Node.js veya Python sunucuları için uv) ihtiyaç duyarsa GenOffice, Ayarlar’daki sunucu kartında onu indirip indirmeyeceğinizi sorar. İndirme boyutunu gösterir ve siz **İndir**’e basana kadar hiçbir şey indirilmez. İndirilen programlar GenOffice’in veri klasöründe kalır ve bilgisayarınızın ayarları değişmez.
- Bu bilgisayardaki bir sunucu gerektiğinde başlar ve 10 dakika kullanılmadığında durur. GenOffice’i kapattığınızda da durur.

## Her aracın ne yapabileceğini seçme

- Her araç için **Her zaman izin ver**, **Önce sor** veya **Kullanma** seçin.
- Başlangıçta sunucunun yalnızca okuma yapan olarak işaretlediği araçlar **Her zaman izin ver**, diğerlerinin tümü **Önce sor** olarak ayarlanır.
- AI bir **Önce sor** aracını çağırdığında AI penceresinde bir kart belirir. Neyin gönderileceğine bakın ve **Bu kez izin ver**, **Bu sohbette her zaman izin ver** veya **Engelle**’ye basın. Birine basana kadar hiçbir şey çalışmaz. AI’ı durdurmak veya pencereyi kapatmak engelleme sayılır.
- Sunucu bir aracın açıklamasını veya aldığı değerleri değiştirirse o araç **İnceleme gerekiyor** gösterir ve siz değişikliğe bakıp **Değişikliği onayla**’ya basana kadar AI’dan gizlenir. Sunucunun AI’a verdiği yönlendirmedeki bir değişiklik de aynı şekilde incelenir.
- Bir sunucudaki yeni araçlar aynı başlangıç ayarlarıyla açılır ve kart ile AI penceresindeki düğme **Yeni araçlar: n** gösterir. İşaret, Ayarlar’da o sunucunun araç listesini açtığınızda kaybolur.

## Sunucuları bir AI penceresinde kullanma

- Sunucular düzenleyicilerin AI pencerelerinde ve Giriş ekranındaki AI’a sor’da çalışır. Bir sunucu açıkken girişin yanında bir **Bağlı sunucular** düğmesi belirir.
- Her sunucunun durumunu görmek ve bir sunucuyu yalnızca bu sohbet için kapatıp açmak üzere ona basın. Yeni bir sohbet, Ayarlar’da açtığınız her sunucuyla başlar. Bağlantısı hiç denetlenmemiş bir sunucu **Henüz denetlenmedi** gösterir; araçlarını almak için onu Ayarlar’da denetleyin.
- **Ayarlar ▸ AI Medya ve Arama** altındaki **AI internet araçlarını kullanabilsin** seçeneğini kapatmak her MCP sunucusu aracını da kaldırır.
- Bir beceri şu anda kullanamadığınız bir sunucudan bir araç beklediğinde AI yanıtında hangi adımı yapamadığını söyler. **Ayarlar ▸ Beceriler** de bir becerinin ihtiyaç duyduğu sunucuyu o becerinin yanında gösterir.
- Ajan penceresi de açık sunucuların araçlarını kullanabilir. Aynı izinler geçerlidir ve bir oturum başladığı ayarları korur. Bkz. [Ajan modu](help://agent-mode).

## Bir sunucunun döndürdüklerini koruma

Her sunucuda başlangıçta açık olan **Bu sunucunun döndürdüklerini koru** vardır. Açıkken o sunucunun döndürdüğü bir şey bir sohbete girdiğinde, uygulamanın dışına bir şey gönderen araçlar o sohbet için durur: web araması, bir sayfayı adresle okuma, diğer MCP sunucularının araçları ve benzerleri. Aynı sunucunun araçları çalışmaya devam eder. Diğerlerini yeniden kullanmak için yeni bir sohbet başlatın. Yalnızca herkese açık malzeme veren bir sunucu için bunu kapatabilirsiniz.

Ajan penceresi bu korumayı sürdüremez. Bir oturum böyle bir sunucuyla başladığında pencere bunu size söyler.

## Ne nereye gider

- AI bir aracı çağırdığında AI’ın seçtiği metin o sunucuya gider. Açık belgeden ve eklerden içerik barındırabilir. AI’dan gizlenen bölümler gizli kalır.
- Sunucunun döndürdüğü şey kullandığınız AI sağlayıcısına gider. Yalnızca işletenlerine güvendiğiniz sunucuları ekleyin.
- Anahtarlar, oturum açma bilgileri ve ortam değişkeni değerleri bu bilgisayarda işletim sisteminizin şifrelemesiyle saklanır. Bu bilgisayar onları şifreleyemiyorsa yalnızca uygulamayı kapatana kadar hatırlanır.
- Bir sunucuyu kaldırmak anahtarlarını ve oturum açma bilgisini siler ve destekliyorsa sunucudan oturumu sonlandırmasını ister.
