# Kontrakt wspólnej obsługi offline — O.1

Data: 26.10.2026. Zadanie: [#49](https://github.com/WojciechPreficz/rodzina/issues/49).
Dokument określa kontrakt dla O.2–O.7 z [OFFLINE_PLAN.md](OFFLINE_PLAN.md).
O.1 dostarcza specyfikację i syntetyczne próbki; nie zmienia zapisu aplikacji.

## 1. Inwentaryzacja źródeł

Poniższe formaty wynikają z aktualnego kodu. Nazwa `v1` w kluczu nie oznacza,
że każdy zapis ma pole `version`. Źródło odczytujemy jako surowy tekst przed
uruchomieniem starych czytników, które mogą je zmienić lub usunąć.

| Moduł / klucz localStorage                              | Format i źródło                                                                                                             | Walidacja i mapowanie                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rodzina:offline-data:v1`                               | `version: 1`, `account`, `session: { user, family }`, opcjonalne `members`, `syncedAt`; `offlineData.ts`                    | Minimalny użytkownik: `id`, `familyId`, `displayName`, `color`, `role`. Konto równe `family.id:user.id`, członkowie z tej rodziny. Cache `family/session` i `family/members`; brak `members` oznacza niepobrane, `[]` pobraną pustą listę. Nie dopisujemy e-maila ani tokenu.                                                                                                    |
| `rodzina:calendar:v1`                                   | `version: 1`, `account`, `ranges`, `details`, `personal`, opcjonalne `distant`; `calendarOffline.ts`                        | Maksymalnie 12 zakresów. Miesiąc ma okno od pierwszego dnia minus 7 dni do pierwszego dnia następnego miesiąca plus 7 dni, nie tylko miesiąc kalendarzowy. Zachować `complete`, `stale`, `detailIds`, `syncedAt`, `usedAt`, szczegóły, wyjątki i osobiste przypomnienia. Powiązania rodziny/użytkownika sprawdzić także w danych. Warstwy świąt nie są danymi tego cache.        |
| `rodzina:contacts:v1`                                   | `version: 1`, `account`, `syncedAt`, `data: { ok: true, groups, contacts }`; `contactsOffline.ts`                           | Schematy shared, jedna grupa domyślna, unikatowe ID, kontakty wskazują istniejącą grupę tej samej rodziny. Cache `contacts/snapshot`, bez mutacji offline.                                                                                                                                                                                                                       |
| `rodzina:shopping:v1`                                   | TanStack `PersistedClient`: `timestamp`, `buster`, `session`, `clientState: { queries, mutations }`; `shoppingOffline.ts`   | `buster` równe kontu sesji, klucze query/mutacji zaczynają się od `['shopping', familyId, userId]`. Query zawiera `queryKey`, `queryHash`, `state.data` i stan Query. Mutacja zawiera `mutationKey`, `scope`, `state`, w tym `state.variables: { change, operationId, submittedAt }`. Cache może już zawierać skutki operacji; nie traktować go automatycznie jako czystej bazy. |
| `rodzina:shopping:v1:operation:<account>:<operationId>` | Pojedyncza odwodniona mutacja TanStack, jak powyżej                                                                         | Dziennik jest głównym źródłem intencji. Konto klucza, mutationKey i scope muszą się zgadzać; końcowe ID klucza równe `variables.operationId`. Zachować `change.id` tworzonych list/produktów. Nie polegać na kolejności `Object.keys(localStorage)`.                                                                                                                             |
| `rodzina:tasks:v1`                                      | Bez pola `version`: `account`, opcjonalne `lists`, `items: Record<listId, Task[]>`, opcjonalne `syncedAt`; `taskOffline.ts` | To baza potwierdzonych danych, bez projekcji kolejki. Schematy shared; `items[id]` musi odpowiadać liście, zadanie jej `listId`, lista rodzinie i dostępowi konta. Brak wpisu listy różni się od `[]`.                                                                                                                                                                           |
| `rodzina:tasks:v1:operation:<account>:<id>`             | `id`, `submittedAt`, `listId`, `taskId`, `change`, opcjonalne `status`, `reason`                                            | `change.type`: `create`, `update`, `remove`; payload zgodny z create/patch shared. Domyślny status `pending`. Status `needs-review` i powód `expired` lub `dependency` są trwałe. `id` staje się `operationId`, `taskId` pozostaje ID obiektu.                                                                                                                                   |
| `rodzina:tasks:v1:discard:<account>:<markerId>`         | `operationIds: UUID[]`, `listId`, `requiresRefresh: boolean`                                                                | Znacznik odrzucenia ma pierwszeństwo przed pozostającymi wpisami dziennika. Nie odtwarzać ich. Wymóg odświeżenia listy zachować nawet po usunięciu samych operacji. Znacznik nie jest nową operacją API.                                                                                                                                                                         |

Formaty mutacji zakupów zachowują wszystkie obecne warianty:
`createList`, `renameList`, `deleteList`, `add`, `edit`, `remove`, `clear`.
W wariancie `clear` nie ma `change.id`; encją porządkującą jest lista.
Nie zapisujemy nowych nieznanych wariantów jako pustych operacji.

Wersje źródłowe obsługiwane w tym planie: powyższe formaty, brak opcjonalnych
pól oraz zadania sprzed dodania `status`/`reason`. Inna wersja lub nieznany
kształt wymaga komunikatu o nieobsługiwanej aktualizacji. Nie zgadujemy formatu.

Poza importem danych domenowych pozostają:

- `rodzina:pending-logout` — znacznik blokujący odtworzenie sesji do czasu
  wykonania oczekującego wylogowania WWW; import nie może go omijać;
- natywne magazyny sesji i alarmów (`SessionStore`, `AlarmStore`), uprawnienia
  oraz systemowe ID powiadomień; nie kopiujemy tokenów do IndexedDB;
- preferencje urządzenia, np. warstwy świąt — zachowują własną obecną politykę.

### Alarmy zadań

`taskOperationBlocksAlarm` wskazuje usunięcie zadania albo zmianę `isDone`,
`dueDate` lub `dueTime`. Także wstrzymana operacja wymagająca sprawdzenia
blokuje alarm. `localSchedule.ts` odczytuje te ID przez `blockedTasks(account)`;
po zmianach otrzymuje zdarzenie `rodzina:tasks-changed`. Natywny zapis używa
rewizji, aby odrzucić stary harmonogram. Migracja nie może mieć chwili,
w której pending zniknął ze starego magazynu, a nowy nie blokuje jeszcze alarmu.
O.4 zachowuje ten interfejs, O.6 zmienia jego źródło na outbox.

## 2. Kontrakt adaptera i UI

To specyfikacja przyszłego interfejsu, bez dodawania produkcyjnych typów w O.1.
Rejestr nie przyjmuje dwóch adapterów o tym samym `module`.

| Element adaptera                                    | Kontrakt                                                                                                                                                                                                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `module`, `schemaVersion`, `capabilities`, `budget` | Stała nazwa i wersja; `read-only` albo `read-write`; deklarowany budżet i reguły usuwania cache.                                                                                                                                                                          |
| `parseCache`, `parseOperation`, `importLegacy`      | Walidacja struktury, konta i powiązań; wersjonowanie i czyste mapowanie źródła. Import nie wysyła API. Niepoprawny cache można odrzucić z komunikatem, ale nie wolno zgubić zależnej intencji. Nieczytelny dziennik blokuje import danego modułu.                         |
| `project(base, operations)`                         | Deterministyczna projekcja; bez sieci, zegara i generowania ID. Zmiany używają własnego `submittedAt`. Brak zakresu pozostaje brakiem, bez fabrykowania pustej listy. Operacje wymagające sprawdzenia mają widoczny stan, bez traktowania ich jako potwierdzonych danych. |
| `orderingKeys`, `dependencies`                      | Zasoby, których operacje nie mogą się wyprzedzać, i jawne zależności od istniejących operacji tego samego konta.                                                                                                                                                          |
| `prepare` / `send` / `classifyError`                | Potwierdzenie bieżącego konta i dostępu, budowa żądania z niezmiennym ID/payloadem i interpretacja kodów błędów. Żadnej drugiej pętli retry ani drugiego odbiornika sieci.                                                                                                |
| `reconcile`                                         | Przygotowanie zmian potwierdzonego cache i projekcji po odpowiedzi; transakcję wykonuje rdzeń. Refetch nie nadpisuje niewysłanych intencji.                                                                                                                               |
| `invalidateAccess`, `alarmBlocks`                   | Usunięcie niedozwolonej treści; tylko zadania podają blokady alarmów. Po skutecznym zapisie rdzeń publikuje status i powiadomienie harmonogramu.                                                                                                                          |

Wspólne API rdzenia: `activate(account)`, `read(module, key)`,
`enqueue(module, intent)`, `synchronize()`, `discard(operationIds)`,
`clearAccount(reason)`, `subscribeStatus()`. Operacje trwałego zapisu i odczytu
są asynchroniczne. `enqueue` rozwiązuje Promise dopiero po zatwierdzeniu
transakcji; wyjątek nie może zamknąć formularza jako poprawnie zapisanego.

Status globalny/modułu obejmuje: `offline`, `hydrating`, `migrating`,
`syncing`, `pendingCount`, `reviewCount`, `lastSyncedAt`, kompletność zakresu,
`storageIssue`, `sessionConfirmed`. UI nie otrzymuje treści innego konta.
Wszystkie komunikaty są po polsku. Nie ma obietnicy synchronizacji przy
zamkniętym APK; ponowne uruchomienie offline odtwarza trwały stan.

## 3. Schemat IndexedDB i wersjonowanie

Nazwa bazy: `rodzina-offline`, początkowa wersja IDB: `1`. Wersja bazy oznacza
układ magazynów/indeksów, `schemaVersion` rekordu oznacza jego format.
Zmiana schematu następuje w transakcji aktualizacji; `blocked` zatrzymuje start
migracji, a `versionchange` zamyka stare połączenie i wstrzymuje jego zapisy.

| Magazyn     | Klucz                           | Indeksy i zawartość                                                                                                                                                                                                                               |
| ----------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cache`     | `[accountId, module, key]`      | Indeksy `accountId`, `[accountId, module]`, `[accountId, module, usedAt]`. Rekord: `schemaVersion`, `payload`, `syncedAt` (lub null), `coverage`, `usedAt`, `chargedBytes`. `coverage`: `missing`, `partial`, `complete`.                         |
| `outbox`    | `[accountId, operationId]`      | Unikatowy `[accountId, sequence]`; indeksy `accountId`, `[accountId, module]`, `[accountId, status, nextAttemptAt]`. Wspólna koperta opisana poniżej.                                                                                             |
| `metadata`  | `[accountId, key]`              | Indeks `accountId`. Sekwencja, dzierżawa, generacja sesji, liczniki budżetu, tryb właściciela magazynu i zadaniowe blokady odświeżenia po odrzuceniu. Klucz konta `__origin__` zarezerwowany dla protokołu/wersji originu, bez prywatnych danych. |
| `migration` | `[accountId, module, importId]` | Indeksy `accountId`, `[accountId, module]`. Surowe źródła, ich skrót i lista kluczy, wynik mapowania, skrót celu, faza i postęp weryfikacji. Żadnych tokenów ani kopii do niechronionych logów.                                                   |

Początkowo można zachować `legacy-snapshot` i dziennik modułu jako wersjonowane
rekordy, aby O.3/O.4 zmieniały pamięć bez wymiany silnika. Metadane
`engine:<module>` mają dokładnie jedną wartość: `legacy-local-storage`,
`legacy-idb` albo `outbox-v1`. O.5/O.6 przełączają wartość i przejęte wpisy
atomowo; nie wysyłają ich równolegle.

Koperta operacji w wersji 1:

```text
schemaVersion, operationId, accountId, module, entityId, orderingKeys[],
sequence, submittedAt, payloadVersion, payload, dependsOn[], status,
attempts, nextAttemptAt, lastError, reviewReason
```

`sequence` jest dodatnią bezpieczną liczbą całkowitą nadawaną transakcyjnie
przez konto; nie zmienia się podczas retry. Wszystkie czasy to epoch ms,
daty domenowe pozostają `YYYY-MM-DD` według obecnych kontraktów. Brak wersji
bazowej API oznacza brak fikcyjnego `baseVersion` i brak obietnicy wykrywania
każdej równoległej edycji.

Statusy: `pending`, `sending`, `retry-wait`, `needs-review`. Powody przeglądu:
`expired`, `dependency`, `conflict`, `missing-base`, `ambiguous-order`,
`snapshot-only`. Sukces usuwa operację dopiero w transakcji uzgodnienia.
Odrzucenie jest osobną transakcją całego wskazanego łańcucha, z zachowaniem
`requiresRefresh`. Stan `sending` po restarcie/utracie dzierżawy wraca do
ponowienia z tym samym ID, nigdy do wygenerowania nowego ID.

## 4. Kolejność, współbieżność i błędy

- Zakupy serializują zasób `shopping:list:<listId>`, także `clear`, usuwanie
  i zmiany nazwy. Tworzenie listy używa jej lokalnego `change.id`. Dzięki temu
  usunięcie listy nie wyprzedzi oczekujących zmian jej produktów.
- Zadania serializują `tasks:list:<listId>:task:<taskId>`. Kolejne operacje
  tego zadania tworzą zależny łańcuch. Operacji list/udostępnień nie dodajemy
  do edycji offline. Operacja może deklarować kilka zasobów.
- `dependsOn` wskazuje tylko operacje tego samego konta, już zapisane lub
  przyjmowane w tej samej transakcji. Odrzucamy cykl, zależność własną i brakujące
  ID. Po sukcesie jedną transakcją usuwamy spełnione krawędzie z dzieci,
  uzgadniamy cache/projekcję i usuwamy rodzica. Nie zostają wiszące odwołania.
- Wysyłamy najmniejszy `sequence` spośród gotowych operacji bez niespełnionych
  zależności i wcześniejszej blokady ich zasobu. Konflikt nie blokuje innych
  zasobów. `clear` całej listy jest barierą dla jej produktów.
- Nadawca używa dzierżawy 15 s, odnawianej co 5 s w transakcji IDB.
  Przejęcie zwiększa `leaseEpoch`; zastosowanie odpowiedzi wymaga zgodności
  właściciela, epoki, konta i generacji sesji. Timeout/cykl życia zatrzymuje
  stary kontekst. Skok zegara może przyspieszyć przejęcie, ale nie uprawnia
  starego nadawcy do zapisu. API nadal chroni skutki niezmiennym operationId.
- Próby retry mają odstęp losowy od zera do `min(5 min, 3 s × 2^attempts)`;
  `Retry-After` wyznacza dolną granicę, gdy serwer ją poda. Termin i licznik
  są trwałe. Wznowienie aplikacji nie zeruje opóźnienia ani limitu wieku.
- Limit 30 dni sprawdzamy przed wysłaniem, również po odzyskaniu dzierżawy.
  Raz zapisany `needs-review/expired` nie wraca do `pending` po zmianie zegara.
  Idempotencja API zachowuje odpowiedź przez 90 dni; nie zmieniamy jej kontraktu.
- 401/`SESSION_CHANGED` i potwierdzona zmiana konta zatrzymują wszystko.
  Sieć, 429 i 5xx oznaczają retry. 409/`OPERATION_CONFLICT` wymaga przeglądu,
  bez zmiany payloadu lub ID. 403/404 wymagają interpretacji adaptera:
  utrata dostępu usuwa także prywatną treść, nie tylko wpis kolejki.
  Trwały błąd walidacji wymaga reakcji, a nie nieskończonego retry.

## 5. Mapowanie i kolejność importu

Import zachowuje oryginalne identyfikatory i czasy, także stare operacje.
Nie dziedziczy łagodnego zachowania dawnych czytników pomijających błędy.

| Źródło                             | Reguła migracji i przypadek brzegowy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rodzina/sesja                      | Zachować minimalne dane i joinCode z `offline-data`. Sesja zakupów jest fallbackiem tylko przy braku poprawnej sesji rodziny: ma wyczyszczony joinCode/e-mail i nie dostarcza domowników. Konflikt kont źródłowych zatrzymuje start; niczego nie scalać między kontami.                                                                                                                                                                                                                                                              |
| Kalendarz                          | Zachować zakresy, czas użycia i kompletność, powiązane szczegóły/personal/distant. Błędny cache można oznaczyć jako niedostępny do ponownego pobrania, bez odtwarzania fałszywej pustej zawartości. Osobiste przypomnienia muszą należeć do konta.                                                                                                                                                                                                                                                                                   |
| Kontakty                           | Zachować snapshot i czas pobrania, także pustą listę przy istniejącej grupie domyślnej. Błąd schematu/rodziny/grupy oznacza brak cache i komunikat, bez kolejki.                                                                                                                                                                                                                                                                                                                                                                     |
| Zakupy: dziennik + snapshot        | Zbiór ID jest sumą źródeł. Identyczne kopie deduplikować po koncie i operationId; porównywać kanoniczny payload oraz submittedAt, nie techniczne pola statusu/retry TanStack. Sprzeczna intencja/czas dla jednego ID blokuje import.                                                                                                                                                                                                                                                                                                 |
| Zakupy: tylko snapshot             | Zachować intencję jako `needs-review/snapshot-only`. Brak dziennika nie dowodzi, że operacja nie została już zakończona lub odrzucona. Nie wysyłać jej automatycznie; nie gubić kopii.                                                                                                                                                                                                                                                                                                                                               |
| Zakupy: tylko dziennik             | Przy potwierdzonym koncie zachować operację także bez snapshotu. Brak listy/bazy oznacza `needs-review/missing-base` do odświeżenia i sprawdzenia dostępu. Nie produkować pustej listy.                                                                                                                                                                                                                                                                                                                                              |
| Projekcja zakupów                  | Query zwykle przechowuje bazę, a `shoppingQueries.ts` nakłada pending raz na osobną mapę UI. Po sukcesie i awarii usuwania dziennika cache może już zawierać skutek pozostawionej operacji. Import oznacza go `legacy-cache`, bez gwarancji czystej bazy. O.3 zachowuje obecne odtwarzanie widoku; nie zapisuje wyniku mapy UI ponownie jako bazy. W O.5 przed wysyłką potwierdzamy bazę API; offline zachowujemy dotychczasowy widok i adnotację. Nie odwracamy heurystycznie `clear`/`remove` ani nie dodajemy produktu drugi raz. |
| Zadania: operacja                  | `id → operationId`, `taskId → entityId`, reszta intencji i czasu bez zmian. Brak statusu to pending; stare operacje i już zapisane review pozostają do przeglądu. Baza z `items` nie zawiera projekcji, więc pending nakładamy raz.                                                                                                                                                                                                                                                                                                  |
| Zadania: odrzucenie                | Najpierw zebrać wszystkie tombstone/discard, następnie wykluczyć ich operationIds. Zachować `requiresRefresh` dla listy. Nie eksportować odrzuconych intencji do nowej kolejki, nawet jeśli stare usuwanie wpisów nie powiodło się.                                                                                                                                                                                                                                                                                                  |
| Nieczytelny dziennik / obca wersja | Zatrzymać import tego modułu i zachować surowe źródło. Błąd cache nie usprawiedliwia usunięcia dziennika. Brak miejsca nie usprawiedliwia pomijania wpisów.                                                                                                                                                                                                                                                                                                                                                                          |

Kolejność zadań to obecna para `(submittedAt, id)`; porównanie UUID używa
porządku ASCII, równoważnego dla małych liter UUID z próbek. Dla zakupów
zachować kolejność pasujących mutacji snapshotu, jeżeli obejmuje cały łańcuch
danego zasobu. Pozostałe wpisy porządkować czasem; **remis na tym samym zasobie
bez pełnego snapshotu oznacza `ambiguous-order` i przegląd całego łańcucha**.
Nie zgadujemy intencji na podstawie ID lub kolejności kluczy localStorage.

Globalne sekwencje nadawać topologicznie z zachowaniem rozpoznanej kolejności
modułów/zasobów. Spośród niezależnych wpisów wybierać według
`(submittedAt, module, operationId)` w porządku ASCII. Historyczna kolejność
między modułami nie jest odtwarzalna; nie tworzymy fikcyjnych dawnych zależności.
Nowe operacje otrzymują sekwencję po wszystkich zaimportowanych.

## 6. Wyłączność, przełączenie i czyszczenie

### Warunek bezpieczeństwa starych kart

Stary kod localStorage nie respektuje IDB ani nowej dzierżawy. Nie istnieje
w tej aplikacji obecnie techniczny sygnał dowodzący, że wszystkie takie karty
są zamknięte. Brak heartbeat, timeout i zgodność skrótu nie są takim dowodem.

O.2 wprowadza protokół koordynacji `offline-protocol:1` z identyfikatorem
instancji, komunikatami `freeze`, `frozen`, `session-changed`, `resume`
oraz trwałym znacznikiem trybu originu. Zgodne instancje zatrzymują stare
zapisy i nadawców przed ACK; start nowej instancji respektuje znacznik
`migrating`. Zdarzenia storage stanowią fallback dla komunikacji kart,
a poprawność przejęcia gwarantują transakcje IDB.

Dla aktualizacji sprzed protokołu **automatyczny import WWW jest zablokowany**.
Wymagana jest jawna procedura konserwacyjna: zamknięcie wszystkich okien
aplikacji i procesów przeglądarki, uruchomienie nowej strony migracji bez
przywracania starych kart i potwierdzenie użytkownika, że nie otworzy starszej
wersji podczas przejścia. To warunek operacyjny, nie wykrywanie przez timeout.
Jeśli nie można go zapewnić, pozostajemy przy starej wersji bez importu.
Alternatywny automatyczny rollout wymaga wcześniejszego wydania zgodnego
protokołu i potwierdzonej wymiany starych instancji, przed włączeniem importu.

W APK aktualizacja następuje po zakończeniu starego procesu; pojedynczy WebView
musi zostać zatrzymany przed przejęciem magazynu. Stary i nowy APK nie migrują
dwukrotnie tego samego originu. Odbiór O.2/O.7 sprawdza ten warunek na telefonie.

Późniejsze wykrycie zmian źródła podczas importu zatrzymuje go z komunikatem
i bez usuwania źródła. Taki test wykrywa część naruszeń, ale nie zastępuje
wyłączności: uruchomienie niezgodnej starej karty po przełączeniu nie jest
wspieranym trybem. Dokumentacja aktualizacji musi to wyjaśniać.

### Fazy importu i punkty awarii

1. `frozen`: zamrozić uczestników, odciąć późne odpowiedzi, przejąć blokadę
   migracji dla modułu i konta. Brak ACK zgodnej instancji blokuje operację.
2. `staged`: odczytać komplet kluczy źródła, zwalidować konto i policzyć miejsce.
   Zapisać kopię roboczą i kanoniczny SHA-256 źródła; hash służy porównaniu,
   nie anonimizacji. Dzienniki zawierają dane prywatne i nie trafiają do logów.
3. `committed`: jedną transakcją zapisać cel, liczniki, sekwencje i znacznik
   importu. Źródło nadal nieaktywne. Awaria przed commit wraca do staged;
   po commit nie importuje ponownie tych samych ID.
4. `verified`: odczytać cel i porównać klucze, intencje, kolejność, tombstone
   i skrót; ponownie sprawdzić niezmienione źródło oraz kontekst konta.
   Awaria weryfikacji nie uruchamia zapisów ani synchronizacji.
5. `active`: usunąć dokładnie przejęte klucze źródła, sprawdzić ich brak,
   następnie zatwierdzić właściciela nowego magazynu. Usuwanie i IDB nie są
   wspólną transakcją: znacznik verified pozwala dokończyć sprzątanie po awarii.
   Nie powtarzać importu resztek źródła. Nie usuwać nieznanych nowych kluczy.
6. Po przełączeniu usunąć surową kopię roboczą. Zachować mały znacznik wersji
   importera, aby pominąć ponowny import i obsłużyć pominięte wydania.

Wylogowanie/utrata sesji/zmiana konta od razu zwiększają generację,
zatrzymują wysyłkę i ukrywają prywatny stan. Następnie asynchronicznie usuwają
cache, outbox, metadata konta, migrację i źródła; czyszczenie ma pierwszeństwo
nad importem. Trwały znacznik `clear-pending` blokuje odtworzenie po przerwaniu
usuwania. Nowe konto uruchamiamy dopiero po sprawdzeniu czyszczenia.
Zdarzenie innej karty odcina tylko stary kontekst, nie kasuje jej nowego konta.

Po nowych zapisach IDB rollback wymaga aplikacji czytającej ten sam format;
stary APK/localStorage nie jest bezpiecznym celem. Przy nieudanym imporcie
przed active można wrócić do nietkniętego źródła po anulowaniu nowej migracji.
Zgodność API z poprzednim wspieranym APK pozostaje obowiązkiem wydań.

## 7. Budżety i pomiar

Początkowy limit logiczny originu: **40 MiB**, gdzie 1 MiB = 1 048 576 bajtów.
Budżet zakłada jedno aktywne konto, z czyszczeniem poprzedniego.

| Obszar                          | Budżet | Postępowanie przy limicie                                                       |
| ------------------------------- | ------ | ------------------------------------------------------------------------------- |
| Cache kalendarza                | 10 MiB | LRU zakresów, nadal maksimum 12 miesięcy, z powiązanymi szczegółami             |
| Cache zadań                     | 6 MiB  | Nieużywane, potwierdzone dane; nigdy baza potrzebna pending                     |
| Cache zakupów                   | 4 MiB  | Jak wyżej; niepobrana lista pozostaje niepobrana                                |
| Rodzina i sesja offline         | 2 MiB  | Zachować aktywną sesję; ograniczać zbędne kopie, jawny błąd zapisu              |
| Kontakty                        | 2 MiB  | Zachować ostatnią poprawną kopię; nowa nie zastępuje jej przy nieudanym zapisie |
| Outbox i chroniona baza zakupów | 6 MiB  | Bez automatycznego kasowania operacji; odmowa nowej zmiany z komunikatem        |
| Outbox i chroniona baza zadań   | 6 MiB  | Jak wyżej, także review i wymagane blokady odświeżenia                          |
| Metadane / liczniki / znaczniki | 4 MiB  | Usuwać tylko nieużywane znaczniki; nigdy aktywną dzierżawę ani stan odrzucenia  |

Rekord przypięty do pending jest liczony w rezerwie modułu zamiast zwykłego
cache, bez podwójnego naliczania. Przy usunięciu ostatniej zależności zmiana
liczników jest częścią transakcji. Niewykorzystana rezerwa jednego modułu
nie uprawnia innego do zajęcia jej bez zmiany kontraktu.

Miara logiczna rekordu: `2 × UTF8(JSON.stringify([key, value])).byteLength + 256`.
Obejmuje margines na reprezentację i indeksy, ale nie jest pomiarem fizycznego
zużycia IDB. Liczniki aktualizujemy wraz z zapisem i okresowo przeliczamy
z rekordów; rozbieżność blokuje nowy zapis do zakończenia przeliczenia.

Obszar migracji ma osobny, przejściowy limit **48 MiB** tej samej miary.
Preflight wymaga, jeśli dostępne są dane `storage.estimate()`, wolnego miejsca
co najmniej `2 × (źródło UTF8 + szacowany cel UTF8) + 1 MiB`.
Brak estymaty nie oznacza przydzielonego miejsca: próbę zapisu wykonujemy
bez kasowania źródła i uznajemy sukces dopiero po commit. Przekroczenie
48 MiB albo brak miejsca zatrzymuje import bez ucinania dziennika.

O.1 mierzy rozmiary syntetycznych próbek i zapisuje wynik testu; to punkt
odniesienia, nie pomiar telefonu. O.2–O.6 mierzą próbki skrajnych poprawnych
danych oraz różnicę usage przed/po zapisie. O.7 potwierdza zachowanie na
rzeczywistych, pozostających na urządzeniu danych i fizycznym APK.
Nowy adapter obiadów w 6.5 wymaga jawnego przydziału/zmiany budżetu.

Pomiar bazowej próbki O.1 według powyższej miary, 26.10.2026:
rodzina/sesja 1518 B, kalendarz 4016 B, kontakty 1740 B, zakupy 10 356 B,
zadania 4848 B; razem **22 478 B**. Dzienniki i znaczniki są tu zsumowane
z modułem, a nie rozdzielone między przyszłe magazyny. Mała próbka sprawdza
format i pomiar; nie potwierdza jeszcze wystarczalności limitów na telefonie.

## 8. Próbki i macierz weryfikacji

[legacy-valid.json](offline/fixtures/legacy-valid.json) zawiera wyłącznie
syntetyczne UUID i dane, pięć snapshotów, dzienniki zakupów/zadań oraz
zadaniowy znacznik odrzucenia. Wartości `entries[].value` serializujemy
do JSON przed umieszczeniem pod dokładnym kluczem `entries[].key`.

[legacy-cases.json](offline/fixtures/legacy-cases.json) opisuje niezależne
warianty na tej bazie. `changes` zmienia wartość przez tablicę `path`, usuwa
cały klucz przez `remove`, podmienia surowy tekst przez `raw` albo dodaje
wartość przez `value`. Nie jest to format produkcyjnej bazy ani implementacja
importera. `expectedMigration` opisuje obowiązek przyszłego kroku, nie wynik
już działającego nowego silnika.

[operation-variants.json](offline/fixtures/operation-variants.json) zawiera
niezależne przykłady wszystkich siedmiu zmian zakupów i trzech operacji zadań.
Nie należy łączyć ich w jeden scenariusz wysyłki; np. usunięcie listy jest
osobnym przykładem, nie warunkiem dalszych przykładów jej edycji.

Test `apps/web/src/offlineFixtures.test.ts` sprawdza odtwarzanie podstawowej
próbki przez obecne czytniki i kontrakty shared, prawdziwe uszkodzenia próbek
oraz wiek/statusy/odrzucenia zadań. Nie pozoruje przetestowania przyszłej IDB,
migratora ani nowego synchronizatora.

| ID  | Scenariusz / kryterium                                                | Próbka lub przygotowanie                                          | Krok wdrożenia i odbioru                                            |
| --- | --------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| M01 | Pięć poprawnych snapshotów, restart offline                           | `legacy-valid`                                                    | O.2 rodzina/kalendarz; O.3 zakupy; O.4 zadania/kontakty; O.7 całość |
| M02 | Niepoprawny JSON i obca wersja cache, brak ≠ puste                    | `broken-family`, `future-contacts`, `missing-task-list`           | O.2, O.4, O.7                                                       |
| M03 | Błędny dziennik, sprzeczne kopie jednego ID                           | `broken-shopping-journal`, `conflicting-shopping-copy`            | O.3, O.5, O.7                                                       |
| M04 | Tylko snapshot albo tylko dziennik; brak bazy                         | `shopping-snapshot-only`, `shopping-journal-only`                 | O.3, O.5                                                            |
| M05 | Zakupy w locie, serwer wykonał, odpowiedź zaginęła                    | `shopping-in-flight`; atrapa API utraty odpowiedzi                | O.3, O.5, O.7                                                       |
| M06 | Remis czasu zakupów bez dowodu kolejności                             | `shopping-ambiguous-order`                                        | O.3, O.5                                                            |
| M07 | Remis zadań i format sprzed review                                    | `task-tie`, `task-without-status`                                 | O.4, O.6                                                            |
| M08 | Stare i trwale oznaczone zmiany, korekta zegara                       | `task-expired`, `task-persisted-review`                           | O.4, O.5, O.6                                                       |
| M09 | Odrzucenie jest ważniejsze niż resztki dziennika                      | `legacy-valid`, znacznik discard; błędy usuwania                  | O.4, O.6                                                            |
| M10 | Konflikt kont i powiązań rodziny, logout podczas importu              | `foreign-contacts`, `foreign-session`; kontrolowana pauza importu | O.2, O.4, O.7                                                       |
| M11 | Niezgodna stara karta, brak ACK, zmiana źródła, blocked/versionchange | Dwa konteksty przeglądarki i wersja sprzed protokołu              | O.2, O.7                                                            |
| M12 | Przerwanie w frozen/staged/committed/verified/active                  | Kontrolowane punkty awarii, także po usunięciu części kluczy      | O.2–O.4, O.7                                                        |
| M13 | Pełna pamięć, odmowa IDB, limit i przypięta baza                      | Limit transakcji i próbki powiększone do granicy budżetu          | O.2–O.6, O.7                                                        |
| M14 | Dzierżawa wygasa, późna odpowiedź, dwie karty                         | Sterowany zegar i dwa nadawcy, zmiana sesji w trakcie API         | O.5, O.6, O.7                                                       |
| M15 | Retry 429/5xx, Retry-After, konflikt i niezależna operacja            | Atrapy transportu; stałe ID, zależności i kolejność               | O.5, O.6                                                            |
| M16 | Utrata dostępu / usunięta lista, brak prywatnej treści                | Zmiana odpowiedzi list i 403/404 po wysłaniu                      | O.4, O.6, O.7                                                       |
| M17 | Alarmy blokowane podczas migracji i po restarcie                      | Pending usunięcia/terminu/isDone, natywna rewizja                 | O.4, O.6, O.7; fizyczny Android                                     |
| M18 | Aktualizacja z pominięciem wydań, rollback i czyszczenie              | Stary APK/WWW z legacy-valid; clear-pending                       | O.7; fizyczny Android i WWW                                         |
| M19 | Wspólny status i układ ekranów                                        | Offline, błąd pamięci, pending i review                           | O.2–O.7; headless 390/1280 px i przegląd wyglądu                    |

W O.1 próby UI i telefonu nie są wymagane: zachowanie aplikacji się nie zmienia.
Nie oznaczamy przyszłych scenariuszy jako zaliczonych. Krok kończy sukces CI
końcowego commita zgodnie z sekcją 1.2 planu.
