# GenOffice kurulumu

Her sürüm, projenin GitHub’daki [Sürümler sayfasında](https://github.com/pblsketch/ieumoffice/releases/latest) yayımlanır. Windows yapısı, beta olarak çıkarılan Mac ve Linux yapılarıyla birlikte yayımlanır. Geliştirici Mac ve Linux yapılarını doğrudan deneyemez; bunlar kullanıcıların bildirimleriyle doğrulanır.

## Makineniz için dosyayı seçin

| Platform                               | Gereksinimler                           | Dosya                             |
| -------------------------------------- | --------------------------------------- | --------------------------------- |
| **Windows**                            | Windows 10 veya üzeri, 64 bit Intel/AMD | `GenOffice-Setup-<version>.exe`   |
| **Mac (beta)**, Apple Silicon          | macOS 12 veya üzeri, M1 ya da daha yeni | `GenOffice-<version>-arm64.dmg`   |
| **Mac (beta)**, Intel                  | macOS 12 veya üzeri, Intel işlemci      | `GenOffice-<version>-x64.dmg`     |
| **Linux (beta)**, tüm dağıtımlar       | 64 bit (x86_64)                         | `GenOffice-<version>.AppImage`    |
| **Linux (beta)**, Ubuntu/Debian ailesi | 64 bit (x86_64)                         | `ieumoffice_<version>_amd64.deb`  |
| **Linux (beta)**, Fedora/RHEL/openSUSE | 64 bit (x86_64)                         | `ieumoffice-<version>.x86_64.rpm` |

Hangi Mac’e sahip olduğunuzu görmek için Apple menüsü ▸ **Bu Mac Hakkında**’yı açın. "Çip" Apple M… diyorsa sonu `-arm64.dmg` ile biten dosyayı, "İşlemci" Intel … diyorsa sonu `-x64.dmg` ile biteni alın. Sürümler sayfasındaki diğer dosyalar (`.zip`, `.yml`, `.blockmap`) uygulamanın kendini güncellemek için kullandıklarıdır; onları indirmeniz gerekmez. Eski sürümler Sürümler sayfasında kalır.

## Windows’ta

1. Sürümler sayfasından `GenOffice-Setup-<version>.exe` dosyasını indirin.
2. Çalıştırın. Yükleyici kod imzalı olmadığı için Windows önce mavi bir “Windows bilgisayarınızı korudu” penceresi gösterebilir. **Daha fazla bilgi**’yi ve ardından **Yine de çalıştır**’ı seçin. Tam ifade Windows sürümünüze göre değişir.
3. Yükleyiciyi sonuna kadar izleyin.

GenOffice’i Başlat menüsüne koyar ve `.docx`, `.xlsx`, `.pptx`, `.pdf` ile benzerlerini kaydeder, böylece bir dosyaya çift tıklamak onu açar.

Yükleyici imzalı olmadığı için yalnızca yukarıdaki Sürümler sayfasından indirdiğiniz bir dosyayı çalıştırın.

## Windows indirmeyi veya kurulumu engellediğinde

### Edge dosyanın "yaygın olarak indirilmediğini" söylüyor

Microsoft Defender SmartScreen, pek çok kişinin indirdiğini görmediği bir dosya için bu şekilde uyarır. Microsoft’un dosyayı tutmak için verdiği yol şudur:

1. Edge’in indirme listesini açın (**Ctrl+J**), dosyanın yanındaki **…** düğmesine basın ve **Sakla**’yı seçin.
2. Açılan pencerede **Daha fazla göster**’e, ardından **Yine de sakla**’ya basın. Dosya İndirilenler klasörünüzde kalır.

O pencerede dosyayı güvenli olarak bildiren bir düğme de vardır. Bu düğme yalnızca Microsoft’un bildirim sayfasını (`feedback.smartscreen.microsoft.com`) açar ve dosyayı tutmaz. O sayfayı kapatın ve bunun yerine penceredeki **Daha fazla göster**’e basın.

Pencerede **Daha fazla göster** veya **Yine de sakla** yoksa:

- Bir okulun veya şirketin yönettiği bir bilgisayarda yönetici bu uyarıları atlamayı kapatabilir (bir Edge ilkesi). O zaman o bilgisayarda kimse dosyayı tutamaz; yöneticiden onu kurmasını veya izin vermesini isteyin.
- Sürümler sayfasından başka bir tarayıcıyla indirmek size aynı dosyayı verir.
- İkisi de işe yaramazsa ve bilgisayar sizinse, Microsoft’un indirme sorun giderme kılavuzu son çare olarak Microsoft Defender SmartScreen’i kısa bir süre kapatmaya izin verir. Edge’de **Ayarlar ve diğer (…) ▸ Ayarlar ▸ Gizlilik, arama ve hizmetler ▸ Güvenlik**’i açın, **Microsoft Defender SmartScreen**’i kapatın, dosyayı yeniden indirin ve hemen ardından yeniden açın. Kapalıyken Edge sizi ne indirmeler ne de kimlik avı sayfaları gibi tehlikeli siteler hakkında uyarır.

### "Windows bilgisayarınızı korudu" penceresi beliriyor

Microsoft Defender SmartScreen, imzasız bir yükleyiciyi ilk gördüğünde bu pencereyi gösterir. **Daha fazla bilgi**’ye basın; bir **Yine de çalıştır** düğmesi belirir. Bir okulun veya şirketin yönettiği bir bilgisayarda bir yönetici ayarı bu düğmeyi gizleyebilir; yöneticiye sorun.

### Akıllı Uygulama Denetimi engelliyor

Windows 11’in Akıllı Uygulama Denetimi açıkken imzasız yükleyicileri durdurur ve **Daha fazla bilgi** yolu sunmaz. Microsoft, tek bir uygulamaya izin vermenin yolu olmadığını söyler: tek seçenek **Windows Güvenliği ▸ Uygulama ve tarayıcı denetimi ▸ Akıllı Uygulama Denetimi ayarları** altında Akıllı Uygulama Denetimi’ni kapatmaktır. Bu, korumayı diğer tüm uygulamalar için de kaldırır. Son Windows güncellemeleriyle Windows’u yeniden kurmadan yeniden açılabilir.

## Mac’te (beta)

macOS 12 (Monterey) veya üzeri gerekir. Mac yapısının Apple geliştirici imzası yoktur; bu yüzden onu ilk açtığınızda macOS, uygulamanın kötü amaçlı yazılım içermediğini doğrulayamadığını söyler ve açmaz. Aşağıdaki gibi bir kez izin verin.

1. dmg’yi açın ve `GenOffice.app` uygulamasını **Uygulamalar** klasörüne sürükleyin.
2. GenOffice’i Uygulamalar klasöründen açın. Uyarı belirdiğinde **Bitti**’ye basın.
3. **Sistem Ayarları ▸ Gizlilik ve Güvenlik**’i açın. Alta yakın bir yerde, GenOffice’in engellendiğini söyleyen satırın yanında **Yine de Aç**’a basın ve Mac parolanızı girin. Düğme, uygulamayı açmayı denedikten sonra yaklaşık bir saat görünür.
4. Yeniden beliren pencerede **Aç**’a basın. Bundan sonra uyarısız açılır.

macOS 12’de yer **Sistem Tercihleri ▸ Güvenlik ve Gizlilik ▸ Genel**’dir ve düğme orada da **Yine de Aç**’tır.

macOS uygulamanın "hasarlı olduğunu ve açılamadığını" söylerse onu Çöp Sepeti’ne taşımayın. Aşağıdaki satırı Terminal’de çalıştırın, sonra uygulamayı yeniden açın ve yukarıdaki gibi izin verin. Bu, macOS’un internetten indirilen dosyalara eklediği işareti kaldırır.

```sh
xattr -dr com.apple.quarantine /Applications/GenOffice.app
```

macOS uygulamanın bu Mac’te desteklenmediğini söylerse iki şeyi denetleyin:

- Intel bir Mac, Apple Silicon dosyasını (`-arm64.dmg`) çalıştıramaz. **Bu Mac Hakkında** altındaki "İşlemci"yi denetleyin, kurduğunuz uygulamayı silin ve bunun yerine `-x64.dmg` dosyasını kurun.
- macOS 11 veya daha eskisi GenOffice’i çalıştıramaz. **Bu Mac Hakkında** macOS sürümünü de gösterir.

Mac’te ayrıca:

- AI bağlantı kartlarında kurulum düğmesi yoktur. Claude Code veya Codex’i kurmak için kartın resmî kurulum kılavuzu bağlantısını izleyin. Claude masaüstü uygulaması Claude Code değildir; bu yüzden masaüstü uygulaması kurulu olsa bile Claude Code’un kurulması gerekir.
- Oturum açma tarayıcıda biter. Tarayıcı bir kod yapıştırmanızı isterse Terminal’de `claude auth login` veya `codex login` komutunu kendiniz çalıştırın. Bkz. [Abonelik bağlantısı](help://subscription).

## Linux’ta (beta)

- **AppImage**: dosyayı çalıştırılabilir yapın (`chmod +x GenOffice-<version>.AppImage`) ve çalıştırın. Kurulum adımı yoktur.
- **deb**: `sudo apt install ./ieumoffice_<version>_amd64.deb` ile kurun.
- **rpm**: `sudo dnf install ./ieumoffice-<version>.x86_64.rpm` ile kurun. openSUSE’de `sudo zypper install ./ieumoffice-<version>.x86_64.rpm` kullanın.

deb ve rpm paketleri `/opt/GenOffice` konumuna kurulur ve `/usr/bin/ieumoffice` terminal komutunu bağlar. Mac’te olduğu gibi AI bağlantı kartlarında kurulum düğmesi yoktur ve bir oturum açma kod istediğinde bir terminalde `claude auth login` veya `codex login` komutunu kendiniz çalıştırırsınız.

## Güncellemeler

- GenOffice yeni bir sürümü aynı GitHub Sürümler sayfasında arar. Yeni bir sürüm yayımlandığında **Ayarlar ▸ Hakkında** onu sunar: **… sürümüne güncelle** düğmesine basın, indirmeyi bekleyin, sonra **Yeniden başlat ve yükle** düğmesine basın. Windows’ta bir yükleyici penceresi ilerlemeyi gösterir; bittiğinde GenOffice açık belgelerinizle birlikte yeniden açılır. Mac’te uygulama kapanır, yeni sürümle değiştirilir ve açık belgelerinizle yeniden açılır. Bu, Uygulamalar klasöründeki bir uygulama için çalışır; doğrudan disk görüntüsünden açılan bir uygulama bunun yerine sizi indirme sayfasına yönlendirir. Güncelleme yalnızca o düğmeye bastığınızda kurulur; uygulamayı sadece kapattığınızda hiçbir zaman kurulmaz.
- Linux’ta yalnızca AppImage kendini günceller. deb veya rpm kurulumunda uygulama yeni sürümü size bildirir ve indirme sayfasını açar; yeni dosyayı aynı şekilde kurun.
- **Menü (☰) ▸ Güncellemeleri denetle** istediğiniz zaman denetler. Mac’te bu, **Yardım ▸ Güncellemeleri denetle**’dir. Mac’te bu komut uygulama menüsünde, GenOffice hakkında öğesinin hemen altında da bulunur.
- Denetim başarısız olduğunda — ağ yoksa ya da henüz bir şey yayımlanmamışsa — hiçbir şey olmaz ve uygulama eskisi gibi çalışmaya devam eder.
- Ayarlar ▸ Hakkında altında yer alan **Güncelleme kanalı** da Kararlı veya Beta’dır. Değiştirmek hemen etkili olur ve bir güncelleme denetler; Beta kurulumunu Kararlı’ya geri düşürmez.
- Güncellemeler de kod imzalı değildir. Bir güncellemeyi kurmadan önce uygulama, indirilen dosyayı o sürümle birlikte yayımlanan sağlama toplamıyla karşılaştırır.
- **Yeniden başlat ve yükle** uygulamayı kapatır da yeni sürüm görünmezse, bir sonraki açılış bunu söyler ve güncellemeyi yeniden sunar. Bu kez yükleyici kendi penceresinde açılır, böylece onu izleyip yönetici istemine yanıt verebilirsiniz. Bu da işe yaramazsa güncelleme penceresi indirme sayfasına yönlendirir; oradan aldığınız dosyayı kurmak ayarlarınızı ve belgelerinizi korur. Güncelleyicinin ne yaptığı, uygulamanın veri klasöründeki `update-log.txt` dosyasına yazılır (açmak için Dosya Gezgini’nin adres çubuğuna `%APPDATA%\GenOffice` yazın). Sorunu bildirirken bu dosyayı ekleyin.

## Çalıştırdığınız yapı

**Ayarlar ▸ Hakkında**, uygulamanın elinizdeki sürümü, izlediği kanalı ve projenin nerede durduğunu bildirdiği yerdir. Ayrıca bu uygulamanın temel aldığı açık kaynak projenin adını da belirtir.

## Komut satırı da onunla gelir

Her kurulum, penceredekiyle aynı motorlarla konuşan bir `ieumoffice` komutu içerir, böylece ikisi bir dosya konusunda asla anlaşmazlığa düşmez. `ieumoffice install-cli` komutu onu `PATH`’inize ekler. Neler yapabildiğini görmek için [Komut satırı ve ajanlar](help://cli) bölümüne bakın.
