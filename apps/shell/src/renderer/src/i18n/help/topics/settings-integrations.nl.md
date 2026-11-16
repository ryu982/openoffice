# Instellingen, taal, thema en MCP-integraties

## Instellingen openen

De regel linksonder op Start opent het instellingenpaneel (de regel eronder laat zien of er een AI is verbonden). Het paneel heeft vijf secties: Account, AI, Algemeen, Integraties en Over.

Je kunt ze ook vanuit elk tabblad openen met **⌘,** (Ctrl+, op Windows en Linux), op een Mac via **Instellingen…** in het app-menu (het menu met de naam van de app, links in de menubalk) of op Windows en Linux via **Menu (☰) ▸ Instellingen…**. In een Word-tabblad is ⌘, (Ctrl+,) subscript, dus open ze daar via het menu.

**Account** laat zien hoe het met je verbindingen met Claude, ChatGPT en Codex staat, en **Verbindingen beheren** brengt je naar de sectie AI. Over AI zijn er eigen artikelen: [Abonnementsverbinding](help://subscription) en [AI-modellen en instellingen](help://ai-models).

## Taal

- De instellingen bieden **22 interfacetalen**: Engels, vereenvoudigd Chinees, Japans, Koreaans, Frans, Duits, Spaans, Thais, Indonesisch, Russisch, Arabisch, Portugees, Italiaans, Pools, Tsjechisch, Nederlands, Maleis, Hebreeuws, Hindi, traditioneel Chinees, Vietnamees, Turks.
- Wisselen gaat meteen in en blijft behouden; de systeemenubalk wordt in de nieuwe taal opgebouwd.

## Thema

Licht / Donker / Systeem volgen. Systeem volgen volgt het uiterlijk van het besturingssysteem en de editors veranderen mee zonder te flikkeren.

## Algemeen

- **Positie AI-zijbalk** (links of rechts), **Tekstgrootte AI-paneel** en **Spellingcontrole in AI-chat**.
- **AI-paneel** — Uit, Ingeklapt of Laatste status.
- **Alle documenten automatisch opslaan** zet AutoSave standaard aan in elke editor; u kunt het voor één venster nog steeds uitschakelen.
- **Opslaglocatie** met de knop **Wijzigen** en **Standaardapp voor Office-documenten** om .docx / .xlsx / .pptx aan GenOffice toe te kennen.
- **Opslagformaat voor nieuwe HWP-documenten** kiest of bij de eerste opslag van een nieuw document eerst HWP of HWPX wordt aangeboden. Geopende documenten behouden hun eigen formaat.
- **Lettertypen voor AI-dia’s** bepaalt welke lettertypen de AI gebruikt voor een nieuwe presentatie als uw verzoek er geen noemt. Kies Automatisch, Schreefloos, Schreef of Titels met schreef, en wijzig het schreefloze en het schreeflettertype apart. Een gekozen ontwerpsjabloon gebruikt zijn eigen lettertypen, en pagina’s die u toevoegt aan een presentatie in andere lettertypen volgen die presentatie.

GenOffice verzamelt of verstuurt geen gebruiksstatistieken, dus er is ook geen schakelaar voor.

## Editors en AI

Hier kies je welke editors je gebruikt en of je AI gebruikt. Dezelfde lijst verschijnt ook één keer op twee andere plekken: in de stap **Kies je editors** van de welkomstschermen bij de eerste start, en in een venster dat één keer op Start verschijnt voor wie GenOffice al gebruikte voordat deze instelling bestond. In het begin staat alles aan; laat je het zo, dan verandert er niets. Een wijziging geldt meteen in alle open vensters.

- **Editors**: Word, Excel, PowerPoint, PDF, PDF-hulpmiddelen, Markdown en tekst, HTML, Mindmap, Diagram, HWP (Hangul) en E-book (EPUB). De PDF-hulpmiddelen zet je los van de PDF-editor aan en uit. Er moet minstens één editor aan blijven.
- **Een editor die uit staat** verdwijnt uit de lijsten voor nieuwe documenten: de kaarten op Start, het **+**-menu van de tabbalk, Bestand ▸ Nieuw en de lijst met standaardapps. Documenten die al open zijn blijven open, en herstelkopieën blijven bewaard.
- **Open je een bestand van een uitgeschakelde editor** (dubbelklikken, slepen en neerzetten, Bestand ▸ Openen, recente bestanden), dan kies je tussen **Aanzetten en openen** en **Annuleren**. Open je meerdere van zijn bestanden tegelijk, dan wordt het maar één keer gevraagd.
- **Andere functies die hun resultaat in een uitgeschakelde editor zouden openen**, zoals een PDF naar dat formaat omzetten, vragen het voordat ze beginnen: **Aanzetten en openen**, **Alleen het bestand maken** (het bestand wordt gemaakt en in zijn map getoond, de editor blijft uit) of **Annuleren**.
- **Met AI-functies uit** verdwijnen de AI-panelen, AI-knoppen en -menu's, het vragenpaneel op Start, het agentvenster en de meldingen om een AI te koppelen, en de tabbladen Account, AI en Vaardigheden verdwijnen uit de instellingen. GenOffice start vanuit zijn schermen geen AI-programma. Aanmeldingen, sleutels, vaardigheden en instellingen blijven bewaard en komen terug als je AI weer aanzet. Loopt er nog AI-werk, dan wordt eerst gevraagd of je wilt **Stoppen en uitschakelen**.
- De opdrachtregel, MCP en deze handleiding werken hetzelfde, of editors en AI nu aan of uit staan.

Ook met AI aan maakt de AI geen nieuwe documenten voor een editor die uit staat; hij vraagt je die editor hier aan te zetten.

## AI ▸ Geavanceerd

Dicht tot je het opent; de meeste mensen hebben het nooit nodig. Het tabblad **AI-model** bevat API-sleutels en servers die je zelf draait, voor chat. Op het tabblad **AI-media en zoeken** kiest elke functie de leverancier die haar bedient, en de sleutel en basis-URL van een leverancier worden eenmaal ingevuld en gedeeld:

- **Zoeken op het web**, **Afbeeldingen genereren**, **Afbeeldingsanalyse** en **Video-analyse**, elk met een provider, een model, een sleutel en een basis-URL.
- **Lokaal bestanden zoeken** draait op deze machine. Daaronder staat **Jev-herordenen van zoekresultaten** **standaard uit**. Zet u het aan, dan gaan de uittreksels van de top 20 lokale treffers — tot 1.200 tekens per document, plus bestands- en mapnamen — naar het beslis-eindpunt dat u kiest (Jev via OpenRouter of TypeSafe, Perplexity, Liquid AI d1, Cloudflare, een lokale motor of een eigen URL) om op relevantie te herordenen. Uit staat blijft niets het apparaat verlaten.
- **Automatische verzoeken een abonnement laten gebruiken** staat **standaard uit**. Het bepaalt of een verzoek vanaf de opdrachtregel of van een verbonden coding agent je Claude- of Codex-abonnement mag gebruiken; zie [Verbinden met een coding agent](help://mcp).

## Over

- **Versie**, het GitHub-adres van het project en een regel die vermeldt op welk opensourceproject deze app is gebaseerd.
- **Updatekanaal**: Stabiel of Bèta. Wijzigen gaat meteen in en controleert op een update; een Bèta-installatie wordt niet teruggezet naar Stabiel.

## Standaardapp-koppelingen

Met de instellingen kun je GenOffice registreren als verwerker van .docx / .xlsx / .pptx / .pdf en vergelijkbare bestanden (registratie van de standaardapp op systeemniveau; bevestiging wanneer daarom wordt gevraagd).

## Mededelingen over software van derden en updates

- Help ▸ Kennisgevingen over software van derden: het volledige overzicht van opensourcelicenties dat met de app is meegeleverd.
- Menu (☰) ▸ Controleren op updates… (op een Mac Help ▸ Controleren op updates…): start een handmatige controle; bij een nieuwere versie wordt je gevraagd die te installeren. Op een Mac staat het ook in het app-menu, direct onder Over GenOffice.

## MCP-integratie (voor gevorderde gebruikers / AI-clients)

**Integraties** is het paneel dat GenOffice met een coding agent verbindt, en daarvoor is er een eigen artikel: Verbinden met een coding agent. De korte versie — kies een route (de opdrachtregel, of MCP), volg dat onderdeel en start daarna een nieuw gesprek en stel je vraag.

Onder **Lokale HTTP-server** kan de app de server ook zelf draaien — een inschakelschakelaar en een poort —, terwijl **Geavanceerd** de URL voor de statuscontrole en het logbestand toevoegt, in plaats van hem over te laten aan de assistent. Hij luistert alleen op localhost.

## Commandoregel in één oogopslag

| Opdracht               | Wat het doet               |
| ---------------------- | -------------------------- |
| `ieumoffice <bestand>` | opent een bestand          |
| `ieumoffice mcp`       | start de lokale MCP-server |
| `ieumoffice --help`    | alle opdrachten en opties  |
