# Tabule: brainstorming, skicování a anotace

Editor tabule otevírá soubory `.whiteboard` v záložce. Můžete na něm rozvrhovat lepící lístky, text, tvary, spojnice, tabulky, nálepky, obrázky, karty odkazů a ruční tahy perem na nekonečných volných plochách i pevných stránkách, vkládat stránky PDF jako pozadí, exportovat do obrázků či PDF a pracovat s panelem AI. Vše běží lokálně ve vašem počítači.

## Otevírání a vytváření

- Nová tabule začíná jako volná nekonečná plocha z dlaždice **Tabule** na domovské obrazovce nebo přes Nový v nabídce Soubor.
- Editor otevírá soubory `.whiteboard` z dialogu otevření, přetažením do okna, z posledních souborů, stromu složek, Rychlého náhledu (Mezerník) nebo z Disku Google. Ve Windows instalace GenOffice zaregistruje aplikaci jako výchozí program pro `.whiteboard`.
- Soubory Excalidraw (`.excalidraw`, `.excalidraw.png`, `.excalidraw.svg`) se importují jako nová nepojmenovaná tabule. Původní soubor se nikdy nepřepisuje, zavření beze změn nevyvolá dotaz na uložení a první uložení nabídne `.whiteboard` ve stejné složce. Nepodporované prvky jako webové vložky se přeskočí a jejich počet zobrazí lišta. Ve Windows se `.excalidraw` nabízí pouze v "Otevřít v programu".
- Pokud je tabule již otevřená, její záložka se přesune do popředí.

## Úpravy a nástroje

- Jeden soubor `.whiteboard` může v pruhu stránek kombinovat volné plochy a pevné stránky (obrazovka 16:9, A4 na výšku i šířku a vlastní velikosti stránek PDF).
- Nástroje zahrnují výběr, lepící lístky, formátovaný text, osm tvarů, spojnice a šipky, tlakově citlivé pero, zvýrazňovač a gumu, obrázky, tabulky, vestavěné nálepky a karty odkazů.
- Chcete-li vybrat více objektů najednou, natáhněte nástrojem pro výběr obdélník z prázdného místa. Pokud objekty nenechávají žádné prázdné místo, zvolte v levém panelu nástrojů **Vybrat oblast** (M) a začněte táhnout přímo nad objekty. Vyberou se jen objekty, které leží celé uvnitř obdélníku. Kliknutí na objekt se Shiftem (nebo Ctrl) jej přidá do výběru nebo z něj odebere, tažení se Shiftem přidá objekty z dalšího obdélníku a Ctrl+A (⌘A na Macu) vybere všechny objekty na aktuální stránce. Přetažením kteréhokoli vybraného objektu se všechny posunou společně a Přenést dopředu, Přenést dozadu, Duplikovat a Smazat platí pro všechny najednou, každá akce jako jeden krok zpět.
- Přetáhněte soubor `.pdf` do otevřené tabule nebo zvolte **Importovat PDF**, čímž převedete vybrané stránky PDF na pevné stránky pozadí pro poznámky a náčrty. Otevření `.pdf` z domovské obrazovky či nabídky Soubor jej nadále otevře v editoru PDF.
- Klávesa F5 nebo tlačítko **Prezentovat** zobrazí tabuli na celou obrazovku s přepínáním stránek šipkami.
- V tmavém motivu ztmavnou panely nástrojů, boční panely a okolí mimo stránku, zatímco papír, lístky, tvary a tahy si zachovají původní barvy dokumentu.

## Ukládání, export a tisk

- Uložení, Uložit jako, automatické ukládání, záložní kopie při pádu a kontrola kolizí v rozděleném zobrazení fungují stejně jako v ostatních editorech. Beze změn se soubor znovu nezapisuje.
- Exportujte do PNG, SVG nebo PDF pro **Všechny stránky** nebo **Jen aktuální stránku**. Na volné ploše export i tisk obepnou všechny objekty s okrajem, nebo výchozí oblast u prázdné tabule.
- Tisk (Ctrl+P) podporuje běžný tisk i pokročilé rozvržení stránek. Exporty a výtisky jsou ve světlém i tmavém motivu shodné.

## Panel AI

- Požádejte AI o roztřídění lístků, návrh šablony workshopu či retrospektivy, přidání tvarů, spojnic, tabulek či obrázků nebo shrnutí obsahu.
- AI dostává strukturovanou textovou tabulku tabule a pokud zvolený model podporuje obrázky, automaticky přiloží snímek aktuální stránky. Čistě textové modely pracují pouze s textovou tabulkou.
- Každé volání úpravy AI tvoří jeden krok zpět (Ctrl+Z), změněné objekty zvýrazní jen na obrazovce bez zásahu do uloženého souboru a nabízí tlačítko **Vrátit tyto změny** na kartě odpovědi.
- Soubory `.whiteboard` lze přikládat v panelech AI jiných editorů, zmiňovat pomocí `@`, vyhledávat na domovské obrazovce, používat ve funkci **Vytvořit jiný dokument** (včetně převodu do Markdown bez AI) a ovládat přes [příkazy terminálu](help://cli) (`ieumoffice whiteboard read`, `ieumoffice whiteboard apply`, `ieumoffice create --type whiteboard`).

## Použití internetu a karty odkazů

- Otevírání, úpravy, export, tisk, import Excalidraw ani import stránek PDF neposílají na internet žádná data.
- Kliknutí na kartu odkazu otevře adresy `http`, `https` nebo `mailto` ve vašem výchozím prohlížeči.
- Pouze když při přidání nebo úpravě karty odkazu výslovně zapnete **Načíst název a náhledový obrázek**, GenOffice se jednou připojí na danou stránku a uloží náhled přímo do souboru `.whiteboard`.
