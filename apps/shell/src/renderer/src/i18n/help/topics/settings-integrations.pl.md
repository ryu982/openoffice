# Ustawienia, język, motyw i integracje MCP

## Otwieranie ustawień

Wiersz w lewym dolnym rogu strony głównej otwiera panel ustawień (wiersz pod nim pokazuje, czy AI jest połączone). Ma pięć sekcji: Konto, AI, Ogólne, Integracje i O aplikacji.

Można je też otworzyć z dowolnej karty skrótem **⌘,** (Ctrl+, w systemach Windows i Linux), na Macu poleceniem **Ustawienia…** w menu aplikacji (menu z nazwą aplikacji, po lewej stronie paska menu), a w systemach Windows i Linux przez **Menu (☰) ▸ Ustawienia…**. W karcie Word ⌘, (Ctrl+,) oznacza indeks dolny, więc tam otwórz je z menu.

**Konto** pokazuje stan twoich połączeń Claude, ChatGPT i Codex, a **Zarządzaj połączeniami** prowadzi do sekcji AI. AI ma własne artykuły: [Połączenie z subskrypcją](help://subscription) oraz [Modele AI i ustawienia](help://ai-models).

## Język

- Ustawienia oferują **22 języków interfejsu**: angielski, uproszczony chiński, japoński, koreański, francuski, niemiecki, hiszpański, tajski, indonejski, rosyjski, arabski, portugalski, włoski, polski, czeski, niderlandzki, malajski, hebrajski, hindi, tradycyjny chiński, wietnamski, turecki.
- Zmiana działa natychmiast i zostaje zapamiętana; natywny pasek menu jest odbudowywany w nowym języku.

## Motyw

Jasny / Ciemny / Zgodnie z systemem. Opcja Zgodnie z systemem podąża za wyglądem systemu operacyjnego, a edytory zmieniają wygląd synchronicznie, bez migotania.

## Ogólne

- **Położenie panelu bocznego AI** (po lewej lub po prawej), **Rozmiar tekstu panelu AI** i **Sprawdzanie pisowni w czacie AI**.
- **Panel AI** — Wyłączony, Zwinięty lub Ostatni stan.
- **Automatycznie zapisuj wszystkie dokumenty** włącza AutoSave domyślnie w każdym edytorze; nadal można je wyłączyć dla jednego okna.
- **Lokalizacja zapisu** z przyciskiem **Zmień** oraz **Domyślna aplikacja dla dokumentów Office**, aby przejąć .docx / .xlsx / .pptx dla GenOffice.
- **Format zapisu nowych dokumentów HWP** decyduje, czy przy pierwszym zapisie nowego dokumentu zaproponować najpierw HWP, czy HWPX. Otwarte dokumenty zachowują swój format.
- **Czcionki slajdów AI** ustala czcionki, których AI używa w nowej prezentacji, gdy prośba nie wskazuje żadnej. Wybierz Automatycznie, Bezszeryfowa, Szeryfowa lub Tytuły szeryfowe i osobno zmień czcionkę bezszeryfową i szeryfową. Wybrany szablon projektu używa własnych czcionek, a strony dodane do prezentacji w innych czcionkach dostosowują się do niej.

GenOffice nie zbiera ani nie wysyła statystyk użytkowania, więc nie ma do tego przełącznika.

## Edytory i AI

Tutaj wybierasz, z których edytorów korzystasz i czy używasz AI. Ta sama lista pojawia się też raz w dwóch innych miejscach: w kroku **Wybierz edytory** na ekranach powitalnych przy pierwszym uruchomieniu oraz w oknie pokazywanym jeden raz na stronie głównej osobom, które korzystały z GenOffice, zanim pojawiło się to ustawienie. Na początku wszystko jest włączone, więc jeśli nic nie zmienisz, nic się nie zmieni. Zmiana działa od razu we wszystkich otwartych oknach.

- **Edytory**: Word, Excel, PowerPoint, PDF, Narzędzia PDF, Markdown i tekst, HTML, Mapa myśli, Diagram, HWP (Hangul) i E-book (EPUB). Narzędzia PDF włącza się osobno od edytora PDF. Co najmniej jeden edytor musi pozostać włączony.
- **Wyłączony edytor** znika z list nowych dokumentów: z kart strony głównej, menu **+** paska kart, Plik ▸ Nowy i listy aplikacji domyślnych. Dokumenty, które są już otwarte, pozostają otwarte, a kopie odzyskiwania są zachowywane.
- **Otwarcie pliku wyłączonego edytora** (dwukrotne kliknięcie, przeciągnięcie i upuszczenie, Plik ▸ Otwórz, ostatnie pliki) pyta, czy wybierasz **Włącz i otwórz**, czy **Anuluj**. Gdy otwierasz naraz kilka jego plików, pytanie pada tylko raz.
- **Inne funkcje, które otworzyłyby wynik w wyłączonym edytorze**, na przykład konwersja PDF do tego formatu, pytają przed rozpoczęciem: **Włącz i otwórz**, **Utwórz tylko plik** (plik zostaje utworzony i pokazany w folderze, a edytor pozostaje wyłączony) albo **Anuluj**.
- **Gdy funkcje AI są wyłączone**, znikają panele AI, przyciski i menu AI, panel pytań na stronie głównej, okno agenta i podpowiedzi dotyczące łączenia AI, a karty Konto, AI i Umiejętności znikają z ustawień. GenOffice nie uruchamia ze swoich ekranów żadnego programu AI. Logowania, klucze, umiejętności i ustawienia zostają zachowane i wracają po ponownym włączeniu AI. Jeśli praca AI wciąż trwa, najpierw padnie pytanie, czy chcesz **Zatrzymaj i wyłącz**.
- Wiersz poleceń, MCP i ten przewodnik działają tak samo bez względu na to, czy edytory i AI są włączone.

Nawet przy włączonym AI nie tworzy ono nowych dokumentów dla wyłączonego edytora, tylko prosi, by włączyć go tutaj.

## AI ▸ Zaawansowane

Ta część pozostaje zwinięta, dopóki jej nie otworzysz; większość osób nigdy jej nie potrzebuje. Karta **Model AI** zawiera klucze API i serwery uruchamiane samodzielnie, używane do czatu. Na karcie **Media i wyszukiwanie AI** każda możliwość wybiera dostawcę, który ją obsługuje, a klucz i bazowy adres URL dostawcy wpisuje się raz i są wspólne:

- **Wyszukiwanie w sieci**, **Generowanie obrazów**, **Analiza obrazów** i **Analiza wideo**, każda z dostawcą, modelem, kluczem i bazowym adresem URL.
- **Lokalne wyszukiwanie plików** działa na tej maszynie. Pod nim **przerankowanie wyszukiwania Jev** jest **domyślnie wyłączone**. Po włączeniu fragmenty top 20 lokalnych trafień — do 1 200 znaków na dokument plus nazwy plików i folderów — idą do wybranego punktu decyzyjnego (Jev przez OpenRouter lub TypeSafe, Perplexity, Liquid AI d1, Cloudflare, lokalny silnik lub własny URL) i są porządkowane według trafności. Wyłączone — nic nie opuszcza urządzenia.
- **Zezwól żądaniom automatycznym na korzystanie z subskrypcji** jest **domyślnie wyłączone**. Decyduje o tym, czy żądanie z wiersza poleceń albo od podłączonego agenta programistycznego może korzystać z twojej subskrypcji Claude lub Codex; zobacz [Podłączenie z agentem programistycznym](help://mcp).

## O aplikacji

- **Wersja**, adres projektu w serwisie GitHub oraz wiersz z nazwą projektu open source, na którym ta aplikacja jest oparta.
- **Kanał aktualizacji**: Stabilny lub Beta. Zmiana działa natychmiast i sprawdza, czy jest aktualizacja; nie cofnie instalacji Beta do kanału Stabilnego.

## Powiązanie z aplikacją domyślną

Ustawienia mogą zarejestrować GenOffice jako obsługę plików .docx / .xlsx / .pptx / .pdf i podobnych (rejestracja aplikacji domyślnej na poziomie systemu; potwierdzenie, gdy aplikacja o to poprosi).

## Informacje o oprogramowaniu innych firm i aktualizacje

- Pomoc ▸ Informacje o oprogramowaniu innych firm: pełny wykaz licencji open source dołączony do aplikacji.
- Menu (☰) ▸ Sprawdź aktualizacje… (na komputerze Mac Pomoc ▸ Sprawdź aktualizacje…): uruchamia ręczne sprawdzenie; nowsza wersja wyświetla monit o instalacji. Na Macu polecenie jest też w menu aplikacji, tuż pod pozycją „O programie GenOffice”.

## Integracja MCP (dla zaawansowanych użytkowników i klientów AI)

Do **Integracji** łączy GenOffice z agentem programistycznym i ma własny artykuł: Podłączenie z agentem programistycznym. Wersja skrócona — wybierz drogę (wiersz poleceń albo MCP), przejdź tę część, a potem rozpocznij nową rozmowę i zapytaj.

W sekcji **Lokalny serwer HTTP** aplikacja może też sama uruchomić ten serwer — przełącznik włączania i port —, a **Zaawansowane** dodaje adres sprawdzenia stanu i plik dziennika, zamiast zostawiać serwer asystentowi. Nasłuchuje wyłącznie na localhost.

## Ściągawka z poleceń

| Polecenie           | Co robi                      |
| ------------------- | ---------------------------- |
| `ieumoffice <plik>` | otwiera plik                 |
| `ieumoffice mcp`    | uruchamia lokalny serwer MCP |
| `ieumoffice --help` | wszystkie polecenia i opcje  |
