# Lavagna: brainstorming, schizzi e annotazioni

L'editor di lavagna apre i file `.whiteboard` in una scheda. Puoi disporre note adesive, testo, forme, connettori, tabelle, adesivi, immagini, schede collegamento e tratti a mano libera su lavagne infinite o pagine fisse, importare pagine PDF come sfondo, esportare come immagini o PDF e lavorare con il pannello IA. Tutto viene eseguito localmente sul tuo PC.

## Aprire e creare

- Una nuova lavagna si apre come lavagna libera infinita dal riquadro **Lavagna** nella Home o da Nuovo nel menu File.
- L'editor apre file `.whiteboard` dalla finestra di apertura, trascinandoli nella finestra, dai file recenti, dall'albero delle cartelle, dall'Anteprima rapida (Spazio) o da Google Drive. Su Windows l'installazione di GenOffice lo registra come programma predefinito per `.whiteboard`.
- I file Excalidraw (`.excalidraw`, `.excalidraw.png`, `.excalidraw.svg`) vengono importati come nuova lavagna senza titolo. Il file originale non viene mai sovrascritto, la chiusura senza modifiche non chiede di salvare e il primo salvataggio propone `.whiteboard` nella stessa cartella. Gli elementi non supportati come gli incorporamenti web vengono saltati indicandone il numero in un avviso. Su Windows `.excalidraw` compare solo in "Apri con".
- Se la lavagna è già aperta, la sua scheda viene portata in primo piano.

## Modifica e strumenti

- Un singolo file `.whiteboard` può combinare lavagne libere e pagine fisse (schermo 16:9, A4 verticale o orizzontale e formati personalizzati di pagine PDF) nella barra delle pagine.
- Gli strumenti includono selezione, note adesive, testo formattato, otto forme, connettori e frecce, penna sensibile alla pressione, evidenziatore e gomma, immagini, tabelle, adesivi integrati e schede collegamento.
- Trascina un file `.pdf` su una lavagna aperta o scegli **Importa PDF** per trasformare le pagine PDF scelte in pagine di sfondo fisse su cui disegnare e aggiungere note. Aprire un `.pdf` dalla Home o dal menu File continua ad aprirlo nell'editor PDF.
- Premi F5 o fai clic su **Presenta** per mostrare la lavagna a schermo intero e cambiare pagina con le frecce.
- Nel tema scuro si scuriscono barre degli strumenti, pannelli e sfondo esterno alla pagina, mentre foglio, note adesive, forme e inchiostro mantengono i colori originali del documento.

## Salvataggio, esportazione e stampa

- Salva, Salva con nome, salvataggio automatico, copie di ripristino e controllo dei conflitti in vista divisa funzionano come negli altri editor. Se nulla è cambiato, il file non viene riscritto.
- Esporta in PNG, SVG o PDF per **Tutte le pagine** o **Solo pagina corrente**. Su una lavagna libera l'esportazione e la stampa racchiudono tutti gli oggetti con un margine oppure l'area iniziale se vuota.
- Stampa (Ctrl+P) supporta sia la stampa standard sia le opzioni avanzate di impaginazione. Esportazioni e stampe sono identiche in tema chiaro e scuro.

## Pannello IA

- Chiedi all'IA di organizzare note adesive, creare un modello di workshop o retrospettiva, aggiungere forme, connettori, tabelle o immagini, oppure riassumere la lavagna.
- L'IA riceve una tabella testuale strutturata della lavagna e, quando il modello scelto supporta le immagini, allega automaticamente un'immagine della pagina corrente. I modelli solo testo usano solo la tabella.
- Ogni chiamata di modifica dell'IA è un solo passaggio di annullamento (Ctrl+Z), evidenzia sullo schermo gli oggetti modificati senza alterare il file salvato e offre **Annulla queste modifiche** nella scheda di risposta.
- I file `.whiteboard` possono essere allegati nei pannelli IA degli altri editor, citati con `@`, cercati nella Home, usati in **Crea un altro documento** (inclusa la conversione in Markdown senza IA) e gestiti dai [comandi da terminale](help://cli) (`ieumoffice whiteboard read`, `ieumoffice whiteboard apply`, `ieumoffice create --type whiteboard`).

## Uso di internet e schede collegamento

- Apertura, modifica, esportazione, stampa e importazione di Excalidraw o pagine PDF non inviano nulla su internet.
- Fare clic su una scheda collegamento apre indirizzi `http`, `https` o `mailto` nel browser predefinito.
- Solo quando attivi esplicitamente **Recupera titolo e immagine di anteprima** aggiungendo o modificando una scheda collegamento, GenOffice si collega una volta alla pagina e salva l'anteprima dentro il file `.whiteboard`.
