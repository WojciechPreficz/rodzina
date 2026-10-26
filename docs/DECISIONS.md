# Decyzje

## 26.10.2026 — rozszerzenie planu obiadów (faza 6, #6)

- Na polecenie właściciela eksport scala składniki również z pozycjami już
  obecnymi na wybranej liście zakupów, po znormalizowanej nazwie. Ilości nadal
  łączymy tekstowo. Podsumowanie rozróżnia pozycje dodane i uzupełnione.
- Eksport jest jednorazową operacją, bez stałego powiązania: późniejsza zmiana
  lub usunięcie obiadu nie zmienia zakupów i odwrotnie. Powód: właściciel nie
  chce automatycznej synchronizacji planu z listą po dodaniu składników.
- Rozszerzamy zakres o odczyt, dodawanie, edycję, usuwanie, kopiowanie zapisanych
  tygodni oraz eksport zapisanych składników offline, na wzór zakupów i zadań.
  Szczegóły cache, kolejki, restartu APK, prywatności, idempotencji i prób
  odbiorczych są w fazie 6 w `plan.md`. Eksport zachowuje kopię składników
  z chwili zlecenia, a retry tej samej operacji nie dubluje ilości.
- Dodajemy krok 6.5 — offline i domknięcie fazy. Kroki 6.1–6.4 pozostają
  działającymi etapami online; 6.5 rozszerza kontrakty i integruje trwały zapis
  oraz synchronizację. Nie wdrażamy przy okazji przyszłej przebudowy magazynów.
- Do wyjaśnienia z właścicielem przed implementacją eksportu: zachowanie przy
  ponownym ręcznym eksporcie tych samych dań na tę samą listę oraz scalaniu
  z pozycjami już kupionymi. Nie utożsamiamy nowego ręcznego eksportu
  z automatycznym ponowieniem tej samej operacji po błędzie sieci.
- Ta zmiana aktualizuje wyłącznie zakres i zadania; nie implementuje funkcji.

## 26.10.2026 — trwałe limity logowania (punkt 3 przeglądu architektury)

- Na polecenie właściciela wdrażamy punkty 3 i 6 przeglądu. Limity logowania
  przenosimy z pamięci procesu do `auth_rate_limits` (migracja 0024), aby
  restart i wiele procesów Passengera nie rozdzielały historii prób.
- Zachowujemy 10 prób w stałym oknie 15 minut i usuwanie licznika po
  poprawnym logowaniu. Rozdzielamy zakresy hasła i PIN-u oraz pary IP–konto;
  dla hasła normalizujemy e-mail, dla dziecka używamy rodziny i użytkownika.
  Klucz to SHA-256 tablicy tych wartości z zakresem, bez surowego e-maila
  w tabeli. Skrót nie jest szyfrowaniem ani obietnicą anonimowości danych.
- Sprawdzenie okna i zwiększenie licznika wykonujemy w krótkiej transakcji
  `immediate`, przed `await` Argon2. Wygasły wpis rozpoczyna nowe okno przy
  odczycie, bez zależności od crona. Istniejący backup sprząta wygasłe wpisy
  po udanej kopii, niezależnie od sprzątania sesji; błąd sprzątania logujemy
  bez unieważniania kopii. Bez nowej usługi, konfiguracji i zależności runtime.
- Przegląd potwierdził `request.ip` i `trustProxy: true`. Zachowujemy politykę,
  ponieważ nie znamy rzeczywistego łańcucha proxy vh.pl. Jej skuteczność
  wymaga nadpisywania nagłówków klienta przez zaufane proxy i braku wejścia
  bezpośrednio do API. Procedurę sprawdzenia opisuje `DEPLOY.md`; nie zaliczamy
  jej jako wykonanej na hostingu. Dodatkowy limit łączny IP lub konta
  pozostaje poza zakresem. Kontrakty API i APK pozostają zgodne.
- Weryfikacja lokalna: 39 testów w sześciu plikach (limity hasła i PIN-u,
  restart bazy, dwa połączenia API, czterech równoległych workerów,
  wygaśnięcie, czyszczenie po sukcesie, klucze, migracja i backup), ESLint
  zmienionego kodu, Prettier, `npm run typecheck`, `npm run build`
  i `npm run release:smoke` zakończyły się sukcesem. Smoke sprawdza również
  obecność `auth_rate_limits` w kopii bazy z paczki. Testy i smoke wykonano
  poza sandboxem po błędach plików tymczasowych Vitest i `EPERM` backupu.
  Raport: `.android-tools/architecture-3-tests.json`; logi buildu i smoke:
  `.android-tools/architecture-3-build.log` i `architecture-3-smoke.log`.
  Bez zmian UI ani APK; próby ekranów i telefonu nie są wymagane tym zakresem.
  Stan przed commitem/pushem: zweryfikowane lokalnie, oczekuje na CI.

## 26.10.2026 — rzeczywista zależność od sterownika SQLite (punkt 6)

- Korygujemy wcześniejszą deklarację wymiany `better-sqlite3` na
  `@libsql/client` w jednym pliku. `client.ts` centralizuje otwieranie
  połączenia, ale typy połączenia, synchroniczne repozytoria i serwisy,
  migracje sterownika, transakcje, idempotencja, limity logowania,
  bezpośrednie SQL, backup `VACUUM INTO` i binaria release zależą od obecnego
  sterownika. Powód: dokumentacja powinna opisywać rzeczywiste granice kodu.
- Zachowujemy sterownik. Abstrakcję i ewentualną migrację planujemy osobno
  dopiero przy konkretnej potrzebie, po sprawdzeniu modelu transakcyjnego
  nowego klienta. Sam interfejs nie uzgadnia zapisów synchronicznych
  i asynchronicznych. Wymagany będzie dowód atomowości mutacji i odpowiedzi
  idempotentnej, poprawnych migracji schematu oraz spójnego backupu.
- Ten punkt zmienia wyłącznie dokumentację, bez nowego adaptera ani zmiany
  runtime lub danych.

## 26.10.2026 — przeterminowane zmiany zadań (punkt 2 przeglądu architektury)

- Zachowujemy 30-dniowy limit automatycznego ponawiania. Trwały stan
  `needs-review` przechowujemy przy oryginalnej operacji, bez zmiany jej danych,
  identyfikatora ani daty. Brak stanu w starszym formacie oznacza `pending`;
  klasyfikacja wieku działa również offline przed zapisaniem nowego stanu.
- Wstrzymujemy późniejsze zapisy tego samego zadania. Potwierdzone dane serwera
  są wyświetlane bez tych zmian, a panel pokazuje osobno cały łańcuch.
  Błąd wysyłania kolejki nie zatrzymuje odczytu potwierdzonych danych.
- Odrzucenie całego obejrzanego łańcucha wymaga potwierdzenia i jednego trwałego
  znacznika z identyfikatorami operacji. Znacznik pozostaje w dzienniku konta,
  aby błąd sprzątania lub druga karta nie odtworzyły odrzuconych wpisów.
  Chronimy nowo dodane wpisy przed odrzuceniem przez nieaktualny panel.
- Po odrzuceniu nowe zapisy na tej liście wymagają udanego pobrania jej danych
  online. Ponowne wprowadzenie odbywa się zwykłym formularzem jako nowy zapis,
  ze zwykłą kontrolą uprawnień serwera. Nie dodajemy automatycznej zmiany daty,
  identyfikatora ani przycisku ponowienia starej operacji.
- Oryginalne wpisy i znaczniki są objęte dotychczasowym czyszczeniem magazynu
  konta. Wstrzymane zmiany terminu, ukończenia i usunięcia nadal wyłączają
  odpowiednie alarmy także po odtworzeniu magazynu offline.
- Po lokalnej implementacji właściciel zlecił commit i push. Zweryfikowane
  lokalnie, oczekuje na CI oraz ręczny odbiór desktopu i fizycznego APK.

## 26.10.2026 — powtarzalne zależności release (punkt 1 przeglądu architektury)

- Paczka serwera zawiera dedykowany manifest `rodzina-release` i lockfile v3
  z `scripts/release/`. `npm run release:lock` wydziela drzewo runtime z głównego
  lockfile, bez ponownego rozwiązywania wersji. Zachowuje wersje przechodnie,
  integralność i warianty platformowe. Bundlowany workspace shared jest pomijany.
  Pakowanie odrzuca rozbieżność z manifestem API lub głównym lockfile i nigdy
  nie aktualizuje automatycznie plików zależności.
- Smoke i hosting korzystają z jednej funkcji przygotowania zależności:
  `npm ci --omit=dev --ignore-scripts`, jawny `prebuild-install` dla SQLite,
  następnie sprawdzenie ładowania SQLite i Argon2. Brak binarium oznacza błąd,
  bez kompilacji runtime. Smoke porównuje dwie puste instalacje i wersje lockfile;
  linuksowy smoke w istniejącym CI na Node 24 sprawdza procedurę hostingu.
- Deploy wymaga nowej pary manifest–lockfile przed instalacją i promocją.
  Archiwizacja poprzedniej instalacji dopuszcza brak starego lockfile i zapisuje
  ten fakt w metadanych historii. Ręczny powrót do starszej paczki bez lockfile
  opisuje `DEPLOY.md`; nie traktujemy ponownego `npm install` jako odtworzenia
  dawnych wersji. Nowe wydania zawsze promują i archiwizują lockfile.
- Zakres nie zmienia danych, konfiguracji, crona ani kontraktu API/APK.
  Nie wymaga prób UI ani fizycznego telefonu. Końcowy odbiór automatyczny
  wymaga CI dla końcowego commita zgodnie z sekcją 1.2 planu.

## 26.10.2026 — święta i dni okolicznościowe w kalendarzu (K.1)

- Właściciel zatwierdził lokalne warstwy świąt ustawowych i 12 dni
  okolicznościowych opisanych w `plan.md`. Reguły obejmują lata 2025–2099,
  według obecnego stanu prawnego, bez obietnicy automatycznego śledzenia zmian.
  Źródłem świąt jest [ustawa o dniach wolnych od pracy](https://eli.gov.pl/eli/DU/2025/296/ogl),
  w tym Wigilia od 2025 r.; daty ruchome obliczamy gregoriańskim algorytmem
  Meeusa/Jonesa/Butchera i przesunięciami od Wielkanocy.
- Dni okolicznościowe stosują daty polskie. Źródła obejmują publikacje GUS:
  [Babcia i Dziadek](https://gdansk.stat.gov.pl/infografiki/21-stycznia-dzien-babci-22-stycznia-dzien-dziadka%2C1%2C11.html),
  [Walentynki](https://publikacje.new.stat.gov.pl/portal-publikacje/14-lutego-walentynki-0),
  [Matka, Dziecko i Ojciec](https://lodz.stat.gov.pl/infografiki/infografika-2026-26-maja-dzien-matki-1-czerwca-dzien-dziecka-23-czerwca-dzien-ojca%2C15%2C18.html?pdf=1).
  Objaśnienie Dnia Nauczyciela wynika z
  [informacji MEN](https://www.gov.pl/web/edukacja/list-ministra-dariusza-piontkowskiego-z-okazji-dnia-edukacji-narodowej).
- Katalog nie jest zbiorem wydarzeń rodziny: brak uczestników, mutacji,
  przypomnień i zapisu do snapshotu wydarzeń. Klucze wpisów adaptera są
  deterministyczne i nie są identyfikatorami encji bazy. Daty pozostają
  `Temporal.PlainDate`, niezależne od strefy urządzenia i rodziny.
- Dwie preferencje widoczności zapisujemy w `rodzina:calendar:holiday-layers:v1`.
  Są wspólne dla urządzenia i nie zawierają danych konta. Domyślnie obie
  włączone; błędny lub niedostępny magazyn nie blokuje kalendarza.
  Filtry domowników dotyczą tylko wydarzeń rodzinnych. Pusty wynik filtra
  opisujemy jako brak wydarzeń rodzinnych, nawet gdy widoczne są święta.
- Rozróżnienie kategorii jest tekstowe i kolorystyczne. Opis okazji nie
  sugeruje, że dana data musi być robocza; zbieżne święta nie zastępują się.
  Brak nowych zależności, API, migracji, zmiennych środowiskowych i crona.
  Zmiany katalogu wymagają aktualizacji WWW i osobnego wydania APK.
- Końcowe CI i próby fizycznego APK pozostają do potwierdzenia. Implementacja
  tego rozszerzenia nie zmienia statusu innych faz i nie obejmuje deployu.
- Weryfikacja lokalna: 83 testy Vitest kalendarza (w tym dodatkowy test
  przełączników), ESLint zmienionego zakresu, Prettier, `npm run typecheck`,
  build WWW/API i debug APK. Playwright headless: 16 scenariuszy kalendarza,
  w tym 4 nowych scenariuszy świąt przy 390 i 1280 px. Po poprawce kontrastu
  zaznaczonego weekendu ponowiono 4 scenariusze świąt i przegląd zrzutów obu
  szerokości. Wszystkie wymienione kontrole zakończyły się sukcesem.
  Raporty lokalne: `.android-tools/holiday-unit.json`,
  `.android-tools/holiday-page-unit.json` oraz `playwright-report/`;
  zrzuty w `test-results/`. Vitest i Playwright uruchomiono poza sandboxem,
  który blokował pliki tymczasowe Vitest i start serwera testowego.
  ADB nie wykazał podłączonego urządzenia: nie zaliczamy próby fizycznego APK.
  Stan: zweryfikowane lokalnie, oczekuje na CI. Deploy nie jest częścią kroku.
- Na polecenie właściciela etykiety 1 maja i 11 listopada to odpowiednio
  „Święto Pracy” i „Dzień Niepodległości”. Po zmianie przeszło 8 testów katalogu,
  ESLint, Prettier oraz `npm run typecheck`.

## 26.10.2026 — trwały podgląd Kontaktów offline (krok 9.3, #46)

- Przechowujemy kompletną odpowiedź `/api/contacts` wraz z czasem pobrania
  w jednym snapshotcie `rodzina:contacts:v1`, związanym z rodziną i użytkownikiem.
  Walidujemy schemat, rodzinę zasobów, unikalność identyfikatorów, jedną grupę
  domyślną i przynależność kontaktów do grup. Niepełna lub błędna odpowiedź
  zachowuje poprzedni poprawny zapis.
- Odmowa zapisu pozostawia pobrane dane w pamięci i pokazuje ostrzeżenie;
  poprzedni trwały snapshot pozostaje dostępny po restarcie. Nie dodajemy
  kolejki mutacji. Udana mutacja i powrót sieci odświeżają pełny snapshot.
- Rejestr magazynów konta usuwa kontakty przed unieważnieniem sesji. Generacja
  magazynu blokuje spóźnione odpowiedzi po wylogowaniu, utracie sesji, zmianie
  konta i zmianie danych w innej karcie. Kolejność zapytań chroni także przed
  zastąpieniem nowszego pobrania starszą odpowiedzią. Zmiana magazynu między
  kartami nie usuwa danych zapisanych przez drugą kartę.
- Bez nowych migracji, zależności runtime, zmiennych środowiskowych i crona;
  API pozostaje zgodne z poprzednim APK. Nie wykonujemy deployu. Końcowe CI
  oraz próby fizycznego APK (restart offline, polskie znaki, długi adres i `tel:`)
  pozostają do potwierdzenia według checklisty w `DEVELOPMENT.md`.
- Lokalnie przeszły testy Vitest Kontaktów, rejestru magazynów i cyklu sesji,
  typecheck, formatowanie oraz lint zmienionych plików (dwa istniejące
  ostrzeżenia Fast Refresh w `auth.tsx`, bez błędów). Build aplikacji i debug APK
  zakończyły się sukcesem. Playwright headless: 10 zaliczonych scenariuszy,
  dwa mobilne scenariusze pominięte na desktopie; WWW i atrapa Androida przy
  390 i 1280 px, CRUD, blokady offline, restart atrapy i odświeżanie po powrocie
  sieci. Przegląd zrzutów obu szerokości potwierdza czytelny baner i długi adres,
  bez poziomego przepełnienia. Raport Playwright jest w ignorowanym
  `playwright-report/`. ADB nie wykrył podłączonego telefonu. Nie zaliczamy
  prób ręcznych ani fizycznego APK. Status: **zweryfikowane lokalnie, oczekuje
  na CI**. Właściciel zlecił commit i push; wynik CI dla końcowego commita
  wymaga osobnego potwierdzenia.

## 26.10.2026 — synchronizacja wyboru grupy w testach Kontaktów

- Zgłoszone timeouty mobilnego scenariusza CRUD występują przy wyborze grupy
  po zapisie formularza. Lokalnie oba warianty przeszły pierwszą próbę oraz
  po pięć powtórzeń ze śladem Playwright; błędu z CI nie odtworzono.
- Helper wyboru grupy czeka teraz na usunięcie dialogu z DOM przed interakcją
  z filtrem. Zapobiega to rozpoczęciu wpisywania podczas zamykania okna
  i przywracania fokusu przez Mantine, które stanowi możliwą przyczynę błędu.
  Nie zmieniamy timeoutów ani kodu aplikacji.
- Adres konta scenariusza CRUD uwzględnia indeks powtórzenia Playwright,
  aby wielokrotne próby nie kolidowały podczas rejestracji.
- Po poprawce przeszło 12 prób CRUD: po trzy dla WWW i transportu Androida
  przy 390 i 1280 px. Lint, formatowanie i typecheck przeszły. Status:
  **zweryfikowane lokalnie, oczekuje na CI**. Próby transportu Androida
  w przeglądarce nie zastępują odbioru fizycznego APK.

## 26.10.2026 — CI wyłącznie na Node 24

- Na polecenie właściciela usuwamy macierz Node 22 i 24 z joba `checks`
  w `.github/workflows/ci.yml` i ustawiamy Node 24, zgodnie z wersją używaną
  na serwerze. Zachowujemy wszystkie dotychczasowe kontrole; osobny job
  Androida już korzysta z Node 24.
- Aktualizujemy opis CI w bieżącym planie i planie redesignu. Historyczne
  wyniki kontroli zachowujemy bez zmian.

## 25.10.2026 — synchronizacja testu katalogu zadań

- Sprawdzono zgłoszony błąd `task catalog restores focus and scroll via Android
transport` w [CI dla 5d78689](https://github.com/WojciechPreficz/rodzina/actions/runs/40231160219):
  zadanie Node 24 zakończyło się błędem, Node 22 anulowano, Android przeszedł.
  Ten przebieg nie udostępnia artefaktu ze stanem strony, więc nie potwierdzamy
  dokładnej przyczyny braku dialogu. Test przeszedł lokalnie pojedynczo i w
  dziesięciu powtórzeniach, również próbę z opóźnionym odświeżaniem.
- W teście znaleziono zbyt wczesne odłączenie sieci: pojawienie się optymistycznego
  wiersza nie oznacza zakończenia obsługi dodawania ani wyczyszczenia ochrony
  formularza. To możliwa przyczyna blokady nawigacji, nie potwierdzona reprodukcja
  zgłoszonego błędu. Test czeka teraz na opróżnienie pola po udanym dodaniu,
  sprawdza powrót do katalogu oraz adres po kliknięciu powiadomienia. Nie dodano
  opóźnień ani podwyższonych timeoutów i nie zmieniono kodu aplikacji.
- Konto scenariusza uwzględnia indeks powtórzenia Playwright, żeby `--repeat-each`
  sprawdzało scenariusz, zamiast kończyć się konfliktem rejestracji tego samego
  e-maila. Końcowe potwierdzenie w CI wymaga osobnego pusha, którego właściciel
  zabronił w tym zadaniu.
- Po zmianie przeszło 20 prób katalogu: po pięć dla WWW i transportu Androida
  przy 390 i 1280 px. Lint, formatowanie zmienionych plików i typecheck przeszły.
  Status: **zweryfikowane lokalnie, oczekuje na CI**. Wynik lokalny nie dowodzi,
  że dokładny błąd z CI został odtworzony ani usunięty.

## 25.10.2026 — interfejs Kontaktów online (krok 9.2, #45)

- Dodano `/kontakty` i pozycję menu po Rodzinie, przed Dokumentami. Widok
  korzysta z istniejącego AppShell, Mantine i wspólnego motywu; grupy mają
  liczniki niezależne od wyszukiwania. Nazwy sortujemy po polsku, wyszukiwarka
  pomija polskie znaki i wielkość liter, a dla telefonu także separatory.
- Po lokalnej próbie właściciel uprościł układ: „Dodaj grupę” jest w nagłówku,
  a „Dodaj kontakt” zajmuje całą szerokość karty grupy i otwiera pełny formularz.
  Usunięto szybkie dodawanie samej nazwy oraz przycisk pod listą grup.
  Nazwa nadal wystarcza do zapisania pełnego formularza zgodnie z kontraktem API;
  telefon, adres i opis relacji pozostają opcjonalne. Powód: bardziej intuicyjny
  interfejs wskazany przez właściciela; jego decyzja zastępuje ten fragment makiety.
- Kolejna uwaga właściciela zastępuje poziomy wybór grup na telefonie
  wyszukiwalnym multiselectem, takim jak w Dokumentach. Kilka grup daje
  łączną listę, a pusty wybór pokazuje wszystkie kontakty. Liczniki pozostają
  niezależne od wyszukiwania. Akcje zarządzania grupą dotyczą tylko pojedynczej
  wybranej grupy. Pełny formularz przy wielu lub braku wyboru proponuje grupę
  domyślną, którą można zmienić. Desktop zachowuje wybór grup po lewej.
- Szczegóły, edycja i potwierdzenia korzystają z jednego okna Mantine, żeby
  animacje przejść nie nakładały dialogów ani obsługi Escape i Wstecz.
  Formularze korzystają z istniejącej ochrony niezapisanych zmian. Telefon
  jest niezależnym odnośnikiem `tel:`, bez otwierania szczegółów kontaktu.
- Dziecko ma tylko odczyt; brak sieci blokuje mutacje także bezpośrednio przed
  wysłaniem żądania. Dane pozostają jedynie w pamięci zapytań powiązanych
  z rodziną i użytkownikiem, bez nowego trwałego magazynu. Cache offline
  pozostaje w kroku 9.3. Bez zmian API, migracji, zależności, konfiguracji i crona.
- Prace wykonano na `main`; po lokalnej próbie właściciel polecił commit bez pusha. Wcześniejszy istniejący
  commit API `7769a12` włączono do `main` przez fast-forward. Próby ręczne,
  fizyczne APK i końcowe CI pozostają do potwierdzenia; checklistę zapisano
  w [DEVELOPMENT.md](DEVELOPMENT.md#odbiór-kontaktów-online--krok-92).
- Kontrole lokalne przeszły: 13 testów komponentów Kontaktów oraz powiązane
  testy menu, ochrony formularzy i natywnej nawigacji; lint, formatowanie,
  typecheck, build WWW/API i debug APK. Playwright headless: sześć scenariuszy
  Kontaktów (390 i 1280 px, WWW i testowy transport Androida, w tym multiselect) oraz sześć
  scenariuszy istniejącej nawigacji. Sprawdzono zrzuty obu szerokości:
  przyciski są we wskazanych miejscach, pełny formularz zachowany,
  brak poziomego przepełnienia strony. Próby interaktywne właściciela i na
  fizycznym APK pozostają niepotwierdzone; ADB nie wykrywa podłączonego telefonu.
  Status: **zweryfikowane lokalnie, oczekuje na CI** — bez pusha nie ma
  wyniku CI ani linku do przebiegu weryfikującego tę wersję.

## 25.10.2026 — model i API Kontaktów (krok 9.1, #44)

- Dodano kontrakty shared, tabele `contact_groups` i `contacts` oraz kompletny
  snapshot `GET /api/contacts` i mutacje kontaktów oraz grup. Rodzina pochodzi
  z sesji; dziecko ma tylko odczyt. Pola opcjonalne przyjmują `null`, a pusty
  tekst po przycięciu jest normalizowany do `null`. PATCH zachowuje pola pominięte.
- Migracja 0023 tworzy cztery grupy dla istniejących rodzin. Nowe rodziny dostają
  je w transakcji rejestracji. Migracja korzysta z funkcji SQLite `random_uuid()`
  rejestrowanej w `db/client.ts`, która wywołuje `crypto.randomUUID()`. Dlatego
  migracje uruchamiamy jobem `dist/jobs/migrate-db.js` z paczki, zgodnie z DEPLOY,
  zamiast wykonywać sam SQL lub używać bezpośrednio migratora CLI Drizzle.
  Lokalne `npm run db:migrate` uruchamia ten sam job przez `tsx`, zachowując
  dotychczasową domyślną ścieżkę bazy i obsługę `RODZINA_DATABASE_PATH`.
  Autorem grup istniejącej rodziny zostaje najstarszy administrator
  (przy równym czasie rozstrzyga ID), a przy jego braku autor jest pusty.
- Częściowy indeks unikalny zapewnia najwyżej jedną grupę domyślną na rodzinę;
  jej flaga nie jest edytowalna przez API. Nazwę można zmienić. Próba usunięcia
  grupy domyślnej zwraca 409. Pozostałe grupy można usuwać, także gdy są puste.
  Kontakty są przenoszone do grupy domyślnej w jednej transakcji z usunięciem
  grupy; błąd dowolnego zapisu wycofuje całość. Złożony klucz obcy blokuje
  powiązanie kontaktu z grupą innej rodziny i usunięcie używanej grupy bez
  przeniesienia kontaktów. Nie ma kaskadowego usuwania kontaktów z grupą.
- Powód: zachowanie danych przy usuwaniu grup i spójność rodziny również na
  poziomie bazy. Usunięcie autora pozostawia kontakty i grupy z `createdBy=null`.
  Nie dodano zależności runtime, konfiguracji, crona ani zmian przypomnień.
- Zakres obejmuje wyłącznie API. Interfejs, potwierdzenia użytkownika i cache
  offline pozostają w krokach 9.2–9.3. Próby UI i telefonu nie dotyczą kroku 9.1.
  Status przed końcowym CI: **zweryfikowane lokalnie, oczekuje na CI**.
- Kontrole lokalne: 38 testów API/autoryzacji/kontraktów, 9 testów ścieżek
  migracji, lint i formatowanie zmienionych plików, typecheck, build WWW/API,
  `npm run db:migrate` na bazie tymczasowej oraz `release:smoke` przeszły.
  Końcowy wynik CI dla konkretnego commita podaje raport zadania.

## 25.10.2026 — plan Kontaktów (faza 9) i status dokumentów

- Właściciel potwierdził implementację fazy 8. Aktualizujemy status i indeks archiwum; zachowujemy historyczne wyniki CI, niepotwierdzone próby ręczne i checklistę fizycznego Androida. Implementacja nie oznacza automatycznie odbioru całej fazy. Faza 6 pozostaje do implementacji.
- Kontakty planujemy jako fazę 9: wspólne dla rodziny, odczyt także dla dzieci, mutacje wyłącznie dla administratora i dorosłych. Wymagana jest nazwa; adres wielowierszowy, jeden telefon i opis relacji są opcjonalne. Kontakty są niezależne od kont domowników.
- Wybrano własne grupy z początkowymi Rodzina, Znajomi, Praca i Inne. Domyślna grupa „Inne” ma trwałą tożsamość niezależną od nazwy i nie może być usunięta; usunięcie innej grupy przenosi jej kontakty do grupy domyślnej, bez utraty danych.
- Makieta „Ciepły i przyjazny — Kontakty” określa układ grup i listy, inicjały oraz styl. Wykorzystujemy obecny AppShell i Mantine; pomijamy elementy prezentacji makiety. Trasa `/kontakty` i menu po Rodzinie, przed Dokumentami. Telefon otwiera systemową obsługę `tel:`, bez uprawnień do kontaktów i bez bezpośredniego połączenia.
- Wybrano podgląd ostatniego kompletnego snapshotu offline, z czasem pobrania, izolacją rodziny i użytkownika oraz integracją istniejącego rejestru czyszczenia konta. Brak kolejki zmian. WWW obsługuje utratę sieci w otwartym interfejsie, APK także restart offline. Nie przywracamy PWA.
- Podział: 9.1 model, kontrakty i API; 9.2 UI online; 9.3 cache odczytu i odbiór fazy. Pełne kryteria, endpointy, limity pól oraz testy zapisano w `docs/plan.md`. Teraz zmieniamy wyłącznie dokumentację, bez implementacji Kontaktów.
- Powód: wspólna książka adresów i telefonów dostępna także bez sieci, zgodna z przesłanym projektem i obecnymi zasadami WWW/APK. Import, eksport, mapy, zdjęcia, prywatne kontakty, wiele adresów lub telefonów i przypomnienia pozostają poza zakresem.

## 25.10.2026 — rejestr magazynów konta (etap A)

- `accountStorage.ts` jest jednym miejscem rejestracji magazynów kalendarza,
  zadań, zakupów i danych rodziny/sesji. `clearAccountData` zastępuje wszystkie
  pięć ścieżek ręcznego czyszczenia w `auth.tsx`. Kolejny magazyn konta musi
  zarejestrować obsługę czyszczenia, również gdy nie ma kolejki zmian.
- Powody `logout`, `session-lost` i `account-changed` usuwają dane z urządzenia.
  `storage-changed` resetuje tylko bieżącą kartę i zatrzymuje zapisy zakupów:
  dane zapisane przez inną kartę pozostają. Kalendarz i zadania unieważniają
  swoje generacje przed zmianą sesji i alarmów. Zapis zakupów zatrzymujemy
  przed czyszczeniem QueryClient; wylogowanie nadal czeka na anulowanie zapytań.
  Obsługa natywnej sesji i alarmów pozostaje w dotychczasowych ścieżkach.
- Test enumeruje wszystkie klucze `rodzina:` po utworzeniu rzeczywistych
  danych i operacji obu kolejek. Niezależnie od rejestru wyszukuje też pełne
  literały kluczy w źródłach frontendu i dodaje dla nich wartości kontrolne,
  aby brak rejestracji nowego magazynu powodował błąd. Nowe klucze konstruowane
  w całości dynamicznie wymagają rozszerzenia danych testowych. Jedynym
  wyjątkiem trwałości jest `rodzina:pending-logout`: nie zawiera danych konta
  i zapobiega przywróceniu sesji cookie przed potwierdzeniem wylogowania WWW.
- Bez migracji danych, zmiany silników offline, nowych zależności, konfiguracji
  i crona. Etap B pozostaje osobną propozycją do decyzji właściciela.
- Weryfikacja lokalna: lint (bez błędów, dwa ostrzeżenia Fast Refresh),
  formatowanie zmienionych plików, typecheck, 820 testów Vitest, build WWW/API
  i debug APK oraz 22 testy Playwright headless offline/auth przy 390 i 1280 px
  przeszły. Przejrzano zrzuty widoków offline; testy obejmują WWW i transport
  Androida. ADB nie wykrywa urządzeń, więc próby na fizycznym telefonie nie
  wykonano. Właściciel zlecił lokalny commit etapu A, bez pusha:
  **zweryfikowane lokalnie, oczekuje na CI** oraz odbiór na urządzeniu.

## 25.10.2026 — PROPOZYCJA DO AKCEPTACJI: wspólny outbox i IndexedDB (etap B)

**Status: projekt do decyzji właściciela, bez implementacji.** Proponujemy
najpierw przenieść istniejące formaty do IndexedDB, a dopiero potem zastępować
silniki kolejek, po jednym module. Rozdzielenie zmian ułatwia sprawdzenie,
czy ewentualny błąd dotyczy migracji danych, czy odtwarzania operacji.
Akceptacji wymagają zakres, kolejność, budżety oraz zasady postępowania
z niewysłanymi zmianami. Ten wpis nie uruchamia realizacji kolejnej fazy.

### Wspólny silnik operacji

- Jeden outbox dla zakupów i zadań; przyszłe moduły dołączają adapterami
  dopiero w swoim zaakceptowanym zakresie. Kalendarz i rodzina pozostają
  podglądem offline. Nie dodajemy teraz kolejek obiadów ani dokumentów.
- Koperta operacji: `schemaVersion`, `operationId`, `accountId`
  (`familyId:userId`), `module`, `entityId`, `sequence`, `submittedAt`,
  `payload`, `status`, `attempts`, `nextAttemptAt` i ostatni błąd. Opcjonalna
  wersja bazowa służy tylko adapterom, których API rzeczywiście obsługuje
  kontrolę współbieżności. Dane waliduje wersjonowany schemat modułu.
- `operationId` powstaje raz przez `crypto.randomUUID()` przed pierwszym
  zapisem i pozostaje ten sam przy ponowieniu, restarcie oraz migracji.
  Import zakupów zachowuje obecne `operationId`, import zadań mapuje `id`
  na `operationId`. Zachowujemy również oryginalne `submittedAt` i identyfikatory
  tworzonych obiektów; migracja nie odmładza operacji.
- Przyjęcie zmiany przez UI następuje dopiero po zakończeniu transakcji
  zapisującej operację i lokalną projekcję. Numer `sequence` nadaje ta sama
  transakcja. Silnik wysyła operacje kolejno dla konta, bez wyprzedzania
  zależnego dodania/edycji/usunięcia. Odtworzenie projekcji jest niezależne
  od komponentów i od stanu mutacji TanStack Query; Query pozostaje cache UI.
- Jedna karta/WebView wysyła kolejkę konta. Właściciela, dzierżawę i jej
  generację przechowujemy transakcyjnie w IndexedDB. Wygasła dzierżawa pozwala
  wznowić pracę po awarii; generacja odrzuca spóźnione odpowiedzi. Powtórzenie
  żądania po utracie dzierżawy nadal chroni ten sam `operationId` na serwerze.
  Powiadomienie innych kart tylko przyspiesza odświeżenie, nie zastępuje blokady.
- Błąd sieci, HTTP 429 i 5xx: rosnący odstęp z losowym rozrzutem, trwałe
  `nextAttemptAt`, respektowanie dostępnego `Retry-After`. Wznowienie po starcie,
  odzyskaniu sieci i aktywacji aplikacji; bez wymagania pracy WWW w tle i bez PWA.
  Zachowujemy obecny limit automatycznego odtwarzania 30 dni oraz retencję
  odpowiedzi API 90 dni. Starsze operacje pozostają do ręcznego rozstrzygnięcia.
- Przed wysyłką potwierdzamy konto i uprawnienia. `SESSION_CHANGED`, 401 oraz
  potwierdzona zmiana tożsamości zatrzymują cały outbox, unieważniają generację
  i uruchamiają istniejącą obsługę utraty sesji. Operacja nigdy nie przechodzi
  na nowe konto. Dotychczasowe czyszczenie przy wylogowaniu i zmianie konta
  nadal usuwa niewysłane zmiany; etap B nie wprowadza ich ukrytego zachowywania.
  Zmiana sesji w innej karcie zatrzymuje tylko stary kontekst, bez usuwania
  nowych danych tej karty. Adapter musi rozróżniać kod błędu od samego statusu.
- HTTP 409 obsługujemy według kodu i semantyki modułu, bez automatycznego
  nadpisywania serwera i bez tworzenia nowego `operationId`. Blokujemy operację
  oraz jej zależności, pobieramy bieżący stan i pokazujemy polski komunikat
  z możliwością odrzucenia zmiany lub świadomego wprowadzenia nowej. Dopiero
  nowa, zmieniona przez użytkownika intencja dostaje nowy identyfikator.
  Brak dostępu lub usunięty obiekt wymagają odrębnej obsługi 403/404, zgodnej
  z prywatnością zadań; nie przechowujemy dalej treści cofniętego udostępnienia.
- Po sukcesie odpowiedź/projekcję i usunięcie wpisu outbox zapisujemy w jednej
  transakcji. Awaria przed nią powoduje bezpieczne ponowienie z tym samym ID.
  Unieważnienie konta po wysłaniu żądania blokuje zastosowanie późnej odpowiedzi.

### IndexedDB i proponowane budżety

- Jedna wersjonowana baza originu z magazynami `outbox`, `cache`, `metadata`
  i roboczym obszarem migracji. Każdy rekord danych ma konto, moduł i wersję;
  indeksy umożliwiają wyczyszczenie całego konta przez rejestr z etapu A.
  Sesja natywna i harmonogram alarmów pozostają w obecnym magazynie Androida;
  nie kopiujemy tokenów do IndexedDB. W localStorage pozostają wyłącznie
  małe znaczniki koordynacyjne, w tym oczekujące wylogowanie.
- Proponowany początkowy budżet aplikacji: **32 MiB**, w tym **8 MiB**
  rezerwy kolejek (zakupy 4 MiB, zadania 4 MiB) oraz **24 MiB** cache:
  kalendarz 12 MiB, zadania 6 MiB, zakupy 4 MiB, rodzina/sesja 2 MiB.
  To wartości projektowe do zatwierdzenia i pomiarów na rzeczywistych danych,
  a nie gwarancja miejsca przydzielonego przez przeglądarkę. Każdy przyszły
  moduł wymaga jawnego budżetu; nie zabiera po cichu rezerwy kolejek.
- Zużycie liczymy dla zapisów modułu w tej samej transakcji, uwzględniając
  reprezentację danych; margines na narzut bazy ustalamy po pomiarach.
  Podczas migracji potrzebny jest dodatkowy zapas na źródło i kopię roboczą;
  brak miejsca zatrzymuje migrację bez usuwania dziennika źródłowego.
- Cache usuwa najstarsze nieużywane dane przy swoim limicie; kalendarz zachowuje
  także obecne maksimum 12 miesięcy. Projekcji potrzebnej niewysłanym operacjom
  nie usuwamy jak zwykłego cache. Kolejki nie podlegają automatycznemu usuwaniu
  według rozmiaru. Brak miejsca po ograniczeniu cache oznacza odrzucenie nowej
  zmiany z komunikatem, bez fałszywego potwierdzenia przyjęcia i bez fallbacku
  do drugiego silnika localStorage.
- Zgoda na trwałość danych, jeśli dostępna, i oszacowanie miejsca są pomocnicze.
  Przeglądarka/system nadal mogą usunąć dane originu, a użytkownik może je
  wyczyścić. IndexedDB i budżety ograniczają ryzyko, lecz nie zastępują synchronizacji
  i nie zapewniają kopii serwerowej dla jeszcze niewysłanych operacji.

### Kroki realizacji etapu B — propozycja

Po akceptacji realizujemy kolejno B.1–B.7: jeden krok na czat i commit,
zgodnie z zasadami kontroli lokalnych i CI z sekcji 1.2 `plan.md`.
Każdy krok implementacyjny pozostawia działającą aplikację. Infrastrukturę
wprowadzamy razem z pierwszym korzystającym z niej modułem. Ten podział
nie oznacza akceptacji etapu B ani rozpoczęcia jego implementacji.

#### B.1 — kontrakt migracji i przypadki testowe

- **Zakres:** zinwentaryzować klucze, formaty i reguły obu kolejek. Opisać
  schemat IDB, protokół wyłączności kart, wersjonowanie, budżety i zasady
  rollbacku. Przygotować próbki poprawnych/uszkodzonych cache i dzienników,
  operacji w locie, różnych kont oraz zmian starszych niż 30 dni.
- **Gotowe, gdy:** uzgodnione są zakres, budżety i zachowanie przy konflikcie,
  wylogowaniu oraz braku miejsca. Każdy format źródłowy ma opis mapowania,
  zachowania identyfikatorów i kolejności, także dla wpisów z tym samym czasem.
  Są wskazane testy awarii wymagane w kolejnych krokach. Ten krok obejmuje
  dokumentację i dane testowe; produkcyjny zapis nadal działa jak dotychczas.

#### B.2 — IndexedDB dla rodziny, sesji offline i kalendarza

- **Zakres:** uruchomić wersjonowaną bazę i użyć jej od razu dla obu magazynów
  podglądu. Wdrożyć ich import, budżety cache, usuwanie najstarszych danych
  oraz obsługę błędów miejsca/dostępu. Zachować limit 12 miesięcy kalendarza.
  Tokeny i harmonogram Androida pozostają w obecnym magazynie natywnym.
- W tym kroku wdrożyć wyłączność migracji i koordynację kart. Wszystkie
  uczestniczące karty muszą potwierdzić wstrzymanie zapisów; starsze wersje
  trzeba zamknąć/przeładować. Sama blokada IDB nie blokuje zapisu localStorage
  przez stary kod; bez zapewnionej wyłączności migracja czeka. WWW i APK
  migrują osobno we własnych originach.
- Dostosować rejestr etapu A do asynchronicznego czyszczenia: zatrzymać
  poprzedni kontekst przed oczekiwaniem na IDB i wyczyścić także dane migracji.
  Zastąpić zależność auth od usunięcia starego klucza jawnym sygnałem zmiany
  sesji. Zapisy i odczyty zakupów oraz zadań pozostają w localStorage.
- **Gotowe, gdy:** podgląd obu modułów działa po migracji i restarcie offline,
  a wylogowanie i zmiana konta usuwają ich dane IDB i stare kopie. Przejście
  nie wylogowuje przypadkowo innych kart. Brak IDB ma jawny komunikat;
  nie uruchamia równoległego zapisu do dwóch magazynów. WWW przy 390/1280 px
  i APK zachowują podgląd; testy obejmują awarię i wylogowanie podczas importu.

#### B.3 — istniejąca kolejka zakupów w IndexedDB

- **Zakres:** przenieść snapshot i dziennik zakupów do IDB, zachowując obecny
  silnik mutacji TanStack i semantykę operacji. Dostosować przyjęcie zmiany
  do asynchronicznego trwałego zapisu: UI potwierdza ją dopiero po transakcji.
  Wprowadzić budżet kolejki i cache zakupów.
- Importować dziennik jako źródło prawdy, odzyskać brakujące wpisy ze snapshotu,
  deduplikować po koncie i ID oraz zachować `operationId`, `submittedAt`,
  identyfikatory obiektów i kolejność. Sprzeczne kopie lub nieczytelny dziennik
  blokują migrację z komunikatem; nie wolno ich po cichu pomijać.
- **Gotowe, gdy:** import, weryfikacja i znacznik ukończenia chronią przed
  pominięciem lub ponownym importem operacji po awarii. Zakupy przeżywają
  restart offline i utratę odpowiedzi bez duplikatów po synchronizacji.
  Sprawdzone są pełny magazyn, karty, wylogowanie i zmiana konta. Nie można
  przyjąć nowej zmiany, której transakcja się nie powiodła. Zadania nadal
  używają swojego dotychczasowego magazynu i silnika.

#### B.4 — istniejąca kolejka zadań w IndexedDB

- **Zakres:** przenieść snapshot i dziennik zadań do IDB, zachowując obecny
  silnik synchronizacji, uprawnienia i ograniczenia edycji offline. Zachować
  `id` operacji, czasy i kolejność; zastosować zweryfikowany protokół migracji
  z B.3 oraz budżety zadań. Potwierdzać zmianę dopiero po trwałym zapisie.
- **Gotowe, gdy:** migracja i synchronizacja po restarcie zachowują wszystkie
  niewysłane zmiany bez duplikatów. Testy sprawdzają cofnięcie udostępnienia,
  zmianę konta, usunięty obiekt, brak miejsca i awarie importu. W APK nadal
  działa blokowanie alarmów zmienionych zadań oraz ich uzgodnienie po sync.
  Wszystkie cztery magazyny danych konta korzystają już z IDB; localStorage
  zawiera jedynie małe znaczniki koordynacji i wylogowania.

#### B.5 — wspólny silnik outbox z adapterem zakupów

- **Zakres:** wdrożyć wspólny silnik od razu jako obsługę działających zakupów.
  Dodać kopertę operacji, transakcję operacji i projekcji, kolejność wysyłania,
  dzierżawę nadawcy, trwały harmonogram retry i obsługę limitu wieku. Przejąć
  kolejkę zakupów z B.3, zachowując ID i czasy. TanStack pozostaje cache UI.
- Wprowadzić obsługę `SESSION_CHANGED`, 401, konfliktów 409 i spóźnionych
  odpowiedzi. Konflikt ma komunikat i możliwość świadomego rozstrzygnięcia;
  ponowienie tej samej operacji nie dostaje nowego ID. Przełączenie silnika
  odbywa się transakcyjnie przy zatrzymanej synchronizacji.
- **Gotowe, gdy:** zakupy działają od początku do końca przez outbox. Testy
  obejmują utratę odpowiedzi, retry po restarcie, wygaśnięcie dzierżawy,
  równoległe karty, konflikty i odcięcie poprzedniej sesji. Tylko jeden silnik
  wysyła zakupy; jego stara ścieżka zostaje wyłączona. Zadania nadal działają
  na swoim silniku w IDB.

#### B.6 — zadania przez wspólny outbox

- **Zakres:** dodać adapter zadań, mapując dotychczasowe `id` na `operationId`
  i zachowując daty oraz kolejność. Przełączyć kolejkę z B.4 na silnik z B.5.
  Zachować prywatność list, zachowanie po cofnięciu dostępu i integrację
  oczekujących zmian z alarmami Androida.
- **Gotowe, gdy:** zakupy i zadania korzystają z jednej kolejki konta oraz
  wspólnych zasad retry, sesji i konfliktów. Testy sprawdzają kolejność także
  między modułami, blokowanie zależności przez konflikt, utratę uprawnień,
  restart i zmianę konta. Tylko outbox wysyła zadania; ich stary silnik zostaje
  wyłączony. Sprawdzone są alarmy zadań na fizycznym Androidzie.

#### B.7 — odbiór migracji i usunięcie starego kodu

- **Zakres:** przeprowadzić wspólny odbiór całej ścieżki aktualizacji od wersji
  z localStorage do wersji z IDB i outbox. Sprawdzić budżety na rzeczywistych
  danych i udokumentować wspieraną wersję APK oraz bezpieczny rollback.
  Po odbiorze usunąć nieużywane persistery, stare silniki i zbędny kod przejściowy;
  zachować import wersji, z których nadal wspieramy aktualizację.
- **Gotowe, gdy:** headless WWW przy 390/1280 px i fizyczny Android przechodzą
  migrację offline, ubicie procesu w punktach przełączenia, restart, równoległe
  karty, brak miejsca, odmowę IDB i wylogowanie podczas importu/żądania.
  Test rejestru obejmuje IDB, pozostałości localStorage i obszar migracji.
  CI dla końcowego commita przechodzi; brakujące próby sprzętowe są raportowane
  jako niewykonane i nie pozwalają zamknąć odbioru.

### Zasady przełączenia i ryzyko utraty zmian

W B.2–B.4 każdy migrowany moduł zapisuje import i znacznik ukończenia
w jednej transakcji, a następnie ponownie odczytuje i porównuje wynik ze źródłem.
Synchronizacja i stare zapisy pozostają zatrzymane do zakończenia weryfikacji.
Awaria przed zatwierdzeniem importu pozostawia localStorage jako źródło;
awaria po zatwierdzeniu odczytuje znacznik IDB i nie importuje drugi raz.
Jeżeli znacznik jest zapisany, ale weryfikacja nie została zakończona,
start wznawia weryfikację przed uruchomieniem zapisów i synchronizacji.
Źródło zachowujemy tylko na czas weryfikacji jako nieaktywną kopię, a po niej
usuwamy, aby nie odtworzyć potwierdzonych już operacji. Brak miejsca lub błąd
importu nie może powodować usunięcia niewysłanych zmian. Nie stosujemy
równoległego zapisu dwóch silników. W B.5–B.6 przejęcie kolejki i znacznik
wersji silnika również zapisujemy transakcyjnie.

Rollback po nowych zapisach w IDB wymaga wersji nadal czytającej IDB;
powrót do starego APK lub do localStorage bez migracji odwrotnej grozi
utratą nowych zmian. Każdy krok zachowuje możliwość aktualizacji ze wspieranych
wcześniejszych wersji, także gdy użytkownik pominie wydanie pośrednie.

Największe ryzyka to pominięcie dziennika, ponowne nadanie ID, stara karta
dopisująca po imporcie i powrót do starej wersji. Ograniczają je zachowanie
źródła do weryfikacji, wyłączność, transakcje i jeden aktywny silnik. Nie da się
wycofać wyczyszczenia danych aplikacji przez system ani odtworzyć zmiany, która
nigdy nie została trwale zapisana. Jawne wylogowanie nadal usuwa niewysłane
zmiany zgodnie z obecną polityką; ewentualna zmiana tego zachowania wymaga
osobnej decyzji właściciela i projektu komunikatu w UI.

## 25.10.2026 — wspólna idempotencja i retencja odpowiedzi API

- Zakupy i zadania korzystają z jednego wrappera synchronicznych mutacji oraz
  klasy ApiError. Zapis odpowiedzi i mutacja pozostają w transakcji immediate.
  Thenable powoduje wycofanie transakcji, HTTP 500 i zapis błędu w logu.
  Dokumenty mają już wspólną obsługę błędów i nie mają kolejki mutacji offline
  ani własnego wrappera; nie rozszerzamy ich kontraktu o idempotencję.
- Przegląd shoppingOffline.ts i taskOffline.ts wykazał brak limitu wieku kolejki:
  wpisy w localStorage mogły czekać bez końca. Żadna skończona retencja nie była
  dłuższa od takiej kolejki. Wprowadzamy wspólny limit automatycznego wysyłania
  30 dni od submittedAt; starsze zmiany pozostają w dzienniku urządzenia
  z komunikatem o konieczności sprawdzenia danych przed ponownym wprowadzeniem.
- Pełne odpowiedzi przechowujemy przez 90 dni od pierwszego wykonania, czyli
  dłużej niż okno wysyłania kolejki, z 60-dniowym zapasem. Powtórzenia nie
  przedłużają retencji. Przy obsłudze operacji z operationId usuwamy starsze
  wpisy danego modułu w tej samej transakcji; bez nowego procesu i crona.
  Indeksy created_at ograniczają koszt wyszukiwania starych wpisów.
- Migracja nadaje dotychczasowym wpisom czas jej wykonania, aby nie utracić
  ochrony powtórzeń bezpośrednio po aktualizacji. Nowe operacje zapisują czas
  serwera w milisekundach UTC; domyślne 0 służy dodaniu kolumny w SQLite.
- Starsze APK nie znają limitu 30 dni. Zachowują zgodność API, ale po upływie
  90 dni od wykonania operacji nie gwarantujemy im odtworzenia starej odpowiedzi.
  Pełna ochrona kolejki wymaga aktualizacji wspólnego frontendu również w APK.

## 25.10.2026 — wiarygodny status i wersja API health

- `GET /api/health` zwraca `ok` zgodne z `dbOk`; błąd zapytania SQLite daje
  HTTP 503 oraz oba pola ustawione na `false`.
- Wersję odczytujemy z `package.json` względem modułu API. Lokalnie jest to
  plik `apps/api/package.json`, a w release plik już dołączany przez
  `scripts/build-release.mjs` z tą samą wersją API. Paczka nie zawiera osobnego SHA.
  Nie polegamy na `npm_package_version`, którego Passenger nie musi ustawiać.
- Smoke uruchamia `server.cjs` bez tej zmiennej i porównuje wersję odpowiedzi
  z `package.json` rozpakowanego wydania. Bez nowych zależności i konfiguracji.

## 25.10.2026 — filtrowanie dokumentów po statusie

- Poprawka wyrównania na telefonie: znaczniki są wyśrodkowane pionowo w polu,
  a puste pole wyszukiwania może się zwężać. Nie wymusza pustego drugiego wiersza
  przy dwóch wybranych filtrach; większy wybór nadal zawija całe znaczniki.
- Na polecenie właściciela „Wygasa” i „Wygasło” z licznikami stają się
  przyciskami filtrów na komputerze. Ponowne kliknięcie wyłącza wybrany status;
  kliknięcie drugiego przełącza status. Wybrana osoba lub kategoria pozostaje aktywna.
- Na telefonie oba statusy są opcjami grupy „Statusy” w istniejącym polu
  wielokrotnego wyboru. Wybrane statusy łączymy alternatywą, a wynik zawężamy
  do wybranych osób i kategorii. Brak statusu pokazuje wszystkie statusy;
  wyczyszczenie pola przywraca całą listę. Liczniki obejmują całą rodzinę.
- Zmiana dotyczy wspólnego frontendu WWW i APK, bez zmian API i przypomnień.
- Zweryfikowane lokalnie, oczekuje na CI i odbiór ręczny: 18 testów komponentu,
  8 testów Playwright headless przy 390 i 1280 px (WWW i transport Androida),
  lint i formatowanie zmienionych plików, typecheck, build WWW i debug APK.
  Przejrzano zrzuty aktywnych filtrów na komputerze i telefonie.

## 25.10.2026 — odnowienie i szczegóły dokumentów, krok 8.4 (#21)

- Zakres pochodzi z `archive/plan-przyszle-fazy.md`. Stary opis issue z Web Push
  ustępuje bieżącym zasadom WWW i alarmów APK. Plakietka jest przy bezpośredniej
  pozycji „Dokumenty”, zgodnie z aktualną nawigacją.
- Plakietka liczy dokumenty `expiring` i `expired` całej rodziny niezależnie
  od filtra listy. Korzysta ze wspólnego zapytania, odświeżania co 20 sekund
  i statusów liczonych w strefie rodziny; zegar odświeża status co minutę.
  Ukrywamy plakietkę, gdy przynależność do rodziny nie jest potwierdzona.
- „Odnowiono” na liście i w szczegółach zapisuje wyłącznie nową datę przez
  istniejące API. Po zapisie odświeżamy dokumenty, osobiste przypomnienia
  i lokalny harmonogram. Zarządzanie wymaga internetu; dziecko nie odnawia dokumentu.
- `/dokumenty/:documentId` otwiera wskazany dokument z listy lub alarmu APK.
  Brak dokumentu pokazuje komunikat zamiast zastępować go innym dokumentem.
  Offline APK pokazuje zapisany payload właściwego alarmu (bezwzględna data,
  ostrzeżenie o nieaktualności) przez istniejący bezpieczny podgląd alarmów.
  Nie dodajemy trwałego cache całego sejfu ani kolejki zmian dokumentów.
- Sekcja „Moje przypomnienia” zarządza wyłącznie przypomnieniami zalogowanej
  osoby przez `/api/reminders/mine` z `documentId`, również dla dziecka.
  Nie zmienia wspólnych przypomnień dokumentu. Obie operacje synchronizują alarmy.
- Bez migracji, nowych zależności runtime, zmiennych środowiskowych i crona.
  Backend zachowuje zgodność z poprzednim APK; nowy frontend APK budujemy osobno.
- Po lokalnej implementacji bez commita właściciel polecił 25.10.2026 wykonać
  commit i push na obecnej gałęzi `main`, bez tworzenia nowej gałęzi. Odbiór
  ręczny i fizyczne próby Androida pozostają do wykonania według `DEVELOPMENT.md`.
  Domknięcie fazy wymaga również CI końcowego commita.
- Zweryfikowane lokalnie, oczekuje na CI: testy modułu dokumentów, statusów,
  przypomnień, harmonogramu, podglądu offline i nawigacji przeszły; również
  lint i formatowanie zmienionych plików, typecheck, build WWW/API, debug APK
  oraz `release:smoke`. Osiem testów Playwright headless sprawdza CRUD,
  odnowienie, osobiste przypomnienia, plakietkę i trasę przy 390 i 1280 px
  na WWW i z transportem Androida. Przejrzano zrzuty szczegółów i odnowienia;
  nie stwierdzono poziomego przepełnienia. Transport testowy nie zastępuje telefonu.

## 24.10.2026 — wielokrotny filtr dokumentów na telefonie

- Na polecenie właściciela poniżej 768 px zastępujemy poziomy pasek filtrów
  polem wielokrotnego wyboru z grupami „Osoby” i „Kategorie” (Pojazdy, Mieszkanie).
  Całe znaczniki wybranych pozycji zawijają się w polu; ich nazwy pozostają
  w jednej linii (długie nazwy skracamy wielokropkiem). Lista opcji ma wyszukiwanie.
- Dokument pasuje, gdy dotyczy dowolnej wybranej osoby lub kategorii.
  Pusty wybór pokazuje wszystkie dokumenty. Wyczyszczenie pola przywraca pełną listę.
- Od 768 px zachowujemy dotychczasowy wygląd i pojedynczy wybór filtra.
  Zmiana obejmuje wspólny frontend WWW i APK; bez zmian API i przypomnień.

## 24.10.2026 — lista i formularz dokumentów, krok 8.3 (#20)

- Zakres według `archive/plan-przyszle-fazy.md`: lista, filtry, formularz,
  edycja i usuwanie; dziecko ma tylko podgląd. Dokumenty są bezpośrednią
  pozycją menu pod `/dokumenty`, zgodnie z bieżącymi zasadami nawigacji.
- Wzorzec wizualny to załączony projekt „Ciepły i przyjazny — Dokumenty”.
  Odczyt MagicPath był niedostępny z powodu limitu API. Na komputerze filtr
  jest bocznym panelem, na telefonie poziomą listą przycisków.
- Nowy dokument i zmiana typu w formularzu podstawiają domyślne przypomnienia
  typu. Edycja innych pól zachowuje konfigurację przypomnień; usunięcie
  wszystkich zapisuje pustą tablicę. `owner` opisujemy jako posiadacza,
  a przy jego braku twórcę. Osobiste przypomnienia pozostają w kroku 8.4.
- Filtr osoby wybiera jej dokumenty przez `holderUserId`, filtr pojazdów
  obejmuje wszystkie trzy typy samochodowe. Pozostałe dokumenty są widoczne
  w filtrze „Wszyscy”. Daty i statusy liczymy w strefie rodziny; dokument
  pozostaje ważny w dniu daty ważności. Zarządzanie wymaga połączenia z siecią.
- Bez migracji, nowych zależności runtime, konfiguracji i crona. Odnowienie,
  plakietka menu i trasa szczegółów z alarmu pozostają w kroku 8.4.
- Minimalną wysokość pól przenosimy z inline `Input.styles` do CSS. Biblioteka
  automatycznej wysokości notatki odrzuca `style.minHeight` w trybie developerskim;
  wysokość notatki określa `minRows`. Test formularza używa rzeczywistego motywu
  i aktywnego autosize, aby sprawdzać także tę integrację.
- Właściciel przeprowadzi ręczne próby dodania każdego typu i próby w APK.
  Na późniejsze polecenie właściciela zapisujemy zmiany w lokalnym commicie
  na `main`, bez pusha. Zweryfikowane lokalnie, oczekuje na CI i odbiór ręczny.
- Weryfikacja lokalna: 29 testów komponentów i logiki, 10 testów Playwright
  headless przy 390 i 1280 px (WWW i transport Androida), lint i formatowanie
  zmienionych plików, typecheck, build WWW/API i debug APK przeszły.
  Przejrzano zrzuty listy i formularza; brak poziomego przepełnienia.
  Test transportu i build nie oznaczają próby na fizycznym telefonie.

## 24.10.2026 — dokumenty dotyczące mieszkania

- Na polecenie właściciela rozszerzamy typy dokumentów o `home_insurance`
  (ubezpieczenie mieszkania) i `rental_agreement` (umowa najmu mieszkania).
- Przyjmujemy domyślne przypomnienia 30 i 7 dni przed końcem ważności,
  analogicznie do ubezpieczenia pojazdu. Próg statusu `expiring` to 30 dni.
- Nowe typy używają istniejącej etykiety, daty ważności i opcjonalnej notatki,
  bez posiadacza ani pojazdu. Nie dodajemy pól adresu ani UI z kroku 8.3.
  Istniejący CRUD, odnowienie i harmonogram APK obsługują je przez wspólny typ.
- Bez migracji, nowych zależności runtime, konfiguracji i crona.

## 22.10.2026 — przypomnienia dokumentów, krok 8.2 (#19)

- Zakres według `archive/plan-przyszle-fazy.md`: API przypomnień, odnowienie
  i harmonogram APK, bez UI z kroków 8.3–8.4 i bez joba Web Push.
- Pominięcie `reminders` przy POST wybiera domyślne offsety typu; pusta tablica
  wyłącza wspólne przypomnienia. PATCH bez tego pola zachowuje ich konfigurację,
  także po zmianie typu. PATCH i odnowienie przeliczają wszystkie terminy,
  również osobiste, bez zmiany ich właścicieli. Zapis dokumentu i przypomnień
  jest jedną transakcją.
- Body dokumentu przyjmuje wspólne `family`, `adults` (domyślne), `owner`.
  Osobiste `user` tworzy wyłącznie `/api/reminders/mine` z `documentId`, zawsze
  dla zalogowanej osoby, także dziecka. Odczyt dokumentów nie ujawnia cudzych
  przypomnień osobistych.
- Nowe APK żąda `includeDocuments=true` obok `includeTasks=true`. Bez tej flagi
  harmonogram nie zawiera dokumentów, aby starsze APK mogło nadal zwalidować
  kontrakt. Payload zawiera bezwzględną datę ważności; offsety używają 09:00
  w strefie rodziny (domyślnie Europe/Warsaw). `documentUrl` wskazuje
  `/dokumenty/:id`; ekran otwierany z alarmu pozostaje w kroku 8.4.
- Migracja 0021 dodaje FK dokumentu z kaskadą usuwania i indeks przypomnień
  dokumentów. Bez nowych zależności runtime, zmiennych środowiskowych ani crona.
- Testy automatyczne adaptera sprawdzają trwały zapis offline oraz zastąpienie
  i anulowanie alarmu po synchronizacji. Nie zastępują odbioru alarmu na
  fizycznym telefonie ani prób po restarcie opisanych w fazie 8.
- Weryfikacja lokalna 22.10.2026: 234 testy zmiany i zależnych modułów,
  lint i formatowanie zmienionych plików, typecheck, build WWW/API,
  `release:smoke` i debug APK przeszły. ADB nie wykrywa podłączonego telefonu;
  odbiór alarmu offline i próby po restarcie nie zostały wykonane.
  Na polecenie właściciela kończymy lokalnym commitem na `main`;
  zweryfikowane lokalnie, oczekuje na CI. Krok nie ma jeszcze pełnego odbioru.

## 22.10.2026 — CRUD dokumentów, krok 8.1 (#18)

- Zakres wynika z `archive/plan-przyszle-fazy.md`, zgodnie z poleceniem właściciela.
  Krok obejmuje typy, statusy, walidację i CRUD; przypomnienia i odnowienie
  pozostają w 8.2, a UI w 8.3–8.4. POST nie przyjmuje jeszcze `reminders`.
- Na polecenie właściciela dodajemy `car_guarantee_inspection` (przegląd
  gwarancyjny samochodu), z pojazdem i domyślnymi offsetami 30 i 7 dni.
- Dokument zachowuje ważność przez cały `expiresOn`; `expired` zaczyna się
  następnego dnia w strefie rodziny. Próg `expiring` jest włączny i liczony
  w dniach kalendarzowych, bez wpływu zmiany czasu.
- Posiadacz i pojazd pozostają opcjonalne. Posiadacz musi należeć do tej
  samej rodziny i dotyczy tylko dowodu lub paszportu; pojazd dotyczy tylko
  trzech typów samochodowych. PATCH waliduje wynik po połączeniu zmian
  z zapisanym dokumentem; przy zmianie typu niepasujące pola trzeba wyczyścić.
  Zapobiega to zachowaniu powiązań niezgodnych z typem.
- Brak nowych zależności runtime, konfiguracji ani crona. Migracja dodaje
  wyłącznie tabelę dokumentów i indeks; integracja FK przypomnień z dokumentami
  należy do 8.2.

## 22.10.2026 — wielodniowe wydarzenia jednorazowe

- Obok „Całodniowe” dodajemy przełącznik „Wielodniowe” wyłącznie dla
  wydarzeń jednorazowych. Pokazuje datę i godzinę końca; dla całodniowych
  wystarcza data ostatniego dnia, wliczana do wydarzenia.
- Wykorzystujemy istniejące `durationMinutes`, bez migracji i nowych pól API.
  Dla wydarzeń z godziną jest to różnica momentów UTC, z uwzględnieniem strefy
  rodziny. Dla całodniowych jednorazowych pełne wielokrotności 1440 oznaczają
  dni kalendarzowe, dzięki czemu zmiana czasu nie przesuwa końca poza północ.
  Dotychczasowe `null` nadal oznacza jeden dzień. Limit pozostaje 525600 minut
  lub 365 dni kalendarzowych. Starsze APK mogą pokazywać całodniowy zakres
  jako jeden dzień; poprawny podgląd i edycja wymagają aktualizacji APK.
- Zapytanie o wystąpienia uwzględnia trwające wydarzenia jednorazowe rozpoczęte
  przed wyświetlanym zakresem. Koniec API pozostaje wyłączny. Przypomnienia
  nadal odnoszą się do początku wydarzenia.

## Wcześniejsze decyzje

[Pełne wcześniejsze wpisy](archive/decisions-historia.md) zachowują treść,
daty i moc obowiązujących decyzji; samo przeniesienie niczego nie uchyla.
Czytaj wpisy dotyczące zmiany, bez rutynowego wczytywania całej historii.
Rozbieżności wskazuje [raport porządkowania](DOKUMENTACJA_RAPORT.md).

- [21.10.2026 — pozostałe ekrany redesignu, krok R.6](archive/decisions-historia.md#21102026--pozostałe-ekrany-redesignu-krok-r6)
- [21.10.2026 — redesign zadań, krok R.5](archive/decisions-historia.md#21102026--redesign-zadań-krok-r5)
- [21.10.2026 — redesign zakupów, krok R.4](archive/decisions-historia.md#21102026--redesign-zakupów-krok-r4)
- [21.10.2026 — porządki w sesjach (#34)](archive/decisions-historia.md#21102026--porządki-w-sesjach-34)
- [21.10.2026 — zbiorcze usuwanie zrobionych zadań](archive/decisions-historia.md#21102026--zbiorcze-usuwanie-zrobionych-zadań)
- [21.10.2026 — podział modułów API](archive/decisions-historia.md#21102026--podział-modułów-api)
- [20.10.2026 — wymagane źródło mutacji API (CSRF)](archive/decisions-historia.md#20102026--wymagane-źródło-mutacji-api-csrf)
- [20.10.2026 — zadania offline (7.6)](archive/decisions-historia.md#20102026--zadania-offline-76)
- [19.10.2026 — wycofanie PWA, kroki 4.8-4.10](archive/decisions-historia.md#19102026--wycofanie-pwa-kroki-48-410)
- [Ręcznie uruchamiany deploy GitHub Actions — krok 4.7 (2026-10-16)](archive/decisions-historia.md#ręcznie-uruchamiany-deploy-github-actions--krok-47-2026-10-16)
- [Numeracja zgodna z kolejnością prac (2026-10-16)](archive/decisions-historia.md#numeracja-zgodna-z-kolejnością-prac-2026-10-16)
- [Android i działające wdrożenie (2026-10-16)](archive/decisions-historia.md#android-i-działające-wdrożenie-2026-10-16)
- [Wcześniejsze wdrożenie (2026-10-16)](archive/decisions-historia.md#wcześniejsze-wdrożenie-2026-10-16)
- [Krok 2.7 (2026-10-12)](archive/decisions-historia.md#krok-27-2026-10-12)
- [Krok 2.5 (2026-10-12)](archive/decisions-historia.md#krok-25-2026-10-12)
- [Krok 4.1 — sesja Androida (2026-10-16, przed implementacją)](archive/decisions-historia.md#krok-41--sesja-androida-2026-10-16-przed-implementacją)
- [Krok 4.2 — kontrakt harmonogramu (2026-10-16)](archive/decisions-historia.md#krok-42--kontrakt-harmonogramu-2026-10-16)
- [Krok 4.3 — trwałe alarmy Androida (2026-10-16)](archive/decisions-historia.md#krok-43--trwałe-alarmy-androida-2026-10-16)
- [Krok 4.4 — synchronizacja harmonogramu (2026-10-17)](archive/decisions-historia.md#krok-44--synchronizacja-harmonogramu-2026-10-17)
- [Krok 4.5 — nawigacja Androida i podgląd alarmu (2026-10-17)](archive/decisions-historia.md#krok-45--nawigacja-androida-i-podgląd-alarmu-2026-10-17)
- [17.10.2026 — krok 4.6: podpisywanie i aktualizacje Androida](archive/decisions-historia.md#17102026--krok-46-podpisywanie-i-aktualizacje-androida)
- [17.10.2026 — diagnostyka lokalnego podpisywania APK](archive/decisions-historia.md#17102026--diagnostyka-lokalnego-podpisywania-apk)
- [18.10.2026 — deploy ze starszego API bez pobierania Androida](archive/decisions-historia.md#18102026--deploy-ze-starszego-api-bez-pobierania-androida)
- [18.10.2026 — izolacja instalacji zależności podczas deployu](archive/decisions-historia.md#18102026--izolacja-instalacji-zależności-podczas-deployu)
- [18.10.2026 — nowe APK przy każdym Deploy](archive/decisions-historia.md#18102026--nowe-apk-przy-każdym-deploy)
- [17.10.2026 — krok 4.7: ręczny deploy istniejącego serwera](archive/decisions-historia.md#17102026--krok-47-ręczny-deploy-istniejącego-serwera)
- [19.10.2026 — stan alarmów po zgłoszeniu z OPPO](archive/decisions-historia.md#19102026--stan-alarmów-po-zgłoszeniu-z-oppo)
- [19.10.2026 — systemowe alarmy kalendarza po próbie APK deploy.3](archive/decisions-historia.md#19102026--systemowe-alarmy-kalendarza-po-próbie-apk-deploy3)
- [19.10.2026 — usunięcie serwerowego Web Push, krok 4.9](archive/decisions-historia.md#19102026--usunięcie-serwerowego-web-push-krok-49)
- [19.10.2026 — usunięcie niestabilnego testu migracji PWA](archive/decisions-historia.md#19102026--usunięcie-niestabilnego-testu-migracji-pwa)
- [19.10.2026 — pionowa nawigacja WWW i menu mobilne](archive/decisions-historia.md#19102026--pionowa-nawigacja-www-i-menu-mobilne)
- [19.10.2026 — API zakupów, krok 5.1](archive/decisions-historia.md#19102026--api-zakupów-krok-51)
- [20.10.2026 — interfejs zakupów (krok 5.2)](archive/decisions-historia.md#20102026--interfejs-zakupów-krok-52)
- [20.10.2026 — trwałe zakupy offline (krok 5.3)](archive/decisions-historia.md#20102026--trwałe-zakupy-offline-krok-53)
- [20.10.2026 — plan podglądu rodziny i kalendarza offline (5.4–5.5)](archive/decisions-historia.md#20102026--plan-podglądu-rodziny-i-kalendarza-offline-5455)
- [20.10.2026 — trwały podgląd rodziny (krok 5.4)](archive/decisions-historia.md#20102026--trwały-podgląd-rodziny-krok-54)
- [20.10.2026 — trwały podgląd kalendarza (krok 5.5)](archive/decisions-historia.md#20102026--trwały-podgląd-kalendarza-krok-55)
- [20.10.2026 — imiona domowników i nazwa rodziny](archive/decisions-historia.md#20102026--imiona-domowników-i-nazwa-rodziny)
- [20.10.2026 — listy zadań: model i widoczność (krok 7.1, #12)](archive/decisions-historia.md#20102026--listy-zadań-model-i-widoczność-krok-71-12)
- [20.10.2026 — CRUD zadań i widok na dziś (krok 7.2, #13)](archive/decisions-historia.md#20102026--crud-zadań-i-widok-na-dziś-krok-72-13)
- [20.10.2026 — przypomnienia zadań (7.3, #14) i usunięcie nagłówka](archive/decisions-historia.md#20102026--przypomnienia-zadań-73-14-i-usunięcie-nagłówka)
- [20.10.2026 — zakładka Zadania (7.4, #15)](archive/decisions-historia.md#20102026--zakładka-zadania-74-15)
- [21.10.2026 — pobieranie zależności Androida](archive/decisions-historia.md#21102026--pobieranie-zależności-androida)
- [21.10.2026 — pełny formularz i szczegóły wydarzenia, krok R.3](archive/decisions-historia.md#21102026--pełny-formularz-i-szczegóły-wydarzenia-krok-r3)
- [21.10.2026 — kalendarz i karty dnia, krok R.2](archive/decisions-historia.md#21102026--kalendarz-i-karty-dnia-krok-r2)
- [21.10.2026 — wspólny motyw redesignu, krok R.1](archive/decisions-historia.md#21102026--wspólny-motyw-redesignu-krok-r1)
- [20.10.2026 — gest przesuwania kalendarza na telefonie](archive/decisions-historia.md#20102026--gest-przesuwania-kalendarza-na-telefonie)
- [21.10.2026 — strona 404 redesignu R.7](archive/decisions-historia.md#21102026--strona-404-redesignu-r7)
- [21.10.2026 — logo launchera Androida](archive/decisions-historia.md#21102026--logo-launchera-androida)
