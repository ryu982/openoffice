# Whiteboard: Brainstorming, Skizzieren und Kommentieren

Der Whiteboard-Editor öffnet `.whiteboard`-Dateien in einem Tab. Sie können Haftnotizen, Text, Formen, Verbinder, Tabellen, Sticker, Bilder, Link-Karten und druckempfindliche Freihandstriche auf endlosen freien Flächen oder festen Seiten anordnen, PDF-Seiten als Hintergrund einfügen, als Bild oder PDF exportieren und mit dem KI-Bereich arbeiten. Alles läuft lokal auf Ihrem PC.

## Öffnen und Erstellen

- Ein neues Whiteboard startet als endlose freie Fläche über die Kachel **Whiteboard** auf der Startseite oder über Neu im Menü Datei.
- Der Editor öffnet `.whiteboard`-Dateien über den Öffnen-Dialog, per Drag-and-drop ins Fenster, über zuletzt verwendete Dateien, den Ordnerbaum, die Schnellvorschau (Leertaste) oder Google Drive. Unter Windows registriert die Installation von GenOffice das Programm als Standard für `.whiteboard`.
- Excalidraw-Dateien (`.excalidraw`, `.excalidraw.png`, `.excalidraw.svg`) werden als neues, unbenanntes Whiteboard importiert. Die Originaldatei wird nie überschrieben, beim Schließen ohne Änderungen erscheint keine Speicherabfrage, und beim ersten Speichern wird `.whiteboard` im selben Ordner vorgeschlagen. Nicht unterstützte Elemente wie Web-Einbettungen werden übersprungen und ihre Anzahl in einer Hinweiszeile angezeigt. Unter Windows erscheint `.excalidraw` nur unter "Öffnen mit".
- Ist das Whiteboard bereits geöffnet, wird sein Tab in den Vordergrund geholt.

## Bearbeiten und Werkzeuge

- Eine einzelne `.whiteboard`-Datei kann in der Seitenleiste freie Flächen und feste Seiten (16:9-Bildschirm, A4 Hoch- und Querformat sowie benutzerdefinierte PDF-Seitengrößen) mischen.
- Zu den Werkzeugen gehören Auswahl, Haftnotizen, formatierter Text, acht Formen, Verbinder und Pfeile, druckempfindlicher Stift, Textmarker und Radierer, Bilder, Tabellen, eingebaute Sticker und Link-Karten.
- Um mehrere Objekte auf einmal auszuwählen, ziehen Sie mit dem Auswahlwerkzeug von einer leeren Stelle aus ein Rechteck auf. Lassen die Objekte keine leere Stelle frei, wählen Sie in der linken Werkzeugleiste **Bereich auswählen** (M) und beginnen das Ziehen direkt auf den Objekten. Ausgewählt werden nur Objekte, die ganz im Rechteck liegen. Mit Shift- oder Ctrl-Klick fügen Sie ein Objekt der Auswahl hinzu oder nehmen es heraus, Ziehen mit gedrückter Shift-Taste fügt die Objekte eines weiteren Rechtecks hinzu, und Ctrl+A (⌘A auf dem Mac) wählt alle Objekte der aktuellen Seite aus. Ziehen Sie eines der ausgewählten Objekte, bewegen sich alle gemeinsam, und Nach vorn, Nach hinten, Duplizieren und Löschen wirken auf alle zugleich, jeweils als ein Rückgängig-Schritt.
- Ziehen Sie eine `.pdf`-Datei auf ein geöffnetes Whiteboard oder wählen Sie **PDF importieren**, um gewählte PDF-Seiten als feste Hintergrundseiten anzulegen und darüber zu zeichnen oder Notizen abzulegen. Das Öffnen einer `.pdf`-Datei über Startseite oder Menü Datei öffnet weiterhin den PDF-Editor.
- Drücken Sie F5 oder klicken Sie auf **Präsentieren**, um das Board im Vollbild anzuzeigen und mit den Pfeiltasten zu blättern.
- Im dunklen Design werden Werkzeugleisten, Bedienfelder und der Bereich außerhalb der Seite dunkel, während Papier, Haftnotizen, Formen und Tinte ihre ursprünglichen Dokumentfarben behalten.

## Speichern, Exportieren und Drucken

- Speichern, Speichern unter, automatisches Speichern, Wiederherstellungskopien und Konfliktprüfung bei geteilter Ansicht funktionieren wie in den anderen Editoren. Ohne Änderungen wird die Datei nicht neu geschrieben.
- Exportieren Sie nach PNG, SVG oder PDF für **Alle Seiten** oder **Nur aktuelle Seite**. Auf einer freien Fläche umfassen Export und Druck alle Objekte mit Rand oder den Standard-Startbereich, wenn die Fläche leer ist.
- Drucken (Ctrl+P) unterstützt sowohl Standarddruck als auch mehrseitige Drucklayouts. Exporte und Ausdrucke sind im hellen und dunklen Design identisch.

## KI-Bereich

- Bitten Sie die KI, Haftnotizen zu ordnen, eine Workshop- oder Retrospektiv-Vorlage anzulegen, Formen, Verbinder, Tabellen oder Bilder hinzuzufügen oder die Inhalte zusammenzufassen.
- Die KI erhält eine strukturierte Texttabelle des Whiteboards und hängt bei bildfähigen Modellen automatisch ein Bild der aktuellen Seite an. Reine Textmodelle arbeiten nur mit der Texttabelle.
- Jeder KI-Bearbeitungsaufruf entspricht einem Rückgängig-Schritt (Ctrl+Z), hebt geänderte Objekte nur auf dem Bildschirm hervor und bietet **Diese Änderungen rückgängig machen** unter der Antwort.
- `.whiteboard`-Dateien lassen sich in KI-Bereichen anderer Editoren anhängen, mit `@` auswählen, auf der Startseite durchsuchen, in **Anderes Dokument erstellen** verwenden (inklusive Umwandlung nach Markdown ohne KI) und über [Terminalbefehle](help://cli) (`ieumoffice whiteboard read`, `ieumoffice whiteboard apply`, `ieumoffice create --type whiteboard`) verarbeiten.

## Internetnutzung und Link-Karten

- Öffnen, Bearbeiten, Exportieren, Drucken sowie Excalidraw- und PDF-Import senden keinerlei Daten ins Internet.
- Ein Klick auf eine Link-Karte öffnet `http`-, `https`- oder `mailto`-Adressen in Ihrem Standardbrowser.
- Nur wenn Sie beim Hinzufügen oder Bearbeiten einer Link-Karte ausdrücklich **Titel und Vorschaubild abrufen** einschalten, verbindet sich GenOffice einmalig mit dieser Seite und speichert das Vorschaubild in der `.whiteboard`-Datei.
