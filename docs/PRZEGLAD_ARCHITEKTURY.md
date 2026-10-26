# Przegląd architektury i propozycje usprawnień

Data: 26.10.2026. Stan kodu podczas przeglądu: `0a9b7d9`.

**Status: propozycje do zaplanowania; niezaimplementowane.** Dokument opisuje cztery pozostałe problemy
z przeglądu oraz dodatkową rozbieżność w dokumentacji sterownika SQLite. Nie zmienia
zakresów i statusów faz w [planie](plan.md), nie zatwierdza decyzji architektonicznych
ani wdrożenia. Każdą przyszłą zmianę należy realizować jako osobny, wskazany krok.
Decyzje wykraczające poza obecne ustalenia należy wtedy zapisać w [DECISIONS.md](DECISIONS.md).

Podstawowy układ pozostaje odpowiedni: modularny monolit Fastify, SQLite, kontrakty
Zod w `packages/shared` i wspólny frontend React dla WWW oraz APK. Propozycje zachowują
ograniczenia cPanel i Passengera: bez stałego procesu w tle, Redisa, WebSocketów i PWA.

## Kolejność i zakres

Kolejność poniżej odpowiada przeglądowi i proponowanej kolejności prac.
Punkty 2–3 dotyczą niezawodności i ochrony logowania. Numeracja pozostałych punktów jest zachowana. Punkt 4 opisuje ryzyko wydajności
wymagające pomiarów, punkt 5 koszt utrzymania, a punkt 6 zgodność dokumentacji z kodem.

| Punkt | Problem                                                   | Oczekiwany rezultat                                                   |
| ----- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| 2     | Przeterminowana operacja blokuje kolejkę zadań            | Niezależne zmiany i odczyt działają mimo operacji wymagającej decyzji |
| 3     | Limity logowania tylko w pamięci                          | Wspólne liczniki przetrwają restart procesu                           |
| 4     | Synchronizacja pobiera całe zbiory wieloma żądaniami      | Mniej żądań HTTP i zapytań SQL, potwierdzone pomiarami                |
| 5     | Sesja jest związana z modułami funkcjonalnymi             | Osobne zarządzanie sesją i koordynowanie modułów                      |
| 6     | Dokumentacja obiecuje prostszą wymianę sterownika niż kod | Jawnie opisane zależności od synchronicznego SQLite                   |

## 2. Przeterminowana operacja blokuje całą kolejkę zadań

### Stan i skutki

W [taskOffline.ts](../apps/web/src/features/tasks/taskOffline.ts) synchronizacja bierze
zawsze pierwszy wpis dziennika. `assertOfflineReplayAge` jest wywoływane przed obsługą
błędu pojedynczej operacji. Po przekroczeniu 30 dni wyjątek kończy synchronizację,
a wpis pozostaje na początku. Nowsze zmiany, także innych zadań, nie są wysyłane.
Nie dochodzi też do późniejszego pobrania aktualnych zadań z serwera.

Istniejący test potwierdza zachowanie starej operacji bez ponownej wysyłki, ale nie sprawdza
kontynuacji kolejki ani drogi rozwiązania problemu w UI. Obecny interfejs pokazuje błąd
i liczbę oczekujących zmian, bez akcji rozstrzygnięcia przeterminowanej operacji.

### Proponowana implementacja

1. Dodać trwały stan operacji wymagającej decyzji, np. `needs-review`, z przyczyną.
   Zachować oryginalne dane, identyfikator i czas utworzenia. Dostosować odczyt starszego
   dziennika tak, aby istniejące wpisy były traktowane jako oczekujące.
2. Przenieść rozpoznawanie przeterminowania do obsługi pojedynczej operacji. Taki wpis
   wyłączyć z automatycznej wysyłki i kontynuować niezależne operacje. Nie zmieniać
   automatycznie daty ani identyfikatora, aby ominąć limit bezpiecznego ponawiania.
3. Wstrzymywać także późniejsze operacje zależne od nierozstrzygniętej zmiany tego samego
   zadania, zwłaszcza gdy pierwszą zmianą było jego utworzenie. Zachować kolejność tych
   zmian; nie wysyłać edycji zasobu, którego utworzenie zostało wstrzymane.
4. Oddzielić pobranie aktualnego stanu serwera od powodzenia całej kolejki. Pokazywać
   potwierdzone dane i osobno lokalne zmiany wymagające sprawdzenia. Nie nakładać ich
   na dane serwera tak, jakby były już zaakceptowane.
5. Dodać w UI listę takich zmian z możliwością obejrzenia danych i odrzucenia wybranego
   łańcucha po potwierdzeniu. Ponowne wprowadzenie ma wymagać aktualnego odczytu,
   uprawnień i świadomego zapisu przez użytkownika jako nowej operacji.
6. Uwzględnić nowy stan w czyszczeniu konta, obsłudze wielu kart i w `blockedTasks`
   lokalnego harmonogramu. Nierozstrzygnięta zmiana terminu lub usunięcie zadania nadal
   muszą wstrzymywać odpowiednie alarmy po restarcie APK.

**Pliki:** `apps/web/src/features/tasks/taskOffline.ts`, `taskQueries.ts`, `TasksPage.tsx`,
powiązane testy, `apps/web/src/features/notifications/localSchedule.ts` i jego testy.
Wspólny limit w `packages/shared/src/offline.ts` pozostaje zachowany.

### Weryfikacja i kryteria odbioru

- W kolejce ze starą operacją oraz świeżą zmianą innego zadania świeża zmiana trafia
  na serwer, a stara pozostaje dostępna do sprawdzenia. Pobieranie zadań nadal działa.
- Łańcuch utworzenie–edycja–usunięcie jednego zadania zachowuje zależności.
  Żadna przeterminowana zmiana nie jest automatycznie ponawiana z nowym identyfikatorem.
- Testy obejmują restart, dwie karty, błąd zapisu magazynu, utratę dostępu do listy,
  wylogowanie i spóźnioną odpowiedź poprzedniego konta.
- UI przechodzi próby przy 390 i 1280 px oraz w fizycznym APK. Próba telefonu obejmuje
  restart offline i wstrzymanie alarmów dla nierozstrzygniętych zmian.

## 3. Limity logowania są przechowywane tylko w pamięci procesu

### Stan i skutki

[auth/service.ts](../apps/api/src/modules/auth/service.ts) utrzymuje liczniki w globalnym
`Map`, według pary IP–konto. Obecny limit wynosi 10 prób w 15 minut i dotyczy logowania
hasłem oraz PIN-em. Restart procesu zeruje historię, a oddzielne procesy Passengera
nie współdzielą liczników. Wygasłe klucze są odnawiane dopiero przy kolejnym użyciu;
nieużywane wpisy nie są usuwane z mapy.

Jest to potwierdzona właściwość implementacji. Przegląd nie potwierdza obejścia ochrony
na serwerze produkcyjnym ani sposobu nadpisywania nagłówków proxy przez hosting.

### Proponowana implementacja

1. Dodać tabelę SQLite, np. `auth_rate_limits`, z kluczem zakresu limitu, licznikiem
   i końcem okna w ms UTC oraz indeksem czasu wygaśnięcia. Wygenerować i commitować migrację.
2. Wydzielić repozytorium i serwis limitowania. W krótkiej transakcji `immediate`
   atomowo sprawdzać okno i zwiększać licznik przed kosztowną weryfikacją Argon2.
   Transakcja nie może obejmować `await` weryfikacji hasła lub PIN-u.
3. W pierwszym kroku zachować obecny próg, okno i rozróżnienie kont hasłowych oraz dzieci.
   Klucz może zawierać skrót znormalizowanego identyfikatora i IP, zamiast surowego adresu
   e-mail. Odpowiedź nadal ma status 429 i obecny polski kontrakt błędu.
4. Przejrzeć ustalanie `request.ip` oraz granicę zaufania `trustProxy` w warunkach hostingu.
   Skuteczność klucza IP wymaga wiarygodnego adresu klienta. Ewentualny dodatkowy limit
   łączny IP lub konta zaplanować osobno, z uwzględnieniem wspólnego IP domowników
   i możliwości zablokowania konta przez cudze próby.
5. Usuwać wygasłe rekordy istniejącym jobem utrzymaniowym przy backupie. Odczyt limitu
   musi sam rozpoznawać wygaśnięcie, więc opóźnienie crona nie przedłuża blokady.
   Uzupełnić opis utrzymania w `docs/DEPLOY.md`, bez dodawania procesu w tle.

**Pliki:** moduł auth i nowe pliki serwisu/repozytorium limitów, `apps/api/src/db/schema.ts`,
migracja w `apps/api/drizzle/`, `apps/api/src/jobs/backup-db.ts`, testy auth, migracji
i sprzątania oraz `docs/DEPLOY.md`.

### Weryfikacja i kryteria odbioru

- Jedenasta nieudana próba jest blokowana także po ponownym otwarciu tej samej bazy.
  Dwa połączenia z plikiem SQLite widzą wspólny limit; równoczesne próby nie gubią zliczeń.
- Testy obejmują granicę wygaśnięcia, logowanie hasłem i PIN-em, poprawne logowanie,
  rozdzielenie kluczy oraz sprzątanie starych wpisów.
- Lokalny `release:smoke` potwierdza migrację i działanie paczki. Nowy stan nie wymaga
  zmiany APK ani nowych usług na hostingu.

## 4. Synchronizacja pobiera całe zbiory wieloma żądaniami

### Stan i skutki

[taskQueries.ts](../apps/web/src/features/tasks/taskQueries.ts) uruchamia synchronizację
co 20 sekund. `TaskPrefetch` jest montowany globalnie przez `AuthProvider`, a widoki
zadań również używają tego hooka. Store współdzieli trwającą synchronizację, ale każde
użycie hooka zakłada własne subskrypcje i interwał.

Bez zapisów w kolejce jeden przebieg store wykonuje odczyt sesji, list oraz osobny odczyt
wszystkich zadań dla każdej listy. Jest to `2 + L` żądań dla `L` list, niezależnie od
odświeżania sesji w samym providerze. Androidowy
[RodzinaApiPlugin](../android/app/src/main/java/pl/preficze/rodzina/RodzinaApiPlugin.java)
wykonuje żądania w jednym executorze, z limitem 20 sekund na wywołanie HTTP.

W [repozytorium wydarzeń](../apps/api/src/modules/events/repository.ts) odczyt listy
wykonuje kolejne zapytania o uczestników, przypomnienia i wyjątki dla każdego wydarzenia.
Generowanie harmonogramu korzysta z tego odczytu i dodatkowo pobiera przypomnienia osobiste.
To ryzyko rosnącego kosztu, a nie wynik wykonanego testu obciążeniowego.

### Proponowana implementacja

1. Zmierzyć bazową liczbę żądań, czas synchronizacji, rozmiar odpowiedzi i liczbę zapytań
   SQL na stałym zestawie danych, np. 1, 10 i 30 list oraz rosnącej liczbie wydarzeń.
   Osobno uwzględnić WWW, APK, wznowienie aplikacji i wolną odpowiedź API.
2. Dodać zbiorczy odczyt zadań, np. `GET /api/tasks/snapshot`, zwracający wyłącznie dostępne
   listy i ich zadania z jednego spójnego odczytu bazy. Kontrakt opisać w shared,
   a starych endpointów nie usuwać ze względu na wspierane starsze APK.
3. Sprawdzenie tożsamości przed ponawianiem operacji zachować. Zbiorczy snapshot może
   zastąpić pobranie list oraz ich zawartości, ale nie może omijać kontroli uprawnień
   przed zapisem ani przy zwracaniu zapisanej odpowiedzi idempotentnej mutacji.
4. Dla wydarzeń pobierać relacje grupowo, według identyfikatorów należących do rodziny,
   i składać je w pamięci. Uwzględnić ograniczenie liczby parametrów SQL przez porcjowanie.
   Podobnie ograniczyć odczyty przypomnień przy generowaniu harmonogramu.
5. Oddzielić subskrybowanie danych od uruchamiania synchronizacji. Pozostawić jednego
   właściciela interwału na konto, wspólne wywołanie w toku i ponawianie po odzyskaniu sieci.
   Szczegółowe wydzielenie koordynatora opisuje punkt 5.
6. Najpierw zachować szeregowość natywnego transportu. Ewentualna współbieżność wymaga
   osobnego projektu kolejności logowania, zapisu cookie i wylogowania. Dalsze zmiany,
   takie jak synchronizacja przyrostowa, wynikają dopiero z pomiarów po optymalizacji.

**Pliki:** moduły tasks, events i reminders w API, kontrakt snapshotu w shared,
`taskOffline.ts`, `taskQueries.ts` oraz powiązane testy. Natywny transport jest miejscem
pomiaru; jego przebudowa nie jest warunkiem pierwszej optymalizacji.

### Weryfikacja i kryteria odbioru

- Liczba żądań do pobrania snapshotu nie rośnie z liczbą list. Liczba zapytań do relacji
  wydarzeń rośnie co najwyżej z liczbą porcji, zamiast osobno dla każdego wydarzenia.
- Pomiary przed i po są wykonane na tych samych danych; raport zawiera również rozmiary
  odpowiedzi. Sam spadek liczby żądań nie dowodzi krótszego czasu synchronizacji.
- Testy obejmują prywatne listy, cofnięcie udostępnienia, izolację rodzin i przypomnienia
  osobiste. Błąd lub częściowa odpowiedź nie zastępują kompletnego cache.
- Próby WWW i fizycznego APK potwierdzają wznowienie, utratę sieci i zmianę konta.
  Starsze wspierane APK nadal korzysta z dotychczasowych kontraktów.

## 5. Zarządzanie sesją jest związane z modułami funkcjonalnymi

### Stan i skutki

[auth.tsx](../apps/web/src/auth.tsx) obsługuje sesję, odtworzenie danych rodziny,
persystencję zakupów, aktywację magazynów offline, prefetching oraz synchronizację alarmów.
Dodawanie modułu wymaga zmian w centralnej obsłudze sesji. Istnieje również zależność
w obu kierunkach: `auth.tsx` importuje `TaskPrefetch`, a `taskQueries.ts` importuje `useMe`
z `auth.tsx`. Taki układ komplikuje testy i ocenę kolejności inicjalizacji.

[accountStorage.ts](../apps/web/src/accountStorage.ts) zawiera już rejestr magazynów
z kolejnością czyszczenia. To przydatna podstawa; nie trzeba zastępować wszystkich
magazynów jednym nowym mechanizmem persystencji.

### Proponowana implementacja

1. Wydzielić kontekst, typ stanu sesji i hook odczytu do niezależnego modułu, np.
   `sessionContext.ts`. Moduły funkcjonalne mają importować ten kontrakt, bez importowania
   komponentu providera ani koordynatora.
2. Ograniczyć provider do stanu tożsamości i operacji sesji. Odtwarzanie cache oraz
   przejścia konta kierować przez jawny koordynator, np. `accountLifecycle.ts`.
   Rozszerzyć istniejący rejestr wyłącznie o rzeczywiście potrzebne operacje.
3. Rejestrację adapterów magazynów wykonać jawnie w miejscu składania aplikacji.
   Adaptery zachowują obecne formaty danych, walidację i zabezpieczenia generacji;
   koordynator ustala kolejność, zamiast znać szczegóły każdego magazynu.
4. Przenieść `TaskPrefetch`, `CalendarPrefetch` i `ScheduleSync` do osobnego komponentu
   uruchamianego wewnątrz providera sesji. Zapewnić jedną rejestrację synchronizacji
   na konto oraz pełne usunięcie interwałów i listenerów przy zmianie konta i odmontowaniu.
5. Zachować jawne rozróżnienie wylogowania, utraty sesji, zmiany konta i zdarzenia storage
   z innej karty. To ostatnie nie może usuwać świeżo zapisanych danych drugiej karty.
   Zachować też wcześniejsze unieważnianie generacji magazynów i alarmów oraz zatrzymanie
   persystencji przed czyszczeniem zapytań.

**Pliki:** `apps/web/src/auth.tsx`, `accountStorage.ts`, miejsce składania aplikacji
w `router.tsx` lub `main.tsx`, proponowane moduły kontekstu i koordynatora, importy hooka
sesji w modułach oraz testy przejść konta i synchronizacji.

### Weryfikacja i kryteria odbioru

- Kontekst sesji nie importuje modułów funkcjonalnych. Provider nie importuje ich magazynów
  ani komponentów synchronizacji; jawne składanie zależności następuje wyżej.
- Testy regresyjne obejmują start offline, wylogowanie offline, zmianę konta, utratę sesji,
  komunikację kart oraz opóźnione odpowiedzi i zapisy poprzedniego konta.
- Po ponownym montowaniu oraz zmianie konta nie pozostają nadmiarowe interwały i listenery.
  Testy uwzględniają cykl montowania w React Strict Mode.
- Refaktoryzacja zachowuje formaty cache i kontrakty API. Próby WWW oraz fizycznego APK
  potwierdzają odtworzenie danych i czyszczenie alarmów przy wylogowaniu.

## 6. Dokumentacja zawyża wymienność sterownika SQLite

### Stan i skutki

[ARCHITECTURE.md](ARCHITECTURE.md) deklaruje możliwość zamiany `better-sqlite3`
na `@libsql/client` przez zmianę jednego pliku. Tymczasem `DatabaseConnection` udostępnia
konkretny typ `BetterSQLite3Database` oraz natywne połączenie `Database.Database`.
Idempotencja używa bezpośrednio `database.sqlite.prepare()` i transakcji `immediate`,
migracje korzystają z migratora właściwego dla sterownika, a repozytoria i serwisy zakładają
synchroniczne operacje. Backup używa `VACUUM INTO`. Zmiana sterownika wymagałaby zatem
analizy i zmian w wielu miejscach, w tym ponownego potwierdzenia atomowości.

### Proponowana implementacja

1. W osobnym kroku dokumentacyjnym poprawić opis: `client.ts` centralizuje otwieranie
   połączenia, ale aplikacja świadomie zależy od synchronicznego SQLite przez Drizzle
   i `better-sqlite3`. Utrwalić korektę wcześniejszego założenia w `DECISIONS.md`.
2. Wymienić granice tej zależności: typy połączenia, migracje, transakcje, idempotencja,
   bezpośrednie SQL, backup oraz pakowanie binariów natywnych.
3. Pozostawić obecny sterownik. Abstrakcję wprowadzać dopiero przy konkretnej potrzebie
   migracji i po sprawdzeniu modelu transakcyjnego drugiego klienta. Samo ukrycie typów
   za interfejsem nie zapewnia zgodności synchronicznych i asynchronicznych zapisów.
4. Ewentualną przyszłą migrację zaplanować oddzielnie, wraz z dowodem atomowego zapisu
   mutacji i jej odpowiedzi idempotentnej, migracji schematu oraz spójnego backupu.

**Pliki w rekomendowanym kroku:** wyłącznie `docs/ARCHITECTURE.md` i `docs/DECISIONS.md`.
Ten dokument jedynie proponuje tę korektę i nie wprowadza jej w obowiązujących zasadach.

### Weryfikacja i kryteria odbioru

- Dokumentacja nie obiecuje wymiany sterownika w jednym pliku i wymienia rzeczywiste
  zależności. Lokalnie wystarczają przegląd treści, diffu i formatowania.
- Nie powstaje nowy adapter bazy, migracja danych ani zmiana runtime tylko w celu
  dopasowania kodu do nieaktualnej deklaracji.

## Zasady odbioru przyszłych zmian i stan weryfikacji przeglądu

Każdy punkt wymaga osobnego zakresu wykonawczego i odbioru zgodnie z sekcją 1.2
[planu](plan.md). Zmiany kodu wymagają odpowiednich testów, lint i formatowania zmienionych
plików oraz typecheck. Zmiany pakowania, migracji i jobów wymagają lokalnego
`release:smoke`. Pełną weryfikację automatyczną dla końcowego commita wykonuje istniejące CI.
Zmiany wspólnego UI wymagają prób przy 390 i 1280 px oraz odpowiednich prób fizycznego APK.

Podczas przeglądu stanu `0a9b7d9` przeszło 69 testów w sześciu plikach: regresje auth,
idempotencja, odbiorcy przypomnień, rejestr magazynów konta, zadania offline i kontakty offline.
Próby w sandboxie napotkały błąd `ENOENT` plików tymczasowych Vitest; ponowienie poza
sandboxem zakończyło się sukcesem. Wynik dotyczy istniejącego kodu i nie potwierdza
działania proponowanych rozwiązań. Nie wykonano pełnego CI, pomiarów obciążenia ani prób
fizycznego APK w ramach tego przeglądu.

Utworzenie tego dokumentu obejmuje wyłącznie dokumentację. Wszystkie propozycje pozostają
niezaimplementowane; nie zmienia to statusów istniejących faz ani ich odbiorów.
