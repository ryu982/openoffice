# Tablica: burza mózgów, szkice i notatki

Edytor tablicy otwiera pliki `.whiteboard` w karcie. Możesz układać karteczki samoprzylepne, tekst, kształty, łączniki, tabele, naklejki, obrazy, karty linków i odręczne pociągnięcia piórem na nieskończonych tablicach swobodnych lub stałych stronach, wstawiać strony PDF jako tło, eksportować do obrazów lub PDF oraz pracować z panelem AI. Wszystko działa lokalnie na Twoim komputerze.

## Otwieranie i tworzenie

- Nowa tablica otwiera się jako swobodna nieskończona powierzchnia z kafelka **Tablica** na ekranie startowym lub przez Nowy w menu Plik.
- Edytor otwiera pliki `.whiteboard` z okna otwierania, przez przeciągnięcie do okna, z ostatnich plików, drzewa folderów, Szybkiego podglądu (Spacja) lub Dysku Google. W systemie Windows instalacja GenOffice rejestruje go jako domyślny program dla `.whiteboard`.
- Pliki Excalidraw (`.excalidraw`, `.excalidraw.png`, `.excalidraw.svg`) są importowane jako nowa tablica bez tytułu. Oryginalny plik nigdy nie jest nadpisywany, zamknięcie bez zmian nie pyta o zapis, a pierwszy zapis proponuje `.whiteboard` w tym samym folderze. Nieobsługiwane elementy jak osadzenia sieciowe są pomijane z informacją o ich liczbie. W Windows `.excalidraw` pojawia się wyłącznie w menu „Otwórz za pomocą”.
- Jeśli tablica jest już otwarta, jej karta przechodzi na wierzch.

## Edycja i narzędzia

- Jeden plik `.whiteboard` może łączyć na pasku stron tablice swobodne i stałe strony (ekran 16:9, A4 pionowo i poziomo oraz niestandardowe rozmiary stron PDF).
- Narzędzia obejmują zaznaczanie, karteczki, tekst sformatowany, osiem kształtów, łączniki i strzałki, pióro reagujące na nacisk, zakreślacz i gumkę, obrazy, tabele, wbudowane naklejki oraz karty linków.
- Aby zaznaczyć kilka obiektów naraz, przeciągnij narzędziem zaznaczania prostokąt od pustego miejsca. Gdy obiekty nie zostawiają wolnego miejsca, wybierz **Zaznacz obszar** (M) na lewym pasku narzędzi i zacznij przeciągać bezpośrednio na obiektach. Zaznaczane są tylko obiekty, które w całości mieszczą się w prostokącie. Kliknięcie obiektu z klawiszem Shift (lub Ctrl) dodaje go do zaznaczenia albo go z niego usuwa, przeciąganie z Shift dodaje obiekty z kolejnego prostokąta, a Ctrl+A (⌘A na Macu) zaznacza wszystkie obiekty na bieżącej stronie. Przeciągnięcie dowolnego zaznaczonego obiektu przesuwa wszystkie razem, a Na wierzch, Na spód, Duplikuj i Usuń działają na wszystkie naraz, każde jako jeden krok cofania.
- Przeciągnij plik `.pdf` na otwartą tablicę lub wybierz **Importuj PDF**, aby zamienić wybrane strony PDF w stałe strony tła do szkicowania i dodawania notatek. Otwarcie `.pdf` ze startu lub menu Plik nadal otwiera edytor PDF.
- Naciśnij F5 lub kliknij **Prezentuj**, aby wyświetlić tablicę na pełnym ekranie i przełączać strony strzałkami.
- W ciemnym motywie ciemnieją paski narzędzi, panele i tło poza stroną, natomiast kartka, karteczki, kształty i tusz zachowują oryginalne kolory dokumentu.

## Zapisywanie, eksport i drukowanie

- Zapis, Zapisz jako, autozapis, kopie odzyskiwania i sprawdzanie konfliktów w widoku podzielonym działają jak w pozostałych edytorach. Gdy nic się nie zmieniło, plik nie jest zapisywany ponownie.
- Eksportuj do PNG, SVG lub PDF dla **Wszystkich stron** lub **Tylko bieżącej strony**. Na tablicy swobodnej eksport i wydruk dopasowują się do wszystkich obiektów z marginesem lub do domyślnego obszaru startowego, gdy tablica jest pusta.
- Drukowanie (Ctrl+P) obsługuje standardowy wydruk i zaawansowany układ stron. Eksporty i wydruki są identyczne w jasnym i ciemnym motywie.

## Panel AI

- Poproś AI o uporządkowanie karteczek, przygotowanie szablonu warsztatów lub retrospektywy, dodanie kształtów, łączników, tabel lub obrazów albo podsumowanie tablicy.
- AI otrzymuje uporządkowaną tabelę tekstową tablicy, a gdy wybrany model obsługuje obrazy, automatycznie dołącza podgląd bieżącej strony. Modele wyłącznie tekstowe działają na samej tabeli tekstowej.
- Każde wywołanie edycji AI to jeden krok cofania (Ctrl+Z), podświetla zmienione obiekty wyłącznie na ekranie bez zmiany zapisanego pliku i udostępnia przycisk **Cofnij te zmiany** na karcie odpowiedzi.
- Pliki `.whiteboard` można załączać w panelach AI innych edytorów, przywoływać przez `@`, wyszukiwać na ekranie startowym, używać w funkcji **Utwórz inny dokument** (w tym konwersja do Markdown bez AI) oraz obsługiwać przez [polecenia terminala](help://cli) (`ieumoffice whiteboard read`, `ieumoffice whiteboard apply`, `ieumoffice create --type whiteboard`).

## Korzystanie z internetu i karty linków

- Otwieranie, edycja, eksport, drukowanie oraz import Excalidraw i stron PDF nie wysyłają niczego do internetu.
- Kliknięcie karty linku otwiera adresy `http`, `https` lub `mailto` w domyślnej przeglądarce.
- Dopiero gdy podczas dodawania lub edycji karty linku wyraźnie włączysz **Pobierz tytuł i obraz podglądu**, GenOffice łączy się jednorazowo z tą stroną i zapisuje obraz podglądu wewnątrz pliku `.whiteboard`.
