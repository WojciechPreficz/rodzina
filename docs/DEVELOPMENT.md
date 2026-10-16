# Praca lokalna

## Krok 2.5 — kalendarz, wydarzenia jednorazowe i szczegóły

`/kalendarz` (oraz `/`) pokazuje Schedule-X: domyślnie agendę miesiąca, dodatkowo tydzień i dzień. Język to polski, tydzień zaczyna się w poniedziałek, a godziny odpowiadają strefie rodziny. Filtr „Pokaż tylko” wybiera uczestników; pusty filtr pokazuje wszystkie wydarzenia, także bez uczestników. Dane odświeżają się co 20 sekund i przy powrocie do karty.

Przycisk „+” otwiera formularz wydarzenia jednorazowego. Szczegóły są dostępne pod `/kalendarz/wydarzenie/:eventId?data=YYYY-MM-DD`; parametr `data` oznacza pierwotną datę wystąpienia, również po przesunięciu wyjątkiem. Dla wydarzeń jednorazowych i odległych można go pominąć. Usunięte wydarzenie, anulowane wystąpienie lub niepoprawna data pokazują „Tego wydarzenia już nie ma”. Niezalogowany użytkownik wraca na ten sam adres po logowaniu. Edycja i usunięcie korzystają z `scope=all`; dziecko widzi te akcje tylko przy swoich wydarzeniach.

Weryfikacja ręczna przez właściciela (Chrome desktop i szerokość około 390 px):

1. Dodaj wydarzenie z godziną, opisem, miejscem i kilkoma uczestnikami, a potem wydarzenie całodniowe. Sprawdź daty, godziny, legendę kolorów oraz filtr każdego uczestnika w widoku miesiąca, tygodnia i dnia. Wybierz inny miesiąc i sprawdź, że pobierany zakres zmienia się wraz z widokiem.
2. Otwórz szczegóły, zmień tytuł i datę, następnie usuń wydarzenie. Sprawdź potwierdzenie i powrót do kalendarza. Na koncie dziecka sprawdź brak akcji przy cudzym wydarzeniu oraz obecność przy własnym.
3. Skopiuj adres szczegółów z `data`, odśwież stronę, a potem otwórz adres po wylogowaniu i zaloguj się ponownie. Sprawdź powrót do właściwego wystąpienia. Sprawdź komunikat dla usuniętego wydarzenia i anulowanego wystąpienia serii utworzonej przez API w poprzednim kroku.
4. Otwórz kalendarz drugiego domownika w incognito lub osobnym profilu. Dodaj lub zmień wydarzenie w pierwszym oknie. W drugim powinno pojawić się po maksymalnie 20 sekundach albo od razu po powrocie do karty.
5. Sprawdź brak poziomego przewijania na telefonie i desktopie, czytelność pól w dialogu i przycisk „+” nad dolną nawigacją.

Dodano testy komponentów i adaptera w `apps/web/src/features/calendar/`, test `eventUrl` w `packages/shared/src/urls.test.ts` oraz e2e linku przez logowanie w `e2e/calendar.spec.ts` (istniejące projekty Playwright: desktop i telefon, wyłącznie headless). Na prośbę właściciela testy oraz `release:smoke` pozostają nieuruchomione. Nie dodano migracji, zmiennych środowiskowych ani cronów. Przypomnienia i kreatory wydarzeń z kroku 2.6–2.7 nie są częścią tej implementacji.

## Wymagania

- Node.js 22 lub 24 oraz npm.
- Na Windowsie `better-sqlite3` korzysta z gotowych binariów Node; nie powinien wymagać kompilacji projektu na serwerze.

## Instalacja i uruchamianie

```sh
npm ci
```

Skopiuj `apps/api/.env.example` do `apps/api/.env`. Uruchom `npm run vapid:generate` i wklej
wygenerowaną parę do `RODZINA_VAPID_PUBLIC_KEY` i `RODZINA_VAPID_PRIVATE_KEY`; ustaw też kontakt
`RODZINA_VAPID_SUBJECT` (mailto lub HTTPS). Od kroku 3.2 są wymagane także lokalnie.
`npm run dev` uruchamia Fastify na porcie 3000 i Vite na 5173. Otwórz `http://localhost:5173`;
wywołanie `/api/health` przechodzi przez proxy Vite do API.

### Job przypomnień — krok 3.2

Uruchom najpierw serwer, aby wykonał migracje bazy. Po buildzie `npm run job:reminders`
jednorazowo rezerwuje i wysyła należne przypomnienia. Możesz nadpisać czas bez przestawiania
zegara systemowego:

```sh
npm run job:reminders -- --now=2026-10-20T14:45:00Z
```

Flaga wymaga daty ISO z godziną i strefą (`Z` lub np. `+02:00`). Domyślnie job używa bieżącego
czasu. `npm run dev:cron` uruchamia wersję źródłową przez `tsx`, od razu i ponownie po minucie
od zakończenia poprzedniego uruchomienia. Każdy przebieg jest osobnym procesem i ponownie
wczytuje `.env`; Ctrl+C kończy pętlę. Ta pętla służy tylko do lokalnej symulacji crona.
Backup wykonuje się osobno przez `npm run job:backup` po buildzie; `dev:cron` symuluje wysyłkę przypomnień.

Testy joba używają tymczasowej bazy i wstrzykniętego `PushSender`, bez połączeń z dostawcą push.
Sprawdzają rezerwację przy dwóch połączeniach, rollback transakcji, kolejne terminy cyklu,
zmianę czasu, przesunięte wystąpienia i ich adresy, odbiorcę awaryjnego, spóźnienia (2/12 h),
404/410, błędy przejściowe i izolację rodzin. Testy oraz e2e generują własne tymczasowe klucze.
Endpointy subskrypcji i obsługa powiadomień w przeglądarce powstaną w kroku 3.3, więc na tym
etapie nie wykonujemy jeszcze ręcznego testu dostarczenia push na telefon.

Weryfikacja kroku 3.2 (2026-10-16): przechodzą lint (dwa wcześniejsze ostrzeżenia Fast Refresh),
format:check, typecheck, build i release:smoke z jobem uruchomionym z paczki. Testy joba obejmują
też dwa niezależne procesy Node startujące na tym samym pliku SQLite; wysyłka następuje raz.
Przechodzą testy API i logiki shared. Pełne `npm test` wykazuje 12 błędów wcześniejszych testów UI
w sześciu plikach: ReminderPicker, MyReminders, EventForm, CalendarPage, EventDetailsPage
i DistantEvents. Te same 12 błędów odtworzono na czystym archiwum HEAD sprzed zmian kroku 3.2:
niejednoznaczne selektory etykiet Mantine, nieaktualne oczekiwania przycisków i brak mocka
`window.matchMedia`. Nie zmieniano UI ani tych testów w tym kroku; pełny zestaw nie jest zielony.

Ustaw `RODZINA_PUBLIC_URL=http://localhost:5173` w trybie dev. Przed `npm start` zmień tę wartość na `http://localhost:3000`, aby zaproszenia i linki resetu prowadziły do uruchomionej aplikacji. `RODZINA_ALLOW_REGISTRATION=false` wyłącza tworzenie nowych rodzin, ale pozwala korzystać z zaproszeń i logowania.

Wariant produkcyjny:

```sh
npm run build
npm start
```

Serwer i API działają wtedy razem na porcie 3000. Nie uruchamiaj jednocześnie `npm run dev:api` i `npm start`, bo próbują użyć tego samego portu.

## Weryfikacja

```sh
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
npm run release:smoke
```

Testy przeglądarkowe z fazy 1:

```sh
npx playwright install chromium
npm run build
npm run test:e2e
```

Playwright uruchamia wyłącznie Chromium headless, w szerokościach 390 i 1280 px. Własny serwer na porcie 3417 korzysta z tymczasowej bazy; test nie używa `apps/api/.env` i nie zmienia danych lokalnej rodziny. Sprawdza rejestrację, trwałość sesji po odświeżeniu, zaproszenie i akceptację w osobnym kontekście, widoczność obu domowników, logowanie dziecka klawiaturą PIN, powrót na `next` oraz reset hasła. Przed uruchomieniem testu port 3417 musi być wolny.

### Ręczna weryfikacja fazy 1

1. Na ekranie powitania wybierz „Załóż rodzinę”. Po rejestracji sprawdź dolną nawigację i odśwież stronę.
2. W Więcej > Rodzina dodaj dziecko oraz utwórz zaproszenie. Skopiuj link i otwórz go w incognito lub drugim profilu Chrome. Zaakceptuj zaproszenie; sprawdź obu domowników na obu urządzeniach.
3. W trzecim profilu wybierz „Jestem dzieckiem”, wpisz kod rodziny, wybierz kafelek dziecka i wprowadź PIN. Błędny PIN powinien pokazać błąd, a 11. próba w ciągu 15 minut blokadę.
4. Z konta administratora wygeneruj link resetu hasła dorosłego. Otwórz link, ustaw nowe hasło i zaloguj się nim. Ponowne użycie linku oraz zaproszenia powinno pokazać błąd.
5. Sprawdź nowe ekrany przy szerokości ok. 390 px i na desktopie. Kafelki oraz klawiatura PIN powinny mieścić się bez poziomego przewijania.
6. Na prawdziwym Androidzie uruchom build produkcyjny przez przekierowanie portu 3000, zainstaluj PWA, zaloguj się, zamknij ją i otwórz ponownie. Użytkownik powinien pozostać zalogowany. Test headless i odświeżenie strony nie zastępują tego sprawdzenia.

### Wyniki weryfikacji fazy 1 — 2026-10-09

| Kryterium                                                                                 | Wynik                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rejestracja, poprawne i błędne logowanie, limit prób, sesje, CSRF i wyłączona rejestracja | Testy API przechodzą. Regresje obejmują również odnowienie cookie i brak pustej rodziny przy równoległej rejestracji.                                                                                                                                                                            |
| Zaproszenia i reset hasła                                                                 | Testy poprawnych, wygasłych i użytych tokenów oraz równoległego wykorzystania przechodzą.                                                                                                                                                                                                        |
| Logowanie dziecka                                                                         | Testy API i UI: wybór profilu, klawiatura PIN, błędny PIN, limit prób i unieważnienie starego kodu rodziny.                                                                                                                                                                                      |
| Uprawnienia i izolacja rodzin                                                             | Testy ograniczeń dorosłego i dziecka, ochrony ostatniego administratora, zasobów obcej rodziny i usunięcia sesji domownika przechodzą.                                                                                                                                                           |
| Smoke e2e                                                                                 | Dwa scenariusze Chromium headless (390 i 1280 px) przeszły: osobne konteksty, obaj domownicy na liście, dziecko i reset hasła.                                                                                                                                                                   |
| UI nowych ekranów                                                                         | Zrzuty z Playwright sprawdzone wizualnie, brak poziomego przewijania; testy komponentów przechodzą.                                                                                                                                                                                              |
| Kontrole jakości                                                                          | 30 testów Vitest, lint, formatowanie, typecheck (w tym e2e), build i release:smoke przechodzą. Lint ma dwa wcześniejsze ostrzeżenia Fast Refresh w `auth.tsx`; build ostrzega o rozmiarze głównego pliku JS.                                                                                     |
| Gotowość do deployu                                                                       | Konfiguracja opisana w `.env.example` i `DEPLOY.md`; brak nowych zmiennych, migracji, zależności runtime i cronów. Istniejące migracje auth są w repo, a paczka poprawnie uruchamia serwer, bazę, SPA, manifest, SW i heartbeat. Nie dodano WebSocketów, Dockera, Redisa ani schedulera serwera. |
| Zamknięcie i ponowne otwarcie PWA na prawdziwym Androidzie                                | Do sprawdzenia przez właściciela według punktu 6. Odświeżenie strony jest objęte e2e, ale nie potwierdza zachowania zainstalowanej PWA na telefonie.                                                                                                                                             |

Lokalny backup można wykonać poleceniem `npm run job:backup` po buildzie. Symulacja crona przypomnień co minutę: `npm run dev:cron`. Oba polecenia wymagają konfiguracji `.env` i używają tej samej bazy co API.

## Kalendarz — API kroku 2.2

Ten krok dodaje API całych wydarzeń. Ekrany kalendarza powstaną w krokach 2.5–2.7, przypomnienia w 2.3, a edycja wystąpień i wyjątki w 2.4. Wszystkie poniższe endpointy wymagają aktywnej sesji. Mutacje wysyłaj jako JSON z tego samego hosta co aplikacja; przy `DELETE` można wysłać `{}`.

| Endpoint                                                         | Działanie                                                                                                                                                                               |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/events`                                               | Tworzy wydarzenie; odpowiedź 201 z `{ ok, event }`.                                                                                                                                     |
| `GET /api/events/:id`                                            | Pobiera wydarzenie z uczestnikami (id, imię i kolor).                                                                                                                                   |
| `PATCH /api/events/:id?scope=all`                                | Zmienia podane pola całego wydarzenia. Pominięty `scope` również oznacza `all`.                                                                                                         |
| `DELETE /api/events/:id?scope=all`                               | Usuwa całe wydarzenie oraz uczestników i wyjątki.                                                                                                                                       |
| `GET /api/occurrences?from=YYYY-MM-DD&to=YYYY-MM-DD&userId=UUID` | Zwraca `{ ok, occurrences }` z datą pierwotną, momentami UTC, tytułem i uczestnikami. Zakres obejmuje obie daty, najwyżej 62 dni. Filtr `userId` jest opcjonalny i dotyczy uczestników. |
| `GET /api/events/upcoming-distant`                               | Zwraca `{ ok, events }`, nadchodzące odległe terminy posortowane po dacie; termin miesięczny pozostaje na liście przez cały miesiąc.                                                    |

Przykładowe body utworzenia wydarzenia (identyfikatory domowników pobierz z `/api/members`):

```json
{
  "kind": "single",
  "title": "Basen",
  "description": "Zabrać ręcznik",
  "location": "Pływalnia",
  "startDate": "2026-10-13",
  "startTime": "17:00",
  "durationMinutes": 60,
  "participantIds": []
}
```

Wymagane są `kind`, `title` i `startDate`. Domyślnie `datePrecision=day`, uczestnicy są pustą listą, a opis, miejsce, godzina, czas trwania i RRULE mają null. Dla wydarzenia z godziną wymagany jest dodatni `durationMinutes`; całodniowe nie ma godziny ani czasu trwania. Cykliczne (`kind=recurring`) wymaga `rrule`, np. `FREQ=WEEKLY;BYDAY=TU,TH;COUNT=8`. Dla jednorazowego i odległego RRULE jest null. Termin `kind=distant` z `datePrecision=month` zapisuje pierwszy dzień miesiąca, np. `2028-05-01`, bez godziny i czasu trwania; widać go wyłącznie na liście odległych terminów. Identyfikatory rodziny i autora pochodzą z sesji i nie są przyjmowane w body.

Ręczna weryfikacja przez właściciela:

1. Utwórz, odczytaj, zmień i usuń wydarzenie każdego rodzaju przez API. Po zmianie jednego pola pozostałe powinny zachować wartości.
2. Sprawdź serię w `/api/occurrences`, także po zmianie czasu. Termin dzienny powinien być widoczny w wystąpieniach, a miesięczny tylko w `/api/events/upcoming-distant`.
3. Z sesji dziecka sprawdź zapis własnego wydarzenia oraz odpowiedź 403 przy zmianie i usunięciu wydarzenia rodzica. Z innej rodziny sprawdź odpowiedź 404.
4. Usuń domownika, który utworzył wydarzenie: wydarzenie pozostaje z `createdBy=null`, a usunięta osoba znika z uczestników.

Migracje uruchamiają się przy starcie API. Migracja `0010_events.sql` dodaje `events`, `event_participants` i `event_exceptions`; uzupełniono metadane wcześniejszych migracji auth. Nie dochodzą zmienne środowiskowe, crony ani biblioteki wymagające kompilacji runtime na serwerze. Weryfikację ręczną wykona właściciel. E2e i `release:smoke` pominięto na jego prośbę.

`npm run dev:api` buduje shared przed uruchomieniem API, więc po świeżym `npm ci` nie trzeba budować go osobno. Po zmianach kodu shared uruchom ponownie dev, aby odświeżyć jego build. Build API dołącza kod shared i biblioteki czasu; paczka release nie instaluje wewnętrznego pakietu `@rodzina/shared` z rejestru npm.

Weryfikacja automatyczna kroku 2.2 (2026-10-11): wszystkie 198 testów Vitest przechodzą, w tym CRUD, walidacja trzech rodzajów wydarzeń, cykle i terminy odległe, uprawnienia dziecka, izolacja rodzin, zachowanie wydarzeń po usunięciu autora oraz aktualizacja istniejącej bazy auth bez utraty danych. Przechodzą lint, formatowanie, typecheck i build. Lint zgłasza dwa wcześniejsze ostrzeżenia Fast Refresh w `auth.tsx`, a build ostrzega o rozmiarze głównego pliku JS weba. Ponowne `db:generate` nie wykazuje zmian schematu.

## PWA na Androidzie przez USB

Service worker, instalację PWA i push (w późniejszej fazie) weryfikuj na buildzie produkcyjnym. Podłącz telefon przez USB, włącz debugowanie USB i w Chrome na komputerze otwórz `chrome://inspect`. W sekcji Port forwarding dodaj `5173 -> localhost:5173` dla pracy nad UI albo `3000 -> localhost:3000` dla builda produkcyjnego. Następnie na telefonie otwórz odpowiednio `http://localhost:5173` albo `http://localhost:3000`.

Tryb dev służy do pracy nad UI; instalację PWA i service worker sprawdzaj po `npm run build && npm start` na porcie 3000. Aplikacja jest wtedy dostępna dla Chrome Androida jako `localhost` i działa w bezpiecznym kontekście.

## Przypomnienia wydarzeń — API kroku 2.3

`POST /api/events` i `PATCH /api/events/:id` obsługują opcjonalną tablicę `reminders`. Jej podanie zastępuje wyłącznie wspólne przypomnienia; pominięcie zachowuje dotychczasowe, a `[]` usuwa wspólne. Osobiste przypomnienia innych osób pozostają. Przy każdym zapisie wszystkie terminy są przeliczane przez `computeNextFireAt` w strefie rodziny, w tej samej transakcji co wydarzenie.

Przykładowe wspólne przypomnienia w body wydarzenia:

```json
{
  "reminders": [
    { "type": "offset", "offsetValue": 1, "offsetUnit": "day", "audience": "participants" },
    { "type": "absolute", "remindAt": 1830240000000, "audience": "adults" }
  ]
}
```

Odbiorca wspólny to `participants` (domyślnie), `family`, `adults` albo `owner`. `user` jest zarezerwowane dla endpointów osobistych. Offset jest nieujemną liczbą całkowitą (maksymalnie 10000), jednostką jest `minute`, `hour`, `day`, `week` albo `month`; w jednym zapisie można podać do 100 przypomnień wspólnych. `absolute` przyjmuje wyłącznie `remindAt` w milisekundach UTC. Przypomnienie z przeszłości pozostaje zapisane z `nextFireAt=null`.

| Endpoint                               | Działanie                                                                                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/reminders/mine?eventId=UUID` | Lista wyłącznie własnych przypomnień osobistych dla widocznego wydarzenia.                                                                      |
| `POST /api/reminders/mine`             | Body: `eventId` i pola `offset` albo `absolute`. Serwer ustawia `audience=user`, odbiorcę i autora z sesji. Odpowiedź 200 z `{ ok, reminder }`. |
| `DELETE /api/reminders/mine/:id`       | Usuwa tylko własne osobiste przypomnienie; cudze, nieistniejące i z innej rodziny daje 404.                                                     |

Dziecko może dodać i usunąć własne przypomnienie do wydarzenia rodzica, ale zapis wydarzenia rodzica nadal daje 403. Odczyt wydarzenia zwraca tylko przypomnienia wspólne; osobiste pobieraj osobnym endpointem. API nie obsługuje jeszcze źródeł `taskId` ani `documentId`. Usunięcie wydarzenia usuwa wszystkie jego przypomnienia; usunięcie odbiorcy kasuje jego osobiste przypomnienia, a wspólne przypomnienia utworzone przez usuniętą osobę pozostają z `createdBy=null`.

Krok nie dodaje UI ani wysyłki push. Migracja `0011_chubby_gateway.sql` jest wykonywana przy starcie. Brak nowych zmiennych środowiskowych, cronów i zależności runtime.

Weryfikacja automatyczna kroku 2.3 (2026-10-12): przechodzą wszystkie 207 testów Vitest, lint, formatowanie, typecheck i build. Testy pokrywają zachowanie osobistych przypomnień przy edycji przez inną osobę, dziecko dodające przypomnienie do wydarzenia rodzica (200) przy zakazie edycji wydarzenia (403), podążanie offsetów za datą, wygaszenie przeszłych absolute, walidację źródeł i odbiorców, izolację rodzin oraz kaskady. Test migracji potwierdza zachowanie istniejących wydarzeń; ponowne `db:generate` nie wykazuje zmian. Pozostają wcześniejsze ostrzeżenia Fast Refresh i rozmiaru głównego pliku JS. `release:smoke` przerwano i pominięto na prośbę właściciela; weryfikację ręczną wykona właściciel.

## Serie i wyjątki — API kroku 2.4

`PATCH` i `DELETE /api/events/:id` przyjmują `scope=all|this|following` (domyślnie `all`). Dla `this` i `following` wymagany jest parametr `occurrenceDate=YYYY-MM-DD`, wskazujący pierwotną datę istniejącego wystąpienia serii, także po jego przesunięciu lub anulowaniu. Brak daty, data poza regułą oraz zastosowanie tych zakresów do wydarzenia jednorazowego lub odległego dają 400. Uprawnienia i izolacja rodzin pozostają takie same jak przy edycji całego wydarzenia.

- `PATCH ...?scope=this&occurrenceDate=2026-10-20` z body `{ "startDate": "2026-10-21", "startTime": "18:00", "title": "Przeniesiony basen" }` tworzy lub aktualizuje wyjątek. Dozwolone pola to tytuł, data, godzina i czas trwania; pozostałe pola należą do serii. Dla zmiany na całodniowe podaj jednocześnie `startTime=null` i `durationMinutes=null`. Ponowna edycja zachowuje pominięte pola wyjątku. Edycja anulowanego wystąpienia przywraca je.
- `DELETE ...?scope=this&occurrenceDate=2026-10-20` anuluje tylko wskazane wystąpienie.
- `PATCH ...?scope=following&occurrenceDate=2026-10-27` kończy starą serię dzień wcześniej przez `UNTIL` i zwraca nową serię w `event`, z nowym `id`. Nowa seria zaczyna się w `occurrenceDate`, chyba że podano inne `startDate`. Domyślnie zachowuje regułę powtarzania, a przy `COUNT` tylko pozostałą liczbę wystąpień. Uczestnicy są kopiowani; wspólne przypomnienia kopiowane, a osobiste przenoszone z zachowaniem identyfikatora, autora i odbiorcy. Podanie `reminders` zastępuje wyłącznie wspólne przypomnienia nowej serii. Przypomnienia obu serii są przeliczane w jednej transakcji. Autor nowej serii pozostaje autorem pierwotnego wydarzenia.
- `DELETE ...?scope=following&occurrenceDate=2026-10-27` kończy serię dzień wcześniej i usuwa wyjątki od wskazanej pierwotnej daty. Nie tworzy nowego wydarzenia. Podział od pierwszego wystąpienia pozostawia starą serię bez wystąpień.

`GET /api/events/:id` zwraca tablicę `exceptions`. `/api/occurrences` stosuje anulowania, przesunięcia oraz tytuły wyjątków. Przesunięte wystąpienie zachowuje pierwotne `occurrenceDate` i pojawia się w zakresie swojej nowej daty. Wyjątek zapisuje kompletną datę, godzinę, czas trwania i tytuł wystąpienia. Przy podziale bez zmiany daty i wzorca powtarzania przyszłe wyjątki przechodzą do nowej serii; zmiana daty lub wzorca usuwa je z przyszłej części. Przeszłe wyjątki pozostają w starej serii.

Weryfikacja ręczna przez właściciela:

1. Utwórz serię wtorkową z `COUNT=4`, uczestnikiem oraz przypomnieniem wspólnym. Z konta drugiej osoby dodaj przypomnienie osobiste.
2. Przesuń drugie wystąpienie przez `this`, następnie zmień tylko jego tytuł. Sprawdź jeden wyjątek w odczycie wydarzenia i właściwą datę, godzinę oraz tytuł w `occurrences`. Anuluj je i sprawdź, że znika z listy.
3. Edytuj trzecie wystąpienie przez `following`. W starej serii sprawdź zachowanie wcześniejszych wystąpień, a w nowej dwa pozostałe, skopiowanych uczestników i wspólne przypomnienia. Z konta drugiej osoby odczytaj przypomnienia osobiste nowej serii: autor i odbiorca muszą pozostać bez zmian. Sprawdź przeliczone `nextFireAt`.
4. Sprawdź `DELETE following`, także od pierwszego wystąpienia, oraz serię kończącą się przez `UNTIL`. Sprawdź odpowiedzi 400 bez daty lub dla daty spoza cyklu, 403 dla dziecka na cudzym wydarzeniu i 404 z innej rodziny.

Nie dodano migracji, zależności, zmiennych środowiskowych ani cronów. Na prośbę właściciela nie uruchomiono testów automatycznych ani `release:smoke`; dopisano przypadki API do późniejszego uruchomienia. Przechodzą typecheck, lint i build; pozostają wcześniejsze ostrzeżenia Fast Refresh i rozmiaru głównego pliku JS. Krok nie dodaje UI ani wysyłki powiadomień.

## Kalendarz — UI kroku 2.6

Przycisk „+” otwiera wybór „Jednorazowe”, „Powtarzające się” albo „Odległy termin”. Kreator serii pozwala wybrać odstęp i jednostkę (dzień, tydzień, miesiąc, rok), dni tygodnia oraz zakończenie: nigdy, w dniu lub po określonej liczbie wystąpień. Podgląd opisuje powtarzanie po polsku. Edycja odczytuje ustawienia zapisanej reguły. Niestandardowe reguły spoza możliwości kreatora pozostają bez zmian przy zapisie innych pól.

Odległy termin ma precyzję dnia lub miesiąca. Miesięczny zapisuje pierwszy dzień miesiąca bez godziny; widoczny jest wyłącznie w sekcji „Odległe terminy”, jako np. „maj 2028”, z odliczaniem liczonym do miesiąca. Termin dzienny pojawia się także w kalendarzu. Sekcja respektuje filtr uczestników oraz odświeżanie co 20 sekund i po powrocie do karty.

Przy edycji i usuwaniu serii najpierw wybierz „Tylko to”, „To i następne” albo „Wszystkie”. „Tylko to” udostępnia tytuł, datę, godzinę i czas trwania, uwzględniając dotychczasowy wyjątek; pozostałe pola są wyłączone. Żądanie wskazuje pierwotną datę wystąpienia, nawet gdy je przesunięto. „To i następne” rozpoczyna formularz w dniu podziału i pokazuje pozostałą liczbę wystąpień dla COUNT. Po zapisie otwierają się szczegóły nowej serii. Zapis nie wysyła zmian przypomnień; ich UI powstaje w kroku 2.7.

Ręczna weryfikacja przez właściciela (Chrome na desktopie oraz przy szerokości ok. 390 px):

1. Kliknij „+” i sprawdź wszystkie trzy tryby oraz powrót do wyboru przyciskiem „Anuluj”. Utwórz serię „co tydzień we wtorek i czwartek”, zapisz, a następnie otwórz edycję „Wszystkie”: dni, odstęp i zakończenie powinny być zachowane. Sprawdź również dzień, miesiąc i rok oraz zakończenie datą i liczbą wystąpień.
2. Otwórz późniejsze wystąpienie serii i wybierz „To i następne”. Zmień tytuł lub godzinę. Wcześniejsze wystąpienia powinny zostać bez zmian, a późniejsze należeć do nowej serii. Dla serii z limitem sprawdź, że formularz pokazuje pozostałą liczbę i zapis nie wydłuża serii.
3. Wybierz „Tylko to”, zmień datę, godzinę i tytuł. Odśwież pierwotny adres szczegółów: powinien pokazać przesunięte wystąpienie. Powtórz edycję; formularz powinien odczytać wyjątek. Anuluj tylko jedno wystąpienie, potem w osobnej serii usuń „To i następne”, a na końcu sprawdź usunięcie wszystkich.
4. Dodaj odległy termin „maj 2028” z precyzją miesiąca. Sprawdź jego nazwę i odliczanie w sekcji odległych, edycję i brak w siatce kalendarza po przejściu do maja 2028. Dodaj też termin z dokładnym dniem: powinien być w obu miejscach. Sprawdź filtr uczestników.
5. W drugim kontekście przeglądarki sprawdź odświeżanie listy odległych po maksymalnie 20 s lub po powrocie do karty. Z konta dziecka sprawdź brak akcji edycji i usunięcia cudzych wydarzeń.

Dodano testy round-trip RRULE, opisów po polsku, granicy UNTIL, pierwszego wystąpienia, wyboru trybów, formularza serii i terminu miesięcznego, listy z odliczaniem oraz zakresów edycji i usuwania. Na prośbę właściciela nie uruchomiono testów automatycznych, e2e ani `release:smoke`; sprawdzenie ręczne pozostaje do wykonania. Krok nie dodaje migracji, konfiguracji środowiska, cronów ani zależności runtime. Działa wyłącznie lokalnie.

Kontrole statyczne i build kroku 2.6 (2026-10-12): przechodzą `npm run typecheck`, `npm run lint`, `npm run format:check` i `npm run build`. Pozostają wcześniejsze ostrzeżenia Fast Refresh w `auth.tsx` i rozmiaru głównego pliku JS. Nie uruchomiono testów ani ręcznej weryfikacji UI.

## Ręczna weryfikacja kroku 2.7 i fazy 2

Testy oraz `release:smoke` nie zostały uruchomione podczas implementacji kroku 2.7 na prośbę
właściciela. Poniższą checklistę wykonaj lokalnie w Chrome przy szerokości około 390 px
i na desktopie; druga sesja wymaga incognito lub osobnego profilu przeglądarki.

- Dodaj wydarzenie ze wspólnym przypomnieniem: sprawdź wszystkie sześć presetów, własne
  wyprzedzenie w dniach, tygodniach i miesiącach oraz konkretną datę i godzinę. Wybierz
  uczestników, dorosłych i całą rodzinę. Zapisz i ponownie otwórz formularz.
- W szczegółach dodaj „Tylko ja”. W narzędziach sieciowych sprawdź POST `/api/reminders/mine`;
  wspólne powinny trafiać wyłącznie do body POST/PATCH `/api/events`.
- Zaloguj dziecko i otwórz wydarzenie rodzica: brak edycji/usuwania wydarzenia, ale działają
  dodawanie i usuwanie „Moich przypomnień”. Zapis wydarzenia przez rodzica zachowuje je.
- Dodaj absolutne przypomnienie z przeszłą datą: zobacz „nieaktualne”, usuń i odśwież.
  Usuń ostatnie wspólne przypomnienie w formularzu i sprawdź, że zapis wysyła `reminders: []`.
- Przesuń termin wydarzenia: offset podąża za nim, a absolutna data pozostaje stała.
  Dla całodniowych bazą jest 09:00, dla miesięcznych — 09:00 pierwszego dnia miesiąca.
- Sprawdź synchronizację między sesjami po maksymalnie 20 s i po powrocie do karty.
- Utwórz serię we wtorki i czwartki, odczytaj ją w kreatorze i edytuj „To i następne”:
  przeszłość bez zmian, przypomnienia osobiste drugiej osoby przy nowej serii.
  „Tylko to” zmienia termin wystąpienia i przelicza przypomnienia bez edycji ich konfiguracji.
- Otwórz deep link `/kalendarz/wydarzenie/:eventId?data=...` po odświeżeniu i przez logowanie;
  usunięte wydarzenie powinno pokazać komunikat. Termin „maj 2028” tylko w odległych.
- Usuń autora wydarzenia: wydarzenie zostaje z podpisem „były domownik”.

Istniejące testy czasu obejmują zmianę czasu, końce miesięcy i RRULE; testy API obejmują
uprawnienia, zachowanie/przeniesienie przypomnień osobistych oraz usunięcie autora.
Dodane testy komponentów obejmują zapis wspólnych, osobisty endpoint, własne wyprzedzenie,
datę absolutną i usuwanie nieaktualnych przypomnień. Wyniki testów i `release:smoke` pozostają
niepotwierdzone do ich osobnego uruchomienia. Lista powyżej nie potwierdza spełnienia kryteriów.

## Push API i service worker — krok 3.3

Wszystkie cztery endpointy wymagają sesji (również dla dziecka):

- `GET /api/push/public-key` → `{ ok: true, publicKey }` (wyłącznie publiczny klucz).
- `POST /api/push/subscriptions` przyjmuje wynik `subscription.toJSON()`: `{ endpoint, keys: { p256dh, auth }, expirationTime? }`. Endpoint musi używać HTTPS, klucze mają format base64url. Upsert własnej subskrypcji zwraca `{ ok: true }`; próba nadpisania cudzej daje 409.
- `DELETE /api/push/subscriptions` z `{ endpoint }` usuwa wyłącznie własną subskrypcję. Brak wpisu również daje `{ ok: true }`.
- `POST /api/push/test` wysyła na wszystkie własne urządzenia i zwraca `{ ok: true, sent, failed, removed }`. Brak urządzeń daje zera. Odpowiedzi dostawcy 404/410 usuwają wygasłe subskrypcje; inne błędy zwiększają `failed`.

Przy zmianie konta w tej samej przeglądarce usuń poprzednią subskrypcję API z sesją jej właściciela i wykonaj `unsubscribe()` w przeglądarce przed zapisaniem nowej. Ekran obsługi powiadomień powstaje w kroku 3.4.

Ręczny test bez ekranu UI (Chrome, lokalny build produkcyjny):

1. Uruchom `npm run build`, następnie `npm start`; otwórz `http://localhost:3000`. W DevTools > Application > Service Workers poczekaj na aktywny `/sw.js`. Dla nowego builda użyj „Update” i przeładuj stronę.
2. Wyłącznie po świadomej akcji w konsoli wykonaj `await Notification.requestPermission()` i zaakceptuj zgodę. System musi zezwalać Chrome na wyświetlanie powiadomień.
3. W polu Push w Application > Service Workers wklej JSON z istniejącym adresem wydarzenia: `{"title":"Test Rodzina","body":"Kliknij, aby otworzyć wydarzenie","tag":"rodzina-manual-test","url":"/kalendarz/wydarzenie/ID?data=2026-10-20"}`. Naciśnij Push. Sprawdź tytuł, treść i ikonę; ponowienie z tym samym tagiem zastępuje powiadomienie.
4. Kliknij powiadomienie: istniejąca karta aplikacji ma dostać fokus i otworzyć wskazane wystąpienie. Powtórz po zamknięciu karty i po wylogowaniu; istniejący mechanizm logowania zachowuje adres powrotu.
5. Wyślij zwykły tekst lub pusty push: pojawia się ogólne powiadomienie Rodzina, prowadzące do kalendarza. Zewnętrzne adresy są zastępowane kalendarzem.

Testy automatyczne kroku obejmują upsert, usunięcie, własność w tej samej i innej rodzinie, dziecko, 401 wszystkich endpointów, walidację, CSRF, mock PushSender, wiele urządzeń, sukcesy i błędy dostawcy. Testy service workera obejmują payload, ikony, tag, zachowanie deep linku, fokus/nawigację, otwarcie okna i niepoprawne dane.

Weryfikacja 2026-10-16: 28 nowych testów przechodzi; lint (dwa wcześniejsze ostrzeżenia Fast Refresh), typecheck, build i release:smoke przechodzą. Pełne npm test: 344 testy przeszły, 15 nie przeszło (testy istniejących komponentów kalendarza/ReminderPicker i limity czasu logowania). Testy ReminderPicker na kopii HEAD sprzed zmian potwierdzają wcześniejszą niejednoznaczność selektora „Kiedy przypomnieć”. Osobne uruchomienie wszystkich testów API z jednym workerem poza sandboxem: 116/116 przechodzi (przed dodaniem ostatniego testu niepoprawnego URL). Próba testu powiadomień w headless Chromium nie potwierdziła wyświetlenia powiadomienia; ręczny test systemowego powiadomienia z checklisty pozostaje do wykonania. Nie dodano migracji, zależności runtime, konfiguracji ani cronów.

## Powiadomienia — krok 3.4

Powtórne kliknięcie „Wyślij testowe” zastępuje poprzednie powiadomienie testowe
i ponownie sygnalizuje je przez `renotify: true`. Bez tej opcji Chrome może odebrać
push i zaktualizować powiadomienie bez pokazania kolejnego banera. Ręczny test:
kliknij „Wyślij testowe” dwukrotnie w odstępie kilku sekund, pozostawiając pierwsze
powiadomienie w centrum powiadomień; oba wysłania powinny zostać zasygnalizowane,
jeżeli ustawienia systemu zezwalają na banery.

Ekran **Więcej > Powiadomienia** (`/wiecej/powiadomienia`) pokazuje brak wsparcia,
blokadę, wyłączenie lub włączenie na bieżącym urządzeniu. Zgoda pojawia się wyłącznie
po kliknięciu „Włącz powiadomienia”. „Wyślij testowe” raportuje przekazanie do usługi
push, błędy i wygasłe subskrypcje; nie potwierdza wyświetlenia powiadomienia w systemie.
Test trafia na wszystkie urządzenia zalogowanej osoby. W kalendarzu pojawia się baner,
gdy są oczekujące przypomnienia dla tej osoby, a bieżące urządzenie nie jest włączone.
Status odświeża się co 20 s i po powrocie do karty. Po odmowie zgody trzeba odblokować
powiadomienia w ustawieniach witryny Chrome. Instrukcja instalacji PWA jest na ekranie.

Dodatkowy endpoint wymagający sesji: `POST /api/push/status` z `{}` albo `{ endpoint }`.
Zwraca `{ ok: true, subscribed, hasReminders }`, sprawdzając własność urządzenia oraz
odbiorców przez ten sam `resolveRecipients` co job. Nie zapisuje subskrypcji ani nie
zwraca jej adresu lub kluczy. `next_fire_at = null` nie powoduje baneru.

Ręczna weryfikacja lokalna na desktopie i fizycznym Androidzie:

1. Wykonaj `npm run build`, uruchom `npm start` (port 3000), a w drugim terminalu
   `npm run dev:cron`. Na Androidzie skonfiguruj przekierowanie USB portu 3000
   według instrukcji powyżej i otwórz `http://localhost:3000` w Chrome.
2. Zapisz przyszłe wydarzenie z przypomnieniem dla siebie. Kalendarz powinien pokazać
   baner prowadzący do powiadomień. Samo wejście na stronę nie prosi o zgodę.
3. Otwórz „Więcej > Powiadomienia”, kliknij „Włącz powiadomienia” i zaakceptuj zgodę.
   Status zmienia się na włączone, baner znika. Odśwież stronę i potwierdź ten status.
4. Kliknij „Wyślij testowe”. Potwierdź odbiór systemowego powiadomienia; zezwól Chrome
   na powiadomienia w systemie i wyłącz „Nie przeszkadzać”. Kliknięcie prowadzi do kalendarza.
5. Utwórz wydarzenie za 10 minut z przypomnieniem „w chwili rozpoczęcia” dla siebie.
   Pozostaw `dev:cron`, zamknij kartę/PWA i sprawdź odbiór z dokładnością do cyklu joba.
   Kliknięcie ma otworzyć właściwe szczegóły z datą wystąpienia. Powtórz dla serii,
   a także po wylogowaniu: logowanie ma przywrócić ten sam deep link.
6. Na osobnym profilu odmów zgody: pokaże się status zablokowania i instrukcja ustawień.
   Sprawdź ekran przy około 390 px oraz na desktopie. Po instalacji na Androidzie
   otwórz aplikację z ikony i powtórz test odbioru.

Krok nie dodaje migracji, zależności, zmiennych środowiska ani cronów. Backup i porządki
pozostają w kroku 3.5. Rzeczywisty odbiór push i punkt 5 wymagają ręcznego potwierdzenia;
testy z mockami i headless nie potwierdzają systemowego wyświetlenia na Androidzie.

Weryfikacja 2026-10-16: testy modułu powiadomień (komponenty, klient przeglądarki i API)
39/39 przechodzą. Playwright headless na buildzie produkcyjnym: 2/2 przechodzą dla
1280 × 800 i 390 × 844; sprawdzono nawigację, baner, status i brak poziomego przepełnienia,
a zrzuty obu szerokości obejrzano. `lint`, `typecheck`, `build` i `release:smoke` przechodzą;
lint zachowuje dwa wcześniejsze ostrzeżenia Fast Refresh w auth.tsx. Pełne `npm test --
--maxWorkers=1`: 369 zaliczonych, 12 błędów w starszych testach kalendarza i ReminderPicker
(m.in. niejednoznaczne selektory Mantine), 6 plików nieprzechodzących. Pełny zestaw nie
jest zielony. Pierwszą próbę testów w sandboxie przerwały błędy odczytu tymczasowych
plików Vitest, a smoke testu — brak dostępu do registry npm; powtórzenia poza sandboxem
potwierdziły powyższe wyniki. Odbiór systemowego push na desktopie i Androidzie oraz
próba za 10 minut pozostają do ręcznego wykonania.

## Krok 3.5 — backup i stan domknięcia fazy 3

Po `npm run build` wykonaj `npm run job:backup` z katalogu repozytorium. Job korzysta
z `apps/api/.env` i `RODZINA_BACKUP_DIR` (domyślnie `./apps/api/data/backups`, katalog
ignorowany przez Git). Kopia `rodzina-YYYY-MM-DD.db` ma datę w strefie Europe/Warsaw.
Ponowienie tego samego dnia zastępuje kopię po ukończeniu nowego snapshotu.
Rotacja zachowuje 14 ostatnich kopii dziennych. Nie dodajemy backupu do minutowej
pętli `dev:cron`; docelowy cron dzienny i procedurę odtworzenia opisuje `DEPLOY.md`.

Usunięto job heartbeat i `job:heartbeat`. Historyczna tabela `job_runs` pozostaje
w migracjach; krok nie wymaga nowej migracji. Build czyści `apps/api/dist`, aby stare
pliki joba nie trafiły do release. Smoke uruchamia przypomnienia i backup z ZIP,
sprawdza integralność kopii i obecność tabel przypomnień oraz subskrypcji.

| Kryterium kroku / fazy 3                                                             | Dowód lub pozostała weryfikacja                                                                                                                                                         |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Powstaje samodzielna kopia SQLite i działa rotacja do 14 kopii                       | Cztery testy `backup-db.test.ts`: snapshot otwartej bazy WAL, data Warszawy, ponowienie tego samego dnia, rotacja, pomijanie innych plików i zachowanie poprzedniej kopii przy błędzie. |
| Jedna wysyłka także przy równoległych uruchomieniach                                 | Testy `send-reminders.test.ts`: dwie konekcje i dwa niezależne procesy Node.                                                                                                            |
| Kolejny termin przypomnienia cyklicznego                                             | Testy joba obejmują cykle, DST i COUNT.                                                                                                                                                 |
| Usunięcie subskrypcji przy 410                                                       | Testy joba obejmują 404 i 410.                                                                                                                                                          |
| Awaryjna wysyłka do dorosłych przy usuniętym twórcy                                  | Test joba oraz testy `resolveRecipients` w `delivery.test.ts`.                                                                                                                          |
| Android: testowy push, termin za 10 minut, kliknięcie po zamknięciu i po wylogowaniu | Nadal wymaga fizycznego Androida i ręcznego przejścia checklisty kroku 3.4 powyżej. Testy z mockami tego nie potwierdzają.                                                              |
| Konfiguracja i cron (sekcja 1.1 planu)                                               | `RODZINA_BACKUP_DIR` opisane w `.env.example` i `DEPLOY.md`; dwa wpisy crona z logami, bez schedulera serwera.                                                                          |
| Migracje i zależności (sekcja 1.1 planu)                                             | Brak nowych migracji i zależności runtime; dotychczasowe migracje pozostają w paczce. Bez nowych wymagań kompilacji na serwerze, WebSocketów, Dockera i Redisa.                         |
| Paczka release (sekcja 1.1 planu)                                                    | `npm run release:smoke` przechodzi: serwer, health, SPA, manifest, SW oraz oba joby i kontrola kopii. Wszystko uruchomiono lokalnie.                                                    |

Weryfikacja 2026-10-16: zestaw backupu, wysyłki, odbiorców i konfiguracji przed dodaniem
dwóch testów konfiguracji backupu: 59/59. Pełne `npm test -- --maxWorkers=1`: 374 zaliczone
(w tym oba nowe testy konfiguracji), 12 błędów w 6 wcześniejszych plikach testów kalendarza
i ReminderPicker, zgodnych z wykazem z kroku 3.4. `lint`, `typecheck`, `build`, `format:check`
i `release:smoke` przechodzą. Lint zachowuje dwa wcześniejsze ostrzeżenia Fast Refresh;
build ostrzeżenie o rozmiarze głównego pliku JS. Testy uruchomiono ponownie poza sandboxem
po błędzie odczytu tymczasowych plików Vitest. Pełny zestaw nie jest zielony;
naprawa wcześniejszych testów i ręczna weryfikacja Androida pozostają warunkami
pełnego domknięcia fazy 3.
