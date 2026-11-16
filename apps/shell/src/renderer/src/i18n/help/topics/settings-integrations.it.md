# Impostazioni, lingua, tema e integrazioni MCP

## Apertura delle impostazioni

La riga in basso a sinistra in Home apre il pannello delle impostazioni (la riga sotto indica se è collegata un'IA). Ha cinque sezioni: Account, IA, Generale, Integrazioni e Informazioni.

Puoi aprirle anche da qualsiasi scheda con **⌘,** (Ctrl+, su Windows e Linux), da **Impostazioni…** nel menu dell’app su un Mac (il menu con il nome dell’app, a sinistra nella barra dei menu) o da **Menu (☰) ▸ Impostazioni…** su Windows e Linux. In una scheda Word ⌘, (Ctrl+,) è il pedice, quindi lì aprile dal menu.

**Account** mostra a che punto sono le tue connessioni Claude, ChatGPT e Codex, e **Gestisci connessioni** porta alla sezione IA. L'IA ha i suoi articoli: [Connessione con abbonamento](help://subscription) e [Modelli IA e impostazioni](help://ai-models).

## Lingua

- Le impostazioni offrono **22 lingue per l'interfaccia**: inglese, cinese semplificato, giapponese, coreano, francese, tedesco, spagnolo, thai, indonesiano, russo, arabo, portoghese, italiano, polacco, ceco, olandese, malese, ebraico, hindi, cinese tradizionale, vietnamita, turco.
- Il cambio ha effetto immediato e viene ricordato; la barra dei menu nativa viene ricostruita nella nuova lingua.

## Tema

Chiaro / Scuro / Segui il sistema. L'opzione Segui il sistema segue l'aspetto del sistema operativo e gli editor si adattano in sincronia senza sfarfallii.

## Generale

- **Posizione della barra laterale IA** (sinistra o destra), **Dimensione del testo del pannello IA** e **Controllo ortografico nella chat IA**.
- **Pannello IA** — Disattivato, Compresso o Ultimo stato.
- **Salva automaticamente tutti i documenti** attiva il salvataggio automatico per impostazione predefinita in ogni editor; puoi comunque disattivarlo per una singola finestra.
- **Posizione di salvataggio** con il pulsante **Cambia** e **App predefinita per i documenti Office** per far gestire a GenOffice .docx / .xlsx / .pptx.
- **Formato di salvataggio dei nuovi documenti HWP** sceglie se proporre prima HWP o HWPX al primo salvataggio di un nuovo documento. I documenti aperti mantengono il proprio formato.
- **Caratteri delle diapositive IA** imposta i caratteri che l’IA usa per una nuova presentazione quando la richiesta non ne indica nessuno. Scegli Automatico, Senza grazie, Con grazie o Titoli con grazie e cambia separatamente il carattere senza grazie e quello con grazie. Un modello di progettazione scelto usa i propri caratteri, e le pagine aggiunte a una presentazione in altri caratteri seguono quella presentazione.

GenOffice non raccoglie né invia statistiche di utilizzo, quindi non c'è alcun interruttore.

## Editor e IA

Qui scegli quali editor usare e se usare l’IA. Lo stesso elenco compare una volta anche in altri due punti: nel passaggio **Scegli i tuoi editor** delle schermate di benvenuto al primo avvio e in una finestra mostrata una sola volta nella Home a chi usava GenOffice prima che esistesse questa impostazione. All’inizio è tutto attivo, quindi se non tocchi nulla non cambia nulla. Una modifica vale subito in tutte le finestre aperte.

- **Editor**: Word, Excel, PowerPoint, PDF, Strumenti PDF, Markdown e testo, HTML, Mappa mentale, Diagramma, HWP (Hangul) ed E-book (EPUB). Gli strumenti PDF si attivano separatamente dall’editor PDF. Almeno un editor deve restare attivo.
- **Un editor disattivato** sparisce dagli elenchi dei nuovi documenti: le schede della Home, il menu **+** della barra delle schede, File ▸ Nuovo e l’elenco delle app predefinite. I documenti già aperti restano aperti e le copie di recupero vengono conservate.
- **Aprendo un file di un editor disattivato** (doppio clic, trascinamento, File ▸ Apri, file recenti) ti viene chiesto di scegliere tra **Attiva e apri** e **Annulla**. Se apri più file di quell’editor insieme, la domanda arriva una sola volta.
- **Altre funzioni che aprirebbero il risultato in un editor disattivato**, come convertire un PDF in quel formato, chiedono prima di iniziare: **Attiva e apri**, **Crea solo il file** (il file viene creato e mostrato nella sua cartella, l’editor resta disattivato) oppure **Annulla**.
- **Con le funzioni IA disattivate** spariscono i pannelli IA, i pulsanti e i menu IA, il pannello delle domande della Home, la finestra dell’agente e gli inviti a collegare un’IA, e le schede Account, IA e Abilità escono dalle impostazioni. GenOffice non avvia alcun programma di IA dalle sue schermate. Accessi, chiavi, skill e impostazioni restano e tornano quando riattivi l’IA. Se c’è ancora un lavoro di IA in corso, ti viene chiesto prima se vuoi **Ferma e disattiva**.
- La riga di comando, MCP e questa guida funzionano allo stesso modo, con editor o IA attivi o no.

Anche con l’IA attiva, l’IA non crea nuovi documenti per un editor disattivato e ti dice di attivarlo qui.

## IA ▸ Avanzate

Resta chiusa finché non la apri; alla maggior parte delle persone non serve mai. La scheda **Modello IA** contiene le chiavi API e i server che gestisci tu, per la chat. Nella scheda **Media e ricerca IA** ogni capacità sceglie il fornitore che la serve e la chiave e l'URL di base di un fornitore si inseriscono una volta sola e si condividono:

- **Ricerca web**, **Generazione di immagini**, **Analisi di immagini** e **Analisi video**, ciascuna con un provider, un modello, una chiave e un URL di base.
- La **ricerca file locale** gira su questa macchina. Sotto, il **reranking di ricerca Jev** è **disattivato per impostazione predefinita**. Attivandolo, i estratti dei primi 20 risultati locali — fino a 1.200 caratteri per documento, più nomi di file e cartelle — vanno all'endpoint decisionale scelto (Jev via OpenRouter o TypeSafe, Perplexity, Liquid AI d1, Cloudflare, un motore locale o un URL personalizzato) per essere riordinati per rilevanza. Da disattivato, nulla lascia il dispositivo.
- **Consenti alle richieste automatiche di usare un abbonamento** è **disattivato per impostazione predefinita**. Decide se una richiesta che arriva dalla riga di comando o da un agente di programmazione collegato può usare il tuo abbonamento Claude o Codex; vedi [Collegare un agente di programmazione](help://mcp).

## Informazioni

- **Versione**, l'indirizzo GitHub del progetto e una riga che indica il progetto open source su cui si basa questa app.
- **Canale di aggiornamento**: Stabile o Beta. Modificarlo ha effetto immediato e controlla la presenza di un aggiornamento; non riporta un'installazione Beta alla versione Stabile.

## Associazioni come app predefinita

Le impostazioni possono registrare GenOffice come gestore dei file .docx / .xlsx / .pptx / .pdf e simili (registrazione dell'app predefinita a livello di sistema; conferma quando richiesto).

## Note sul software di terze parti e aggiornamenti

- Aiuto ▸ Note sul software di terze parti: l'elenco completo delle licenze open source incluso nell'app.
- Menu (☰) ▸ Controlla aggiornamenti… (su un Mac, Aiuto ▸ Controlla aggiornamenti…): avvia un controllo manuale; se c'è una versione più recente ti propone di installarla. Su un Mac si trova anche nel menu dell’app, subito sotto Informazioni su GenOffice.

## Integrazione MCP (per utenti avanzati / client IA)

**Integrazioni** è il riquadro che collega GenOffice a un agente di programmazione, e ha un articolo tutto suo: Collegare un agente di programmazione. In breve — scegli una strada (la riga di comando, oppure MCP), segui quella sezione, poi apri una nuova conversazione e fai la domanda.

Sotto **Server HTTP locale** l'app può anche eseguire il server per conto proprio — un interruttore di attivazione e una porta — e **Avanzato** aggiunge l'URL di controllo integrità e il file di registro, invece di lasciarlo all'assistente. Ascolta solo su localhost.

## Riepilogo rapido dei comandi

| Comando             | Cosa fa                      |
| ------------------- | ---------------------------- |
| `ieumoffice <file>` | apre un file                 |
| `ieumoffice mcp`    | avvia il server MCP locale   |
| `ieumoffice --help` | tutti i comandi e le opzioni |
