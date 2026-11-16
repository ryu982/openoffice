# Komut satırı ve ajanlar

Her kurulum, penceredekiyle aynı motorları çalıştıran bir `ieumoffice` komutu içerir — aynı ayrıştırıcılar, aynı yazıcı, aynı görüntüleyici. Uygulamanın kaydettiği dosya ile komutun yazdığı dosya aynı dosyadır; uygulamanın AI panelinin geçtiği bir denetimden komut da geçer.

```sh
ieumoffice --help          # every command
ieumoffice guide slides    # the op reference, for writing your own
```

`ieumoffice --help` tek ekranda bütün yüzeydir: her komut ne yaptığını söyleyen bir satırla, ardından genel seçenekler ve çıkış kodları.

## Komutu edinme

Komut uygulamanın içinde gelir. Adıyla kullanmak için bir kez `ieumoffice install-cli` komutunu çalıştırın: Windows’ta komutu barındıran klasörü kullanıcı `PATH`’inize ekler ve sonrasında açtığınız terminaller onu bulur. **Ayarlar ▸ Entegrasyonlar**, terminalinizin komutu zaten bulup bulmadığını ve bulamıyorsa çalıştırılacak tam satırı gösterir.

Kodlama ajanları bu adıma ihtiyaç duymaz. Uygulama komutun yerini `~/.ieumoffice/launcher` dosyasına yazar; ajanlar onu orada bulur.

## Bilinmeye değer komutlar

| Komut             | Ne yapar                                                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `open`            | Bir belgeyi uygulamada açar; uygulama çalışmıyorsa başlatır.                                                                                                                                                                               |
| `selection`       | Uygulama çalışırken kullanıcının o dosyada tam şu anda neyi seçtiğini söyler — “bu” / “burası” için işaretçi. Dosya hangi düzenleyicideyse ona göre bir blok aralığı, bir çalışma sayfası aralığı, slayt öğeleri ya da bir sayfa döndürür. |
| `convert`         | Uygulamanın kendi motorlarını kullanarak biçimler arasında dönüştürür.                                                                                                                                                                     |
| `create`          | Yapılandırılmış içerikten bir belge oluşturur.                                                                                                                                                                                             |
| `render`          | Görüntüleyicinin yerleştirdiği biçimde her sayfa için bir PNG.                                                                                                                                                                             |
| `pdf`             | Bir PDF’nin metin katmanını, uygulama süreci olmadan sayfa sayfa okur.                                                                                                                                                                     |
| `read-url`        | Bir web sayfasının metnini komut satırından okur — bir makale, bir belge ya da bir becerinin bağlantısı; metni yazdırır ve `--offset` ile devam eder.                                                                                      |
| `info`            | Bir belgenin üst verileri ve yapı özeti.                                                                                                                                                                                                   |
| `search`          | Web veya görsel araması: varsayılan olarak ücretsiz arama ya da uygulamada anahtarını seçtiğiniz arama sağlayıcısı.                                                                                                                        |
| `image` / `media` | Bir görsel oluşturur ya da bir görsel, video veya ses dosyası hakkında açıklama yapar ve sorular sorar.                                                                                                                                    |
| `merge`           | Bir `.docx`, `.pptx` veya `.xlsx` şablonundaki `{{key}}` yer tutucularını doldurur.                                                                                                                                                        |
| `capabilities`    | Bu makinede hangi AI özelliklerinin (arama, görsel oluşturma, görsel ve video analizi) hangi yolla kullanılabildiğini bildirir.                                                                                                            |
| `guide`           | Yürütücünün doğruladığı tanımların aynısından üretilen op başvurusu ve tasarım kılavuzları — böylece `apply` komutunun kabul ettiğinden sapamaz. `--json` her op’un şemasıyla birlikte döndürür.                                           |
| `install-cli`     | `ieumoffice` komutunu `PATH`’e koyar.                                                                                                                                                                                                      |
| `skill`           | Bu makinede bulunan kodlama ajanlarını listeler ve onlara GenOffice becerisini kurar veya günceller.                                                                                                                                       |
| `mcp`             | Her komutu bir Model Context Protocol aracı olarak sunar. Bkz. **Bir kodlama ajanı bağlama**.                                                                                                                                              |

## Düzenleme: docs, sheets, slides

`ieumoffice docs`, `ieumoffice sheet` ve `ieumoffice slides` komutlarının her biri önce bir alt komut alır — `read`, `apply`, `check` ve slides için `audit`, `render`, `replace` — ve uygulamanın kullandığı aynı yazma yolundan geçer. Tek bir sözlüğü paylaşırlar: bir **op** tek bir düzenlemedir, bir **spec** ise sırayla uygulanan op listesidir.

```sh
ieumoffice sheet read report.xlsx
ieumoffice slides apply deck.pptx --ops ops.json --dry-run
ieumoffice docs apply brief.docx --ops ops.json
```

`--dry-run` bir toplu işin ne yapacağını bildirir ve hiçbir şey yazmaz; bir spec’i uygulamaya koymadan önce denetlemenin ucuz yolu budur. Uygulamadaki AI paneli tam olarak bu op’lar üzerinde çalışır, yani ona yaptırabileceğiniz her şeyi betikleştirebilirsiniz.

## Arama, görsel ve medya komutları

`search`, `image` ve `media`, uygulamada Ayarlar ▸ AI ▸ Gelişmiş altında kurulmuş olanı kullanır:

- `search` her zaman çalışır. Varsayılan olarak ücretsiz aramayı ya da anahtarını seçtiğiniz arama sağlayıcısını kullanır.
- `image`, Ayarlar'daki görsel üretimi seçimini izler. Varsayılan seçim olan ChatGPT planı (Codex programı) ile Codex programı üzerinden ChatGPT planınızla çizer; ancak bunu yalnızca otomatik çağrılarda abonelik kullanımına izin verdiyseniz yapar (**varsayılan olarak kapalı**; bkz. [Bir kodlama ajanı bağlama](help://mcp)). Aksi halde kurduğunuz bir görsel sağlayıcısının anahtarını kullanır. `--model`, o yol modeli sunuyorsa kullanılır; sunmuyorsa komut kullanabileceğiniz modellerle yanıt verir. `--ref` ile verilen görseller iki yolda da çalışır.
- Bir görsel üzerinde `media`, kuruluysa bir anahtar sağlayıcı kullanır. Claude veya Codex aboneliğinizi yalnızca buna izin verdiyseniz kullanır ve bu varsayılan olarak **kapalıdır**; [Bir kodlama ajanı bağlama](help://mcp) anahtarı ve sınırlarını açıklar.
- Video veya ses üzerinde `media`, videoyu destekleyen bir anahtar sağlayıcı gerektirir.

`ieumoffice capabilities --json` bütün bunları hiçbir AI’ı çağırmadan bildirir. `detail` alanı şunları taşır:

| Alan                                                                             | Ne söyler                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search`, `image_search`, `image_generation`, `image_analysis`, `video_analysis` | Her özellik için: `available`; `via`, kimin yanıtladığı; `route`, `free`, `key` veya `subscription` seçeneklerinden biri; kullanım başına ödeme yapan oturum için `metered: true`; ve özellik kullanılamıyorsa komutun kendisinin yanıtladığı metin olan `message`. |
| `media_analysis`                                                                 | Eski betikler için tutulur: `image_analysis` ile aynı ya da yalnızca video çalışıyorsa `video_analysis` ile aynı.                                                                                                                                                   |
| `automatic_calls`                                                                | `subscription_enabled` ve o açıkken son bir saatte işlenen otomatik istekler olan `used` (yalnızca bilgi amaçlı); `limit` ve `remaining` her zaman `null`.                                                                                                          |
| `app`                                                                            | `available`: uygulamanın komutun başlatabileceği yerde kurulu olup olmadığı.                                                                                                                                                                                        |
| `settings_path`                                                                  | Bu yanıtların okunduğu ayarlar dosyası.                                                                                                                                                                                                                             |

`image` veya `media` çalışamadığında komut 4 koduyla ve `error: "app_unavailable"` ile çıkar; `detail.errorCode` nedenini söyler. `unavailable`, özellik için hiçbir şeyin kurulmadığı anlamına gelir, bu yüzden yeniden denemek işe yaramaz. `rate-limit`, isteklerin yeniden mümkün olduğu zamanı (milisaniye olarak) taşıyan `detail.resetsAt` ile gelir.

## Bu bilgisayarda neler tutar

İki dosya da kullanıcı klasörünüzdeki `.ieumoffice` klasöründedir:

- `~/.ieumoffice/launcher` uygulamanın komutunun nerede olduğunu kaydeder, böylece bir kodlama ajanı onu `PATH`’inizde olmasa bile bulur.
- `~/.ieumoffice/cli-audit.jsonl` çalıştırılan her komut için bir satır alır — komut, bağımsız değişkenleri ve sonuç — böylece sonradan bir ajanın ne yaptığını görebilirsiniz.

## Model Context Protocol

`ieumoffice mcp` her komutu bir MCP aracı olarak sunar; `ieumoffice mcp install <agent|all>` ise onu bir kodlama ajanının kendi yapılandırmasına kaydeder. O taraf için bkz. **Bir kodlama ajanı bağlama**.

## Komutun yapmadıkları

Dosyayı okur ve yazar. Uygulama değildir: penceresi yoktur ve uygulama içi güncelleme iletişim kutusu burada geçerli değildir. Pencereyi gerektiren her şey — AI paneli, işlenmiş bir slayt üzerinde kalite denetimi — siz dosyayı açana kadar bekler. `ieumoffice render` pikselleri o olmadan verir, `ieumoffice slides` ise bir sunumun düzenini kendi başına denetler.
