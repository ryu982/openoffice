# Práce se soubory: přejmenování, odstranění, export

Tato kapitola popisuje práci se soubory společnou všem editorům; vlastní možnosti exportu každého editoru najdete v jeho kapitole.

Nabídka **⋯** na řádku (objeví se po najetí na řádek souboru) sdružuje tyto akce:

![Nabídka ⋯ na řádku souboru](img/file-ops.png)

## Přejmenování

Dvě vstupní místa, jedna sada kontrol:

- **⋯ ▸ Přejmenovat** na řádku domovské stránky.
- **Dvojklik na kartu souboru** přejmenuje přímo na místě (viz [Karty a správa oken](help://tabs-and-windows)).

Pravidla: přípona se zachovává automaticky; nepovolené znaky, tečky na konci a rezervované názvy (CON, NUL a podobně) se odmítnou s hlášením; překrytí názvu ve stejné složce se rovněž zablokuje. Přejmenuje se skutečný soubor na disku a seznamy nedávných a oblíbených se aktualizují.

## Odstranění

- **⋯ ▸ Odstranit** na domovské stránce: zeptá se, které soubory, a přesune je do **systémového koše**, odkud je může obnovit operační systém. GenOffice si pro tuto věc nepřidržuje vlastní zpět — obnova je v kompetenci koše, ne oznámení.

## Duplikování

**⋯ ▸ Duplikovat** vytvoří ve stejné složce kopii souboru <jméno>; při kolizi názvů se automaticky připojí číslo. Kopie přibude do **Nedávné** místo toho, aby se sama otevřela — je na jeden klik od vás, ne před vámi.

## Uložit a Uložit jako

- **⌘S / ctrl+S** uloží aktuální soubor; soubor bez názvu se nejdřív zeptá na umístění a název.
- Ve většině editorů nabízí seznam typů souborů v okně Uložit jako také exportní formáty (PDF, obrázky, jiné formáty dokumentů). Volba jednoho z nich zapíše jen kopii; otevřený dokument a jeho karta zůstávají u původního souboru. Obrázky více stránek se rozdělí na `název-01.png`, `název-02.png`, ….
- **Docs**: seznam Uložit jako nabízí také .hwp a .hwpx (Soubor ▸ Exportovat jako dokument HWP… dělá totéž). Pokud něco nelze převést, například komentáře, rovnice nebo textová pole, dozvíte se to před zápisem souboru.
- **Uložit jako…** zapíše nový soubor a originál ponechá nedotčený; další úpravy se týkají nového souboru.
- Každé uložení je atomické (dočasný soubor + přejmenování); ukončení uprostřed zápisu soubor nepoškodí.
- Automatické ukládání se řídí přepínačem v každém editoru; nový dokument bez vlastního souboru začne až po prvním uložení (viz [Rychlý start](help://getting-started)).

## Export do PDF

- **Docs**: Soubor ▸ Exportovat jako PDF… (nebo tlačítko na pásku), s aktuálním stránkováním.
- **Slides**: export rastruje stránku po stránce, u velkých prezentací s ukazatelem průběhu.
- **Sheets**: export používá stránkování pro tisk.
- Exporty se vykreslují ve skrytém okně a ukládají tam, kam zvolíte.

## Export do Wordu a obrázků

- **Exportovat jako Word…** u PDF: převede PDF na soubor .docx (místní převod; složitá rozvržení se překládají, jak nejlépe lze).
- **Docs** umí exportovat stránky jako obrázky (PNG na stránku).

## Tisk

Soubor ▸ Tisk (⌘P/ctrl+P) otevře v každém editoru okno tisku. Docs, PDF, Sheets, Slides a Markdown mají oddíl **Rozložení stránek** ve svém obvyklém okně tisku, HWP v náhledu tisku a HTML, myšlenková mapa a diagram v novém malém okně tisku. Když v oddílu Rozložení stránek nic nezvolíte, tiskne se stejně jako dřív.

- **Rozložení**: zvolte Jedna stránka na list, Více stránek na list (2, 4, 6, 9 nebo 16), Brožura (vazba vlevo nebo vpravo), Plakát (listů vodorovně a svisle, překryv, čáry řezu) nebo Štítky (jedna stránka na štítek nebo stejná stránka na každém štítku, počáteční štítek, běžný formát A4 nebo vlastní rozměry).
- **Jen liché strany listu, jen sudé strany listu, obrácené pořadí**: strany se počítají po rozložení, podle toho, co skutečně vyjde z tiskárny. Hodí se u tiskárny bez oboustranného tisku: vytiskněte přední strany, papír otočte a vytiskněte zadní strany.
- **Zmenšit na velikost papíru**: zmenší se jen stránky větší než zvolený papír; menší se nezvětšují. Sheets a Markdown používají svá dosavadní pole pro papír a měřítko.
- **Odstíny šedi a rozlišení obrázků**: při tisku s volbami Rozložení stránek se každá stránka převede na obrázek a teprve pak jde do tiskárny. Rozlišení volíte z možností Automaticky, 150, 300 nebo 600 dpi.
- **Jen výběr**: Docs a Markdown vytisknou jen vybraný text, znovu zalomený od první stránky; Slides vytiskne vybrané snímky a PDF vybrané stránky. Sheets tiskne vybranou oblast jako dřív.
- **Nákres rozložení a náhled výsledku**: nákres hned ukazuje, kam na papíře padne které číslo stránky, a **Náhled výsledku** ukáže, co se skutečně vytvořilo. **Uložit rozložený výsledek jako PDF** umožní vytisknout stejné rozložení na jiném počítači nebo v tiskárně.
- **Systémové okno tisku**: pro brožuru zvolte oboustranný tisk s otáčením podél krátké hrany. Rozsah stránek a počet stránek na list nechte v systémovém okně beze změny.

Soubory PDF se tisknou s aktuálním pořadím stránek a otočením.

## Kam putují soubory bez názvu

Umístění, které zvolíte při prvním uložení, je jejich domovem. Do té doby nemá dokument vlastní soubor: jeho neuložený obsah existuje jen jako kopie pro obnovení v datové složce aplikace, takže se dá vrátit, i když se aplikace náhle vypne (viz [Karty a správa oken](help://tabs-and-windows)). Automatické ukládání se ujme až po tomto prvním uložení.
