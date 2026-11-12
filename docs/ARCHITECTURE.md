# Architektura aplikacji

## Platformy i podział kodu

- WWW i APK korzystają ze wspólnego React w `apps/web` (Vite, Mantine,
  Schedule-X i TanStack Query). APK zawiera lokalny frontend i łączy się
  ze zdalnym API przez natywny transport. Alarmy dostarcza Android.
- Publiczna strona `/strona/` pochodzi z `page/` i wchodzi do builda WWW.
  Anonimowe wejście na główny adres WWW prowadzi do tej strony, w APK do
  `/witaj`. Głębokie linki zachowują cel po logowaniu.
- `apps/api` to modularny monolit Fastify. Trasy obsługują HTTP, serwisy
  realizują reguły i transakcje, repozytoria wykonują zapytania Drizzle.
  Moduły współpracują przez serwisy lub jawne porty. ESLint pilnuje granic
  repozytoriów API i publicznych wejść `features/<moduł>/index.ts` w WWW.
- `packages/shared` udostępnia schematy Zod, typy i wspólne obliczenia czasu.
  Struktura SQLite wynika ze schematu Drizzle w `apps/api/src/db/schema/`
  i migracji. Każde połączenie włącza klucze obce oraz korzysta z WAL.
  Transakcje i idempotencja zależą od synchronicznego sterownika SQLite.
- Produkcja działa pod Passengerem z HTTPS. Proces może zostać uśpiony,
  więc aplikacja nie wymaga stale działającego workera. Backup i porządkowanie
  danych wykonuje cron. Szczegóły operacyjne są w [DEPLOY.md](DEPLOY.md).

## Kontrakty API

Polecenie `npm run openapi:generate` zapisuje OpenAPI 3.1 w `docs/openapi.json`.
Dokument powstaje z tras faktycznie zarejestrowanych przez Fastify i schematów
Zod wskazanych przy trasach. Schematy współdzielone pochodzą z
`packages/shared/src/schemas`, a schematy specyficzne dla transportu z API.
Parametry idempotencji pochodzą z tego samego profilu, który je waliduje.
Warunki między polami, reguły zależne od danych i uprawnienia sprawdza
aplikacja podczas obsługi żądania.

- API wyznacza rodzinę i użytkownika z sesji. Odczyty i zapisy są zawężone do
  rodziny, także w repozytoriach oraz przy odtwarzaniu odpowiedzi idempotentnej.
- Sesja używa cookie `sid` z HttpOnly i SameSite=Lax oraz Secure w produkcji.
  Mutacje wymagają JSON i zaufanego źródła według Origin albo, przy jego
  braku, Referer. Tylko skonfigurowani pośrednicy mogą podać IP klienta.
- Limiter IP działa osobno w każdym procesie. Logowanie i operacje
  poświadczeń mają dodatkowe trwałe limity SQLite. Argon2 współdzieli
  ograniczoną pulę pracy. Limity rekordów rodziny są egzekwowane w tej samej
  transakcji co zapis i mają konfigurację opisaną w [DEPLOY.md](DEPLOY.md).
- Klient odróżnia błąd poświadczeń od utraty sesji. API zwraca polskie
  komunikaty. Szczegóły nieoczekiwanych błędów trafiają do logów serwera.
- Profil idempotencji mutacji zapisuje odpowiedź atomowo z operacją.
  Zmiana danych pod tym samym identyfikatorem jest konfliktem. Ponowienie
  z kolejki zachowuje identyfikator i treść. Klient ponawia automatycznie
  do 30 dni, serwer zachowuje odpowiedzi przez 90 dni.

## Dane i czas

- Nowe identyfikatory to UUID. Momenty zapisujemy jako milisekundy UTC,
  a daty kalendarzowe jako `YYYY-MM-DD`. Godziny lokalne są niezależne od UTC.
- Strefa rodziny to `Europe/Warsaw`. Obliczenia przejścia czasu są wspólne
  w `packages/shared/src/time.ts`. Nieistniejąca godzina przesuwa się o lukę,
  a dla powtórzonej godziny wybieramy wcześniejszy moment UTC.
- Role to administrator, dorosły domownik i dziecko. Dostęp do zadań zależy
  także od listy. Wskazania historycznej osoby mogą zostać puste po usunięciu
  konta, a interfejs pokazuje „były domownik”.

## Rodzina i sesja

- Założenie rodziny wymaga akceptacji regulaminu i potwierdzenia e-mail.
  Wysłanie zgłoszenia zapisuje wyłącznie tymczasowy rekord. Jawne potwierdzenie
  atomowo tworzy rodzinę, administratora i domyślne grupy kontaktów. Zalogowanie
  jest osobną czynnością. Błąd SMTP unieważnia tylko bieżące zgłoszenie.
- Zaproszenie jest jednorazowe. Rotacja kodu rodziny zachowuje istniejące
  sesje. Starsze kody pozostają aktywne do rotacji, a starsze APK mogą wymagać
  przeglądarki lub aktualizacji, aby założyć rodzinę albo podać nowy kod.
- Reset hasła atomowo zużywa token i unieważnia pozostałe linki oraz sesje
  resetowanej osoby. Zamówienie lub otwarcie linku samo nie zmienia konta.
  Odpowiedź zamówienia nie ujawnia, czy konto istnieje. Tokeny przechowujemy
  w postaci skrótów i pomijamy w logach. Wysyłka odbywa się w żądaniu.
- Administrator może usunąć rodzinę lub domownika. Inny dorosły może usunąć
  siebie lub dziecko swojej rodziny. Ostatni administrator może usunąć całą
  rodzinę albo przekazać rolę przed usunięciem własnego konta.
- Usuwanie kont wymaga połączenia i potwierdzenia hasłem wykonującego.
  Po weryfikacji hasła serwis ponownie sprawdza sesję i uprawnienia w transakcji.
  Pojedyncze usunięcie zachowuje wspólną treść. Prywatne listy znikają,
  udostępnione przechodzą na członka albo są usuwane, gdy nie mają członków.
  Nieznany wynik usunięcia wymaga sprawdzenia przed ponowieniem.

## Pamięć i synchronizacja offline

- `OfflineModule` określa format, migracje, budżet i pokrycie lokalnej kopii
  modułu. Kalendarz i kontakty odczytują zapisane dane. Zadania, zakupy i
  obiady projektują widok ze snapshotu oraz wspólnej kolejki zapisów.
  Brak pobranego zakresu pozostaje stanem nieznanym.
- Każde konto ma oddzielną bazę IndexedDB z sesją, snapshotami, metadanymi
  i outboxem. Rejestr przełączenia kontroluje rewizje i przerwane czyszczenie.
  Zmiana konta zamyka połączenia, a unieważnienie generacji sesji zatrzymuje
  spóźnione operacje i odpowiedzi, również z mostka Androida.
- Interfejs potwierdza zmianę po trwałym zapisie. Potwierdzenie z serwera
  aktualizuje snapshot i kolejkę w jednej transakcji. Sygnały do innych kart
  idą po zatwierdzeniu. Zależne zmiany zachowują kolejność, a niezależne mogą
  przejść mimo konfliktu innej operacji.
- W WWW Web Locks szereguje nadawców między kartami. Brak blokady wstrzymuje
  synchronizację i zachowuje kolejkę. APK szereguje nadawców w procesie.
  Nadawca potwierdza tożsamość przed pierwszą operacją i unieważnia
  potwierdzenie po zmianie konta, transporcie z błędem lub końcu przebiegu.
- Utrata sesji zawiesza oczekujące zapisy. Potwierdzone logowanie na to samo
  konto pozwala wznowić wysyłkę. Logowanie na inne konto usuwa zawieszone dane.
  Jawne wylogowanie z kolejką wymaga wysłania lub odrzucenia zmian.
- WWW obsługuje utratę sieci w otwartym interfejsie. APK uruchamia lokalny
  frontend offline po wcześniejszym pobraniu danych. Zamknięte APK nie
  synchronizuje danych w tle.
- Migracja starej bazy wznawia pracę po przerwaniu. Przełączenie następuje po
  zatwierdzeniu kompletnej kopii, a źródło jest usuwane po przełączeniu.
  Starsze karty muszą zamknąć połączenia. Odzyskiwanie z `localStorage`
  działa na tym samym originie lub w tej samej instalacji APK i usuwa źródło
  po zweryfikowaniu importu. Procedury aktualizacji opisuje [DEPLOY.md](DEPLOY.md).

## Kalendarz

- Wydarzenie jednorazowe bez godziny jest wpisem przypisanym do daty. Godzina
  bez podanej długości zachowuje początek bez wyświetlanego czasu końca.
  Wydarzenia odległe, serie i wystąpienia mają osobne reguły czasu.
- Zapisany zakres kalendarza można odczytać offline. Cache szczegółów,
  wydarzeń odległych i osobistych przypomnień uzupełnia się w bazie konta.
- Duplikaty wykrywamy po dacie i znormalizowanym tytule. Zastąpienie wymaga
  aktualnej wersji dopasowania oraz uprawnień. Zachowuje identyfikator i autora
  wydarzenia. Wystąpienie serii zmienia się w edycji serii.

### Import wydarzeń ze zdjęcia

- Tesseract.js w WWW i Tesseract4Android w APK przetwarzają zdjęcie lokalnie
  i używają polskiego modelu. Wspólny parser otrzymuje tekst i położenie
  fragmentów. Brak roku, kilka możliwych dat lub niejasna godzina wymagają
  decyzji użytkownika. Import nie przypisuje sam uczestników ani alarmów.
- Zdjęcie i surowy OCR pozostają na urządzeniu. Do API trafiają wyłącznie
  zatwierdzone propozycje. Przed wysłaniem klient trwale zapisuje dane i
  identyfikatory operacji w magazynie konta. Po nieznanym wyniku ręcznie
  ponawia te same dane. Wybór kolejnego zdjęcia zastępuje tylko propozycje
  niewysłane. Zmiana konta unieważnia odczyt i odpowiedzi.
- Każda pozycja paczki zapisuje się w osobnej transakcji z rejestrem sukcesu.
  Retry zachowuje identyfikator, a aktualny dostęp jest sprawdzany również
  przed replay. Powtórzenie zapisanej operacji nie odtwarza usuniętego
  wydarzenia. Częściowy sukces odświeża kalendarz i harmonogram.

## Zadania

- Listy mogą być prywatne lub udostępnione. Zadania, checklisty i serie
  dziedziczą dostęp z listy, również dla dzieci. Cofnięcie dostępu usuwa
  lokalne dane listy, jej oczekujące zmiany i powiązane alarmy po uzgodnieniu.
- Ukończenie rodzica i podzadań jest niezależne. Treść kroku, odhaczenie
  i kolejność mają osobne wersje. Konflikt wymaga świadomej decyzji,
  a brak checklisty w starym snapshotcie blokuje jej edycję do odświeżenia.
- Seria ma najwyżej jedno aktywne wystąpienie. Stały rytm liczy daty od kotwicy,
  a odstęp po wykonaniu od lokalnej daty rzeczywistego zamknięcia. Zamknięcie
  atomowo zapisuje historię i tworzy jednego następcę, o ile reguła ma kolejny
  termin. Następca otrzymuje nowe kroki wzorca i wspólne względne przypomnienia.
- Offline można wykonać pobrane wystąpienie. Kolejka zachowuje czas i wersje,
  a następca pojawia się po potwierdzeniu serwera i zapisie pełnego snapshotu.
  Anomalia czasu lub konflikt wymagają sprawdzenia. Zmiana reguły, pominięcie
  i zatrzymanie wymagają sieci. Cofnięcie zamknięcia jest warunkowe i zachowuje
  historię. Starszy klient przekazuje zwykłe odhaczenie i używa czasu serwera.

## Zakupy

- Moduł przechowuje listy i pobrane zakresy pozycji. Obecny snapshot v2 czyta
  także starszy format v1. Kolejka własnych zmian i eksportów obiadów wyznacza
  wspólną projekcję zawartości zakupów.
- Eksport używa publicznego serwisu zakupów w API i publicznego modułu zakupów
  we frontendzie. Zapis rozliczenia może jednocześnie uzgodnić identyfikatory
  kolejnych zmian z pozycjami po scaleniu.

## Obiady

- Tydzień zaczyna się w poniedziałek. Dzień może zawierać wiele dań, a tryb
  zgodności starszego APK operuje na pierwszym. Dorośli edytują znane tygodnie
  także offline. Dzieci mają odczyt. Dzisiejsza karta stosuje datę rodziny
  i tę samą projekcję co plan tygodnia.
- Eksport jest jednorazowym dodaniem składników do zakupów. Scala nazwy po
  normalizacji i łączy ilości tekstowo. Kupione pozycje zachowują stan.
  Powtórny świadomy eksport wymaga potwierdzenia, a techniczne ponowienie
  zachowuje wynik bez zwiększenia ilości.
- Offline eksport utrwala składniki i docelowe identyfikatory. Czeka na
  wcześniejsze zmiany, od których zależy. Późniejsza edycja planu nie zmienia
  utrwalonej operacji. Rozliczenie aktualizuje bazę zakupów i outbox atomowo.

## Dokumenty

- Dostęp do wspólnych dokumentów wynika z rodziny. Dziecko może odczytywać
  dokumenty i zarządzać własnymi przypomnieniami. Zmiana lub odnowienie
  dokumentu przelicza terminy względne, zachowując daty przypomnień stałych.

## Kontakty

- Każdy kontakt należy do jednej grupy. Usunięcie grupy atomowo przenosi
  kontakty do nieusuwalnej grupy domyślnej „Inne”. Dorośli edytują, a wszyscy
  domownicy mają odczyt.
- Urodziny mogą zawierać pełną datę lub dzień i miesiąc. Alarm działa także
  bez roku, o 09:00 w strefie rodziny. W roku nieprzestępnym termin 29 lutego
  wypada 28 lutego. Zmiana lub usunięcie daty aktualizuje alarm po synchronizacji.

## Przypomnienia

- Serwer wylicza terminy i odbiorców, a Android zapisuje alarmy systemowe.
  Źródłem jest wydarzenie, zadanie lub dokument, a urodziny wynikają z kontaktu.
  Odbiorca musi mieć dostęp do źródła. Przy pustym zbiorze odbiorców
  wydarzenia i dokumenty kierują alarm do dorosłych, a zadanie pomija alarm.
- Osobiste przypomnienia należą wyłącznie do wskazanej osoby. Edycja źródła
  zachowuje cudze przypomnienia osobiste. Offset podąża za terminem, a data
  stała zachowuje swój moment. Bez godziny podstawą offsetu jest 09:00.
- Za zgodą na dokładne alarmy Android używa `setExactAndAllowWhileIdle`.
  Przypomnienia mogą działać w Doze bez systemowej ikony budzika. W Doze
  limity Androida mogą opóźniać przypomnienia wyznaczone blisko siebie.
  Bez zgody APK używa `setAndAllowWhileIdle`, więc przypomnienia mogą przyjść
  po wyznaczonym czasie. Po aktualizacji APK oraz po restarcie i pierwszym
  odblokowaniu aplikacja odtwarza przyszłe alarmy z urządzenia. Udzielenie
  zgody zastępuje alarmy przybliżone dokładnymi. Cofnięcie zgody usuwa
  dokładne alarmy w Androidzie. Przy następnym uruchomieniu APK odtwarza je
  w trybie przybliżonym.
- Zmiana konta lub utrata sesji czyści alarmy. Cofnięcie dostępu na innym
  urządzeniu jest widoczne po synchronizacji. Powiadomienie o prywatnym zadaniu
  ma ogólną treść, a otwarcie wymaga ponownej autoryzacji.

## Interfejs

Mantine definiuje motyw i wspólne tokeny. Szerokie WWW ma menu po lewej.
Wąskie WWW i APK używają panelu z prawej. Ekrany zachowują czytelny fokus,
etykiety, obsługę klawiatury, kontrast, cele dotykowe i safe area. Systemowy
Wstecz współpracuje z ochroną niezapisanych formularzy. Stan błędu lub
synchronizacji pozostaje czytelny bez rozpoznawania koloru.
