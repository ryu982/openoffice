# Projeler

Proje, bilgisayarınızdaki tek bir klasördür. Bir AI panelinde bir proje seçin; AI o klasörün dosyalarını, yönergelerini, belleğini ve sohbetlerini bilerek çalışır. Bir işin belgelerini tek bir klasörde tutun; Docs’ta başlayan bir sohbet, arka planı her belgede yeniden anlatmadan Hangul’da veya Slides’ta sürebilir.

## Proje seçme

- Her düzenleyicinin AI panelinde ve Giriş ekranındaki **AI’a sor**’da geçerli projenin adı girişin altında, solda durur. Hiçbiri seçilmemişken **Proje yok** yazar.
- Listeyi açmak için ona tıklayın: **Sabitlenmiş** ve **Son kullanılan** projeler, **Yeni proje**, **Klasör ekle** ve **Proje yok**. Aramak için üstteki kutuya yazın; hiçbir proje eşleşmediğinde o adla yeni bir proje oluşturabilirsiniz.
- Sabitleme, **Klasörü aç** ve **Listeden kaldır** için bir satırın üzerine gelin. Bir projeyi listeden kaldırmak klasörü ve dosyalarını olduğu gibi bırakır.
- Klasörü taşınan veya silinen bir proje soluk olarak **Klasör bulunamadı** biçiminde görünür. Aynı projeyle devam etmek için ona tıklayın ve taşınan klasörü seçin.
- Bir proje klasörünün içindeki bir belgeyi açın; o proje zaten seçilidir. O belgeyi **Proje yok**’a geçirin; bir sonraki açışınızda da öyle kalır. Klasörün dışındaki bir belge için seçtiğiniz proje de o belge için hatırlanır.
- Seçtiğiniz proje o panelin bir sonraki isteğinden itibaren geçerli olur. Bir sohbetin ortasında değiştirmek yeni bir sohbet başlatır; içinde olduğunuz sohbet olduğu yerde kalır.

## Yeni proje ve Klasör ekle

- **Yeni proje**: bir ad yazın; varsayılan kayıt klasörünüzde (başta `Documents\GenOffice`; Ayarlar’dan değiştirebilirsiniz) o adla bir klasör oluşturulur. **Başka bir yerde oluştur…** başka bir yer seçmenizi sağlar. O adla bir klasör zaten varsa onu proje olarak kullanıp kullanmayacağınız sorulur ve **Bu klasörü kullan** onunla başlar. O klasör listenizde zaten bir projeyse sormadan doğrudan açılır.
- **Klasör ekle** (Giriş ekranının Projeler ekranında **Var olan bir klasörü kullan**): zaten sahip olduğunuz bir klasörü kullanın. Alt klasörleri de dahil edilir. Bir sürücünün tamamı, kullanıcı klasörünüzün tamamı ve oturum açma verilerini ya da uygulamanın verilerini tutan klasörler seçilemez.
- Listenizde olmayan bir proje klasörünün içindeki bir belgeyi açın; girişin altında **Kullan** düğmesiyle birlikte "Bu belge '…' proje klasöründe" belirir. Ona tıklamak Klasör ekle ile aynıdır.
- Başkasından aldığınız bir klasör zaten yönergeler veya bellek, `AGENTS.md` ya da `CLAUDE.md` veya başka bir bilgisayarda yazılmış sohbetler barındırıyorsa uygulama bunları bir kez gösterir ve sorar. **Tümünü görüntüle** önce her şeyi okumanızı sağlar. **Yönergelerle kullan** hepsini kullanır. **Yönergeler olmadan kullan** bu yönergeleri ve belleği AI’dan uzak tutar, diğer bilgisayarlardan gelen sohbetleri gizler ve bellek eklemeyi durdurur; dosya okuma yine çalışır. Daha sonra projenin sayfasındaki **Yönergeleri de kullan** ile geçiş yapabilirsiniz. **İptal** veya soruyu seçim yapmadan kapatmak klasörü eklemez.
- Bundan sonra yeniden sormaz. Yönergeler veya bellek GenOffice dışında değişirse AI paneli bir kez "Yönergeler değişti" gösterir ve **Görüntüle** projenin sayfasının o bölümünü açar.

## Yönergeler ve bellek

- **Yönergeler** bu projenin kurallarıdır; örneğin "Raporları madde işaretleriyle yaz ve kurumun adını asla kısaltma". Bunları Giriş ekranında projenin sayfasına yazın ve **Kaydet**’e basın. Klasörün en üstünde `AGENTS.md` veya `CLAUDE.md` varsa onlar da okunur ve projenin sayfasından kapatabilirsiniz.
- **Bellek**, AI’ın sohbetler sırasında yazdığı notlardır: daha sonra işe yarayacak gerçekler, tercihler ve kararlar, her biri tarihiyle tek satır. AI her not yazdığında AI paneli **Sil** düğmesiyle birlikte "Hatırlandı: …" gösterir. O not zaten silinmişse satırda "Bellekten kaldırıldı: …" yazar ve **Sil** düğmesi olmaz. Önce size sormaz.
- Bellek uzadığında AI paneli **Toparla** ile birlikte "Bellek uzuyor" gösterir. Ona basmak çakışan veya güncelliğini yitirmiş notları birleştirir. Önceki sürüm saklanır ve **Geri al** onu geri getirir. Toparlama yalnızca düğmeye bastığınızda olur ve bir AI isteği gönderir.
- Projenin sayfasında notları silebilir, belleğin tamamını düzenleyebilir ve belleği kapatabilirsiniz. Kapalıyken yeni bir şey yazılmaz ve var olan bellek okunmaya devam eder.
- Çok uzun yönergelerin son kısmı kaybolur ve AI paneli bunu size söyler. Bellek ne kadar uzun olursa olsun her zaman tamamen gönderilir.

## AI’ın gördüğü dosyalar

- Her istekle birlikte AI projenin adını, yönergelerini ve belleğini ve klasördeki dosyaların adlarının bir listesini alır. Bir dosyanın içeriğine ihtiyaç duyduğunda onu bir ek gibi kendisi okur; böylece AI’dan gizlenen bölümler gizli kalır.
- Kaydedilmemiş değişiklikleri olan açık belgeleri, adı noktayla başlayan gizli dosyaları veya `.ieumoffice` klasörünü okumaz.
- Bir dosyayı AI’dan uzak tutmak için projenin sayfasının Dosyalar bölümünde **AI’dan gizle**’ye basın. Bunu geri alabilirsiniz. Dosya Giriş ekranındaki arama sonuçlarında görünmeye devam eder.
- OneDrive, Google Drive ve benzerlerinin eşitlediği klasörlerde bu bilgisayara indirilmemiş dosyalar "Bu bilgisayarda değil" olarak görünür. AI birini okumak istediğinde önce indirip indirmeyeceğiniz sorulur.
- Girişe `@` yazın; açık belgelerden sonra "Bu projedeki dosyalar" belirir. Birini seçmek onu ekler. Bkz. [AI asistan paneli](help://ai-panel).
- AI’ın bir projede yaptığı yeni belgeler geçerli belgenin klasörüne veya Giriş ekranından sorduğunuzda proje klasörünün en üstüne kaydedilir. Ad alınmışsa hiçbir dosyanın yerine geçilmemesi için `(2)` eklenir.

## Sohbetler

- Proje seçili bir AI paneli üstte geçerli sohbetin başlığını gösterir. Bu projenin sohbet listesi, bir arama kutusu ve **Yeni sohbet** için ona tıklayın. Listedeki herhangi bir sohbete herhangi bir düzenleyicide yeniden devam edilebilir.
- Başka bir düzenleyicide yapılanlar "Hangul 'rapor.hwp' içinde 3 araç çalıştırıldı" gibi tek bir satır olarak görünür. AI yalnızca bulunduğunuz düzenleyicinin araçlarını kullanır.
- Bir belgeyi açmak o belgede en son kullanılan sohbeti gösterir. İki pencerede aynı sohbet açıksa birinde gönderilen bir ileti hemen diğerinde de görünür.
- Başka bir bilgisayarda yazılan sohbetler **Diğer bilgisayar** olarak işaretlenir.
- Listede sohbetleri yeniden adlandırabilir veya silebilirsiniz. Silinen bir sohbet çöp kutusuna gider.
- Bir belgenin bu özellikten önceki sohbetleri listenin en altında, **Bu belgedeki önceki sohbetler** altında bulunur.
- **Proje yok** ile yapılan sohbetler eskisi gibi belge başına kaydedilir. Giriş ekranındaki AI’a sor’da proje olmadan, uygulamayı kapattığınızda sohbet sona erer.

## Giriş ekranında projenin sayfası

Giriş ekranının kenar çubuğundaki **Projeler**, **Yeni proje** yaptığınız veya **Var olan bir klasörü kullan**dığınız ve yönetmek için birini açtığınız yerdir.

- **Başlık**: ad (yeniden adlandırmak klasörü yeniden adlandırmaz), klasör yolu, **Dosya Gezgini’nde aç** (Mac’te **Finder’da göster**) ve durum. Proje yönergeler olmadan kullanılıyorsa **Yönergeleri de kullan** belirir.
- **Yönergeler**: yönerge kutusu ve onunla birlikte okunan `AGENTS.md` ve `CLAUDE.md`.
- **Bellek**: not listesi, **Tümünü düzenle**, **Toparla**, belleği açma veya kapatma.
- **Dosyalar**: AI’ın gördüğü dosyalar ve ondan uzak tutulanlar. Dosyayı açmak için bir dosya adına tıklayın.
- **Sohbetler**: bu projenin sohbetleri. En son kullanıldığı belgeyi açıp o AI panelinde devam etmek için birine tıklayın.
- Bu ekran her gösterildiğinde klasörü yeniden okur; böylece AI’ın az önce hatırladığı bir not ekrandan çıkmadan görünür. Siz düzenlerken yönerge veya bellek dosyası GenOffice dışında değiştiyse **Kaydet** önce sorar: **Yeniden yükle** değişen dosyayı okur, **Yine de kaydet** onun üzerine sizin düzenlemelerinizi yazar.

## Klasörde kalanlar ve bilinmesi gerekenler

- Yönergeler, bellek ve sohbetler proje klasörünün içindeki bir `.ieumoffice` klasöründe metin dosyaları olarak tutulur. Klasörü taşıyın veya başka bir bilgisayara kopyalayın, onlar da birlikte gider. Başka bir bilgisayarda onu bir kez bir AI panelindeki **Klasör ekle** veya Giriş ekranının Projeler ekranındaki **Var olan bir klasörü kullan** ile seçin.
- `.ieumoffice` klasörü yalnızca yazılacak bir şey olduğunda oluşturulur. Dosyalarını Not Defteri’nde açıp düzenleyebilirsiniz.
- Bir sohbete yazdığınız şeyler belleğe girebilir. Bir şeyi dışarıda tutmak için "Hatırlandı" satırındaki **Sil** ile silin veya belleği kapatın.
- Eşitlenen bir klasörü proje olarak seçerseniz yönergeleri, belleği ve sohbetleri de o hizmete yüklenir. Uygulama bunu ilk seçtiğinizde bir kez söyler.
- Birkaç kişinin kullandığı paylaşılan bir klasörde bellek ve sohbetler karışabilir.
- Uygulamanın yazamadığı bir klasörde, örneğin salt okunur bir klasörde, yönergeler ve dosya okuma yine çalışır ama sohbetler ve bellek kaydedilmez. AI paneli bunu size söyler.
- Ajan penceresi henüz projeleri kullanmaz. Bir ajan bir klasörün `.ieumoffice` içindeki dosyaları da değiştirebilir; bu yüzden bilmediğiniz malzemenin bulunduğu bir klasörde önce soran yollardan birini kullanın. Bkz. [Ajan modu](help://agent-mode).
