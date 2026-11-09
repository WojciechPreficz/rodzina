# Architektura aplikacji

## Produkt i platformy

Publiczna strona prezentująca aplikację działa pod `/strona/`, z przekierowaniem
z `/strona`. W WWW niezalogowany użytkownik trafia na nią z `/`, również
z parametrami i fragmentem adresu; zalogowany widzi kalendarz. APK zachowuje
ekran `/witaj` i nie zawiera plików strony marketingowej. Bezpośrednie linki
do funkcji nadal prowadzą przez logowanie z zachowaniem adresu docelowego.
Strona ma własny dokument HTML i lokalne zasoby, korzysta z istniejącej CSP,
a rejestracja i oba logowania działają na tej samej domenie. Źródłem jest `page/`;
plugin Vite dołącza wyłącznie HTML, CSS i dwa skrypty do builda WWW.

Rodzina organizuje kalendarz, zakupy, zadania, dokumenty i kontakty.
Obiady mają plan tygodnia, eksport do zakupów i dzisiejszą kartę, również z trwałą obsługą offline. Rodzina ma wspólne konto
z wieloma domownikami; listy zadań są prywatne lub udostępniane.
WWW i APK korzystają ze wspólnego React. APK zawiera lokalny frontend
i pobiera zdalne API. Alarmy dostarcza wyłącznie Android; zamknięta aplikacja
nie pobiera zmian w tle. Nie przywracamy PWA ani Web Push.

## Stack i podział kodu

- npm workspaces: apps/web (React 19, Vite, Mantine, Schedule-X,
  TanStack Query), apps/api (Fastify, Drizzle, SQLite), packages/shared
  (wspólne schematy Zod, typy i czas).
- API jest modularnym monolitem: modules/<moduł>/ zawiera routes,
  service, repository i testy. Połączenia z bazą centralizuje db/client.ts.
  better-sqlite3 działa synchronicznie z WAL i busy_timeout=5000.
- Migracje i transakcje, idempotencja, VACUUM INTO i gotowe binaria zależą
  od tego sterownika. Zmiana na klienta asynchronicznego wymaga osobnego
  projektu; sam interfejs adaptera nie zapewnia zgodności.
- Harmonogram i sekrety Androida pozostają w magazynach natywnych.
  Preferencje urządzenia nie są danymi rodziny. Dane konta i spóźnione
  odpowiedzi podlegają cyklowi życia sesji; zmiana konta nie może przywrócić
  danych poprzedniej osoby.
- Sesja offline (`AccountSession`: użytkownik i rodzina) ma niezależny moduł
  `apps/web/src/session.ts`. Ostatnio potwierdzony stan zapisujemy w istniejącym
  IndexedDB konta, w `metadata` pod kluczem `account-session:1`, bez e-maila; kod
  dołączenia pozostaje dostępny offline jak dotychczas. Zapis następuje po
  logowaniu i potwierdzeniu `/api/auth/me`,
  niezależnie od pobrania domowników oraz stanu zakupów i obiadów.
  Przy braku nowego rekordu aplikacja po istniejącej migracji magazynów kopiuje
  sesję z cache `family`, a zapasowo z `shopping`. Zwraca ją dopiero po trwałym
  zapisie; kolejne odczyty korzystają z metadanych. Stare pola sesji i format
  zakupów w wersji 1 pozostają dla zgodności. Migracja sprawdza tożsamość konta;
  zapis i odczyt korzystają z bariery oraz generacji IndexedDB. Wylogowanie,
  zmiana konta i utrata sesji czyszczą ten rekord, a spóźnione operacje
  poprzedniego konta nie mogą go odtworzyć. Po 401 kolejka i zapisane podstawy
  modułów zapisu pozostają zawieszone pod identyfikatorem rodziny i użytkownika.
  Dopiero potwierdzone logowanie na to samo konto pozwala wznowić wysyłkę.
  Logowanie na inne konto usuwa zawieszone dane przed aktywacją jego magazynu.
  Przy wylogowaniu z niewysłanymi zmianami aplikacja pokazuje ich liczbę i
  pozwala je wysłać przy dostępnym połączeniu lub odrzucić. Jeśli po próbie
  wysyłki kolejka nadal zawiera zmiany, wylogowanie wymaga ich odrzucenia.
  Potwierdzone usunięcie własnego konta lub rodziny czyści również kolejkę.
  Lokalna kopia nie zastępuje
  sprawdzenia uprawnień przez API. Klucz `rodzina:pending-logout` zachowuje wartość.
- Wspólny nadawca outboxa potwierdza użytkownika i rodzinę przez `/api/auth/me`
  przed pierwszą gotową operacją zadań, zakupów lub obiadów. Potwierdzenie
  współdzielą moduły w obrębie jednego przebiegu i dzierżawy. Zmiana konta lub
  generacji, utrata dzierżawy, przerwa transportu i koniec przebiegu je wygaszają.
  `GET /api/auth/me` zwraca `401 UNAUTHORIZED` dla nieważnej sesji.
  `403 INVALID_CREDENTIALS` dotyczy błędnych danych logowania.
  Błąd `403` przy potwierdzaniu sesji nie czyści danych i pozwala ponowić
  próbę. Po `403` przy mutacji kolejna operacja wymaga potwierdzenia; `401` i
  `SESSION_CHANGED` zatrzymują nadawcę i uruchamiają obsługę utraty sesji.
  Każda mutacja nadal podlega autoryzacji po stronie API.
- Produkcja: cPanel vh.pl, Node 24, HTTPS i Phusion Passenger.
  Passenger może usypiać proces: bez stałego workera, WebSocketów,
  Dockera i Redisa. Jedynym cronem jest backup.
- server.cjs ładuje konfigurację i importuje ESM dist/server.js.
  Release zawiera public/ i drizzle/; ścieżki liczymy względem paczki.
  Konfigurację i procedury opisuje [DEPLOY.md](DEPLOY.md).

## Moduły offline

- `OfflineModule<Snapshot, Change, View>` rejestruje w istniejącym rejestrze
  adapter cache z parserem, wersją, budżetem, opisem pokrycia i regułą
  przycinania. IndexedDB przechowuje snapshot bazowy i wspólny outbox.
  Moduł deklaruje format danych oraz własne reguły migracji i zapisu.
  Moduły importują publiczne API z `offline/index`. Rejestr przekazuje
  operacje na snapshotach i kolejce w granicach transakcji aktywnego konta.
  Rdzeń zarządza IndexedDB i wysyła sygnały po zatwierdzeniu zapisu.
- Wspólny magazyn aktywuje konto, wczytuje snapshot i wystawia stabilny stan
  przez `useSyncExternalStore`. Rejestracja w `registerAccountStore` wiąże
  aktywację i czyszczenie pamięci z cyklem życia konta. Trwałe usuwanie obsługuje
  wspólna baza. Generacja bazy i rewizja magazynu odcinają spóźnione odpowiedzi.
  Sygnał między kartami inicjuje ponowny odczyt IndexedDB.
- Moduł z odczytem offline wyprowadza widok ze snapshotu. Odświeżenie
  online waliduje dane, zapisuje je przez adapter cache i publikuje widok.
  Kontakty korzystają z tego trybu, z formatem wersji 1 i dotychczasową
  migracją z klucza `rodzina:contacts:v1`.
  Kalendarz korzysta z tego samego trybu. Pobrane zakresy miesięczne,
  szczegóły wydarzeń, przypomnienia osobiste i wydarzenia odległe uzupełniają
  snapshot kolejno przez `updateSnapshot`, z kontrolą bieżącej rewizji
  i generacji konta. Zachowuje format wersji 1 i migrację z klucza
  `rodzina:calendar:v1`.
- Moduł z zapisem offline odczytuje snapshot i uporządkowane zmiany w jednej
  transakcji, a następnie czysta funkcja wyprowadza z nich widok. Sygnały
  outboxa odświeżają tę projekcję po zatwierdzeniu transakcji. Reguły zapisu
  i kolejkowania należą do modułu. Wspólny nadawca używa `SyncAdapter` danego konta
  do przygotowania, wysłania i rozliczenia operacji oraz obsługi utraty dostępu.
  Zadania korzystają z tego trybu. Przed odczytem magazyn może przenieść starszy
  dziennik IndexedDB do outboxa i utrwalić zmiany wymagające sprawdzenia.
  Zadania dołączają do nadawcy po potwierdzeniu sesji i odświeżeniu dostępu do
  list. Zachowują wersję 1 i migrację z klucza `rodzina:tasks:v1` oraz kluczy
  dziennika. Odpowiedzi odświeżania i zapisy sprawdzają zakres aktywnego konta,
  niezależnie od przeładowania widoku po sygnale outboxa.
  Zakupy korzystają z tego samego trybu zapisu offline. Snapshot w wersji 2
  przechowuje listy i zakresy ich zawartości z czasem pobrania. Moduł odczytuje
  wersję 1 z zakresami TanStack Query i zapisuje wersję 2 przy następnym zapisie
  snapshotu. Moduł sprawdza zgodność konta podczas migracji klucza
  `rodzina:shopping:v1` i dziennika localStorage. Magazyn przejmuje starszy
  dziennik IndexedDB do wspólnego outboxa. Projekcja łączy operacje zakupów
  z eksportami obiadów w kolejności outboxa.
  Obiady korzystają ze wspólnego magazynu zapisu offline. Projekcja łączy
  snapshot w wersji 1 z operacjami obiadów odczytanymi w tej samej transakcji.
  Rejestracja przez kontrakt przywraca magazyn z sesją i klientem TanStack Query,
  którego nadawca używa do anulowania odczytów zakupów przed eksportem.

## Dane, czas i uprawnienia

- Identyfikatory: crypto.randomUUID() jako text. Momenty: integer ms UTC.
  Daty: YYYY-MM-DD; godziny: HH:mm albo null. Dla wydarzenia jednorazowego
  null oznacza wpis przypisany do dnia bez istotnej godziny, opisany w UI
  jako „Bez godziny”, bez sugerowania zajęcia całego dnia. Godzina i czas
  trwania są opcjonalne; podana godzina bez długości ma durationMinutes=null
  i jednakowy początek/koniec wystąpienia. UI nie pokazuje wtedy końca ani
  zerowego czasu trwania. Techniczne allDay w wystąpieniach oznacza układ
  kalendarza według daty. Dla serii i odległych terminów zasady pozostają bez zmian.
  Strefa rodziny: Europe/Warsaw. Konwersje czasu są w shared/src/time.ts.
- familyId pochodzi wyłącznie z sesji, nigdy z parametrów klienta.
  Repozytoria przyjmują go jako pierwszy argument. Role: admin, member, child.
  Dziecko odczytuje wspólne dane, a uprawnienia zadań zależą też od listy.
- Schematy SQLite są w apps/api/src/db/schema.ts i migracjach, kontrakty JSON
  w packages/shared/src/schemas. Nie utrzymujemy drugiej listy wszystkich kolumn.
- createdBy i inne wskazania historycznej osoby są nullable z ON DELETE SET NULL;
  UI pokazuje „były domownik”. Usunięcie źródła usuwa jego relacje i przypomnienia.
  Usunięcie domownika czyści sesje, członkostwa i jego przypomnienia osobiste.
  Prywatne listy znikają; udostępnione przechodzą na pierwszego członka
  (is_default=false), a bez członków są usuwane.
- Zaproszenia są jednorazowe, ważne 7 dni. Reset tworzony przez administratora
  jest ważny 24 godziny. Hasła/PIN-y: Argon2id; tokeny: hash SHA-256.
  Sesje odnawiają się przy aktywności, ważność 60 dni. Nie usuwamy ostatniego
  administratora pojedynczo; może on usunąć całą rodzinę. Nie zmieniamy dzieci
  w dorosłych i odwrotnie.
- Usuwanie kont działa wyłącznie online na ekranie „Rodzina”. Administrator
  usuwa dowolnego domownika lub całą rodzinę; inny dorosły tylko siebie
  i dowolne dziecko swojej rodziny. Dzieci nie usuwają kont. Własne konto
  administrator usuwa tylko wtedy, gdy pozostanie inny administrator;
  usunięcie siebie nie usuwa automatycznie dzieci. Uprawnienia edycji profilu
  i PIN-u pozostają odrębne.
- DELETE /api/members/:id wymaga JSON { password }, a DELETE /api/family
  dodatkowo confirmationName zgodnego z aktualną nazwą rodziny po usunięciu
  skrajnych spacji. Hasło należy do wykonującego operację. Limit potwierdzeń
  jest wspólny: 10 prób/15 minut na konto, trwale w SQLite; 429 z Retry-After.
  Odpowiedź { ok: true, deleted: true, resetOwnSession } wskazuje czyszczenie
  własnej sesji i alarmów. Błędne hasło daje 403 INVALID_CREDENTIALS, ostatni
  administrator 409 LAST_ADMIN, a brak hasła w starszym APK
  409 ACCOUNT_DELETION_UPDATE_REQUIRED. Pozostałe funkcje starszego APK działają.
- Usuwanie i przygotowanie zależności odbywają się w transakcji immediate,
  z ponownym sprawdzeniem sesji, hasha hasła, ról i ostatniego administratora
  po asynchronicznej weryfikacji hasła. Pojedyncze usunięcie zachowuje wspólne
  treści i dotychczasowe przekazywanie list zadań. Usunięcie rodziny usuwa
  jej dane w aktywnej bazie, najpierw listy zadań i kontakty, następnie rodzinę
  z relacjami, kontami i sesjami; nie przekazuje list usuwanym osobom.
- Interfejs wymaga hasła i potwierdzenia skutków, a dla rodziny wpisania nazwy.
  Nie kolejkuje usuwania i nie ponawia go automatycznie. Nieznany wynik wymaga
  sprawdzenia sesji lub obecności domownika przed kolejną próbą. Hasło nie jest
  utrwalane w magazynach ani historii mutacji. Usunięcie siebie lub rodziny
  uruchamia istniejące wylogowanie i czyszczenie danych, niewysłanych zmian
  oraz alarmów, także w innych kartach. Na innym urządzeniu API zgłasza utratę
  sesji tym samym kodem 401 co przy wygaśnięciu. Urządzenie czyści sesję i
  alarmy, a zawieszoną kolejkę usunie po zalogowaniu na inne konto.
- Checklisty zadań: `task_checklist_items` dziedziczą dostęp przez listę rodzica,
  również dla dziecka. Usunięcie rodzica/listy usuwa kroki kaskadowo. Ukończenie
  lub ponowne otwarcie rodzica nie zmienia kroków i odwrotnie. Limit to 100
  pozycji i 200 znaków tytułu. Czasy są znacznikami UTC w milisekundach.
  `GET /api/tasks/:id/checklist` zwraca `{ ok, items, orderVersion }`;
  `POST` pod ten sam adres przyjmuje `{ id, title }` z UUID klienta.
  `PATCH /api/tasks/:id/checklist/:itemId` przyjmuje `{ title, version }`
  albo `{ isDone, doneVersion }`. Treść i wykonanie mają niezależne liczniki
  wersji, zwiększane przy zapisie; niezgodność daje 409 `CHECKLIST_CONFLICT`.
  `DELETE` pozycji wymaga `{ version, doneVersion }`, aby nie usunąć zmienionego
  kroku bez sprawdzenia. Odhaczenie zapisuje wykonawcę i czas, cofnięcie je czyści.
  `PATCH /api/tasks/:id/checklist/order` wymaga `{ itemIds, orderVersion }`:
  kompletu unikalnych ID bieżącej checklisty. Dodanie, usunięcie i przestawienie
  zwiększają wersję kolejności rodzica; odhaczenia i edycja nazwy jej nie zmieniają.
  Niezależne odhaczenia różnych kroków scalają się, sprzeczne zmiany tego samego
  pola wymagają sprawdzenia. Pozycje są numerowane od zera bez luk.
  Mutacje wymagają `operationId` w query i opcjonalnie `actorId`, używają
  istniejącego `task_operations` i transakcji immediate. Replay sprawdza aktualny
  dostęp i istnienie rodzica; usuniętego zadania nie odtwarza. Odpowiedzi mają
  istniejącą retencję 90 dni; automatyczny retry klienta pozostaje do 30 dni.
  Snapshot, listy, widok dzisiejszy i odpowiedzi mutacji rodzica zawierają
  `checklist` oraz `checklistOrderVersion`; odczyt kroków jest grupowy, porcje
  do 400 rodziców. Pola są opcjonalne w kontrakcie odczytu dla wcześniejszych
  danych APK. Dotychczasowy PATCH rodzica nie zastępuje checklisty.
  Warstwa offline zadań zapisuje mutacje checklist w dotychczasowym IndexedDB
  i wspólnym outboxie. Rozszerzenie formatu jest addytywne: zachowuje wersję 1,
  stare operacje, ID, daty i stany sprawdzenia. Brak checklisty lub jej wersji
  oznacza nieznane dane, nie pustą listę; blokuje lokalne mutacje checklisty
  do pobrania pełnego snapshotu. Lokalnie utworzony rodzic ma pustą checklistę.
  Transakcja odczytuje aktualną bazę i kolejkę, waliduje projekcję oraz zapisuje
  zmianę przed potwierdzeniem. Projekcja wylicza wykonane i wszystkie kroki,
  niezależnie od ukończenia rodzica. Utworzenie rodzica poprzedza pozycje;
  mutacje pozycji zależą od jej utworzenia. Osobne klucze treści, wykonania
  i kolejności pozwalają synchronizować niezależne zmiany mimo konfliktu.
  Konflikty i zależne zmiany pozostają do jawnego odrzucenia oraz odświeżenia
  przed nową decyzją. Odpowiedź checklisty i usunięcie operacji z outboxa
  zatwierdza jedna transakcja. Pełny snapshot zachowuje niewysłane operacje;
  retry zachowuje ID. Brak pojedynczego kroku nie usuwa rodzica z cache.
  Obowiązuje istniejący cykl życia konta, czyszczenie dostępu, alarmów i danych
  oraz ochrona przed spóźnionymi odpowiedziami.
  Podzadania są widoczne pod rodzicem na liście zadań. Odhaczanie i cofanie
  wykonania korzysta z tej samej trwałej kolejki offline co formularz checklisty;
  nie zmienia wykonania rodzica. Błąd zapisu jest widoczny na liście.
  Formularz istniejącego zadania zawiera sekcję „Podzadania”: dodawanie Enterem
  lub przyciskiem, edycję, usuwanie z potwierdzeniem, odhaczanie i przyciski
  kolejności dostępne klawiaturą. Nowy rodzic wymaga najpierw zapisu.
  Mutacje podzadań zapisują się od razu, niezależnie od przycisku „Zapisz”
  formularza rodzica. Szkice obu części chroni wspólna kontrola nawigacji,
  również dla systemowego Wstecz Androida. Błąd zapisu zachowuje szkic;
  kolejka i konflikty mają widoczny komunikat, z odesłaniem do istniejącego
  panelu sprawdzania zmian. Brak zapisanej checklisty blokuje jej edycję.
  Lista zadań i karta „Dziś do zrobienia” pokazują postęp „2 z 5”, bez zmiany
  licznika otwartych zadań. Ukończenie wszystkich kroków nie kończy rodzica:
  służy do tego osobny przycisk lub dotychczasowe odhaczenie na liście.
  Niewykonane albo nieznane kroki wymagają potwierdzenia ukończenia rodzica;
  jego cofnięcie pozostawia checklistę bez zmian.
- Cykliczność zadań (C.1–C.4): `task_series` przechowuje regułę
  kalendarzową (ze strefą), wzorcowe pola i wspólne względne przypomnienia,
  stan oraz wersję. `task_occurrences` wiąże widoczne zadanie z serią,
  numerem kolejności od zera, planowanym terminem, stanem
  active/done/skipped, faktycznym czasem zamknięcia i wersją. Numer dotyczy
  utworzonego wystąpienia, nie każdego pominiętego terminu harmonogramu;
  następca numeru N ma N+1. Unikalne (series_id, sequence) i częściowy
  indeks jednego active chronią przed podwójnym następcą. Złożone klucze
  obce wymuszają wspólną listę zadania i serii; dostęp dziedziczymy z listy.
  Usunięcie listy usuwa serię, wystąpienia i historię, zadania — jego wystąpienie.
  `task_series_history` (migracja 0029) zachowuje tytuł, planowany termin,
  wykonanie/pominięcie, czas i wykonawcę niezależnie od widocznego zadania.
  Cofnięcie zapisuje undoneAt/undoneBy, bez kasowania wcześniejszego wpisu.
  Usunięcie historycznego wykonawcy zeruje closedBy/undoneBy. Migracja 0028 nie zmienia
  żadnych pól ani stanu istniejących zadań, które pozostają jednorazowe.
  Walidowane schematami shared pola JSON reguły i wzorca nie stanowią
  dodatkowej konfiguracji środowiska.
  Czyste funkcje `firstTaskOccurrence` i `nextTaskOccurrence` zachowują
  pierwotną kotwicę miesięcy/lat, tygodnie ISO oraz granicę końca włącznie.
  Stały rytm wraca do kotwicy po spóźnieniu; odstęp po wykonaniu używa
  lokalnej daty faktycznego zamknięcia zamiast synchronizacji. Godzina
  pochodzi z reguły. Konwersje przez time.ts zachowują DST: luka przesuwa
  czas do przodu, powtórzenie wybiera wcześniejszy moment UTC. Obliczenia
  dat używają kalendarza, nie stałej długości doby w strefie rodziny.
  Funkcja zwraca faktyczny czas bez zmiany i stan review przy przyszłości
  ponad 5 minut lub regresji przed utworzenie/poprzednie zamknięcie;
  wtedy nie wyznacza następcy. Brak terminu po granicy końca daje null.
  Odczyty i odpowiedzi mutacji zadań publikują `recurrence` (null — jednorazowe)
  oraz `taskRecurrenceVersion: 1`. Brak tych opcjonalnych pól oznacza stary
  serwer/cache, bez znanej konfiguracji cykliczności. Relacje są odczytywane
  grupowo, po najwyżej 400 zadań. recurrence zawiera również seriesVersion,
  aby zapisane wystąpienie znało wersje wymagane do późniejszego zamknięcia.
  `POST /api/tasks/:id/recurrence` dołącza niewykonane zadanie do nowej serii;
  `PATCH /api/tasks/series/:id` zmienia aktywne wystąpienie i przyszły wzorzec.
  Oba przyjmują `{ rule, template, expectedVersion, expectedOccurrenceVersion }`;
  przy tworzeniu obie wersje wynoszą 0. Wzorzec zawiera title, notes, assigneeId
  i wyłącznie względne wspólne reminders oraz opcjonalną uporządkowaną tablicę
  tytułów checklisty. Wzorzec jest zapisany w istniejącym JSON, bez migracji.
  Przy dołączeniu do serii brak checklisty we wzorcu pobiera bieżące kroki;
  przy edycji brak pola zachowuje wcześniejszy wzorzec (zgodność starszego klienta).
  Zmiana reguły ustawia aktywny termin
  na `firstTaskOccurrence(rule)`; bez zmiany reguły zachowuje planowany termin.
  Podgląd dat w formularzu korzysta z tych samych funkcji shared.
  `GET /api/tasks/series/:id` zwraca serię, activeTaskId i occurrenceVersion,
  a `/history` — historię zamknięć i ich cofnięć. Dostęp dziedziczy listę,
  również dla dzieci. Cofnięcie udostępnienia lub usunięcie domownika czyści
  przypisanie we wzorcu, aby kolejne zadanie nie wróciło do byłego odbiorcy.
  `POST /api/tasks/series/:id/stop` wymaga obu wersji; zachowuje historię
  i odłącza aktywne zadanie jako jednorazowe. `POST /api/tasks/:id/skip`
  wymaga `{ expectedSeriesVersion, expectedOccurrenceVersion, closedAt }`.
  Pominięte zadanie ma isDone=true, ale bez doneAt/doneBy; stan skipped
  i wykonawca pominięcia są w recurrence oraz historii.
  Te mutacje wymagają operationId w query, opcjonalnie actorId, i korzystają
  z task_operations. Dostęp jest sprawdzany także przed replay; retencja
  odpowiedzi wynosi 90 dni, automatyczny retry klienta do 30 dni.
  Dotychczasowy PATCH zmienia tylko pojedyncze zadanie. isDone=true atomowo
  zamyka aktywne wystąpienie i tworzy jednego następcę albo kończy serię;
  ponowne true nie generuje kolejnej kopii, także z innym operationId.
  Nowy klient przekazuje closedAt (UTC ms), expectedSeriesVersion oraz
  expectedOccurrenceVersion; stary używa jawnie czasu odbioru przez serwer.
  Konflikt wersji daje 409 TASK_RECURRENCE_CONFLICT, anomalia czasu —
  409 TASK_CLOSURE_TIME_REVIEW bez zamknięcia i następcy.
  isDone=false cofa zamknięcie tylko przy niezmienionej serii i nietkniętym
  następcy. Transakcja usuwa następcę wraz z alarmami i otwiera poprzednika.
  Kontrola obejmuje treść, wersję wystąpienia, checklistę i przypomnienia;
  dostarczenie alarmu samo w sobie nie jest edycją. Usunięty, zmieniony
  lub wykonany następca oznacza jawny konflikt, bez odtwarzania historii.
  Stary DELETE aktywnego zadania oznacza pominięcie i utworzenie następcy;
  usuwanie zamkniętych pozycji nie wyłącza serii ani nie usuwa historii.
  Następca używa wzorca i jego odbiorcy. Względne wspólne przypomnienia
  dostają nowe UUID i przeliczony termin; absolutne i osobiste nie są kopiowane.
  Istniejący harmonogram i widok dzisiejszych zadań odczytują widoczne aktywne
  wystąpienie bez crona ani workera. Następca w tej samej transakcji otrzymuje
  kroki wzorca z nowymi UUID, zerowymi wersjami i niewykonanym stanem.
  Retry nie kopiuje kroków ponownie; historia i postęp poprzednika pozostają.
  Formularz „Powtarzaj” konfiguruje oba tryby, interwał, dni, godzinę i koniec.
  Pokazuje termin, przewidywanego następcę po zamknięciu teraz i pomijane daty
  stałego rytmu (lista ograniczona do ośmiu dat z informacją o dalszych).
  „Zapisz tylko to zadanie” nie zmienia wzorca; „Zapisz to i kolejne” zapisuje
  pola formularza i regułę. Zastąpienie wzorcowej checklisty bieżącą wymaga
  jawnego zaznaczenia. Nie zmienia to bieżących ani historycznych kroków.
  Osobiste przypomnienia zapisuje się osobno przez zapis pojedynczego zadania;
  stała data przypomnienia wspólnego blokuje zapis wzorca. Formularz udostępnia
  historię, pominięcie i zatrzymanie online, z kontrolą wersji i komunikatem
  konfliktu. Ponowienie żądania w otwartym formularzu zachowuje ID i czas.
  Zmiana checklisty podnosi wersję wystąpienia, więc konfiguracja i wykonanie
  na nieaktualnych danych nie nadpisują nowszych kroków. Lista i „Dziś”
  oznaczają serię; zaległość i oczekiwanie na synchronizację są jawne.
  Wykonanie pobranego wystąpienia korzysta z istniejącego IndexedDB i outboxa.
  Przy trwałym zapisie kolejka utrwala faktyczny czas UTC, tożsamość serii
  i wystąpienia oraz ich wersje. PATCH wykonania/cofnięcia przekazuje także
  opcjonalne expectedSeriesId; inna seria daje konflikt nawet przy zgodnych
  numerach wersji. Retry nie podmienia czasu ani identyfikatora operacji.
  Rozszerzenie magazynu jest addytywne, bez zmiany wersji 1; stare operacje
  zachowują dotychczasowe żądania i semantykę czasu serwera.
  Edycje treści i checklisty poprzedzające wykonanie uwzględniamy w wersji
  wystąpienia i zależnościach kolejki. Offline nie generujemy następcy ani
  jego alarmów; UI pokazuje „Kolejne zadanie po synchronizacji”. Cofnięcie
  wykonania przed wysyłką przywraca lokalnie zadanie, a kolejka zachowuje
  deterministyczne wykonanie i warunkowe cofnięcie na serwerze.
  Po mutacji cyklicznej, zmianie wykonania lub usunięciu adapter pobiera pełny
  snapshot, również gdy odpowiedź zgodnego API zawiera tylko rodzica.
  Zapis snapshotu z następcą i potwierdzenie outboxa są jedną transakcją.
  Błąd pobrania lub zapisu pozostawia operację do retry z tym samym ID;
  odświeżenie w tle nie publikuje następcy przed potwierdzeniem wykonania.
  Konflikty, anomalie czasu i wiek ponad 30 dni wymagają sprawdzenia.
  Dostęp do list pobieramy przed pierwszą operacją zadań w przebiegu nadawcy.
  Po `403` lub `404` adapter odświeża dostęp, aby odróżnić utratę listy od
  błędu pojedynczego zadania. Brak listy skutkuje `TASK_LIST_REVOKED`, ukryciem
  listy i usunięciem jej lokalnych danych oraz oczekujących zmian. Jawny
  sygnał `TASK_LIST_REVOKED` od razu ukrywa listę i wygasza odczyt dostępu
  przed następną operacją. Zmiana konta odrzuca spóźnione odpowiedzi.
  Istniejący taskOperationBlocksAlarm wstrzymuje alarmy pending także po
  restarcie i w stanie do sprawdzenia; uzgodnienie odświeża harmonogram.
  Konfiguracja, pominięcie i zatrzymanie serii wymagają internetu.
- Kontakty: jedna grupa na kontakt, jedna nieusuwalna grupa domyślna „Inne”
  na rodzinę; pozostałe początkowe grupy: Rodzina, Znajomi, Praca.
  Usunięcie grupy przenosi kontakty do domyślnej w transakcji.
  Dorośli edytują, cała rodzina odczytuje; brak integracji z książką telefonu.
- Obiady: rodzina może zaplanować wiele dań typu `dinner` na dzień.
  Każde danie ma własne ID i uporządkowane składniki.
  `GET /api/meals?weekStart=YYYY-MM-DD&multiple=true` wymaga poniedziałku
  i zwraca siedem dni z tablicami dań. Bez `multiple=true` zwraca pierwsze
  danie każdego dnia dla starszych klientów. Starsze zapisy po dacie
  (`PUT` i `DELETE /api/meals/:date/dinner` oraz `POST /api/meals/copy-week`)
  również działają na pierwszym daniu. Dziecko ma dostęp tylko do odczytu.
  `GET /api/meals/suggestions?q=` zwraca do 20 różnych tytułów z aktualnie
  zapisanych obiadów rodziny wraz ze składnikami ostatnio zapisanego wariantu.
  Wyszukiwanie i grupowanie ignorują wielkość liter i różnice białych znaków.
  Zakładka `/obiady` pokazuje siedem dni od poniedziałku, nawigację tygodni
  i powrót do bieżącego tygodnia według strefy rodziny. Dorośli dodają,
  edytują i usuwają obiady; formularz pozwala wybrać wcześniejsze danie
  z jego składnikami, zmienić notatkę i składniki. Kopiowanie poprzedniego
  tygodnia kopiuje wszystkie dania z każdego dnia źródłowego na odpowiadający
  mu wolny dzień. Opcja nadpisania zastępuje także zawartość zajętych dni,
  do których trafiają dania.
  Dziecko widzi wyłącznie odczyt. Pobrane tygodnie i podpowiedzi są zapisywane
  w istniejącym IndexedDB dla rodziny i użytkownika. Dorośli mogą przeglądać,
  edytować i usuwać obiady offline oraz kopiować znany tydzień do znanego
  tygodnia. Niepobrany tydzień nie oznacza pustego planu i blokuje zapis.
  Niezapisany formularz ma ochronę przed przypadkowym zamknięciem.
  `POST /api/meals/to-shopping-list?operationId=<UUID>` przyjmuje `weekStart`,
  `listId`, opcjonalne `mealIds` (ID dań z tego tygodnia) i `confirmRepeat`
  (domyślnie false). Brak filtra wybiera cały tydzień; nieznane ID daje 404,
  powtórzone ID nie zwielokrotnia składników. Eksport jest tylko dla dorosłych.
  W jednej transakcji scala składniki po nazwie (NFKC, białe znaki, wielkość
  liter) z niekupionymi pozycjami listy. Ilości łączy tekstowo przez `+`,
  pomijając brakujące wartości, bez konwersji jednostek. Kupione pozycje
  pozostają bez zmian; nowa potrzeba tworzy osobną niekupioną pozycję.
  Nowe pozycje korzystają z historii kategorii zakupów i aktualizują historię.
  Odpowiedź `{ ok: true, added, updated }` liczy pozycje dodane i uzupełnione.
  Rejestr `meal_shopping_exports` wykrywa wcześniejszy eksport obiadu na daną
  listę, także po edycji obiadu. Ponowienie ręczne wymaga `confirmRepeat=true`;
  w przeciwnym razie 409 `MEAL_EXPORT_CONFIRMATION_REQUIRED` wyjaśnia ponowne
  dodanie ilości. Odrzucana jest cała operacja, także przy mieszanym wyborze.
  Rejestr nie synchronizuje zmian: edycja/usunięcie obiadu nie zmienia zakupów,
  a zmiany zakupów nie wpływają na plan. Usunięcie obiadu lub listy usuwa wpis
  rejestru; nowy obiad ma nową tożsamość.
  Wymagany `operationId` korzysta z istniejącej tabeli `shopping_operations`:
  ponowienie zachowuje odpowiedź bez zwiększenia ilości, także po zmianie planu;
  zmiana danych pod tym samym ID daje 409. Po ostrzeżeniu można potwierdzić
  pod tym samym ID, ponieważ odrzucona operacja nie zapisuje odpowiedzi.
  Rola i dostęp do listy są sprawdzane również przed odtworzeniem odpowiedzi.
  UI eksportu pozwala wybrać zapisaną listę i dania ze składnikami, pokazuje
  podsumowanie pozycji dodanych i uzupełnionych oraz link do docelowej listy.
  Ostrzeżenie o ponownym eksporcie wymaga osobnego zaznaczenia potwierdzenia.
  Po wysłaniu wybór jest zablokowany; ponowienie po błędzie zachowuje ID i treść
  żądania. Eksport jest pojedynczą operacją istniejącego wspólnego outboxa,
  z kopią składników (`snapshot`) i docelowych identyfikatorów pozycji (`targets`).
  Edycja obiadu po zleceniu nie zmienia kopii. Lokalna projekcja zakupów
  uwzględnia eksport w kolejności operacji; adapter zakupów go nie wysyła.
  Serwer zwraca również aktualne pozycje i mapowanie identyfikatorów po scaleniu.
  Jedna transakcja IndexedDB aktualizuje bazę zakupów, potwierdzenie eksportu
  i identyfikatory późniejszych zmian, zachowując ich treść. Eksport czeka
  na utworzenie lokalnej listy oraz wcześniejsze zmiany obiadów i zakupów.
  Docelowa lista i jej zawartość muszą być wcześniej zapisane; nowa lokalna
  lista ma znaną pustą bazę. Zakupy wstrzymują automatyczne odświeżanie na
  podstawie statusu synchronizacji obiadów i wznawiają je po jej zakończeniu.
  Obiady przekazują transakcję do publicznego API zakupów
  (`features/shopping/index.ts`). Zakupy wyznaczają `targets` z lokalnej
  projekcji, zabezpieczają jej bazę po dopisaniu eksportu do kolejki i rozliczają
  wynik serwera wraz z mapowaniem identyfikatorów. Dialog korzysta z tej samej
  projekcji co ekran zakupów. Publiczne API anuluje trwające odczyty przed
  wysłaniem eksportu. Obiady odpowiadają za `snapshot`
  i zależności w kolejce.
  Reguła ESLint `architecture/public-feature-imports` wymaga, aby importy
  spoza danego modułu `features/<moduł>` przechodziły przez jego publiczny
  `index.ts`. Istniejące wyjątki są zapisane w `eslint.config.mjs` jako
  konkretne pary pliku importującego i pliku docelowego.
  Karta „Dziś na obiad” na górze kalendarza pokazuje nazwy i notatki dań
  według strefy rodziny, niezależnie od oglądanej daty kalendarza. Współdzieli
  odczyt tygodnia z zakładką Obiady; zapis, usunięcie lub kopiowanie odświeża
  kartę. Uwzględnia cache i oczekujące zmiany; brak zapisanej zawartości nie
  oznacza braku obiadu. Baner tygodnia pokazuje tryb offline, czas pobrania,
  stan kolejki i zmiany wymagające reakcji.
  Mutacje z kolejki trafiają do `POST /api/meals/offline?operationId=<UUID>&actorId=<UUID>`.
  Operacja `write` z `byId: true` zawiera tydzień i zapisy pojedynczych dań
  (`date`, `id`, `expectedId`, `data`, a `data=null` oznacza usunięcie).
  Kopiowanie zapisuje zamrożone dane i oczekiwane ID dań w dniach docelowych
  w jednej atomowej operacji. Niezgodność tożsamości daje konflikt.
  Starsze operacje z kolejki działają na pierwszym daniu każdego dnia.
  Idempotencja obiadów używa tabeli `shopping_operations`. Rola jest sprawdzana
  również przed odtworzeniem odpowiedzi.
  Wspólny nadawca obsługuje kolejkę obiadów. Powrót sieci i wznowienie
  aplikacji uruchamiają synchronizację. WWW obsługuje otwarte okno bez sieci,
  APK również restart lokalnego frontendu. Zamknięte APK nie synchronizuje.
  Cache obiadów ma budżet 4 MiB, z kolejką do 6 MiB; najstarsze tygodnie bez
  oczekujących zmian mogą być usuwane. Bazy oczekujących zmian są przypięte;
  brak miejsca przerywa zapis zamiast potwierdzać pozorny sukces.
  Konflikty i zmiany starsze niż 30 dni pozostają do sprawdzenia. Ponowny
  eksport można potwierdzić; odrzucenie zmiany i jej zależności wymaga osobnej
  decyzji użytkownika. Wylogowanie i zmiana konta czyszczą również obiady,
  a spóźnione odpowiedzi nie przywracają danych poprzedniej osoby.

## API i bezpieczeństwo

- /api, dane wejściowe walidowane schematami Zod przez wspólny parser HTTP
  przed przekazaniem do serwisów. Reguły biznesowe pozostają w serwisach.
  Jeden globalny handler zwraca błędy { error: { code, message } } z komunikatem
  po polsku, zachowuje statusy błędów HTTP klienta (w tym 413 i 415), a szczegóły
  nieoczekiwanych błędów zapisuje tylko w logach. Błąd walidacji odpowiedzi
  oznacza 500, nie błąd danych klienta.
  Publiczne trasy są jawnie określone w konfiguracji auth.
- Mutacje wymagają application/json i zgodnego źródła: Origin, a wyłącznie
  przy jego braku Referer. Porównujemy z hostem żądania. Proxy Vite zachowuje
  changeOrigin=false. Cookie sid: HttpOnly, SameSite=Lax, Secure w produkcji.
- RODZINA_TRUSTED_PROXIES wskazuje zaufane IP/CIDR pośredników. Pusta lista
  ignoruje X-Forwarded-For; zaufanie do całego łańcucha nie jest domyślne.
  Konfiguracja hostingu wymaga potwierdzenia; patrz DEPLOY.
- Żądania `/api` mają wspólny licznik według adresu IP klienta.
  Limiter trzyma dane w pamięci osobno w każdym procesie Passengera. Restart
  zeruje liczniki. Po przekroczeniu limitu API zwraca `429 RATE_LIMITED`
  z `Retry-After`. Logowanie zachowuje dodatkowe trwałe limity w SQLite.
- Haszowanie i weryfikacja haseł i PIN-ów korzystają ze wspólnej kolejki
  Argon2. Jeden proces wykonuje równolegle najwyżej dwie operacje.
- Limity rekordów rodzinnych obejmują wydarzenia, kontakty, grupy kontaktów,
  listy i pozycje zakupów, listy i zadania, serie zadań, dokumenty, obiady i domowników.
  Sprawdzenie wolnego miejsca i dodanie rekordu odbywają się pod tą samą blokadą
  zapisu SQLite. Seria w kalendarzu zajmuje jedno miejsce, a każde zapisane wystąpienie
  cyklicznego zadania liczy się jako zadanie. Po wyczerpaniu miejsca zapis nowego
  rekordu zwraca `409 FAMILY_RECORD_LIMIT`. Import wydarzeń zgłasza ten kod przy
  konkretnej pozycji w wyniku zbiorczym. Domyślna lista zadań powstaje, gdy jest
  wolne miejsce. Wartości konfiguracyjne opisuje DEPLOY.
- Błędny e-mail, hasło lub PIN zwraca 403 `INVALID_CREDENTIALS`, bez sygnału
  utraty sesji. Brak lub wygaśnięcie sesji zwraca 401 `UNAUTHORIZED`
  i uruchamia czyszczenie danych konta.
  Po potwierdzeniu braku sesji frontend wstrzymuje automatyczne sprawdzanie
  /api/auth/me przez timer, powrót do karty i odzyskanie sieci. Logowanie
  przywraca sprawdzanie; zmiana konta w drugiej karcie pozwala wykryć nową sesję.
- Limity logowania: 10 prób/15 minut dla IP–konto, osobno hasło i PIN,
  trwałe w SQLite. Poprawne logowanie usuwa licznik IP–konto.
- Nowe kody rodzin mają 10 znaków z alfabetu 32 znaków losowanych przez
  `crypto.randomInt`. Administrator może wygenerować nowy kod w ustawieniach
  rodziny. Stare kody 6-znakowe działają do dobrowolnej zmiany. Starsze APK
  przyjmuje w formularzu tylko 6 znaków. Wpisanie nowego kodu wymaga aktualizacji
  APK. Już zalogowane urządzenia zachowują sesje po zmianie kodu.
- Publiczne GET /api/auth/family-members pozwala na 10 wyszukiwań na IP w 15 minut
  i 100 nieudanych wyszukiwań łącznie w 15 minut. Kod nieistniejący i kod rodziny
  bez dzieci zwracają to samo 404. Po wyczerpaniu globalnego limitu wyszukiwanie
  zwraca 429 także dla poprawnego kodu. Odpowiedzi mają Cache-Control: no-store.
- Logowanie dziecka zwraca to samo 403 dla nieznanego kodu, profilu lub błędnego
  PIN-u. Dodatkowy limit to 20 nieudanych prób na dziecko w godzinę ze wszystkich
  adresów IP. Próby równoległe rezerwują miejsce przed sprawdzeniem PIN-u.
  Poprawny PIN zwalnia własną rezerwację. Zmiana PIN-u przez administratora
  odblokowuje dziecko na wszystkich IP, a zmiana kodu rodziny zachowuje blokadę.
  Limity wyszukiwania i PIN-u są trwałe w auth_rate_limits, a 429 zawiera Retry-After.
- Nowa rodzina wymaga akceptacji regulaminu i potwierdzenia e-mail. Formularz
  WWW i APK linkuje do `/strona/regulamin.html`. POST /api/auth/registration-requests
  wymaga `acceptedTerms: true`, zapisuje tylko pending_registrations i zwraca 202
  po przyjęciu wiadomości przez SMTP. Nie tworzy rodziny, użytkownika, grup kontaktów ani sesji.
  Istniejące konta, sesje i zaproszenia do rodziny nie wymagają weryfikacji.
  Dane zgłoszenia zawierają hash hasła Argon2 i hash losowego tokenu 256 bitów.
  Link /potwierdz-rodzine#token=… jest ważny 24 godziny; sekret we fragmencie
  nie trafia do żądania strony. GET nie tworzy konta. Przycisk potwierdzenia
  wysyła POST /api/auth/confirm-registration, który w transakcji immediate
  tworzy rodzinę, administratora i grupy kontaktów oraz usuwa wszystkie
  zgłoszenia adresu. Równoległe potwierdzenia nie tworzą duplikatów. Nie
  uruchamiamy sesji z linku: po sukcesie użytkownik loguje się swoim hasłem.
  Błąd SMTP usuwa tylko nowy token; wcześniejsze ważne linki pozostają aktywne.
  Dopóki SMTP nie zakończy się sukcesem, zgłoszenia nie można potwierdzić.
  Wygasłe dane są usuwane przy żądaniach rejestracji/potwierdzenia, bez crona.
  Rejestracja ma osobne trwałe limity IP (10/15 minut) i adresu (3/godzinę),
  z kluczami hash w auth_rate_limits i Retry-After przy 429.
  RODZINA_ALLOW_REGISTRATION=false blokuje zgłoszenia i potwierdzanie; brak
  SMTP oznacza 503, nigdy rejestrację bez poczty. Flaga resetu hasła nie
  wyłącza potwierdzeń. Stare POST /api/auth/register-family również wymaga
  `acceptedTerms: true`. Starsze APK bez tego pola otrzymuje instrukcję
  założenia rodziny w przeglądarce. Po akceptacji starszy endpoint wykonuje tę
  samą wysyłkę i zwraca 409 EMAIL_CONFIRMATION_REQUIRED.
- GET /api/auth/password-recovery udostępnia wyłącznie dostępność funkcji.
  Formularz /nie-pamietam-hasla wysyła POST /api/auth/forgot-password.
  Domyślnie wysyłka jest wyłączona (503 bez sprawdzania konta). Po włączeniu
  poprawne żądania dają jednakowe 202 dla znanych i nieznanych adresów,
  kont bez hasła i dzieci oraz błędów SMTP. Nie potwierdza to dostarczenia maila.
- Link e-mail ma losowy token 256 bitów, hash w password_resets i ważność
  30 minut. Link administratora zachowuje 24 godziny. Zamówienie kolejnego linku
  i samo otwarcie strony nie unieważniają wcześniejszych linków ani sesji.
  SMTP wymusza TLS/STARTTLS z weryfikacją certyfikatu; wysyłka ma 4 s limitu,
  a jednakowa minimalna odpowiedź 4,5 s ogranicza różnice czasowe. Błąd lub timeout
  unieważnia tylko nowy token. Wysyłka działa w żądaniu, bez kolejki i crona.
- Reset ma osobne klucze w auth_rate_limits: hash IP i znormalizowanego adresu,
  10 prób/15 minut/IP i 3/godzinę/adres; wspólna transakcja immediate rezerwuje
  limity przed wysyłką. Obejmują nieistniejące konta, przetrwają restart,
  a odpowiedź 429 ma Retry-After. Wygasłe liczniki są czyszczone przy żądaniu.
- POST /api/auth/reset-password atomowo wykorzystuje token, zapisuje hasło,
  unieważnia pozostałe linki i wszystkie sesje resetowanej osoby. Dwa różne
  tokeny nie pozwalają na dwa równoległe sukcesy. Odpowiedź zachowuje ok: true
  i dodaje resetOwnSession; cookie kończymy tylko dla resetowanego konta.
  Wspólny frontend uruchamia jego istniejące wylogowanie, czyszcząc dane i alarmy.
  Inne urządzenia wykrywają utratę sesji przy kontakcie z API; telefon offline
  nie dostaje natychmiastowego sygnału. Strona resetu i API mają no-store oraz
  no-referrer; treść linku nie trafia do cache modułów ani logów aplikacji.
  Utworzenie sesji hasłem sprawdza w transakcji aktualność zweryfikowanego
  hasha, aby rozpoczęte wcześniej logowanie nie przywróciło sesji starym hasłem.
- Operacje zakupów, zadań i obiadów zachowują identyfikatory przy ponowieniu.
  Automatyczne retry trwa do 30 dni; odpowiedzi idempotentne są przechowywane
  90 dni. Uprawnienia sprawdzamy także przy odtwarzaniu odpowiedzi.
  Mutacje API jawnie wybierają profil idempotencji zdefiniowany w module lub
  ustawiają `config.idempotency: false`. Rejestracja trasy z profilem wymaga
  synchronicznego handlera. Nieznany lub nieużywany profil przerywa start API.

## Wydarzenia ze zdjęcia (OCR.1–OCR.5)

Shared eksportuje `ocrDocumentSchema`, `OcrDocument` i `parseOcrEvents`.
Adapter przekazuje wymiary obrazu po korekcie orientacji i zmniejszeniu oraz
linie z unikalnym w obrębie wyniku `id`, tekstem i `box` (x, y, width, height
w zakresie 0–1, początek w lewym górnym rogu tego obrazu). Opcjonalny `blockId`
jest lokalnym identyfikatorem bloku silnika. Opcjonalne `confidence` (0–100)
przekazuje ocenę silnika, bez deklarowania prawdopodobieństwa poprawności.
Kontrakt nie zależy od silnika OCR.

Parser jest lokalną, czystą funkcją bez zegara, sieci i zapisu. Respektuje bloki
adaptera i rozdziela fragmenty przez odstępy poziome/pionowe; szeroki nagłówek
nie łączy odległych kolumn. Tytuł i miejsce proponuje z pobliskich linii
w tym samym obszarze. Wynik zawiera częściowe propozycje, pełne źródłowe linie
z położeniem i polskie ostrzeżenia z kodami i identyfikatorami fragmentów.

Daty numeryczne, ISO i polskie nazwy miesięcy są walidowane kalendarzowo.
Brak roku zachowuje dzień/miesiąc i pustą datę ISO; nie wybieramy bieżącego
ani najbliższego roku. Nie poprawiamy automatycznie błędów OCR. Kilka dat
w obszarze pozostaje alternatywami z ostrzeżeniem, bez wybranej daty i godziny;
termin zapisów jest oznaczony do potwierdzenia. Rozpoznane godziny i rosnące
przedziały są lokalne; pojedyncza godzina nie otrzymuje domyślnego czasu
trwania, a przedział przez północ wymaga decyzji. Brak godziny nie oznacza
automatycznie wydarzenia całodniowego. Każda propozycja wymaga zatwierdzenia.
Układ jest heurystyką: nieczytelne i rozdzielone fragmenty mogą wymagać ręcznego
połączenia lub rozdzielenia.

W WWW kalendarz zawiera akcję „Dodaj ze zdjęcia”: wybór JPEG, PNG lub WebP
do 20 MB i korekta orientacji EXIF. Małe obrazy powiększamy do dłuższego boku
2000 px (najwyżej trzykrotnie), duże zmniejszamy do 3200 px; obrazy pomiędzy
tymi progami zachowują rozdzielczość.
Tesseract.js 6 działa w lokalnym workerze uruchamianym dopiero po wyborze
zdjęcia. Tryb rozproszonego tekstu rozpoznaje osobne fragmenty plakatów;
adapter rozdziela słowa o odległych położeniach lub różnych liniach bazowych.
Zwraca linie z położeniem i oceną pewności dla wspólnego parsera. Podgląd
poprzedzają dwa dodatkowe lokalne odczyty: skala szarości oraz obraz progowany
w skali 75%. Rozpoznanie jednej daty nie pomija pozostałych przebiegów.
Daty i niepewne napisy (najwyżej 32 wiersze) są ponownie odczytywane osobno,
z marginesem i powiększeniem do 2×, najwyżej 3200 px, w trybie pojedynczego
wiersza. Położenie fragmentu pozostaje przypisane do zdjęcia źródłowego.
Scalanie preferuje rozpoznaną datę nad uszkodzonym tekstem, a sprzeczne daty
zachowuje do decyzji użytkownika. Przy alternatywach różniących się wyłącznie
kreską `|` i literą `I` wybiera istniejący odczyt litery z wystarczającą pewnością,
bez dopisywania słów. Parser odrzuca ceny również bez spacji („15ZŁ”)
i nie tworzy pustych propozycji z samych ozdób. Podgląd
zawiera zdjęcie, częściowe propozycje i ostrzeżenia, bez sekcji tekstu źródłowego. Brak roku
lub godziny nie otrzymuje domyślnej wartości. Istniejący formularz wydarzenia
w trybie zatwierdzania pozwala poprawić propozycję lub dodać brakującą ręcznie.
Brak daty/roku wymaga uzupełnienia. Godzina i czas trwania są opcjonalne;
pusta godzina oznacza wpis „Bez godziny” w wybranym dniu. Zatwierdzenie w formularzu nie zaznacza pozycji i nie zapisuje wydarzenia.
Jednoznaczną propozycję z poprawnym tytułem i datą można zatwierdzić
przyciskiem na karcie, bez otwierania formularza. Przycisk „Zatwierdź propozycję”
od razu zaznacza wydarzenie do zapisu; checkbox pozwala je ponownie odznaczyć.
Brak godziny pokazuje tylko
żółte ostrzeżenie „Nie rozpoznano godziny” i nie blokuje zatwierdzenia;
rozpoznana godzina pozostaje w zatwierdzonych danych. Niejasne daty, brak roku
lub niejednoznaczny odczyt godziny nadal wymagają poprawienia formularzem.
Użytkownik zapisuje online do 20 zaznaczonych, zatwierdzonych pozycji.
Osoby i przypomnienia pozostają puste do ich jawnego wyboru w formularzu.

WWW używa `parseOcrEvents(document, { groupByDates: true })`: daty wyznaczają
kolumny i karty, a sąsiadujące alternatywne daty pozostają niejednoznaczne.
Jawne granice bloków adaptera nadal obowiązują. Tytuł może łączyć kilka
wierszy podobnej wielkości; ceny, pojedyncze znaki i metadane biletu nie są
tytułami. Adres zawierający „ul.” może występować po nazwie miasta.
Rozpoznane daty porządkują propozycje. Niska ocena istotnego fragmentu daje
ostrzeżenie; nie poprawiamy automatycznie liter ani treści na podstawie
oczekiwanego słowa. Domyślny tryb parsera zachowuje dotychczasową segmentację.

W podglądzie jednoznaczny zapis „12–14 marca 2024” daje `dateRange` z oboma
końcami włącznie, zamiast alternatywnych dat. Wyliczenia „12 i 14” pozostają
niejednoznaczne. Powtórzony ten sam zakres przy etykiecie godzin otwarcia
nie tworzy drugiego wydarzenia; `openingHours` jest osobne od czasu trwania
wydarzenia. Dodatkowe godziny programu nie zastępują jawnego „start”.
Brak roku pozostaje do potwierdzenia także przy zapisie „14 06”; nie pobieramy
roku z nazwy edycji ani nie interpretujemy „już jutro” według bieżącego zegara.

Jeżeli pierwszy przebieg nie znajduje poprawnej daty, worker wykonuje najwyżej
trzy dodatkowe lokalne odczyty: luminancja, luminancja w mniejszej skali
i kanał czerwony. Współrzędne są normalizowane do wspólnego obrazu, a fragmenty
nakładające się po położeniu są uzgadniane, bez dublowania wierszy. Przygotowanie
kontrastu oddaje sterowanie interfejsowi i sprawdza anulowanie; obowiązuje
wspólny limit 120 s. Zwykłe poprawnie odczytane obrazy zachowują pierwszy przebieg.

Vite dołącza worker, cztery warianty silnika z osadzonym WASM, polski model
i licencje pod `/ocr/<hash>/`; manifest jest w `/ocr/manifest.json`.
Nie korzystamy z CDN ani trwałego cache OCR. CSP dopuszcza `wasm-unsafe-eval`
i podgląd obrazów `blob:`, zachowując skrypty oraz workery wyłącznie z `self`.
Brak gwarancji uruchamiania WWW offline. Zdjęcie i wynik pozostają w pamięci
urządzenia; nie trafiają na serwer ani do logów. Anulowanie, ponowny wybór,
opuszczenie ekranu i czyszczenie konta kończą worker, zwalniają podgląd
i unieważniają spóźnione wyniki. Limit pojedynczego odczytu wynosi 120 s.
APK udostępnia tę samą akcję przez plugin `RodzinaOcr`. Systemowy selektor
`PickVisualMedia` (z zastępczym `ACTION_OPEN_DOCUMENT`) udziela dostępu tylko
do wybranego zdjęcia, bez uprawnień do całej galerii i bez aparatu.
Tesseract4Android 4.9.0 używa Tesseracta w trybie LSTM i tego samego polskiego
modelu `4.0.0_best_int` co WWW. APK zawiera model, który jest kopiowany do
prywatnej pamięci podręcznej przy pierwszym odczycie. Sieć jest zbędna także
bezpośrednio po instalacji.

Silnik odczytuje rozproszony tekst na oryginale, w skali szarości i po
progowaniu obrazu w skali 75%. Adapter rozdziela odległe słowa oraz słowa
na różnych liniach bazowych. Przekazuje tekst, znormalizowane położenie
fragmentu i pewność odczytu (0–100). Następnie ponawia odczyt najwyżej
32 fragmentów oryginału w trybie pojedynczego wiersza. Kandydatami są
wiersze z rokiem i niepewne napisy. Fragment ma margines i jest powiększany
do 2×, najwyżej do 3200 px. Odczyt zachowuje położenie źródłowego wiersza.
Anulowanie obejmuje także warianty i fragmenty. Most scala dostępne dokumenty
`alternateDocument`, `binaryDocument` i `refinedDocument` z odczytem oryginału.
Zgodne geometrycznie fragmenty są uzgadniane według pewności silnika;
sprzeczne odczyty dat pozostają alternatywami do ręcznego rozstrzygnięcia.
Nie korygujemy słów słownikiem ani nie odgadujemy dat. Błąd dodatkowego
przebiegu zachowuje wynik pierwszego; anulowanie unieważnia oba wyniki.
Tekst kartki bez odczytanej daty, oddzielony poziomo od sąsiedniego terminu,
pozostaje osobną propozycją z brakującą datą. „Szkoła do hymnu” jest tytułem;
rozpoznanie szkoły jako miejsca wymaga etykiety adresu lub określenia placówki.

Źródło JPEG/PNG/WebP jest kopiowane strumieniowo z URI do prywatnego pliku
tymczasowego z egzekwowanym limitem 20 MB. Granice obrazu są odczytywane
przed dekodowaniem; próbkowanie ogranicza bitmapę do 12 mln pikseli,
następnie stosowana jest orientacja EXIF (także odbicie) i skalowanie jak w WWW.
Plik jest usuwany po przygotowaniu; pozostałości po przerwaniu procesu
są usuwane przy załadowaniu pluginu. Nie należy do trwałej pamięci konta.
Most JS otrzymuje tylko dokumenty OCR i opcjonalny podgląd JPEG do 640 px
i 256 KiB, bez pełnego zdjęcia. Bitmapy i instancja Tesseracta są zwalniane po
zakończeniu zadania, także anulowanego. Trwający odczyt blokuje uruchomienie
drugiego; anulowany selektor musi najpierw wrócić do aplikacji.

Identyfikator odczytu wiąże anulowanie z właściwą operacją. Zamknięcie ekranu,
zmiana konta i limit 120 s unieważniają wynik i zlecają anulowanie natywne.
Powrót z selektora kontynuuje istniejącą operację; nie uruchamia nowego odczytu.
Podgląd, parser, poprawianie, zatwierdzanie, zapis online, wyniki i trwałe retry
są wspólne z WWW. Transport API nie przesyła zdjęcia ani surowego OCR.
Fizyczny odbiór pozostaje wymagany w OCR.5/OCR.6.

`POST /api/events/import` (OCR.3) przyjmuje `{ items: [{ operationId, event }] }`
z 1–20 pozycjami i unikalnymi UUID operacji. Niepoprawna struktura odrzuca całe
żądanie (400); dane wydarzenia walidujemy osobno istniejącym schematem tworzenia,
ograniczonym do `kind=single`. Odpowiedź 200 to `{ ok: true, results: [...] }`:
każda pozycja ma `operationId`, `status` (`created`, `already_created`, `error`),
a także `eventId` przy sukcesie lub `error: { code, message }` przy błędzie.
Obowiązują dotychczasowe role kalendarza, również tworzenie przez dzieci.
Nie przypisujemy automatycznie uczestników ani przypomnień.

Każda pozycja ma osobną transakcję immediate obejmującą wydarzenie, jego relacje
i sukces w `event_import_operations`. Klucz obejmuje rodzinę, użytkownika i UUID;
odcisk SHA-256 dotyczy zwalidowanych danych po uzupełnieniu wartości domyślnych.
Retry identycznych danych zwraca zapisany identyfikator, inne dane — błąd pozycji
`OPERATION_CONFLICT`. Przed replay sprawdzamy sesję, dostęp do rodziny i aktualną
przynależność uczestników. Rejestr nie wygasa; znika po usunięciu konta lub rodziny,
ale pozostaje po usunięciu wydarzenia, więc retry nie odtwarza usuniętej treści.
Zdjęcia i surowy OCR nie należą do kontraktu API. Dotychczasowy `POST /api/events`
zachowuje kontrakt.

Przed żądaniem OCR.4 zapisuje UUID operacji i kopię zatwierdzonych danych
w metadanych istniejącego IndexedDB konta (`calendar-photo-import:1`). Zapis
jest transakcyjny i korzysta z istniejącej bariery zmiany konta; jego błąd
blokuje żądanie. Nie jest to outbox ani automatyczna kolejka offline.
Nieznany wynik blokuje edycję i odrzucenie pozycji. Po ponownym otwarciu ekranu
ręczne ponowienie online wysyła te same UUID i dane, bez nowej daty operacji.
Wynik każdej pozycji jest utrwalany: sukces pozostaje widoczny do opuszczenia ekranu, a odrzucenie
zachowuje dane do poprawy także po restarcie. Kolejna wysyłka definitywnie
odrzuconej pozycji dostaje nowy UUID; poprawienie wymaga ponownego zatwierdzenia
i zaznaczenia. Utrata zapisu wyniku pozostawia wcześniejszy stan nieznany.
Sukces, także częściowy, unieważnia dane kalendarza i odświeża istniejący
harmonogram. Ponowne otwarcie importu usuwa lokalne wyniki sukcesów i odtwarza
wyłącznie operacje o nieznanym wyniku oraz odrzucone pozycje wymagające poprawy.
Po w pełni udanym imporcie nowy formularz jest pusty. Ukrycie sukcesu usuwa
tylko lokalny wynik, nie wydarzenie.

Niezapisane propozycje są chronione istniejącym ostrzeżeniem nawigacji.
Zdjęcie i źródło OCR pozostają wyłącznie w pamięci ekranu; wybór kolejnego
zdjęcia od razu usuwa poprzednie propozycje, także zatwierdzone, ale jeszcze
niewysłane, i zastępuje je wynikiem nowego odczytu. Zachowane pozostają wysłane
operacje o nieznanym wyniku i odrzucone pozycje wymagające poprawy. Trwałe dane obejmują tylko
zatwierdzone operacje i ich wyniki. Wylogowanie, utrata sesji i zmiana konta
stosują wspólne czyszczenie IndexedDB. Generacja sesji i ekranu chroni przed
spóźnionym odczytem lub odpowiedzią poprzedniego konta.

Dodawanie z formularza i ze zdjęcia porównuje datę rozpoczęcia oraz tytuł
z wydarzeniami rodziny. Tytuły porównujemy po normalizacji Unicode,
usunięciu nadmiarowych spacji i zmianie liter na małe; godzina nie rozstrzyga
o duplikacie. Dopasowanie obejmuje również wystąpienia serii, ale zastąpienie
serii wymaga jej edycji w kalendarzu. Dialog pokazuje pasujące wpisy i pozwala
zastąpić wybrany albo dodać kolejne wydarzenie. Anulowanie zachowuje dane
formularza; nie zmienia kalendarza. Dziecko może zastąpić wyłącznie własny wpis.

`GET /api/events/duplicates?title=&startDate=&kind=` zwraca pasujące wpisy,
możliwość zastąpienia i odcisk ich aktualnej treści. Nowy formularz wysyła
`POST /api/events?duplicateAction=check|add|replace`; zastąpienie wymaga
`duplicateEventId` i `duplicateVersion`. Sprawdzenie oraz zapis odbywają się
w jednej transakcji. Zastąpienie zachowuje ID i autora istniejącego wpisu,
aktualizuje jego dane i harmonogram według zasad zwykłej edycji. Zmiana lub
usunięcie wpisu po pokazaniu dialogu wymaga ponownej decyzji. Stary POST
bez opcji zachowuje zgodność z wcześniejszym APK.

Pozycja importu może zawierać `duplicateResolution`: `{ action: 'check' }`,
`{ action: 'add' }` lub `{ action: 'replace', eventId, version }`. Nowy klient
zaczyna od `check`. Duplikat daje błąd pozycji `DUPLICATE_EVENT` z listą
pasujących wpisów, bez rejestru sukcesu ani zmiany wydarzenia. Pozostałe
pozycje paczki mogą zostać zapisane. Dialog wysyła wybór jako nową operację;
UUID, dane i decyzja są trwale zapisywane razem. Odcisk operacji obejmuje
również decyzję. Retry zastąpienia zwraca wynik z rejestru bez ponownej edycji,
także po późniejszej zmianie wydarzenia. Kontrola rodziny, uczestników
i prawa do zastąpienia obowiązuje również przed replay. Rejestr sukcesu
jest atomowy ze zmianą, więc błąd jego zapisu cofa również zastąpienie.
Stare operacje importu bez decyzji zachowują wcześniejszą semantykę.

## Przypomnienia

Opcjonalna data urodzin kontaktu (`birthday`, YYYY-MM-DD) automatycznie dodaje
do harmonogramu coroczne przypomnienie dla wszystkich domowników o 09:00
w strefie rodziny. Nie ma konfiguracji przypomnienia. Dla 29 lutego w latach
nieprzestępnych używamy 28 lutego. Alarmy wynikają z aktualnych kontaktów;
zmiana daty lub usunięcie kontaktu usuwa poprzedni alarm po synchronizacji.
Kliknięcie otwiera Kontakty. WWW służy do zapisu daty; alarm dostarcza Android.
Formularz rozdziela dzień i miesiąc (DD.MM) od opcjonalnego roku urodzenia.
Pełna data pozostaje w `birthday` (YYYY-MM-DD); bez roku zapisujemy wyłącznie
`birthdayMonthDay` (MM-DD), z pustym `birthday`, bez fikcyjnego roku. Pola te
są wzajemnie wykluczające. Starsze żądanie zmieniające `birthday` zastępuje
również datę bez roku; zapis pozostałych pól zachowuje obie reprezentacje.
Data jest widoczna na liście kontaktów i w szczegółach przy ikonie tortu,
w formacie DD.MM lub DD.MM.YYYY. Znany rok dodaje numer urodzin w bieżącym
roku w strefie rodziny. Alarm działa także bez roku urodzenia.
Nowy klient pobiera źródła `contact` przez `includeContacts=true`, więc starsze
APK zachowują dotychczasowy harmonogram. Stare żądania zapisu bez `birthday`
nie zmieniają daty, a stare snapshoty offline mogą nie zawierać tego pola.

Jedna tabela reminders i GET /api/reminders/schedule dla APK. Źródłem jest
dokładnie jedno wydarzenie, zadanie albo dokument; urodziny kontaktów są
wyliczane bez osobnego rekordu w reminders. Serwer wyznacza odbiorców
i terminy; Android zapisuje alarmy systemowe. Historyczne next_fire_at
i last_sent_at nie sterują dostarczaniem APK.

| Odbiorca     | Znaczenie                                                                                  | Źródła                |
| ------------ | ------------------------------------------------------------------------------------------ | --------------------- |
| participants | Uczestnicy, a bez nich twórca                                                              | Wydarzenia            |
| family       | Wszyscy domownicy                                                                          | Wydarzenia, dokumenty |
| adults       | Admin i member                                                                             | Wydarzenia, dokumenty |
| owner        | Twórca wydarzenia; przypisany zadania lub właściciel listy; posiadacz dokumentu lub twórca | Wszystkie             |
| list_members | Właściciel i członkowie listy                                                              | Zadania               |
| user         | Wyłącznie wskazana osoba („tylko ja”)                                                      | Wszystkie             |

Odbiorca musi widzieć źródło. Pusta lista daje awaryjnie adults, z wyjątkiem
zadań: dla nich brak odbiorców oznacza brak alarmu. Prywatne zadania mają
ogólną treść powiadomienia i autoryzację online przy otwarciu. Cofnięcie
dostępu dociera do telefonu dopiero po udanej synchronizacji.

Wspólne przypomnienia edytuje osoba uprawniona do źródła. Osobiste są
zapisywane osobno wyłącznie dla siebie; edycja źródła nie usuwa cudzych.
Offsety dni/tygodni/miesięcy liczymy kalendarzowo w strefie rodziny;
bez godziny bazą jest 09:00. Offset podąża za terminem, absolute nie.
Minione absolute staje się nieaktywne. Zmiany terminu, ukończenia zadania,
odnowienia dokumentu i serii przeliczają przypomnienia.

## Interfejs

Kierunek „Ciepły i przyjazny”: kremowe tło, szałwiowe akcenty, jasne karty,
delikatne obramowania, szeryfowe tytuły; istniejący motyw Mantine jest źródłem
tokenów. Referencja: [MagicPath](https://www.magicpath.ai/files/463387065032278016).
Nie kopiujemy atrap funkcji ani dodatkowego systemu UI.

Od 768 px menu po lewej ma 240 px. Węższa WWW i APK mają hamburger po prawej
i panel z prawej. Kolejność: Kalendarz, Zadania, Zakupy, Obiady, Rodzina,
Kontakty, Dokumenty, Powiadomienia, Wersja aplikacji; konto i wylogowanie na dole.
Tytuł pozostaje w treści. Stare adresy /wiecej zachowują zgodność.
Wymagane: fokus, etykiety, klawiatura, cele 44×44 px, kontrast 4,5:1
(duży tekst 3:1), safe area i systemowy Wstecz. Kolor nie jest jedynym
oznaczeniem stanu, a banery nie zasłaniają treści ani menu.
