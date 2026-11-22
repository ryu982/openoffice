# Einstellungen, Sprache, Design und MCP-Integrationen

## Einstellungen öffnen

Die Zeile unten links auf der Startseite öffnet den Einstellungsbereich (die Zeile darunter zeigt, ob eine KI verbunden ist). Er hat fünf Abschnitte: Konto, KI, Allgemein, Integrationen und Über.

Sie können sie auch in jedem Tab mit **⌘,** öffnen (Ctrl+, unter Windows und Linux), auf dem Mac über **Einstellungen…** im App-Menü (dem Menü mit dem Namen der App, links in der Menüleiste) oder unter Windows und Linux über **Menü (☰) ▸ Einstellungen…**. In einem Word-Tab ist ⌘, (Ctrl+,) Tiefgestellt; öffnen Sie sie dort über das Menü.

**Konto** zeigt, wie es um Ihre Verbindungen zu Claude, ChatGPT und Codex steht, und **Verbindungen verwalten** führt zum Abschnitt KI. Zur KI gibt es eigene Artikel: [Abonnement-Verbindung](help://subscription) und [KI-Modelle und Einstellungen](help://ai-models).

## Sprache

- Die Einstellungen bieten **22 Oberflächensprachen**: Englisch, vereinfachtes Chinesisch, Japanisch, Koreanisch, Französisch, Deutsch, Spanisch, Thai, Indonesisch, Russisch, Arabisch, Portugiesisch, Italienisch, Polnisch, Tschechisch, Niederländisch, Malaiisch, Hebräisch, Hindi, traditionelles Chinesisch, Vietnamesisch, Türkisch.
- Die Umstellung gilt sofort und bleibt erhalten; die native Menüleiste wird in der Sprache neu aufgebaut.

## Design

Hell / Dunkel / System folgen. „System folgen“ richtet sich nach dem Erscheinungsbild des Betriebssystems, und die Editoren wechseln synchron die Darstellung, ohne zu flackern.

## Allgemein

- **Position der KI-Seitenleiste** (links oder rechts), **Textgröße im KI-Bereich** und **Rechtschreibprüfung im KI-Chat**.
- **KI-Panel** — Aus, Eingeklappt oder Letzter Zustand.
- **Alle Dokumente automatisch speichern** schaltet AutoSave in jedem Editor standardmäßig ein; für ein einzelnes Fenster können Sie es weiterhin abschalten.
- **Speicherort** mit der Schaltfläche **Ändern** und **Standard-App für Office-Dokumente**, um .docx / .xlsx / .pptx für GenOffice zu beanspruchen.
- **Speicherformat für neue HWP-Dokumente** legt fest, ob beim ersten Speichern eines neuen Dokuments zuerst HWP oder HWPX angeboten wird. Geöffnete Dokumente behalten ihr eigenes Format.
- **Schriftarten für KI-Folien** legt fest, welche Schriftarten die KI für eine neue Präsentation verwendet, wenn Ihre Anfrage keine nennt. Wählen Sie Automatisch, Serifenlos, Serifen oder Titel mit Serifen und ändern Sie die serifenlose und die Serifenschrift getrennt. Eine gewählte Designvorlage verwendet ihre eigenen Schriftarten, und Folien, die einer Präsentation in anderen Schriftarten hinzugefügt werden, folgen dieser Präsentation.

GenOffice erhebt und sendet keine Nutzungsstatistiken; deshalb gibt es dafür auch keinen Schalter.

## Editoren und KI

Hier wählen Sie, welche Editoren Sie nutzen und ob Sie KI verwenden. Dieselbe Liste erscheint außerdem einmal an zwei anderen Stellen: im Schritt **Editoren auswählen** der Willkommensbildschirme beim ersten Start und in einem einmaligen Fenster auf der Startseite für alle, die GenOffice schon vor dieser Einstellung genutzt haben. Anfangs ist alles eingeschaltet; wer nichts ändert, behält die App wie bisher. Eine Änderung gilt sofort in allen offenen Fenstern.

- **Editoren**: Word, Excel, PowerPoint, PDF, PDF-Werkzeuge, Markdown und Text, HTML, Mindmap, Diagramm, HWP (Hangul) und E-Book (EPUB). Die PDF-Werkzeuge werden getrennt vom PDF-Editor geschaltet. Mindestens ein Editor muss eingeschaltet bleiben.
- **Ein ausgeschalteter Editor** verschwindet aus den Listen für neue Dokumente: aus den Karten der Startseite, dem **+**-Menü der Tableiste, Datei ▸ Neu und der Liste der Standard-Apps. Bereits geöffnete Dokumente bleiben offen, Wiederherstellungskopien bleiben erhalten.
- **Beim Öffnen einer Datei eines ausgeschalteten Editors** (Doppelklick, Ziehen und Ablegen, Datei ▸ Öffnen, zuletzt verwendete Dateien) werden Sie gefragt: **Einschalten und öffnen** oder **Abbrechen**. Öffnen Sie mehrere seiner Dateien auf einmal, kommt die Frage nur einmal.
- **Andere Funktionen, die ihr Ergebnis in einem ausgeschalteten Editor öffnen würden**, etwa das Umwandeln einer PDF in dieses Format, fragen vor dem Start: **Einschalten und öffnen**, **Nur die Datei erstellen** (die Datei wird erstellt und in ihrem Ordner gezeigt, der Editor bleibt aus) oder **Abbrechen**.
- **Bei ausgeschalteten KI-Funktionen** verschwinden KI-Bereiche, KI-Schaltflächen und -Menüs, das Fragefeld der Startseite, das Agentenfenster und die Hinweise zum Verbinden einer KI, und die Tabs Konto, KI und Skills verschwinden aus den Einstellungen. GenOffice startet aus seinen Bildschirmen kein KI-Programm. Anmeldungen, Schlüssel, Skills und Einstellungen bleiben erhalten und kehren zurück, wenn Sie KI wieder einschalten. Läuft noch KI-Arbeit, werden Sie zuerst gefragt, ob Sie **Anhalten und ausschalten** möchten.
- Kommandozeile, MCP und diese Anleitung funktionieren gleich, egal ob Editoren oder KI ein- oder ausgeschaltet sind.

Auch bei eingeschalteter KI erstellt die KI keine neuen Dokumente für einen ausgeschalteten Editor, sondern bittet Sie, ihn hier einzuschalten.

## KI ▸ Erweitert

Geschlossen, bis Sie den Bereich öffnen; die meisten brauchen ihn nie. Der Tab **KI-Modell** enthält API-Schlüssel und selbst betriebene Server für den Chat. Auf dem Tab **KI-Medien & Suche** wählt jede Fähigkeit den Anbieter, der sie bedient, und Schlüssel und Basis-URL eines Anbieters werden einmal eingetragen und gemeinsam genutzt:

- **Websuche**, **Bildgenerierung**, **Bildanalyse** und **Videoanalyse**, jede mit Anbieter, Modell, Schlüssel und Basis-URL.
- **Lokale Dateisuche** läuft auf diesem Rechner. Darunter ist **Jev-Such-Reranking** **standardmäßig aus**. Ein schaltet es ein, gehen die Auszüge der Top-20-Treffer — bis zu 1.200 Zeichen je Dokument, plus Datei- und Ordnernamen — an den von Ihnen gewählten Entscheidungs-Endpunkt (Jev über OpenRouter oder TypeSafe, Perplexity, Liquid AI d1, Cloudflare, ein lokales Modell oder eine eigene URL) und werden nach Relevanz neu geordnet. Aus bleibt alles auf dem Gerät.
- **Automatische Anfragen dürfen ein Abonnement nutzen** ist **standardmäßig aus**. Der Schalter legt fest, ob eine Anfrage von der Kommandozeile oder von einem angebundenen Coding-Agenten Ihr Claude- oder Codex-Abonnement nutzen darf; siehe [Einen Coding-Agenten anbinden](help://mcp).

## Über

- **Version**, die GitHub-Adresse des Projekts und eine Zeile, die das Open-Source-Projekt nennt, auf dem diese App basiert.
- **Update-Kanal**: Stabil oder Beta. Eine Änderung wirkt sofort und prüft auf ein Update; eine Beta-Installation wird nicht auf Stabil zurückgestuft.

## Standard-App-Zuordnungen

Die Einstellungen können GenOffice als Programm für .docx / .xlsx / .pptx / .pdf und verwandte Formate hinterlegen (Registrierung als Standard-App auf Plattformebene; bestätigen Sie, wenn Sie dazu aufgefordert werden).

## Hinweise zu Drittanbietersoftware und Updates

- Hilfe ▸ Hinweise zu Drittanbietersoftware: das vollständige Verzeichnis der mitgelieferten Open-Source-Lizenzen.
- Menü (☰) ▸ Nach Updates suchen (auf dem Mac Hilfe ▸ Nach Updates suchen): löst eine manuelle Prüfung aus; bei einer neueren Version werden Sie zur Installation aufgefordert. Auf dem Mac steht der Befehl auch im App-Menü, direkt unter „Über GenOffice“.

## MCP-Integration (für erfahrene Anwender / KI-Clients)

**Integrationen** ist der Bereich, der GenOffice mit einem Coding-Agenten verbindet, und er hat einen eigenen Artikel: Einen Coding-Agenten anbinden. Die Kurzfassung — wählen Sie einen Weg (die Kommandozeile oder MCP), folgen Sie dem jeweiligen Abschnitt und starten Sie dann einen neuen Chat.

Unter **Lokaler HTTP-Server** kann die App den Server auch selbst betreiben — ein Schalter zum Aktivieren und ein Port —, während **Erweitert** die Zustandsprüfung-URL und die Protokolldatei hinzufügt, statt ihn dem Assistenten zu überlassen. Er lauscht nur auf localhost.

Oben unter **Einstellungen ▸ Integrationen** fasst **Verbundene Dienste** Google Drive, Notion, Canva, Obsidian-Vault, Korean Law MCP, kordoc MCP und eigene MCP-Server oberhalb der Coding-Agent-Verbindung zusammen.

## Spickzettel für die Kommandozeile

| Befehl              | Was er bewirkt             |
| ------------------- | -------------------------- |
| `ieumoffice <file>` | eine Datei öffnen          |
| `ieumoffice mcp`    | lokalen MCP-Server starten |
| `ieumoffice --help` | alle Befehle und Optionen  |
