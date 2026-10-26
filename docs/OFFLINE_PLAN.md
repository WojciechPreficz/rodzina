# Plan wspólnej obsługi offline

Data: 26.10.2026. Status: O.1 opracowany lokalnie, oczekuje na CI;
O.2 zaimplementowany lokalnie, oczekuje na końcowe CI i odbiór fizycznego APK;
O.3 zaimplementowany lokalnie, oczekuje na odbiór fizycznego APK i końcowe CI;
O.4 zaimplementowany lokalnie, oczekuje na odbiór fizycznego APK i końcowe CI;
O.5 zaimplementowany lokalnie, oczekuje na odbiór fizycznego APK i końcowe CI;
O.6 zaimplementowany lokalnie, oczekuje na odbiór fizycznego APK i końcowe CI;
O.7 do realizacji. Zakupy i zadania używają wspólnego outbox i jednego nadawcy.

## 1. Cel i kolejność prac

Tworzymy jedno miejsce odpowiedzialne za trwały zapis danych konta, kolejkę
oczekujących operacji (outbox), synchronizację i jej stan. Moduły dołączają przez
adaptery opisujące własne dane i operacje. Dodanie modułu nie powinno wymagać
pisania kolejnego mechanizmu retry, koordynacji kart ani ochrony sesji.

To osobny ciąg kroków O.1–O.7. Obowiązują sekcje 1, 1.1 i 1.2
[planu projektu](plan.md): jeden krok na czat i commit, kontrole lokalne dobrane
do zmiany oraz końcowe CI i wymagane próby fizycznego Androida.
Zapisanie planu i utworzenie issues nie oznacza wykonania tych kroków.

O.1–O.7 kończymy **przed krokiem 6.5 — Obiady offline**. Kroki obiadów 6.1–6.4
mogą wcześniej dostarczyć funkcje online. Krok 6.5 wykorzysta gotowy rdzeń
i doda adapter obiadów oraz eksport do zakupów. Nie przebudowuje wtedy innych
magazynów. Nie zmieniamy numeracji ani statusów dotychczasowych faz.

Plan rozwija propozycję „wspólny outbox i IndexedDB (etap B)” z 25.10.2026
w [DECISIONS.md](DECISIONS.md). O.1–O.7 zastępują jej roboczy podział B.1–B.7;
nie są drugim, równoległym projektem. Uwzględniamy dodane później kontakty
i zależności przyszłego eksportu obiadów.

## 2. Stan wyjściowy

| Obszar                  | Obecne rozwiązanie                                                                         | Stan docelowy                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Zakupy                  | TanStack Query, persister i dziennik w `shoppingOffline.ts`                                | Adapter wspólnej kolejki; Query jako cache UI                          |
| Zadania                 | Własny magazyn, dziennik, synchronizacja i stany wymagające sprawdzenia w `taskOffline.ts` | Adapter tej samej kolejki, z zachowaniem ograniczeń i alarmów          |
| Kalendarz               | `calendarOffline.ts` i `calendarSync.ts`, zapis zakresów i szczegółów                      | Wspólna pamięć trwała; zakresy i pobieranie specyficzne dla kalendarza |
| Rodzina i sesja offline | `offlineData.ts`, ostatnio pobrani domownicy i kod dołączenia                              | Wspólna pamięć trwała oraz asynchroniczne odtwarzanie sesji            |
| Kontakty                | `contactsOffline.ts`, wersjonowana kopia tylko do odczytu                                  | Adapter wspólnej pamięci trwałej, bez kolejki edycji                   |
| Dokumenty               | Zarządzanie online, osobny podgląd przypomnień w APK                                       | Bez rozszerzenia zakresu offline                                       |
| Obiady                  | Plan fazy 6, w tym osobny krok 6.5                                                         | Przyszły adapter, dopiero w fazie 6                                    |

Istnieją już wspólne elementy: `connectivity.ts`, `accountStorage.ts`,
odtwarzanie sesji w `auth.tsx`, ustawienia Query w `queryClient.ts`, limit
wieku operacji w `packages/shared/src/offline.ts` i serwerowy mechanizm
idempotencji w `apps/api/src/http/idempotency.ts`. Rozwijamy je zamiast
tworzyć drugą obsługę kont, połączenia lub idempotencji API.

## 3. Architektura docelowa

### Rdzeń i adaptery

Rdzeń umieszczamy w `apps/web/src/offline/`. Przewidywany podział:

- `database` — wersjonowana IndexedDB, transakcje, budżety, import starych danych;
- `registry` — rejestr adapterów i ich możliwości: podgląd albo podgląd i zapis;
- `outbox` — trwałe operacje, kolejność, zależności oraz ich stany;
- `sync` — jeden nadawca konta, retry, zatrzymywanie i wznawianie;
- `session` — kontekst konta, generacje i integracja z istniejącym auth;
- `status` — wspólne dane dla hooków i komunikatów UI.

Nazwy plików doprecyzujemy w O.1. Produkcyjną infrastrukturę dodajemy razem
z pierwszym użytkownikiem; nie tworzymy nieużywanych adapterów na zapas.

Adapter pozostaje przy danym module w `features/`. Określa wersjonowane
schematy danych i operacji, pobieranie, transport do API, lokalną projekcję
zmian oraz interpretację błędów. To on zna uprawnienia, zakresy kalendarza,
reguły zakupów czy wpływ zadania na alarmy. Rdzeń nie zna pól formularzy
ani zasad scalania składników.

### Trwała pamięć i odczyt

- Jedna wersjonowana baza IndexedDB dla danego originu, z magazynami cache,
  outbox, metadanych i migracji. Każdy rekord danych ma konto
  `familyId:userId`, moduł i wersję schematu. WWW i APK mają oddzielne magazyny;
  dane między urządzeniami uzgadnia API.
- Rozdzielamy potwierdzony stan serwera od projekcji oczekujących zmian.
  Ponowne odtworzenie lub refetch nie może podwójnie zastosować operacji ani
  usunąć lokalnych zmian. TanStack Query nie jest źródłem prawdy kolejki.
- Cache zawiera informację o czasie pobrania i kompletności zakresu.
  Niepobrana lista lub tydzień nie są pustymi danymi. Dane wymagane przez
  niewysłane operacje pozostają chronione przed zwykłym usuwaniem cache.
- O.1 ustala mierzalne budżety per moduł i rezerwę kolejki. Dawne 32 MiB
  z propozycji etapu B są punktem wyjścia do pomiarów, nie przyjętym limitem:
  nie uwzględniały kontaktów ani obiadów. Każdy nowy adapter deklaruje budżet.
- Brak miejsca może ograniczyć zbędny cache, ale nigdy automatycznie usunąć
  kolejkę. Nieudany trwały zapis oznacza błąd akcji w UI. Brak IndexedDB ma
  czytelny stan ograniczonej dostępności; nie uruchamiamy drugiego silnika
  zapisującego te same operacje do localStorage.
- Tokeny sesji i natywny harmonogram alarmów pozostają w obecnych magazynach
  Androida. Małe znaczniki koordynacji i wylogowania mogą zostać w localStorage.
  Preferencje urządzenia rozpatrujemy według ich obecnej polityki konta.

### Operacje i synchronizacja

- Wersjonowana koperta zawiera co najmniej `operationId`, `accountId`, `module`,
  `entityId`, `sequence`, `submittedAt`, `payload`, `status`, `attempts`,
  `nextAttemptAt` oraz ostatni błąd. Jawne `dependsOn` opisuje zależności,
  których nie wystarczy wyrazić kolejnością operacji jednej encji.
- ID generujemy raz przez `crypto.randomUUID()`. Przy retry i migracji
  zachowujemy ID, czas oraz identyfikatory lokalnie tworzonych obiektów.
  Zadaniowe `id` operacji mapujemy na `operationId`.
- Przyjęcie zmiany następuje po zatwierdzeniu jednej transakcji zapisującej
  operację, numer kolejności i lokalną projekcję. Zakończenie operacji zapisuje
  odpowiedź, uzgodniony stan i usunięcie wpisu kolejki również atomowo.
- Jeden aktywny nadawca na konto. Transakcyjna dzierżawa w IDB ma właściciela,
  termin ważności i generację; przejęcie po awarii unieważnia starego nadawcę.
  Sygnały między kartami przyspieszają odświeżanie, ale nie stanowią blokady.
  Generacja sesji dodatkowo odcina spóźnione odpowiedzi poprzedniego konta.
- Operacje jednej encji zachowują kolejność; zależności między modułami są
  jawne. Konflikt blokuje operację i jej zależności. Niezależne, gotowe
  operacje mogą być wysłane dalej przez tego samego nadawcę. O.1 definiuje
  deterministyczny wybór i odrzucanie cykli zależności.
- Błędy sieci, 429 i 5xx mają rosnący odstęp z losowym rozrzutem, trwały termin
  ponowienia i obsługę `Retry-After`, jeśli jest dostępny. Synchronizacja rusza
  przy starcie, odzyskaniu sieci i wznowieniu aktywnej aplikacji.
- Automatyczne ponawianie kończy się po 30 dniach. Stan wymagający sprawdzenia
  jest trwały i nie znika po korekcie zegara. Retencja odpowiedzi API nadal
  wynosi 90 dni. Awaria po wykonaniu na serwerze, przed lokalnym zatwierdzeniem,
  powoduje retry z tym samym ID, bez ponownego wykonania skutku.
- 401 i potwierdzona zmiana sesji zatrzymują cały kontekst konta. 403, 404 i 409
  interpretujemy według kodu błędu i adaptera. Nie nadpisujemy automatycznie
  serwera, nie odtwarzamy usuniętych danych i nie nadajemy nowego ID w retry.
  Cofnięcie dostępu do prywatnej listy usuwa niedozwolony podgląd; komunikat
  o odrzuconej zmianie nie ujawnia jej treści.

### Sesja, UI i Android

- Wykorzystujemy istniejący rejestr `accountStorage.ts`, dostosowując go do
  asynchronicznego usuwania. Najpierw zatrzymujemy nadawcę i unieważniamy
  kontekst, potem czekamy na czyszczenie danych, także roboczych danych migracji.
  Awaria czyszczenia nie może udawać pełnego usunięcia ani ujawnić starego konta.
- Zachowujemy politykę usuwania niewysłanych zmian przy wylogowaniu, utracie
  sesji i zmianie konta. Sygnał z innej karty odcina stary kontekst bez kasowania
  nowych danych tej karty. Nie przenosimy kolejki na inne konto.
- Hook statusu udostępnia stan połączenia, synchronizacji, czas pobrania danych,
  liczbę zmian oczekujących i wymagających sprawdzenia oraz błąd pamięci.
  Z tych samych danych korzystają banery modułów. Ich treść pozostaje po polsku.
- Dla zadań zachowujemy trwałe wstrzymywanie alarmów zmienionych lokalnie
  i uzgadnianie harmonogramu po synchronizacji. Nie przenosimy planowania
  alarmów do ogólnej kolejki mutacji.
- WWW obsługuje utratę sieci w otwartej aplikacji; APK także restart offline
  po wcześniejszym pobraniu danych. Bez PWA, Web Push i obietnicy wysyłania
  zmian przy zamkniętym APK.

## 4. Bezpieczne przejście z obecnych magazynów

Migrację pamięci rozdzielamy od wymiany silnika kolejki. Najpierw zachowujemy
obecne zachowanie na IndexedDB, następnie przełączamy po jednym adapterze
na wspólny outbox. W danym momencie operację wysyła tylko jeden silnik.

1. Wstrzymać stare zapisy i synchronizację we wszystkich uczestniczących
   kartach. Starszy kod nie respektuje nowej blokady IDB. Sam brak odpowiedzi
   karty ani porównanie snapshotu nie dowodzą wyłączności. O.1 określi protokół
   aktualizacji i warunki wymaganego zamknięcia/przeładowania starych kart;
   jeśli nie da się jej zapewnić, migracja czeka. W razie potrzeby najpierw
   wydać zgodny mechanizm wstrzymywania w ramach O.2, przed aktywacją importu.
2. Zweryfikować konto, formaty, wszystkie źródła oraz miejsce na kopię roboczą.
   Zachować dziennik jako źródło operacji, zadaniowe wpisy odrzuceń i stany
   wymagające sprawdzenia. W zakupach rozpoznać już zastosowaną projekcję
   snapshotu, żeby import nie zastosował jej ponownie.
3. Zapisać import i znacznik w jednej transakcji, następnie odczytać i porównać
   wynik. Brakujące wpisy można odzyskać ze snapshotu; sprzeczne kopie lub
   nieczytelny dziennik wymagają jawnego zatrzymania, bez cichego pomijania.
   Remisy czasu i brak numerów sekwencji mają udokumentowaną regułę importu.
4. Po awarii wznowić import albo weryfikację na podstawie znacznika, bez
   ponownego dodawania operacji. Źródło zachować jako nieaktywną kopię wyłącznie
   do zakończenia weryfikacji, następnie usunąć. Nie stosować podwójnego zapisu.
5. Uruchomić nową ścieżkę dopiero po weryfikacji. Sprawdzić również aktualizację
   z pominięciem wydań pośrednich, nie tylko przejście z poprzedniego kroku.

Powrót po nowych zapisach wymaga wersji czytającej nowe dane. Nie obiecujemy
bezpiecznego powrotu do starego APK/localStorage bez migracji odwrotnej.
Dokumentujemy wspierane wersje i ograniczenia rollbacku. API zachowuje
zgodność z poprzednią wspieraną wersją APK. Kopia bazy serwera nie zabezpiecza
zmian, które są jeszcze wyłącznie na urządzeniu.

## 5. Kroki realizacji i kryteria

### O.1 — kontrakty, migracja i scenariusze odbioru

**Zależności:** brak; pierwszy krok planu.

Kontrakt, inwentaryzacja, budżety i macierz przypadków:
[OFFLINE_CONTRACT.md](OFFLINE_CONTRACT.md). Próbki źródłowe są w
`docs/offline/fixtures/`, test ich zgodności w `apps/web/src/offlineFixtures.test.ts`.

**Zakres:** zinwentaryzować aktualne formaty pięciu magazynów konta, obie
kolejki i integrację alarmów. Ustalić kontrakt adaptera, schemat IDB,
stany operacji, kolejność, zależności, dzierżawę, sygnał zmiany konta i protokół
wyłączności migracji. Dobrać budżety, strategię pomiaru i zapas migracji.
Przygotować zanonimizowane próbki wszystkich wspieranych formatów i mapowania
danych, bez produkcyjnego silnika tworzonego na zapas.

**Gotowe, gdy:** każdy format ma regułę importu, walidacji, deduplikacji,
kolejności oraz postępowania z błędem. Opisano start starej karty podczas
importu, uszkodzony dziennik, stan w locie, operacje stare i odrzucone,
cofnięcie uprawnień i zmianę konta. Budżety i warunki blokowania migracji
są konkretne. Przypadki testowe mają przypisany krok O.2–O.7.

### O.2 — wspólna pamięć dla rodziny, sesji offline i kalendarza

**Zależności:** O.1.

**Zakres:** dodać bazę i obsługę transakcji wraz z rzeczywistymi adapterami
rodziny/sesji i kalendarza. Wdrożyć wersjonowanie, budżety cache, limit
12 miesięcy kalendarza, import i jego koordynację. Dostosować auth i rejestr
czyszczenia do asynchronicznego odczytu/usuwania oraz jawnego sygnału konta.
Zakupy, zadania i kontakty pozostają przy swoich obecnych magazynach.

**Gotowe, gdy:** oba podglądy działają po migracji i restarcie offline.
Sprawdzone są awaria importu, blokada aktualizacji bazy, stara karta,
wylogowanie podczas odczytu/zapisu, brak miejsca i odmowa IDB.
Nie uruchamia się równoległy zapis do starego i nowego magazynu.
Próby UI przy 390 i 1280 px oraz podglądu w fizycznym APK są opisane i wykonane.

### O.3 — magazyn zakupów w IndexedDB

**Zależności:** O.2.

**Zakres:** przenieść snapshot, dziennik i odtwarzanie zakupów do wspólnej
pamięci, dostosowując pomost do asynchronicznych transakcji. Zachować silnik
mutacji TanStack i semantykę zakupów. Wdrożyć budżety i potwierdzanie zmiany
dopiero po trwałym zapisie. Nie zastępować jeszcze silnika synchronizacji.

**Gotowe, gdy:** zachowane są ID, czasy, kolejność, lokalne identyfikatory
list/produktów i projekcja bez podwójnego zastosowania. Testy pokrywają
rozbieżność snapshotu i dziennika, przerwaną migrację, restart offline,
utratę odpowiedzi, dwie karty, pełny magazyn i zmianę konta.
Tylko jedna ścieżka zapisuje i wysyła daną operację zakupów.
Próby WWW 390/1280 px i restartu fizycznego APK nie wykazują utraty zmian.

### O.4 — magazyny zadań i kontaktów w IndexedDB

**Zależności:** O.3.

**Zakres:** podłączyć zadania i kontakty do wspólnej pamięci. Zachować
dotychczasowy synchronizator zadań oraz ich wpisy odrzuceń, stany wymagające
sprawdzenia i blokady alarmów. Kontakty pozostają tylko do odczytu offline.
Nie tworzyć dla nich kolejki mutacji. Objąć oba adaptery budżetami i rejestrem
czyszczenia oraz przejściem ze wszystkich wspieranych wersji.

**Gotowe, gdy:** pięć magazynów danych konta korzysta ze wspólnej pamięci.
Zadania zachowują niewysłane zmiany, ich wiek i statusy, a kontakty ostatnią
pobraną kopię i czas pobrania. Testy obejmują cofnięcie udostępnienia,
spóźnioną odpowiedź, usunięty obiekt, brak miejsca i przerwaną migrację.
W fizycznym APK sprawdzono restart offline obu modułów i wstrzymanie alarmów.

### O.5 — wspólny outbox i adapter zakupów

**Zależności:** O.4.

**Zakres:** wdrożyć silnik od razu jako działającą obsługę zakupów. Dodać
kopertę, transakcje operacji i projekcji, zależności, dzierżawę nadawcy,
retry, limit wieku i stany wymagające reakcji. Przejąć kolejkę O.3 bez zmiany
ID i czasów. Wdrożyć wspólny hook statusu i wykorzystać go na ekranie zakupów.
Stary silnik wysyłania zakupów wyłączyć; Query pozostaje cache widoku.

**Gotowe, gdy:** zakupy działają od zapisu lokalnego do uzgodnienia z API
przez wspólny rdzeń. Testy obejmują przerwanie po sukcesie serwera, konflikt,
429/5xx i restart retry, przekroczenie 30 dni, korektę zegara, przejęcie
dzierżawy, równoległe karty i utratę sesji. Brak potwierdzenia transakcji
nie daje sukcesu UI. Odbiór WWW 390/1280 px i fizycznego APK potwierdza brak
duplikatów i spóźnionych zapisów poprzedniego konta.

### O.6 — zadania przez wspólny outbox

**Zależności:** O.5.

**Zakres:** dodać adapter zadań, przejąć dziennik O.4 i wyłączyć jego stary
synchronizator. Zachować wszystkie ograniczenia edycji, prywatność list,
obsługę zależności i alarmów. Podłączyć statusy oraz istniejące rozstrzyganie
starych zmian do wspólnych stanów. Sprawdzić harmonogram operacji zakupów
i zadań w jednej kolejce; nie dodawać operacji obiadów.

**Gotowe, gdy:** oba moduły korzystają z jednego nadawcy i tych samych zasad
retry, sesji oraz trwałego zapisu. Konflikt jednej encji nie gubi jej zależności
ani nie blokuje niezależnych operacji bez powodu. Testy obejmują cofnięcie
dostępu i czyszczenie prywatnej treści, odrzucenia, restart, stare zmiany
i zmianę konta. Fizyczny Android potwierdza wstrzymanie i przywrócenie alarmów
po właściwym uzgodnieniu, także po restarcie urządzenia.

### O.7 — wspólny odbiór i instrukcja dodawania modułów

**Zależności:** O.6; krok zamyka plan i poprzedza 6.5.

**Zakres:** wykonać odbiór całej migracji, usunąć nieużywane silniki i pomosty,
zachowując importer wspieranych wersji. Ujednolicić dostępne statusy podglądów
i kolejek. Dodać instrukcję adaptera z rzeczywistych zakupów/zadań: schematy,
budżet, projekcja, transport, błędy, czyszczenie i testy. Opisać wsparcie
aktualizacji WWW/APK i rollback w dokumentacji utrzymania.

**Gotowe, gdy:** przeszły scenariusze z sekcji 7, wymagane próby fizycznego
APK oraz wszystkie zadania CI końcowego commita. Zmierzono budżety, zweryfikowano
czyszczenie IDB, localStorage i obszaru migracji. Nowy moduł może dołączyć
adapterem bez drugiej kolejki i drugich listenerów sesji/sieci.
Checklistę przyszłego adaptera obiadów powiązano z 6.5, bez implementacji
tej fazy. Brakujące próby i oczekujące CI nie są oznaczone jako zaliczone.

## 6. Integracja przyszłych obiadów

Implementacja pozostaje w fazie 6. W O.1 projektujemy i w O.5–O.6 sprawdzamy
ogólne zależności operacji na istniejących modułach. Nie dodajemy pustego
adaptera ani przykładowego modułu obiadów do produkcyjnej aplikacji.

W 6.5 adapter obiadów zapisze pobrane tygodnie, składniki i lokalne podpowiedzi,
obsłuży dozwolone zmiany i kartę „Dziś na obiad”. Eksport składników będzie
**jedną operacją wspólnego outbox**, należącą do adaptera obiadów i wywołującą
atomowy endpoint API. Adapter zakupów udostępni uzgodnienie lokalnej projekcji
docelowej listy; nie dopisze drugiej operacji wysyłającej ten sam eksport.

Operacja zachowa kopię składników z chwili zlecenia, konto, listę i stałe ID.
Zależności uwzględnią wcześniejsze operacje niezbędne do jej wykonania,
np. utworzenie lokalnej listy. Późniejsza edycja dania nie zmieni kopii.
Po odpowiedzi serwera obie projekcje zostaną uzgodnione atomowo; ponowienie
nie zwiększy ilości drugi raz. Gdy wynik zależy od reguł scalania serwera,
UI oznaczy lokalny wynik jako oczekujący, bez udawania ostatecznej odpowiedzi.

Rdzeń nie rozstrzyga otwartych pytań fazy 6: ponownego ręcznego eksportu
tych samych dań i scalania z kupionymi pozycjami. Ich uzgodnienie pozostaje
warunkiem implementacji kroku 6.2. Nie blokuje prac O.1–O.7.

## 7. Weryfikacja i granice zakresu

W każdym kroku implementacyjnym: testy zmienionego modułu i rdzenia, lint
i formatowanie zmienionych plików oraz typecheck. Dla samego planowania:
przegląd treści, linków, diffu i formatowania, bez testów aplikacji.
Plany, kontrakt i próbki JSON są objęte kontrolą formatowania projektu od O.1.
Pełną weryfikację automatyczną końcowego commita wykonuje istniejące CI
zgodnie z sekcją 1.2 planu. Nie zastępuje ona wymaganych prób telefonu.

Minimalna macierz odbioru O.7:

- aktualizacja ze wspieranej wersji localStorage, także z pominięciem etapów;
- migracja offline z niewysłanymi operacjami, starymi wpisami i odrzuceniami;
- przerwanie procesu przed i po zatwierdzeniu importu oraz odpowiedzi serwera;
- ponowne otwarcie APK offline, zmiany, zamknięcie, ponowny start i sync;
- dwie karty, start starej karty, wygaśnięcie dzierżawy i późna odpowiedź;
- pełny magazyn, odmowa IDB, uszkodzony cache i dziennik oraz blokada wersji bazy;
- wylogowanie, utrata sesji i zmiana konta podczas migracji lub wysyłki;
- cofnięcie dostępu, konflikty, 429/5xx i przekroczenie limitu wieku operacji;
- alarmy zadań na fizycznym Androidzie, w tym restart urządzenia;
- Playwright wyłącznie headless przy 390 i 1280 px oraz przegląd wyglądu
  stanów offline, oczekiwania, błędu pamięci i zmian wymagających sprawdzenia.

Przed commitem/pushem i przy oczekującym CI: „zweryfikowane lokalnie,
oczekuje na CI”, z jawną listą niewykonanych prób. Deploy serwera i wydanie
APK pozostają osobnymi czynnościami na polecenie właściciela.

**Poza zakresem:** implementacja obiadów, eksportu i innych nowych funkcji;
edycja offline kalendarza, rodziny, kontaktów i dokumentów; PWA/Web Push;
praca kolejki przy zamkniętym APK; zmiana polityki kasowania zmian przy
wylogowaniu; zmiana bazy API, hostingu i mechanizmu alarmów. Nowe wymagania
runtime/config/crona, jeśli okażą się konieczne, podlegają sekcji 1.1 planu.

## 8. Zadania GitHub

Zadania wykonujemy kolejno O.1 → O.2 → O.3 → O.4 → O.5 → O.6 → O.7.
Każde ma własny zakres i kryteria z sekcji 5. O.1 jest opracowany lokalnie
i oczekuje na CI końcowego commita; pozostałe kroki nie są wykonane.

| Krok | Zadanie                                                     | Zakres                                                 |
| ---- | ----------------------------------------------------------- | ------------------------------------------------------ |
| O.1  | [#49](https://github.com/WojciechPreficz/rodzina/issues/49) | kontrakty, migracja i scenariusze odbioru              |
| O.2  | [#50](https://github.com/WojciechPreficz/rodzina/issues/50) | wspólna pamięć dla rodziny, sesji offline i kalendarza |
| O.3  | [#51](https://github.com/WojciechPreficz/rodzina/issues/51) | magazyn zakupów w IndexedDB                            |
| O.4  | [#52](https://github.com/WojciechPreficz/rodzina/issues/52) | magazyny zadań i kontaktów w IndexedDB                 |
| O.5  | [#53](https://github.com/WojciechPreficz/rodzina/issues/53) | wspólny outbox i adapter zakupów                       |
| O.6  | [#54](https://github.com/WojciechPreficz/rodzina/issues/54) | zadania przez wspólny outbox                           |
| O.7  | [#55](https://github.com/WojciechPreficz/rodzina/issues/55) | wspólny odbiór i instrukcja dodawania modułów          |

Krok [6.5 — Obiady offline (#48)](https://github.com/WojciechPreficz/rodzina/issues/48)
realizujemy po O.7 (#55) i kroku 6.4 (#10). Zadanie nadrzędne obiadów:
[#6](https://github.com/WojciechPreficz/rodzina/issues/6).
