# Nastavení, jazyk, motiv a integrace MCP

## Otevření nastavení

Řádek vlevo dole na domovské stránce otevře panel nastavení (řádek pod ním ukazuje, zda je připojena AI). Má pět částí: Účet, AI, Obecné, Integrace a O aplikaci.

Otevřít je můžete také z libovolné karty zkratkou **⌘,** (Ctrl+, ve Windows a Linuxu), na Macu položkou **Nastavení…** v nabídce aplikace (nabídka s názvem aplikace vlevo na řádku nabídek) a ve Windows a Linuxu přes **Nabídka (☰) ▸ Nastavení…**. Na kartě Word je ⌘, (Ctrl+,) dolní index, proto je tam otevřete z nabídky.

**Účet** ukazuje, jak jsou na tom vaše připojení Claude, ChatGPT a Codex, a **Spravovat připojení** vás zavede do části AI. AI má vlastní kapitoly: [Připojení předplatného](help://subscription) a [Modely AI a nastavení](help://ai-models).

## Jazyk

- Nastavení nabízí **22 jazyků rozhraní**: angličtina, zjednodušená čínština, japonština, korejština, francouzština, němčina, španělština, thajština, indonéština, ruština, arabština, portugalština, italština, polština, čeština, nizozemština, malajština, hebrejština, hindština, tradiční čínština, vietnamština, turečtina.
- Změna působí okamžitě a zůstává zachována; nativní pruh nabídek se znovu sestaví v novém jazyce.

## Motiv

Světlý / Tmavý / Podle systému. Volba Podle systému sleduje vzhled operačního systému a editory se přeoblekují současně bez blikání.

## Obecné

- **Pozice postranního panelu AI** (vlevo nebo vpravo), **Velikost textu panelu AI** a **Kontrola pravopisu v chatu AI**.
- **Panel AI** — Vypnuto, Sbaleno nebo Poslední stav.
- **Automaticky ukládat všechny dokumenty** zapne ve výchozím stavu automatické ukládání v každém editoru; pro jedno okno ho můžete i nadále vypnout.
- **Umístění pro ukládání** s tlačítkem **Změnit** a **Výchozí aplikace pro dokumenty Office**, aby GenOffice přebíral .docx / .xlsx / .pptx.
- **Formát ukládání nových dokumentů HWP** určuje, zda se při prvním uložení nového dokumentu nabídne nejprve HWP, nebo HWPX. Otevřené dokumenty si zachovávají svůj formát.
- **Písma snímků s AI** určuje písma, která AI použije v nové prezentaci, když žádost žádné neuvádí. Vyberte Automaticky, Bezpatkové, Patkové nebo Patkové nadpisy a zvlášť změňte bezpatkové a patkové písmo. Zvolená šablona návrhu používá vlastní písma a stránky přidané do prezentace v jiných písmech se řídí touto prezentací.

GenOffice neshromažďuje ani neodesílá statistiky používání, takže pro ně není žádný přepínač.

## Editory a AI

Tady vybíráte, které editory používáte a zda chcete používat AI. Stejný seznam se navíc jednou objeví na dvou dalších místech: v kroku **Vyberte editory** uvítacích obrazovek při prvním spuštění a v okně, které se jednou ukáže na domovské stránce těm, kdo GenOffice používali už před zavedením tohoto nastavení. Na začátku je vše zapnuté, takže když nic nezměníte, nic se nezmění. Změna platí hned ve všech otevřených oknech.

- **Editory**: Word, Excel, PowerPoint, PDF, Nástroje PDF, Markdown a text, HTML, Myšlenková mapa, Diagram, HWP (hangul) a E-kniha (EPUB). Nástroje PDF se zapínají odděleně od editoru PDF. Aspoň jeden editor musí zůstat zapnutý.
- **Vypnutý editor** zmizí ze seznamů nových dokumentů: z karet domovské stránky, z nabídky **+** na liště karet, z Soubor ▸ Nový a ze seznamu výchozích aplikací. Dokumenty, které už jsou otevřené, zůstanou otevřené a záložní kopie pro obnovení se zachovají.
- **Při otevření souboru vypnutého editoru** (dvojklik, přetažení, Soubor ▸ Otevřít, nedávné soubory) se zobrazí volba **Zapnout a otevřít** nebo **Zrušit**. Když otevřete několik jeho souborů najednou, zeptá se jen jednou.
- **Jiné funkce, které by svůj výsledek otevřely ve vypnutém editoru**, například převod PDF do jeho formátu, se zeptají před začátkem: **Zapnout a otevřít**, **Jen vytvořit soubor** (soubor se vytvoří a ukáže ve složce, editor zůstane vypnutý) nebo **Zrušit**.
- **Když jsou funkce AI vypnuté**, zmizí panely AI, tlačítka a nabídky AI, panel dotazů na domovské stránce, okno agenta i výzvy k připojení AI a z nastavení zmizí karty Účet, AI a Dovednosti. GenOffice ze svých obrazovek nespouští žádný program AI. Přihlášení, klíče, dovednosti a nastavení zůstanou a po opětovném zapnutí AI se vrátí. Pokud ještě běží práce AI, nejdřív se zeptá, zda chcete **Zastavit a vypnout**.
- Příkazový řádek, MCP a tato příručka fungují stejně, ať jsou editory a AI zapnuté, nebo ne.

Ani se zapnutou AI nevytváří AI nové dokumenty pro vypnutý editor; požádá vás, abyste ho zapnuli zde.

## AI ▸ Pokročilé

Tato část je sbalená, dokud ji neotevřete; většina lidí ji nikdy nepotřebuje. Karta **Model AI** obsahuje klíče API a servery, které provozujete sami, pro chat. Na kartě **AI média a vyhledávání** si každá schopnost vybere dodavatele, který ji poskytuje, a klíč i základní URL dodavatele se zadávají jednou a sdílejí se:

- **Webové vyhledávání**, **Generování obrázků**, **Analýza obrázků** a **Analýza videí**, každá s poskytovatelem, modelem, klíčem a základní URL.
- **Lokální hledání souborů** běží na tomto stroji. Pod ním je **Jev přeřazení výsledků** ve výchozím stavu **vypnuté**. Zapnete-li ho, výtahy top 20 lokálních zásahů — až 1 200 znaků na dokument plus názvy souborů a složek — míří na zvolený rozhodovací endpoint (Jev přes OpenRouter nebo TypeSafe, Perplexity, Liquid AI d1, Cloudflare, lokální engine nebo vlastní URL) a přeřadí se podle relevance. Vypnuté ze zařízení nic neodchází.
- **Povolit automatickým požadavkům používat předplatné** je ve výchozím stavu **vypnuté**. Určuje, zda požadavek z příkazové řádky nebo od připojeného programového agenta smí použít vaše předplatné Claude nebo Codex; viz [Připojení programového agenta](help://mcp).

## O aplikaci

- **Verze**, adresa projektu na GitHubu a řádek, který uvádí open-source projekt, na kterém je tato aplikace založena.
- **Kanál aktualizací**: Stabilní nebo Beta. Změna se projeví ihned a vyvolá kontrolu aktualizace; instalaci z kanálu Beta nevrátí zpět na Stabilní.

## Přiřazení jako výchozí aplikace

Nastavení může zaregistrovat GenOffice jako aplikaci pro soubory .docx / .xlsx / .pptx / .pdf a podobné (registrace výchozí aplikace na úrovni systému; potvrzení, když o něj systém požádá).

## Informace o softwaru třetích stran a aktualizace

- Nápověda ▸ Informace o softwaru třetích stran: úplný přehled licencí open source dodávaných s aplikací.
- Nabídka (☰) ▸ Zkontrolovat aktualizace… (na počítači Mac Nápověda ▸ Zkontrolovat aktualizace…): spustí ruční kontrolu; novější verze vyzve k instalaci. Na Macu je příkaz také v nabídce aplikace, hned pod položkou O aplikaci GenOffice.

## Integrace MCP (pro pokročilé uživatele a klienty AI)

**Integrace** je panel, který propojí GenOffice s programovým agentem, a má o tom vlastní kapitolu: Připojení programového agenta. Zkrátka — vyberte cestu (příkazová řádka, nebo MCP), řiďte se danou částí a pak začněte nový chat a zeptejte se.

Pod **Místní HTTP server** umí aplikace server spustit sama — přepínač zapnutí a port — a část **Pokročilé** přidá adresu pro kontrolu stavu a soubor protokolu, místo aby ho nechala na pomocníkovi. Naslouchá pouze na localhostu.

## Přehled příkazů

| Příkaz                | Co dělá                     |
| --------------------- | --------------------------- |
| `ieumoffice <soubor>` | otevře soubor               |
| `ieumoffice mcp`      | spustí místní server MCP    |
| `ieumoffice --help`   | všechny příkazy a přepínače |
