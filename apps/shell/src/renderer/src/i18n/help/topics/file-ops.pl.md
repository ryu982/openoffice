# Operacje na plikach: zmiana nazwy, usuwanie, eksport

Ten rozdział opisuje operacje na plikach wspólne dla wszystkich edytorów; opcje eksportu każdego edytora znajdziesz w jego rozdziale.

**⋯ menu** w wierszu (pojawia się po najechaniu na wiersz pliku) zbiera te działania:

![⋯ menu wiersza pliku](img/file-ops.png)

## Zmiana nazwy

Dwa wejścia, jeden zestaw sprawdzeń:

- **⋯ ▸ Zmień nazwę** w wierszu na stronie głównej.
- **Kliknięcie dwukrotnie karty pliku** zmienia nazwę w miejscu (patrz [Karty i zarządzanie oknami](help://tabs-and-windows)).

Zasady: rozszerzenie jest zachowywane automatycznie; niedozwolone znaki, kropki na końcu i nazwy zastrzeżone (CON, NUL i tym podobne) są odrzucane z komunikatem; konflikt nazwy w tym samym folderze również jest blokowany. Zmieniana jest nazwa prawdziwego pliku na dysku, a listy ostatnich i ulubionych aktualizują się wraz z nią.

## Usuwanie

- **⋯ ▸ Usuń** na stronie głównej: pyta, które pliki, a następnie przenosi je do **kosza systemowego**, skąd system operacyjny może je przywrócić. GenOffice nie trzyma własnego cofnięcia — przywracanie to zadanie kosza, nie komunikatu.

## Duplikowanie

**⋯ ▸ Utwórz kopię** tworzy kopię pliku <nazwa> w tym samym folderze; przy kolizji nazw automatycznie dopisywany jest licznik. Kopia trafia do **Ostatnie**, zamiast otworzyć się sama — jeden klik dalej, a nie przed nosem.

## Zapisz i Zapisz jako

- **⌘S / ctrl+S** zapisuje bieżący plik; plik bez tytułu najpierw pyta o lokalizację i nazwę.
- W większości edytorów lista typów plików w oknie Zapisz jako zawiera też formaty eksportu (PDF, obrazy, inne formaty dokumentów). Wybranie jednego z nich zapisuje tylko kopię; otwarty dokument i jego karta pozostają przy pliku oryginalnym. Obrazy wielu stron są dzielone na `nazwa-01.png`, `nazwa-02.png`, ….
- **Docs**: lista Zapisz jako oferuje też .hwp i .hwpx (Plik ▸ Eksportuj jako dokument HWP… działa tak samo). Jeśli czegoś nie da się przenieść, np. komentarzy, równań czy pól tekstowych, dowiesz się o tym przed zapisaniem pliku.
- **Zapisz jako…** zapisuje nowy plik i pozostawia oryginał nietknięty; późniejsze edycje dotyczą nowego pliku.
- Każdy zapis jest atomowy (plik tymczasowy + zmiana nazwy); zamknięcie w trakcie zapisu nie może uszkodzić pliku.
- Autozapis działa zgodnie z przełącznikiem w każdym edytorze; nowy dokument bez własnego pliku zaczyna działać po pierwszym zapisie (patrz [Szybki start](help://getting-started)).

## Eksport do PDF

- **Docs**: Plik ▸ Eksportuj jako PDF… (lub przycisk na wstążce), z podziałem na strony zgodnym z układem.
- **Slides**: eksport rasteryzuje stronę po stronie, z paskiem postępu przy dużych prezentacjach.
- **Sheets**: eksport stosuje podział na strony używany przy drukowaniu.
- Eksporty są renderowane w ukrytym oknie i trafiają tam, gdzie wskażesz.

## Eksport do Worda i obrazów

- **Eksportuj jako Word…** w PDF: zamienia PDF w plik .docx (konwersja lokalna; złożone układy odtwarzane są w miarę możliwości).
- **Docs** może eksportować strony jako obrazy (PNG na stronę).

## Drukowanie

Plik ▸ Drukuj (⌘P/ctrl+P) otwiera w każdym edytorze okno drukowania. Docs, PDF, Sheets, Slides i Markdown mają sekcję **Układ stron** w swoim dotychczasowym oknie drukowania, HWP w podglądzie wydruku, a HTML, mapa myśli i diagram w nowym, małym oknie drukowania. Jeśli w sekcji Układ stron nic nie wybierzesz, drukowanie przebiega tak samo jak dotąd.

- **Układ**: wybierz Jedna strona na arkusz, Kilka stron na arkusz (2, 4, 6, 9 lub 16), Broszura (oprawa z lewej lub z prawej), Plakat (arkusze w poziomie i w pionie, zakładka, linie cięcia) albo Etykiety (jedna strona na etykietę lub ta sama strona na każdej etykiecie, etykieta początkowa, popularny format A4 lub własne wymiary).
- **Tylko nieparzyste strony arkusza, tylko parzyste strony arkusza, odwrotna kolejność**: strony liczy się po ułożeniu, według tego, co faktycznie wychodzi z drukarki. Przydaje się przy drukarce bez druku dwustronnego: wydrukuj przednie strony, odwróć papier i wydrukuj tylne.
- **Zmniejsz do rozmiaru papieru**: zmniejszane są tylko strony większe niż wybrany papier; mniejsze nie są powiększane. Sheets i Markdown korzystają ze swoich dotychczasowych pól papieru i skali.
- **Skala szarości i rozdzielczość obrazu**: przy drukowaniu z opcjami sekcji Układ stron każda strona jest zamieniana na obraz i dopiero wtedy trafia do drukarki. Rozdzielczość wybierasz spośród: Automatyczna, 150, 300 lub 600 dpi.
- **Tylko zaznaczenie**: Docs i Markdown drukują tylko zaznaczony tekst, ułożony od nowa od pierwszej strony; Slides drukuje zaznaczone slajdy, a PDF zaznaczone strony. Sheets jak dotąd drukuje zaznaczony zakres.
- **Schemat układu i podgląd wyniku**: schemat od razu pokazuje, gdzie na papierze trafia każdy numer strony, a **Podgląd wyniku** pokazuje to, co faktycznie powstało. Użyj **Zapisz ułożony wynik jako PDF**, aby wydrukować ten sam układ na innym komputerze lub w drukarni.
- **Systemowe okno drukowania**: dla broszury wybierz druk dwustronny z obracaniem wzdłuż krótszej krawędzi. Zakres stron i liczbę stron na arkusz zostaw w oknie systemowym bez zmian.

Pliki PDF drukują się z bieżącą kolejnością stron i obrotami.

## Gdzie trafiają pliki bez tytułu

Lokalizacja wybrana przy pierwszym zapisaniu jest ich domem. Do tego czasu dokument nie ma własnego pliku: jego niezapisana zawartość istnieje tylko jako kopia odzyskiwania w folderze danych aplikacji, dzięki czemu można ją odzyskać, gdy aplikacja nagle się wyłączy (zobacz [Karty i zarządzanie oknami](help://tabs-and-windows)). Autozapis przejmuje nad nim kontrolę dopiero po tym pierwszym zapisaniu.
