# Whiteboard: brainstormen, schetsen en annoteren

De whiteboardeditor opent `.whiteboard`-bestanden in een tabblad. U kunt plaknotities, tekst, vormen, verbindingslijnen, tabellen, stickers, afbeeldingen, linkkaarten en drukgevoelige pennestreken ordenen op oneindige vrije borden of vaste pagina's, PDF-pagina's als achtergrond importeren, exporteren naar afbeelding of PDF en samenwerken met het AI-paneel. Alles draait lokaal op uw pc.

## Openen en maken

- Een nieuw bord start als oneindig vrij bord via de tegel **Whiteboard** op Start of via Nieuw in het menu Bestand.
- De editor opent `.whiteboard`-bestanden via het openen-dialoogvenster, slepen naar het venster, recente bestanden, de mappenstructuur, Snelle weergave (Spatie) of Google Drive. Onder Windows registreert de installatie van GenOffice het programma standaard voor `.whiteboard`.
- Excalidraw-bestanden (`.excalidraw`, `.excalidraw.png`, `.excalidraw.svg`) worden geïmporteerd als nieuw naamloos whiteboard. Het originele bestand wordt nooit overschreven, sluiten zonder wijzigingen vraagt niet om op te slaan en de eerste keer opslaan stelt `.whiteboard` in dezelfde map voor. Niet-ondersteunde elementen zoals webinsluitingen worden overgeslagen met een melding van het aantal. Onder Windows verschijnt `.excalidraw` alleen onder "Openen met".
- Als het whiteboard al geopend is, komt dat tabblad naar voren.

## Bewerken en gereedschappen

- Eén `.whiteboard`-bestand kan in de paginabalk vrije borden en vaste pagina's (16:9-scherm, A4 staand of liggend en aangepaste PDF-paginaformaten) combineren.
- Tot de gereedschappen behoren selecteren, plaknotities, opgemaakte tekst, acht vormen, verbindingslijnen en pijlen, drukgevoelige pen, markeerstift en gum, afbeelding, tabel, ingebouwde stickers en linkkaarten.
- Sleep een `.pdf`-bestand op een geopend whiteboard of kies **PDF importeren** om gekozen PDF-pagina's als vaste achtergrondpagina's toe te voegen waarop u kunt tekenen en aantekeningen plaatsen. Een `.pdf` openen vanaf Start of via Bestand opent nog steeds de PDF-editor.
- Druk op F5 of klik op **Presenteren** om het bord schermvullend weer te geven en met de pijltjestoetsen door pagina's te bladeren.
- In het donkere thema worden werkbalken, panelen en de achtergrond buiten de pagina donker, terwijl het papier, plaknotities, vormen en inkt hun oorspronkelijke documentkleuren behouden.

## Opslaan, exporteren en afdrukken

- Opslaan, Opslaan als, automatisch opslaan, herstelkopieën en conflictcontrole in gesplitste weergave werken net als in de andere editors. Zonder wijzigingen wordt het bestand niet opnieuw geschreven.
- Exporteer naar PNG, SVG of PDF voor **Alle pagina's** of **Alleen huidige pagina**. Op een vrij bord passen export en afdruk rond alle objecten met een marge, of het standaard startgebied als het bord leeg is.
- Afdrukken (Ctrl+P) ondersteunt standaard afdrukken en uitgebreide paginalay-outopties. Exports en afdrukken zijn identiek in licht en donker thema.

## AI-paneel

- Vraag de AI om plaknotities te ordenen, een workshop- of retrospectiefsjabloon op te zetten, vormen, verbindingen, tabellen of afbeeldingen toe te voegen of het bord samen te vatten.
- De AI ontvangt een gestructureerde teksttabel van het bord en voegt, wanneer het gekozen model afbeeldingen ondersteunt, automatisch een afbeelding van de huidige pagina bij. Tekstmodellen werken alleen met de teksttabel.
- Elke AI-bewerkingsaanroep is één stap ongedaan maken (Ctrl+Z), markeert gewijzigde objecten alleen op het scherm zonder het opgeslagen bestand te wijzigen en biedt **Deze wijzigingen ongedaan maken** onder het antwoord.
- `.whiteboard`-bestanden kunnen worden bijgevoegd in AI-panelen van andere editors, met `@` worden genoemd, op Start worden doorzocht, worden gebruikt in **Ander document maken** (inclusief conversie naar Markdown zonder AI) en via [terminalopdrachten](help://cli) (`ieumoffice whiteboard read`, `ieumoffice whiteboard apply`, `ieumoffice create --type whiteboard`) worden verwerkt.

## Internetgebruik en linkkaarten

- Openen, bewerken, exporteren, afdrukken en importeren van Excalidraw of PDF-pagina's sturen niets naar het internet.
- Klikken op een linkkaart opent `http`-, `https`- of `mailto`-adressen in uw standaardbrowser.
- Alleen wanneer u tijdens het toevoegen of bewerken van een linkkaart uitdrukkelijk **Titel en voorbeeldafbeelding ophalen** inschakelt, maakt GenOffice eenmalig verbinding met die pagina en slaat de voorbeeldafbeelding op in het `.whiteboard`-bestand.
