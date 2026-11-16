# Bestandsbewerkingen: hernoemen, verwijderen, exporteren

Dit hoofdstuk behandelt de bestandsbewerkingen die alle editors delen; de eigen exportopties van elke editor staan in het bijbehorende hoofdstuk.

Het **⋯-menu** in de rij (verschijnt als je over een bestandsrij zweeft) bundelt deze acties:

![Het ⋯-menu van een bestandsrij](img/file-ops.png)

## Hernoemen

Twee instappen, één set controles:

- **⋯ ▸ Naam wijzigen** in een rij op Start.
- **Dubbelklik op een bestandstabblad** om ter plekke te hernoemen (zie [Tabbladen en vensterbeheer](help://tabs-and-windows)).

Regels: de extensie blijft automatisch behouden; ongeldige tekens, afsluitende punten en gereserveerde namen (CON/NUL en dergelijke) worden met een melding geweigerd; een naamconflict in dezelfde map wordt eveneens tegengehouden. Het echte bestand op schijf wordt hernoemd, en de lijsten met recente en favoriete bestanden volgen.

## Verwijderen

- **⋯ ▸ Verwijderen** op Start: vraagt welke bestanden, verplaatst ze daarna naar de **prullenbak van het systeem**, waar het besturingssysteem ze kan herstellen. GenOffice bewaart hiervoor zelf geen ongedaan maken — herstel is de taak van de prullenbak, niet van een melding.

## Dupliceren

**⋯ ▸ Dupliceren** maakt een kopie van <naam> in dezelfde map; bij een botsing wordt automatisch een teller toegevoegd. De kopie komt in **Recent** terecht in plaats van voor jou te worden geopend — één klik verderop, niet pal voor je neus.

## Opslaan en Opslaan als

- **⌘S / ctrl+S** slaat het huidige bestand op; een naamloos bestand vraagt eerst om locatie en naam.
- In de meeste editors biedt de lijst met bestandstypen in het venster Opslaan als ook de exportformaten (PDF, afbeeldingen, andere documentformaten). Kies je er een, dan wordt alleen een kopie geschreven; het geopende document en zijn tabblad blijven bij het oorspronkelijke bestand. Afbeeldingen van meerdere pagina’s worden verdeeld over `naam-01.png`, `naam-02.png`, ….
- **Docs**: de lijst Opslaan als biedt ook .hwp en .hwpx (Bestand ▸ Exporteren als HWP-document… doet hetzelfde). Als iets niet kan worden overgenomen, zoals opmerkingen, vergelijkingen of tekstvakken, hoort u dat voordat het bestand wordt geschreven.
- **Opslaan als…** schrijft een nieuw bestand en laat het origineel ongemoeid; latere bewerkingen gaan naar het nieuwe bestand.
- Elk opslaan is atomair (tijdelijk bestand + hernoemen); tussentijds afsluiten kan het bestand niet beschadigen.
- Automatisch opslaan volgt de schakelaar van elke editor; een nieuw document zonder eigen bestand begint pas na de eerste keer opslaan (zie [Snel starten](help://getting-started)).

## Exporteren naar pdf

- **Docs**: Bestand ▸ Exporteren als pdf… (of de knop op het lint), gepagineerd zoals het eruitziet.
- **Slides**: exporteren rastert pagina voor pagina, met voortgang bij grote presentaties.
- **Sheets**: exporteren volgt de afdrukpaginering.
- Exports worden in een verborgen venster weergegeven en belanden waar jij kiest.

## Exporteren naar Word of afbeeldingen

- **Exporteren als Word…** in pdf: zet de pdf om naar een .docx-bestand (lokale conversie; ingewikkelde opmaak wordt zo goed mogelijk benaderd).
- **Docs** kan pagina's exporteren als afbeeldingen (png per pagina).

## Afdrukken

Bestand ▸ Afdrukken (⌘P/ctrl+P) opent in elke editor een afdrukvenster. Docs, PDF, Sheets, Slides en Markdown hebben het onderdeel **Pagina-indeling** in hun gewone afdrukvenster, HWP in het afdrukvoorbeeld, en HTML, mindmap en diagram in een nieuw klein afdrukvenster. Kies je niets onder Pagina-indeling, dan wordt er afgedrukt zoals vroeger.

- **Indeling**: kies Eén pagina per vel, Meerdere pagina's per vel (2, 4, 6, 9 of 16), Boekje (links of rechts binden), Affiche (vellen in de breedte en hoogte, overlapping, snijlijnen) of Etiketten (één pagina per etiket of dezelfde pagina op elk etiket, beginetiket, een gangbaar A4-formaat of eigen maten).
- **Alleen oneven zijden, alleen even zijden, omgekeerde volgorde**: de zijden worden geteld na het indelen, op wat werkelijk uit de printer komt. Handig bij een printer zonder dubbelzijdig afdrukken: druk de voorkanten af, draai het papier om en druk de achterkanten af.
- **Verkleinen tot papierformaat**: alleen pagina's die groter zijn dan het gekozen papier worden verkleind; kleinere worden niet vergroot. Sheets en Markdown gebruiken hun eigen velden voor papier en schaal.
- **Grijstinten en beeldresolutie**: bij afdrukken met opties uit Pagina-indeling wordt elke pagina eerst een afbeelding en zo naar de printer gestuurd. Kies de resolutie uit Automatisch, 150, 300 of 600 dpi.
- **Alleen selectie**: Docs en Markdown drukken alleen de geselecteerde tekst af, opnieuw verdeeld vanaf de eerste pagina; Slides drukt de geselecteerde dia's af en PDF de geselecteerde pagina's. Sheets drukt zoals vroeger het geselecteerde bereik af.
- **Indelingsschets en resultaat bekijken**: de schets laat meteen zien waar elk paginanummer op het papier komt, en **Resultaat bekijken** toont wat er echt is gemaakt. Met **Ingedeeld resultaat opslaan als pdf** druk je dezelfde indeling af op een andere pc of bij een drukkerij.
- **Afdrukvenster van het systeem**: kies voor een boekje dubbelzijdig afdrukken met omslaan over de korte kant. Laat het paginabereik en het aantal pagina's per vel in het systeemvenster zoals ze zijn.

Pdf's worden afgedrukt met de huidige paginavolgorde en draaiingen.

## Waar naamloze bestanden staan

De locatie die je bij de eerste keer opslaan kiest is hun thuisbasis. Tot dan heeft het document geen eigen bestand: de niet-opgeslagen inhoud bestaat alleen als herstelkopie in de gegevensmap van de app, zodat die terug kan komen als de app plotseling uitvalt (zie [Tabbladen en vensterbeheer](help://tabs-and-windows)). Automatisch opslaan neemt het pas over na die eerste keer opslaan.
