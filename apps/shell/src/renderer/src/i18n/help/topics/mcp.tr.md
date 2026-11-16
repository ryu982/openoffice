# Bir kodlama ajanı bağlama

GenOffice, Model Context Protocol ile konuşur; böylece bir kodlama ajanı belgelerinizi uygulamanın kullandığı aynı motorlar üzerinden okuyabilir, yazabilir ve işleyebilir. Ajan bir dosya biçimini tahmin etmez: tipli op şemalarını, yürütücünün doğruladığı tanımların aynısından alır.

## Uygulamadan kaydetme

Bunu yapacağınız yer **Ayarlar ▸ Entegrasyonlar**. Bölmenin iki yarısı vardır; ikisini de kullanabilir ya da yalnızca birini seçebilirsiniz.

**Beceri.** Bu makinede bulunan her kodlama ajanı için bir satır — Claude Code, ortak klasör `~/.agents` (Codex, Cursor, Gemini CLI, Copilot CLI ve OpenCode tarafından okunur), Windsurf — her birinde **Yükle**, **Güncelle** ve **Kaldır** ile birlikte **Başka bir klasöre kur…**, **Beceriyi indir (zip)** ve **Yolu kopyala**. Asistanınız listede yoksa GenOffice’i `SKILL.md` okuduğu bir klasöre yönlendirin ya da zip’i kaydedip asistanın kurmasına izin verin. Beceri ile MCP yan yana durabilir: asistan birini seçer ve ikisi tam olarak aynı şeyleri yapar. Daha önce bu beş aracın kendi klasörlerinden birine kurulan bir kopya ortak satırın altında listelenmeye ve güncellenmeye devam eder; ortak klasörde beceri olduğunda o kopyayı kaldırabilirsiniz.

**MCP.** İki yol sunulur: **Asistan tarafından başlatılır (önerilen)** — gösterilen yapılandırmayı istemcinize eklersiniz ve sunucuyu asistanın kendisi başlatır — ve uygulamanın sizin için çalıştırdığı **Yerel HTTP sunucusu**. Her iki durumda da asistan GenOffice ile konuşur ve siz hiç komut yazmazsınız.

## Komut satırından kaydetme

Aynı şeyi bir terminalden yapmak — bu ileri düzey yoldur; ajan, bölmenin bulamadığı bir yerdeyse buna başvurun:

```sh
ieumoffice mcp install all
```

Bu makinedeki kodlama ajanlarını bulur ve stdio sunucu girdisini her birinin kendi yapılandırmasına yazar; dosyanın geri kalanını bulduğu gibi bırakır. Girdinin adı `ieumoffice` olur. Claude Code için elle yapıldığında aynı kayıt `claude mcp add --transport stdio ieumoffice -- ieumoffice mcp` olur.

```sh
ieumoffice mcp list             # where each agent stands
ieumoffice mcp install cursor    # just one
ieumoffice mcp uninstall cursor  # take it back out
```

Alışılmadık bir yere kurduğunuz bir ajan için `--dir <path>` gerekir; `--force` zaten var olan bir girdiyi yeniden yazar.

`ieumoffice mcp --help` sunucunun kabul ettiği her şeyi tek ekrana koyar: kaydetme, kaldırma ve listeleme biçimleri, HTTP üzerinden sunma ve iki şema bayrağı.

## Asistansız çalıştırma

Başka bir makinedeki istemci için bunun yerine HTTP üzerinden sunun:

```sh
ieumoffice mcp --http 8765 --token <secret>
```

`--host <addr>` dinlediği yeri değiştirir. Aynı belirteci istemciye geçin.

HTTP üzerinden dosyalar da gider: `PUT /files/<name>` bir dosya yükler, her araç yol yerine bir `http(s)` URL’si alır ve çıktılar indirme URL’si olarak geri gelir — yeterince küçük olduklarında gömülü kaynak olarak da. Op’lar, spec’ler ve Markdown her iki durumda da satır içi geçer.

## Ajan ne elde eder

Her komut bir araçtır. İlginç olanlar:

- **`docs`, `sheet`, `slides`** — bir dosyayı uygulamanın kendi yazma yolu üzerinden, bir seferde bir **op** ile okuyup düzenler. Yeni bir sunum `deck_start`, `deck_page`, `deck_build` adımlarından geçer.
- **`render`** — uygulamanın görüntüleyicisinin yerleştirdiği biçimde her sayfa için bir PNG, böylece ajan bir slayta bakabilir, onu tahmin etmek zorunda kalmaz.
- **`pdf`** — bir PDF’nin metin katmanı, sayfa sayfa, uygulama süreci olmadan.
- **`info`** — üst veriler ve yapı özeti; tanımadığınız bir dosyada genellikle en ucuz ilk çağrıdır.
- **`search`, `image`, `media`** — web ve görsel araması, görsel oluşturma ve medya analizi, uygulamada kurulmuş olanlar üzerinden; böylece ajanın kendi anahtarlarına ihtiyacı olmaz. Sonraki bölüm neleri kullanabileceğini söyler.
- **`merge`** — bir `{{key}}` şablonunu doldurur.

## Arama, görseller ve medya: ajan neleri kullanabilir

`ieumoffice` komutundan veya bir MCP istemcisinden gelen isteği uygulamada siz yazmadığınız için GenOffice onunla dikkatli davranır.

- **Arama** her zaman çalışır ve varsayılan olarak ücretsizdir. Bir arama sağlayıcısı anahtarı yalnızca bir tane seçtiyseniz kullanılır.
- **Görsel oluşturma**, Ayarlar'daki görsel üretimi seçimini izler. Varsayılan seçim olan ChatGPT planı (Codex programı), Codex programı üzerinden ChatGPT planınızı kullanır ve **izin vermedikçe kullanılmaz** (aşağıya bakın). Aksi halde kurduğunuz bir görsel sağlayıcısının anahtarı kullanılır. Ajanın adını verdiği model, o yol sunuyorsa kullanılır.
- **Bir görseli betimleme**, kuruluysa bir anahtar sağlayıcı kullanır. Claude veya Codex aboneliğiniz **izin vermedikçe kullanılmaz**.
- **Video ve ses** videoyu destekleyen bir anahtar sağlayıcı gerektirir.

Abonelik kullanımına izin vermek için Ayarlar ▸ AI ▸ **Gelişmiş** bölümünü açın ve **Otomatik istekler abonelik kullanabilsin** seçeneğini açın. Önce bir uyarı gelir — “Saatlik sınır yoktur, bu yüzden bir program istediği kadar istek gönderebilir ve bunlar bir belgenin tüm metnini ve sayfalarının görüntülerini taşıyabilir. İki şirket de bir programın aboneliğinizi kendiliğinden kullanmasına izin vermeyi önermez ve hesabınız kısıtlanabilir.” — ve anahtar ancak **Yine de aç** düğmesine basıldıktan sonra açılır.

Anahtar açık olsa bile:

- İstekler tek tek işlenir. Diğerleri sırasını bekler.
- Saatlik sınır yoktur. Sıra iş bazında değil, istek bazında verilir; bu yüzden uzun bir PDF çevirisi diğer çağıranları bekletmek yerine onlarla sıra paylaşır. Eski uyarı altında açılmış bir anahtar kapatılmıştır: yeni uyarıyı okuyup yeniden açın.
- **Yine de kullan** ile izin verdiğiniz kullanım başına ödeme yapan bir oturum burada abonelik sayılmaz. Anahtar gibi işlem görür: kullanılacak AI olarak onu seçtiyseniz, anahtar ne derse desin görsel betimlemeleri onun üzerinden gider ve her biri faturalandırılır.

Anahtar kapalıyken ve hiçbir anahtar kurulu değilken araç, özelliğin kullanılamadığını söyler ve bu ayarı adlandırır. Bir ajan önce `capabilities` aracıyla denetleyebilir; bkz. [Komut satırı ve ajanlar](help://cli).

## Şemalar ve daha küçük bir bütçe

`apply` ve `create`, `ops`, `cells` ve `data` parametrelerini `ieumoffice guide <domain> --json` çıktısından üretilen tipli op şemasıyla duyurur. Bu kesindir ve küçük değildir. Bağlam penceresi dar bir istemci bunun yerine düz diziler isteyebilir:

```sh
ieumoffice mcp --compact-schemas
GENOFFICE_MCP_COMPACT_SCHEMAS=1 ieumoffice mcp
```

## Beceri neden gerekli

Op sözlüğünü bilmeyen bir ajan tahmin eder. Beceri, başvuruyu ve tasarım kılavuzlarını taşır — `ieumoffice guide` komutunun yazdırdığı aynı malzemeyi — böylece asistan, spec’ini gerçekten okuduğu op’ları yazar. Yukarıdaki bölmeden ya da bir terminalden `ieumoffice skill` ile kurun.

## Uygulamada neye erişebilir

Sunucu diskteki dosyalarla sınırlı değildir. GenOffice çalışırken ajan pencere üzerinden de çalışabilir:

- **`open_in_genoffice`** bir dosyayı sekmede açar ve ona odaklanır.
- **`open_documents`** açık olan her belgeyi listeler — kimlik, tür, yol ve kaydedilmemiş değişikliği olup olmadığı — sonra birinin canlı içeriğini okur, yerinde kaydeder veya kapatır; siz atmayı istemedikçe önce kaydeder.
- **İçerik araçları** o kimliği (veya yolu) `document` bağımsız değişkeni olarak alır, böylece bir düzenleme zaten açık olan sekmeye iner ve pencere onu göstermek için öne gelir.

İki şey erişimin dışında kalır: AI paneli yoktur ve uygulama içi güncelleme iletişim kutusu burada geçerli değildir.

## Yerel HTTP sunucusu bölmesi

**Yerel HTTP sunucusu** altında uygulama sunucuyu asistana bırakmak yerine kendisi çalıştırabilir: bir açma anahtarı, bir **Bağlantı noktası** alanı, bir **Çalışıyor / Çalışmıyor** göstergesi, **Arka planda oluşturma** (belgeleri arayüzü açmadan doğrudan bir yola yazma) ve istemcinize kopyalayacağınız **İstemci yapılandırma örneği**. **Gelişmiş** bölümünü açmak iki bağlantı URL’sini — Streamable HTTP ve eski SSE — bir **Durum denetimi** URL’sini ve sunucu ile araç etkinliğini, oradan **Aç**, **Yenile** veya **Temizle** yapabileceğiniz yerel bir dosyaya kaydeden bir **Günlük kaydı** anahtarını ekler. Yalnızca localhost üzerinde dinler.
