# Praca lokalna

**Aktualizacja 19.10.2026:** kroki 4.8-4.10 wycofują PWA. Bieżące zasady i testy
opisuje sekcja „Wycofanie PWA” na końcu dokumentu; wcześniejsze instrukcje PWA są historyczne.

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

Skopiuj `apps/api/.env.example` do `apps/api/.env`. Od kroku 4.9 VAPID nie jest
wymagane; dodatkowe stare zmienne są ignorowane.
`npm run dev` uruchamia Fastify na porcie 3000 i Vite na 5173. Otwórz `http://localhost:5173`;
wywołanie `/api/health` przechodzi przez proxy Vite do API.

### Job przypomnień — zapis historyczny kroku 3.2

Od kroku 4.9 poniższe polecenia i testy Web Push są usunięte. Przypomnienia
sprawdzamy przez `/api/reminders/schedule` i alarmy APK; backup działa nadal.

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

# Android — krok 4.1

APK zawiera lokalne pliki tego samego interfejsu React. Kalendarz wymaga połączenia
z API; harmonogram i alarmy offline nie należą do kroku 4.1. APK nie rejestruje
service workera ani Web Push. Ekran powiadomień pokazuje informację o niedostępności
alarmów na tym etapie. PWA zachowuje dotychczasowy build, service worker i push.

Narzędzia: Node >=22 (sprawdzono 24.15.0), Capacitor 8.5.3, JDK 21, Android SDK 36,
build-tools 35.0.0 (dobierane przez AGP; zainstalowano też 36.0.0), Gradle 8.14.3
z wrappera oraz Android Gradle Plugin 8.13.0.
Minimalny Android to 7.0 (API 24). Można użyć Android Studio 2025.2.1 lub nowszego
albo samych narzędzi wiersza poleceń. Ustaw `JAVA_HOME` na JDK 21 oraz
`ANDROID_HOME` na katalog SDK. Do testów telefonu potrzebne są platform-tools/ADB
i debugowanie USB. Narzędzia nie są instalowane na vh.pl.

```text
npm ci
npm run android:sync
npm run android:debug
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

`android:sync` buduje shared i web w trybie `android` do `apps/web/dist-android`,
a następnie wykonuje Capacitor sync. `android:debug` wykonuje to samo oraz
`assembleDebug`. Frontend PWA powstaje nadal przez `npm run build` w `apps/web/dist`;
sync Androida go nie nadpisuje. W konfiguracji nie ma zdalnego `server.url`.
Plik `.env.android.example` opisuje konfigurację komputera budującego; nie jest
automatycznie wczytywany ani kopiowany do APK. Ustaw zmienną w terminalu przed sync.

Domyślny adres API to `https://rodzina.preficze.pl`. Lokalne testy wykonuj na
osobnej lokalnej bazie, bez zakładania testowych kont na serwerze. PowerShell:

```powershell
$env:RODZINA_ANDROID_API_ORIGIN = 'http://localhost:3000'
npm run android:debug
adb reverse tcp:3000 tcp:3000
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Uruchom lokalne API przez `npm run dev:api` albo `npm start` po buildzie PWA.
`localhost:3000` w APK trafia do API na komputerze dzięki `adb reverse`.
Debug dopuszcza HTTP wyłącznie dla localhost; release blokuje je także w pluginie
i konfiguracji sieciowej. Przed budową przeciwko produkcji usuń zmienną:
`Remove-Item Env:RODZINA_ANDROID_API_ORIGIN`, następnie ponów sync/build.
Nie zmieniaj hosta WebView ani ochrony Origin na serwerze.

Sesja APK: natywny `RodzinaApi` wysyła cookie i Origin API. OkHttp ma wyłączony
magazyn cookies i przekierowania, dzięki czemu cookie nie trafia do WebView.
Plugin przechowuje `sid` i termin ważności zaszyfrowane AES-GCM kluczem Android
Keystore, odnawia zapis z Set-Cookie serwera i usuwa go po 401. Dane sesji nie są
zwracane do JS. Zmiana originu, uszkodzony zapis lub wygaśnięcie wymagają logowania.
Backup Androida i logowanie mostka Capacitor są wyłączone. Wylogowanie próbuje
unieważnić sesję serwera i usuwa zapis lokalny także przy błędzie sieci; offline
nie można potwierdzić unieważnienia sesji serwerowej, która ostatecznie wygasa.
Cache zapytań jest czyszczony przy wylogowaniu, utracie sesji i zmianie konta;
spóźnione odpowiedzi poprzedniej sesji są odrzucane. Nie zapisujemy kalendarza
do localStorage ani do trwałego cache. 403 przy edycji cudzej treści nie wylogowuje.

Weryfikacja na urządzeniu (pozostaje wymagana przed uznaniem kroku za w pełni gotowy):

1. Zainstaluj debug APK i uruchom bez sieci — lokalny interfejs musi się otworzyć.
2. Połącz z lokalnym API, załóż rodzinę, zaloguj dorosłego, dodaj i edytuj wydarzenie.
3. Zamknij proces przez `adb shell am force-stop pl.preficze.rodzina`, uruchom ponownie
   i sprawdź zalogowane konto oraz odczyt kalendarza. Nie używaj `pm clear` ani reinstalacji.
4. Dodaj dziecko, wyloguj dorosłego, zaloguj dziecko kodem rodziny i PIN-em.
   Utwórz i edytuj własne wydarzenie. Powtórz zamknięcie procesu i uruchomienie.
5. Wyłącz sieć, wyloguj, uruchom ponownie — poprzednie konto i dane nie mogą wrócić.
   Zaloguj inną rodzinę i sprawdź, że nie ma danych poprzedniej.
6. Usuń sesję w lokalnej bazie testowej; po żądaniu 401 APK wraca do logowania.
   Błąd połączenia nie usuwa cookie; po odzyskaniu sieci ponów logowanie/odczyt.
7. W Chrome przy szerokości 390 i 1280 px sprawdź logowanie dorosłego/dziecka,
   zapis kalendarza i wylogowanie PWA. Playwright uruchamiaj wyłącznie headless.

Test magazynu na podłączonym Androidzie: po `npm run android:sync` uruchom
`./gradlew connectedDebugAndroidTest` z katalogu `android` (Windows:
`./gradlew.bat connectedDebugAndroidTest`). Sprawdza szyfrowany zapis, ponowne
utworzenie magazynu, wygaśnięcie, zmianę originu i usunięcie. Sam ten test nie
zastępuje zamknięcia i ponownego uruchomienia całego APK z punktów 3–4.

Źródła wersji i integracji: [wymagania Capacitor 8](https://capacitorjs.com/docs/updating/8-0),
[plugin Androida](https://capacitorjs.com/docs/plugins/android),
[Android Keystore](https://developer.android.com/privacy-and-security/keystore).

Wyniki kroku 4.1 (2026-10-16):

| Warunek „Gotowe, gdy”                                    | Wynik                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Debug APK z lokalnym frontendem                          | `npm run android:debug`: BUILD SUCCESSFUL; plik `android/app/build/outputs/apk/debug/app-debug.apk` (ok. 5,1 MB). W assets jest index.html i zasoby React, bez sw.js i manifestu PWA. Uruchomienie na telefonie pozostaje niepotwierdzone.                                                               |
| Logowanie dorosłego i dziecka, odczyt i zapis kalendarza | Testy `android-session.test.ts` sprawdzają istniejący kontrakt sesji i kalendarza dla obu ról; `platform.test.ts` transport przez mostek. End-to-end APK wymaga telefonu.                                                                                                                                |
| Trwałość po zamknięciu procesu                           | Zaimplementowano szyfrowany magazyn; dodano `SessionStoreTest`. Test procesu i wykonanie testu na Androidzie nie były przeprowadzone.                                                                                                                                                                    |
| Wylogowanie i zmiana konta                               | Dwa testy `auth-native.test.tsx`: wylogowanie offline usuwa sesję i cache, zmiana konta odrzuca starą odpowiedź. Testy mostka obejmują 401, 403 oraz awarię sieci.                                                                                                                                       |
| CSRF, izolacja rodzin, brak sesji                        | Dwa nowe testy API przechodzą: obcy origin/WebView odrzucony, inna rodzina dostaje 404, brak i unieważniona sesja 401, aktywność odnawia cookie. Kod ochrony API nie został zmieniony.                                                                                                                   |
| Regresja PWA                                             | Build z manifestem i SW przechodzi; Playwright headless: rejestracja, zaproszenie, logowanie dziecka, reset hasła i utrzymanie sesji — 2/2 przy 390 i 1280 px.                                                                                                                                           |
| Konfiguracja i paczka serwera                            | `.env.android.example`, komentarz w API `.env.example`, opis w DEPLOY.md; `release:smoke` zakończony pomyślnie. Brak nowych migracji lub cronów.                                                                                                                                                         |
| Kontrole jakości                                         | Lint (dwa wcześniejsze ostrzeżenia Fast Refresh), typecheck, format:check i build przechodzą. Pełny Vitest: 382 zaliczone, 12 wcześniejszych błędów w sześciu plikach kalendarza/ReminderPicker opisanych przy fazie 3; dodatkowe dwa testy cyklu sesji zaliczone osobno. Łącznie nowe testy kroku: 9/9. |

Nie uznajemy kroku za w pełni zweryfikowany: pozostają testy fizycznego Androida
oraz wcześniejsze błędy pełnego zestawu Vitest. W tym czacie właściciel pominął
sprawdzanie podłączonego telefonu przez ADB. Nie wykonywano zmian na produkcji.

Końcowa kontrola natywna: `:app:lintDebug`, `:app:assembleDebug` oraz
`:app:assembleDebugAndroidTest` zakończyły się BUILD SUCCESSFUL. Lint nie zgłasza
błędów; ostrzeżenia o nowszych wersjach zależności szablonu pozostają informacyjne.
Testowe APK zostało skompilowane, ale nie uruchomione na urządzeniu.

## API harmonogramu — krok 4.2

Zalogowany klient pobiera `GET /api/reminders/schedule` bez parametrów.
Odpowiedź zawiera `ok`, `generatedAt`, `validUntil` (ms UTC) i `reminders`.
Jest to pełny snapshot przyszłych alarmów bieżącej osoby: wspólnych i osobistych,
po rozstrzygnięciu odbiorców, cykli i wyjątków. Okno wynosi 90 × 24 h od odczytu,
z wyłączeniem chwili odczytu i włączeniem końca okna. Każdy wpis zawiera
`key`, `reminderId`, `sourceType`, `sourceId`, `occurrenceDate`, `fireAt`,
`title`, `body`, `url`. Treść ma bezwzględną datę; URL wskazuje pierwotną datę
wystąpienia także po jego przesunięciu. Alarmy bez godziny liczone są od 09:00
Europe/Warsaw. Precyzja miesiąca oznacza pierwszy dzień miesiąca jako bazę obliczeń.

Endpoint wymaga tej samej sesji co kalendarz (PWA i transport RodzinaApi).
Nie przyjmuje identyfikatora użytkownika ani rodziny od klienta. Nie zmienia
`next_fire_at` ani `last_sent_at`; rezerwacja crona nie jest potwierdzeniem
lokalnego dostarczenia. Brak nowych zmiennych środowiskowych, migracji i cronów.

Testy kontraktu: `npm test -- apps/api/src/modules/reminders/schedule.test.ts`.
Obejmują odbiorców, izolację rodzin, brak sesji, stabilność kluczy i stanu joba,
wyjątki, podział serii, obie zmiany czasu, terminy odległe i granice okna.
Krok 4.2 udostępnia API; zapis harmonogramu i alarmy na telefonie należą do 4.3.

Weryfikacja lokalna 16.10.2026 dla kroku 4.2: 11/11 testów harmonogramu
przechodzi; lint (dwa istniejące ostrzeżenia Fast Refresh w auth.tsx), typecheck,
format:check i build przechodzą. Pełny Vitest poza sandboxem: 395/407 testów
przechodzi. Te same 12 błędów UI potwierdzono na kopii HEAD sprzed tego kroku
(11/23 testów w sześciu sprawdzanych plikach UI przechodzi). Dotyczą
ReminderPicker, CalendarPage, DistantEvents, EventDetailsPage, MyReminders
oraz EventForm; nie zaliczamy pełnego zestawu jako zielonego. Pierwsze uruchomienie
w sandboxie miało też błędy ENOENT katalogu tymczasowego Vitest; powtórzenie
poza sandboxem pozwoliło wykonać wszystkie testy.

`npm run release:smoke` przeszedł poza sandboxem: instalacja zależności produkcyjnych,
start serwera, health, frontend i trasy SPA, job przypomnień oraz backup.

## Alarmy systemowe offline — krok 4.3

W APK otwórz **Więcej > Powiadomienia**. Osobno udziel zgody na powiadomienia
i dokładne alarmy. Po powrocie z ustawień użyj „Sprawdź zgody po powrocie z ustawień”,
następnie „Pobierz i zapisz harmonogram”. Pobierany jest pełny snapshot zalogowanej
osoby z API kroku 4.2. Ekran pokazuje liczbę zapisanych grup oraz zakres zabezpieczenia
w Europe/Warsaw; brak zgody, wyczerpany zakres, limit lub częściowa awaria nie daje
komunikatu sukcesu. „Ponów zapis z urządzenia” uzgadnia zapisany snapshot bez sieci,
np. po częściowej awarii. Zapisane wcześniej alarmy działają bez otwartego ekranu.

Snapshot oraz mapowanie ID są w prywatnym magazynie Androida, przypisane do konta.
Plugin ma drugi magazyn konkretnych alarmów odtwarzany natywnie po restarcie.
Wylogowanie (także offline), nowe logowanie i 401 czyszczą oba magazyny i powiadomienia.
Błąd transportu zachowuje dane. 403 samego harmonogramu czyści jego dane, a 403
edycji cudzego wydarzenia nadal nie wylogowuje użytkownika. Backup Androida pozostaje wyłączony.

Bliskie terminy (mniej niż 9 minut od pierwszego) łączymy w jeden alarm na początku
grupy, z treścią wszystkich przypomnień. Limit wynosi 400 grup; brakujące pozostają
w snapshotcie, a ekran pokazuje skrócony zakres. Po ponowieniu porównujemy wynik
z magazynem getPending pluginu, zamiast przyjmować sukces całej paczki.

Ograniczenia: po restarcie wymagane jest pierwsze odblokowanie telefonu. Wyłączenie
telefonu, wymuszone zatrzymanie APK, brak zgód, prywatna przestrzeń Androida i ograniczenia
producenta mogą uniemożliwić dostarczenie. Plugin po restarcie może wyświetlić zaległy
alarm po włączeniu/odblokowaniu; nie oznacza to dostarczenia o czasie przy wyłączonym telefonie.
Zmiany na innym urządzeniu wymagają ręcznego pobrania (automatyzacja dopiero 4.4).
Kliknięcie właściwego wystąpienia i podgląd offline należą do 4.5.
PWA ma niezależną subskrypcję: zalecamy wyłączyć jej powiadomienia na tym telefonie,
jeśli używasz APK. Nie wyłączaj subskrypcji innych urządzeń.

### Obowiązkowa próba na fizycznym Androidzie

1. Zbuduj debug APK (`npm run android:debug`) i zainstaluj bez usuwania danych aplikacji.
   Zaloguj się online, ustaw pojedyncze przypomnienie na kilka minut później,
   udziel obu zgód i pobierz harmonogram. Zapisz widoczny wynik, wersję Androida,
   model telefonu i planowany termin; nie używaj testowego czasu joba serwera.
2. Włącz tryb samolotowy (wyłącz także Wi-Fi), zamknij interfejs APK przez listę
   ostatnich aplikacji i zablokuj ekran. Nie stosuj „Wymuś zatrzymanie”. Zapisz
   rzeczywisty moment odbioru i opóźnienie. Dla pojedynczego alarmu wymagamy ≤60 s.
3. Powtórz z nowym przyszłym przypomnieniem: pobierz online, włącz tryb samolotowy,
   uruchom telefon ponownie i przynajmniej raz odblokuj. Nie otwieraj APK i nie włączaj
   sieci. Zablokuj ekran, odczekaj do terminu i zanotuj dostarczenie/opóźnienie.
4. Sprawdź ponowne pobranie, edycję i usunięcie przypomnienia (ręczne pobranie po
   każdej zmianie), brak duplikatów, dwie bliskie daty w jednej grupie oraz cofnięte
   zgody. Wyloguj offline i sprawdź brak alarmów oraz powiadomień poprzedniego konta.
5. Opcjonalnie uruchom `gradlew.bat connectedDebugAndroidTest` z katalogu android.
   AlarmStoreTest sprawdza trwałość danych, zmianę konta, rewizję i wylogowanie;
   nie zastępuje scenariuszy dostarczenia z punktów 2–3.

Scenariusz fazy z datą 18.10.2026 15:00 pozostaje osobnym przyszłym testem.
Na 16.10.2026 testy sprzętowe kroku 4.3 nie zostały wykonane — nie udzielono zgody
na sprawdzenie urządzenia przez ADB. Mocki i test przeglądarkowy nie dowodzą alarmu
przy zablokowanym ekranie ani po restarcie. Krok pozostaje niepotwierdzony sprzętowo.

### Wyniki lokalne 16.10.2026

- Vitest: 327/327, 35 plików; w tym 12 przypadków adaptera oraz 3 testy ekranu.
  Adapter sprawdza kolizje i zawijanie ID, grupowanie, ponowienie po restarcie JS,
  zmianę/usunięcie, częściową awarię, fałszywe powodzenie pluginu, błąd sieci,
  niepełny/stary snapshot, brak zgód, limit i wylogowanie w trakcie pobrania.
- Lint i typecheck przechodzą; lint ma dwa wcześniejsze ostrzeżenia Fast Refresh
  w auth.tsx. Format:check i build API/PWA przechodzą.
- Android: debug APK, Android Lint i kompilacja testowego APK przechodzą.
  AlarmStoreTest jest skompilowany, ale nie wykonany na telefonie.
- Playwright headless: 4/4 — nowy ekran z atrapą mostka Androida oraz regresja
  ekranu PWA przy 390 i 1280 px, bez poziomego przepełnienia. Użyto tymczasowej
  konfiguracji na porcie 3418, ponieważ standardowy port 3417 był zajęty.
- Release:smoke przechodzi: zależności produkcyjne, start serwera, health, frontend,
  trasy SPA, service worker, job przypomnień i backup. Nie zmieniano produkcji.
- Pozostałe warunki „Gotowe, gdy”: odbiór przy zablokowanym ekranie offline
  i drugi odbiór po restarcie telefonu nadal wymagają prób z procedury powyżej.

## Synchronizacja harmonogramu i ekran powiadomień — krok 4.4

APK pobiera i uzgadnia harmonogram po zalogowaniu/uruchomieniu, zapisie lub
usunięciu wydarzenia albo własnego przypomnienia, wznowieniu, odzyskaniu sieci
i co 20 sekund przy aktywnej aplikacji. Nasłuch App/Network jest usuwany po
zmianie konta. Pobrania i operacje systemowych alarmów są serializowane;
spóźniony wynik poprzedniego konta lub unieważnionej operacji jest odrzucany.
Brak sieci nie kasuje poprzedniego harmonogramu. Wylogowanie offline nadal
usuwa alarmy, powiadomienia i dane konta przez istniejący mechanizm natywny.

**Więcej > Powiadomienia** pokazuje osobno zgody na powiadomienia i dokładne
alarmy, liczbę zapisanych grup, datę snapshotu, ostatnią udaną synchronizację
oraz rzeczywisty zakres zabezpieczenia offline (`validUntil`, Europe/Warsaw).
Data sukcesu przetrwa ponowne uruchomienie. Brak zgody, błąd pobrania,
częściowe planowanie i limit nie są sukcesem. „Synchronizuj teraz” ponawia
pobranie; „Ponów zapis z urządzenia” uzgadnia zapisany snapshot bez sieci.
Ten drugi przycisk nie zmienia daty ostatniego udanego pobrania.
Po udzieleniu zgody ekran ponawia synchronizację; powrót z ustawień również
wywołuje odświeżenie. Zgody są żądane wyłącznie po świadomym kliknięciu.
Baner APK prowadzi do tego ekranu i nie zależy od subskrypcji Web Push.
PWA zachowuje ekran i test powiadomień przeglądarkowych.

### Procedura fizycznego telefonu — do wykonania

1. Zbuduj i zainstaluj debug APK z aktualnymi pluginami. Zaloguj się, udziel
   obu zgód i sprawdź automatyczny zapis przypomnienia na przyszły termin.
   Zapisz model, wersję Androida, czas ostatniej synchronizacji, liczbę grup
   i `validUntil`. Sprawdź ponownie po zamknięciu i uruchomieniu APK.
2. Na drugim urządzeniu zmień termin/treść wydarzenia. W aktywnym APK w ciągu
   20 s potwierdź nowy harmonogram i brak alarmu o starej godzinie. Powtórz
   z usunięciem oraz zmianą osobistego przypomnienia. Ponów kilka razy:
   liczba alarmów nie może wzrosnąć przez duplikaty.
3. Zapisz kolejny alarm, zamknij interfejs przez listę ostatnich aplikacji
   (bez „Wymuś zatrzymanie”). Zmień wydarzenie na drugim urządzeniu.
   Przed wznowieniem nie oczekuj aktualizacji telefonu: poprzedni zapis
   pozostaje obowiązujący. Wznów APK online i potwierdź aktualizację/anulowanie.
   Zapisz wynik obu etapów: przed i po wznowieniu. To wymagany test granicy
   zamkniętego APK; nie zastępuje go mock ani uruchomienie joba serwera.
4. Włącz tryb samolotowy, użyj „Synchronizuj teraz”: czytelny błąd i zachowany
   poprzedni zakres, bez nowego sukcesu. Włącz sieć przy aktywnym APK:
   harmonogram ma się odświeżyć. Cofnij dokładne alarmy w ustawieniach i wróć:
   ekran ma pokazać brak zgody/niepełne zabezpieczenie.
5. Wyloguj offline: brak alarmów i widocznych powiadomień poprzedniej osoby.
   Przywróć sieć i zaloguj inne konto; poprzednie dane nie mogą wrócić,
   również po zakończeniu opóźnionego pobrania.

Stan na 17.10.2026: testów fizycznego telefonu i zamkniętego APK nie wykonano;
sprawdzenie urządzenia przez ADB nie zostało zatwierdzone. Powyższa procedura
jest planem weryfikacji, a nie zaliczonym wynikiem. Implementacja kroku pozostaje
niepotwierdzona sprzętowo; nie zmieniano serwera produkcyjnego.

### Wyniki lokalne 17.10.2026 i warunki „Gotowe, gdy”

| Warunek kroku 4.4                                                                  | Wynik                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zmiana/usunięcie z drugiego urządzenia aktualizuje/anuluje alarm po synchronizacji | Headless z prawdziwym lokalnym API i atrapą mostka: utworzenie wydarzenia, edycja przez osobny request API, niezmienione ID z nową treścią i anulowanie po usunięciu. Próba dwóch fizycznych urządzeń pozostaje do wykonania. |
| Ponowienie nie dubluje alarmów                                                     | Testy adaptera: ponowne pobranie, ponowienie po restarcie JS, zachowanie ID, częściowa awaria i ponowne planowanie brakujących alarmów.                                                                                       |
| Przerwany request zachowuje poprzedni harmonogram                                  | Test adaptera oraz headless: odcięcie requestu harmonogramu pozostawia zapisany alarm; ekran pokazuje błąd i wcześniejszą datę sukcesu.                                                                                       |
| Odpowiedź poprzedniego konta/snapshotu nie odtwarza jego danych                    | Testy generacji, starszego snapshotu, zmiany konta podczas pobrania i opóźnionego sprawdzania zgód; anulowanie Query unieważnia operację schedulera.                                                                          |
| Wylogowanie offline usuwa alarmy                                                   | Testy czyszczenia schedulera i cyklu sesji offline. Natywny magazyn jest czyszczony istniejącym clearSession; próba sprzętowa pozostaje do wykonania.                                                                         |
| Brak fałszywego sukcesu przy braku zgody/błędzie planowania                        | Testy zgód, faktycznie zapisanych alarmów, częściowej awarii oraz ekranu z poprzednim sukcesem i nowym błędem.                                                                                                                |
| Zamknięte APK wymaga wznowienia/synchronizacji                                     | Zaimplementowane ograniczenie i procedura powyżej; test fizycznego telefonu niewykonany, warunek niezaliczony sprzętowo.                                                                                                      |

- Vitest: pełny zestaw 336/336 w 36 plikach; po dopracowaniu anulowania
  ponownie sprawdzono 43/43 testów powiadomień i sesji.
- Lint: brak błędów, dwa wcześniejsze ostrzeżenia Fast Refresh w auth.tsx.
  Typecheck, format:check i build API/PWA przechodzą.
- Playwright wyłącznie headless: 4/4, ekran APK z atrapą mostka i regresja PWA
  przy 390 i 1280 px; brak poziomego przepełnienia. Zrzuty ekranów sprawdzono
  wizualnie. Użyto izolowanego serwera na porcie 3418.
- Android: synchronizacja trzech pluginów, build debug APK i Android Lint
  przechodzą. Artefakt: `android/app/build/outputs/apk/debug/app-debug.apk`.
- `release:smoke` przechodzi. Brak zmian konfiguracji środowiska, migracji,
  cronów lub nowych zależności runtime serwera. Nie wykonano deployu ani
  instalacji APK na telefonie.

## Nawigacja Androida, linki i użyteczność — krok 4.5

APK nasłuchuje `localNotificationActionPerformed`, także zachowanego zdarzenia
startowego pluginu, i otwiera `/kalendarz/wydarzenie/:id?data=YYYY-MM-DD`.
Capacitor BridgeActivity przekazuje intent przy zimnym starcie; nie przekazujemy
go ponownie, aby nie dublować nawigacji. W grupie alarmów otwierane jest pierwsze
wystąpienie (adres zapisany w `extra.url`). Obce adresy są odrzucane.

Bez połączenia ekran pokazuje wyłącznie zapisane tytuły i treści przypomnień dla
tego adresu z ostrzeżeniem o możliwej nieaktualności. Dane odczytuje natywny plugin
po sprawdzeniu ważnej lokalnej sesji. Pozwala to otworzyć podgląd również po
zamknięciu procesu bez odtwarzania pełnego konta offline. Brak wpisu/sesji daje
komunikat i link logowania z wewnętrznym `next`. „Sprawdź aktualne dane” ponawia
sesję i dane wydarzenia. Potwierdzone 403/404 nie pokazuje starego podglądu.

App Links przy uruchomionym APK obsługuje `appUrlOpen`, a zimny start również
`getLaunchUrl`. Akceptujemy tylko HTTPS domeny produkcyjnej, zaproszenie lub reset.
W przeglądarce pozostają istniejące trasy. Konfigurację certyfikatu/domeny opisuje
DEPLOY.md; nie publikuj prywatnych kluczy. Źródła techniczne:
[Capacitor App](https://capacitorjs.com/docs/apis/app),
[Deep Links](https://capacitorjs.com/docs/guides/deep-links).

Wstecz: aktywne pole traci fokus, następne cofnięcie zamyka górny modal przez Escape,
potem cofa trasę; brak historii prowadzi do kalendarza, a ekran główny minimalizuje
APK. Formularz wydarzenia pyta o odrzucenie niezapisanych zmian. Android obsługuje
systemowe paski, wycięcie i klawiaturę przez insets; CSS przeglądarki stosuje safe-area.
Linki w APK kopiujemy przez ClipboardManager i udostępniamy systemowym chooserem.

### Próby na fizycznym telefonie — do wykonania

1. Zbuduj debug APK z lokalnym frontendem, zainstaluj zgodnie z istniejącą procedurą.
   Skonfiguruj faktyczny odcisk certyfikatu na domenie według DEPLOY.md. Zweryfikuj
   domenę w ustawieniach Androida „Otwieranie obsługiwanych linków”. Opcjonalnie ADB:
   `adb shell pm verify-app-links --re-verify pl.preficze.rodzina`, potem
   `adb shell pm get-app-links pl.preficze.rodzina`. Stan domeny musi być `verified`.
2. Z komunikatora otwórz prawdziwy link zaproszenia, potem resetu, przy zamkniętym
   i uruchomionym APK. Sprawdź właściwy token/ekran i wykonanie formularza.
   Bez APK sprawdź te same linki w Chrome. Nie uznawaj wymuszonego intentu do
   pakietu przez ADB za dowód weryfikacji domeny.
3. Zapisz alarm wydarzenia cyklicznego z przyszłym wystąpieniem. Kliknij otrzymane
   powiadomienie przy działającym APK i po zamknięciu procesu. W obu przypadkach
   sprawdź konkretną datę wystąpienia. Powtórz po wyłączeniu sieci i zamknięciu
   procesu: ma być zapisany podgląd, ostrzeżenie, brak edycji. Włącz sieć i użyj
   ponowienia. Wylogowanie lub zmiana konta nie może odsłonić poprzedniego podglądu.
4. Usuń wydarzenie lub odbierz dostęp na serwerze. Po ponownej synchronizacji
   i otwarciu adresu sprawdź komunikat o braku wydarzenia/dostępu; stary podgląd
   nie może zastępować odpowiedzi 403/404. Offline przed synchronizacją pozostaje
   ograniczenie znane z kroku 4.4.
5. W formularzu wydarzenia wpisz tekst. Cofnij klawiaturę, potem użyj Wstecz:
   odrzucenie potwierdzenia zachowuje treść, akceptacja zamyka formularz. Sprawdź
   także Escape, przycisk Anuluj, zamknięcie modala, obrót telefonu i paski systemu.
   Skopiuj i udostępnij link zaproszenia/resetu przez systemowe menu.

Stan na 17.10.2026: testy fizycznego telefonu, prawdziwego intentu powiadomienia,
weryfikacji domeny i natywnego menu udostępniania nie zostały wykonane. Testy
headless z atrapą mostka sprawdzają React i układ, nie zastępują tych prób.

### Wyniki lokalne i warunki „Gotowe, gdy” — 17.10.2026

- Vitest: 349/349 testów w 41 plikach, w tym odrzucanie obcych URL w alarmie,
  App Links i `next`, zachowanie daty wystąpienia, pierwszeństwo nowego intentu,
  podgląd z magazynu i brak wpisu po utracie sesji, 403 bez starej treści,
  ochrona formularzy oraz natywne kopiowanie/udostępnianie.
- Playwright wyłącznie headless: 8/8 przy 390 i 1280 px. Test zimnego startu
  z zachowanym kliknięciem alarmu otwiera właściwą datę i zapisany podgląd;
  linki przekazane przez atrapę Androida otwierają reset i zaproszenie.
  Regresja przeglądarki obejmuje zaproszenie, reset, logowanie dzieci i powrót
  po logowaniu do szczegółów. Anulowanie modala, Escape i cofnięcie historii
  zachowują wpisany formularz po odmowie odrzucenia zmian. Zrzuty podglądu
  sprawdzono wizualnie; brak poziomego przepełnienia w obu szerokościach.
- Test wykrył i zweryfikował poprawkę wyścigu: nasłuchy intentów rejestrujemy
  po zamontowaniu RouterProvider, aby ekran powitalny nie nadpisał celu alarmu.
- Lint i format:check przechodzą (dwa wcześniejsze ostrzeżenia Fast Refresh
  w auth.tsx), typecheck i build API/PWA przechodzą. Build debug Androida
  i Android Lint sprawdzono z JDK 21.0.12.1, SDK 36 i Gradle 8.14.3.
- `release:smoke` potwierdza paczkę serwera, JSON assetlinks, trasy przeglądarki,
  manifest, service worker, job przypomnień i backup. Nie dodano migracji ani crona.
  Nowa konfiguracja certyfikatów jest opisana w `.env.example` i DEPLOY.md.
- Pełne „Gotowe, gdy” pozostaje niepotwierdzone sprzętowo: otwarcie prawdziwych
  linków po zweryfikowaniu domeny, kliknięcie alarmu w działającym/zamkniętym APK,
  systemowe Wstecz, klawiatura/insets i menu udostępniania wymagają powyższych prób.
  Nie wykonano deployu ani instalacji APK na telefonie.

# Krok 4.6 — weryfikacja podpisanych wydań i aktualizacji

Budowa: `npm run android:debug` bez sekretów; release: `npm run android:release`
według DEPLOY.md. Wersja jest w `android/version.properties`. Keystore i jego kopia
pozostają poza repo. Testowy klucz nigdy nie powinien służyć do publikacji rodzinie.

## Checklista telefonu (fizyczne urządzenie, podpisane APK)

1. Zapisz model, wersję Androida, wersje starego/nowego APK, publiczny odcisk klucza,
   wersje Node/JDK/SDK/Gradle, datę oraz wynik każdej próby. Bez zapisywania sekretów.
2. W Chrome otwórz stronę logowania: sprawdź numer i pobierz podpisane APK. Udziel
   zgody Chrome na instalację z tego źródła, zatwierdź instalator. Uruchom APK,
   zaloguj dorosłego i dziecko na testowych kontach, odczytaj/zapisz kalendarz.
3. Zapisz przyszły alarm online, zamknij i otwórz APK. Potwierdź zachowanie sesji.
   Opublikuj wyższy versionCode podpisany tym samym kluczem. Sprawdź automatyczne
   wykrycie po starcie/wznowieniu/sieci i ręczne „Sprawdź aktualizacje”.
4. Wybierz „Aktualizuj”, obserwuj postęp. Odmów zgody dla Rodziny, następnie zezwól
   w systemowych ustawieniach i wróć do ponowienia. Anuluj instalator; sesja i alarm
   mają pozostać. Ponów i zatwierdź. Nowy numer musi pochodzić z zainstalowanego
   pakietu, a nie z samego faktu uruchomienia instalatora.
5. Sprawdź zachowanie sesji i zapisanych alarmów po aktualizacji. Wyłącz internet,
   zamknij interfejs, zablokuj telefon i odbierz wcześniej zapisany alarm; nie może
   być duplikatów. Powtórz po restarcie offline i regresję zgód/harmonogramu z 4.3–4.5.
6. Przerwij pobieranie, odłącz sieć, sprawdź brak miejsca, uszkodzony SHA-256 i
   anulowanie. Instalator nie może dostać uszkodzonego/niedokończonego pliku.
   Równe/niższe versionCode nie proponuje aktualizacji; 404, błędny JSON i awaria
   serwera nie blokują interfejsu ani lokalnego alarmu.
7. W przeglądarce/PWA przy 390 i 1280 px sprawdź logowanie i „Więcej”: pobranie,
   instrukcję, brak wydania bez martwego linku oraz regresję kalendarza, sesji,
   linków i Web Push. Przycisk pobrania ma być ukryty w APK. Nie uznawaj atrap
   Playwright ani testu joba serwera za dowód zachowania instalatora/alarmów Androida.

Stan początkowy 17.10.2026: właściciel nie ma klucza produkcyjnego; przygotowano
procedurę jego utworzenia i kopii zapasowej. Nie opublikowano APK ani metadanych,
nie zmieniono produkcji. Testy fizycznego telefonu pozostają do wykonania.
Pełne „Gotowe, gdy” 4.6 wymaga tych wyników; fazę 4 domyka osobno krok 4.7.

## Wyniki lokalne kroku 4.6 — 17.10.2026

- Node 24.15.0, npm 11.12.1, JDK Microsoft 21.0.12.1, Android SDK/build-tools 36.0.0,
  Gradle 8.14.3, Capacitor Android 8.5.3. Polecenia: `npm run lint`,
  `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`,
  `npm run test:e2e`, `npm run release:smoke`, `npm run android:debug` oraz Gradle
  `assembleDebug testDebugUnitTest lintDebug`.
- Vitest: 377/377 testów w 45 plikach. Po końcowych poprawkach ponowiono 28/28
  testów nowych modułów. Testy obejmują wersje równe/niższe/wyższe, walidację
  metadanych i URL, błędy sieci, limit częstotliwości, ponawianie zgody,
  odrzucenie uszkodzonego pobrania przed instalatorem i widoczność przycisków.
- Testy JVM: 3/3, rzeczywiste strumienie z SHA-256, znaną/nieznaną długością,
  uszkodzeniem, pustym/niedokończonym transferem, anulowaniem, limitem i brakiem
  miejsca. Android Lint: 0 błędów, 18 wcześniejszych ostrzeżeń zasobów/uprawnień;
  brak ostrzeżeń w nowych klasach aktualizacji.
- Zbudowano debug i podpisany release. Ścieżkę podpisywania sprawdzono osobnym
  jednorazowym JKS poza repo, o ważności dwóch dni; po próbie usunięto klucz.
  `android:package` zweryfikował podpis, pakiet i wersję oraz przygotował APK,
  SHA-256, latest.json i publiczny odcisk certyfikatu. Lokalny katalog
  `.android-tools/step46-test-release` oznaczono `TEST-ONLY.txt`; nie publikować tej paczki
  ani nie używać jej jako pierwszej instalacji rodzinnej. Wydanie produkcyjne
  wymaga własnego trwałego klucza. Katalog `android-releases/1-1.0.0` pozostaje
  wolny na pierwsze rzeczywiste wydanie.
- Playwright headless: 16/16 przy 390 i 1280 px. Pobranie i brak wydania na
  logowaniu i „Więcej”, walidacja originu, poprawny numer wersji i instrukcja.
  Zrzuty obu szerokości sprawdzono wizualnie; brak poziomego przepełnienia.
  Regresja obejmuje rejestrację, zaproszenie, reset, dziecko, kalendarz, deep linki,
  formularze oraz ekrany lokalnych alarmów i Web Push z atrapami mostka.
- Build, lint, format:check, typecheck i smoke przechodzą. ESLint ma dwa wcześniejsze
  ostrzeżenia Fast Refresh w auth.tsx; build ostrzega o istniejącym dużym bundle.
  Smoke potwierdza 404 JSON/no-store bez APK, brak fallbacku SPA dla APK, nagłówki,
  manifest, service worker, job przypomnień i backup. Nową zmienną katalogu
  wydań opisano w `.env.example` i DEPLOY.md; brak migracji, crona i nowych zależności.
- Nadal niepotwierdzone: pierwsza instalacja ze strony, systemowa zgoda i odmowa,
  aktualizacja ze starszej podpisanej wersji, zachowanie sesji i rzeczywistego
  alarmu offline na fizycznym urządzeniu. Nie wykonano deployu ani publikacji.

# Diagnostyka podpisywania — 17.10.2026

Po zgłoszeniu nieudanego podpisania przy poprawnym `keytool -list` dodano
`npm run android:release:interactive` (odczyt haseł w konsoli JDK) oraz
`npm run android:check-signing` (kontrola wartości ze zmiennych procesu).
Test na jednorazowym JKS z różnymi hasłami magazynu i klucza, w tym znakami
nie-ASCII, potwierdza rozróżnienie błędnego hasła magazynu, aliasu i hasła klucza
bez ujawniania poświadczeń w wyjściu. Release nie współdzieli daemona Gradle.

Weryfikacja: 378/378 testów Vitest w 46 plikach, lint (dwa wcześniejsze ostrzeżenia),
format:check, typecheck i build przechodzą. Klucz właściciela nie został zmieniony;
wynik podpisywania z jego hasłami pozostaje do sprawdzenia lokalnie przez właściciela.

## Krok 4.7 — ręczny deploy i stan domknięcia fazy 4

Implementację rozpoczęto 17.10.2026; końcową weryfikację wykonano 18.10.2026.
Workflow `.github/workflows/deploy.yml` ma wyłącznie `workflow_dispatch`, odrzuca
inne gałęzie niż `main`, weryfikuje dokładny commit na Node 24 i przesyła sprawdzony
ZIP. `scripts/deploy.mjs` obsługuje walidację, SSH/SCP i kontrole HTTPS;
`scripts/deploy-remote.mjs` jest wykonywany przez stdin Node hostingu. Konfigurację,
backup, historię paczek, etapy awarii i ręczne odzyskiwanie opisuje DEPLOY.md.

Testy `npm test -- scripts/deploy.test.mjs` obejmują 14 scenariuszy:

- Walidację gałęzi/SHA, hosta, portu, bezwzględnych ścieżek, nodevenv i sekretów,
  zakres plików ZIP-a, brak wymaganych plików i wskazanie innej aplikacji.
- Preflight na rzeczywistym katalogu testowym: identyfikację aplikacji, środowisko
  produkcyjne, katalog publiczny, bazę, backupy, katalog APK, brak narzędzi i prywatne
  pliki w zarządzanych drzewach. Kontrola poprawnego preflight jest uruchamiana na
  Node 24; macierz CI z Node 22 pomija ten jeden scenariusz, zgodnie z wymogiem hostingu.
- Lokalną próbę na katalogu z atrapą transportu SSH/SCP: przesłanie sprawdzonych
  bajtów, przygotowanie zależności, backup przed podmianą, historię paczek, podmianę
  API/PWA i restart. Prywatne pliki, baza/WAL/SHM, logi, backupy, konfiguracja,
  crony, metadane i APK zachowują zawartość. Stare assety pozostają dostępne.
- Błędy sumy, rozpakowania, instalacji zależności, backupu, zachowania poprzedniej
  paczki i transferu przerywają pracę przed podmianą. Nie ma restartu przy takim błędzie.
- Ograniczone ponowienia health JSON, strony i 401 bez sesji, kontrolę sumy APK,
  odrzucenie obcego URL, błąd po restarcie i brak automatycznego cofania bazy.
- Statyczną kontrolę wyzwalacza ręcznego, odrzucenia innych gałęzi przed checkoutem,
  kolejności wszystkich sprawdzeń przed deployem, SHA, uprawnień i blokady Actions.

Transport SSH/SCP, rozpakowanie, npm, job backupu i archiwizacja są w próbie lokalnej
zastępowane atrapami; test wykonuje prawdziwe operacje kopiowania i zachowania plików.
Ta próba nie dowodzi dostępu SSH ani działania Node/prebuildów na vh.pl. Wymaga to
kontrolowanego uruchomienia na serwerze; nie wykonano go w tym czacie. Nie zmieniono
produkcji ani konfiguracji GitHub, nie opublikowano nowego APK.

Wyniki lokalne: lint (dwa wcześniejsze ostrzeżenia Fast Refresh), format:check,
typecheck, build, Playwright headless 16/16 (390 i 1280 px), `release:smoke` oraz
`android:debug` przechodzą. Końcowy pełny Vitest: 392/392 w 47 plikach,
w tym 14/14 testów deployu. Pierwsze uruchomienie pełnego Vitest w sandboxie
miało błędy odczytu plików tymczasowych; ponowienie poza sandboxem przeszło.
Playwright, smoke i Gradle także potwierdzono poza sandboxem po zatrzymaniu/błędzie
prób w ograniczonym środowisku. Build zgłasza dotychczasowy duży bundle webowy.

### Kryteria fazy 4 — potwierdzenia i brakujące próby

| Kryterium z PLAN.md                                                             | Stan i dowód                                                                                                                                                        |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lokalny frontend APK, współpraca API, trwała sesja, regresja PWA                | Implementacja 4.1–4.6, build Androida, testy API/web/e2e; trwałość sesji na fizycznym urządzeniu nadal wymaga potwierdzenia. Produkcyjna baza nie była podmieniana. |
| Alarm 18.10.2026 o 15:00, zapis przed 10:00, offline od 10:00, opóźnienie ≤60 s | Brak potwierdzenia sprzętowego. Nie zaliczamy tego kryterium na podstawie testów automatycznych ani samego upływu daty.                                             |
| Restart offline oraz brak starych/podwójnych alarmów po zmianach                | Testy adaptera i synchronizacji istnieją; odbiór po restarcie fizycznego telefonu nadal niepotwierdzony.                                                            |
| Europe/Warsaw, zmiana czasu, strefa telefonu, bliskie terminy, limity i zgody   | Testy czasu, harmonogramu i adaptera; zachowanie systemu na docelowym telefonie wymaga prób z checklist 4.3–4.6.                                                    |
| Wylogowanie/zmiana konta, izolacja odbiorców, status synchronizacji w UI        | Pokryte testami API, adaptera i komponentów; próba na fizycznym urządzeniu pozostaje do wykonania.                                                                  |
| Brak Web Push w APK i niezależne zgody PWA                                      | Rozdzielenie platform w kodzie i regresji, instrukcja wyłączenia push PWA na tym samym telefonie; ręczna próba do potwierdzenia.                                    |
| Pobranie, wykrycie i instalacja podpisanego APK, zachowanie sesji/alarmów       | Testy metadanych, aktualizatora i przeglądarki przechodzą; instalator i aktualizacja między rzeczywistymi wydaniami na fizycznym telefonie nadal niepotwierdzone.   |
| Smoke serwera i osobne publikowanie API/PWA oraz APK                            | Smoke przechodzi; DEPLOY.md opisuje obie procedury i ograniczenia. Nie wykonano publikacji produkcyjnej.                                                            |
| Ręczny Actions z main, backup, restart, HTTP, zachowanie danych/APK             | Workflow i 14 testów lokalnych; kontrolowane wykonanie GitHub Actions na vh.pl pozostaje do wykonania po konfiguracji przez właściciela.                            |

Gotowość do deployu (sekcja 1.1): brak nowych zmiennych API, cronów i migracji;
dotychczasowa konfiguracja i cron pozostają zachowane. Brak nowych zależności runtime
ani wymogu ich kompilacji na serwerze; prebuild-only przerywa deploy, jeśli nie ma
gotowej binarki. Brak nowego procesu w tle, WebSocketów, Dockera i Redisa. Sprawdzono
smoke paczki serwera oraz build Androida, APK publikuje się nadal osobno. Krok 4.7
jest zaimplementowany lokalnie; pełna akceptacja fazy 4 pozostaje otwarta do czasu
zapisania wyników powyższych prób sprzętowych i kontrolowanego deployu.

## Diagnostyka alarmów offline po zgłoszeniu 19.10.2026

Właściciel na OPPO Reno 5Z z Androidem 13 i APK `1.0.0-deploy.2` potwierdził obie
zgody, dodał przyszłe przypomnienie i uzyskał `1 z 1`. Ekran nadal pokazywał
niepełne zabezpieczenie i baner. Po wyłączeniu internetu i usunięciu APK z listy
ostatnich przypomnienie nie pojawiło się o czasie. Powiadomienie zobaczył dopiero
po wejściu do aplikacji i połączeniu z internetem. Nie ustalono źródła tego
powiadomienia ani dokładnej przyczyny niedostarczenia lokalnego alarmu.

W poprawionym ekranie:

- `0 z 0` oznacza brak przyszłych wpisów w pobranym harmonogramie. Sprawdź termin,
  przypomnienie na liście dodanych przypomnień wydarzenia oraz jego odbiorców.
  Sprawdzenie po godzinie przypomnienia nie dowodzi, że wcześniej go nie zapisano.
- Przy niepustym harmonogramie widnieje najbliższy zapisany termin w Europe/Warsaw.
  Zapis nie potwierdza, że system już wyświetlił powiadomienie.
- Stare powiadomienia nie wpływają na licznik i kompletność: odczyt korzysta
  z `getAll({ state: 'SCHEDULED' })`, ponieważ `getPending()` pluginu 8.3.1 zwraca
  także wcześniejsze rekordy.
- Przy niepełnym zabezpieczeniu ekran i baner podają konkretną przyczynę: zgody,
  ograniczenie tła, limit, brakujące lub niezgodne alarmy, wygaśnięcie bądź błąd
  planowania. Przy błędzie pobrania baner informuje o nieudanym odświeżeniu.
- Stan pracy w tle pochodzi z Androida (`isBackgroundRestricted`). „Android nie
  zgłasza ograniczenia” nie oznacza braku dodatkowych mechanizmów producenta.
  „Ustawienia pracy w tle” otwierają standardowy ekran informacji o Rodzinie,
  gdzie użytkownik może przejść do ustawień baterii aplikacji.
- OPPO pokazuje dodatkową wskazówkę: Ustawienia → Aplikacje → Automatyczne
  uruchamianie → Rodzina. Ścieżka według [instrukcji OPPO](https://support.oppo.com/co/answer/?aid=neu119)
  dotyczy ColorOS 12–13; nazwy w polskim systemie mogą się różnić.

Próba sprzętowa po zainstalowaniu nowego APK:

1. Sprawdź obie zgody, pracę w tle i automatyczne uruchamianie. Zapisz widoczną
   wersję APK i ewentualne komunikaty błędów.
2. Dodaj wydarzenie za co najmniej 10 minut z przypomnieniem w chwili rozpoczęcia
   dla siebie albo całej rodziny. Potwierdź, że przypomnienie jest na liście
   dodanych przypomnień i że najbliższy zapisany alarm ma oczekiwaną godzinę.
3. Wyłącz sieć, usuń interfejs z listy ostatnich i zablokuj ekran. Zanotuj czas
   odbioru i opóźnienie; nie używaj „Wymuś zatrzymanie”. Przy braku alarmu sprawdź
   najpierw ponowne otwarcie APK nadal offline, a dopiero potem włączenie sieci.
4. Przy spóźnionym powiadomieniu sprawdź aplikację źródłową w systemowych
   informacjach o powiadomieniu. Osobna instalacja PWA nadal może dostawać Web Push.
5. Powtórz test po restarcie i pierwszym odblokowaniu, nadal bez internetu.

Testów komponentów, atrap mostka ani samego zbudowania APK nie traktujemy jako
potwierdzenia dostarczenia offline na fizycznym OPPO.

Weryfikacja lokalna poprawki: pełny Vitest 442/442 w 49 plikach (w tym 54 testy
powiadomień i sesji), typecheck, lint (dwa dotychczasowe ostrzeżenia Fast Refresh),
format:check, build i `release:smoke` przechodzą. Headless Playwright: 2/2 próby
ekranu alarmów przy 390 i 1280 px; obejrzano oba zrzuty, bez przepełnienia w poziomie.
`android:debug`, Android Lint i 3/3 testy JVM przechodzą. Vitest, Playwright
i Gradle wymagały ponowienia poza sandboxem po błędach plików tymczasowych
lub zatrzymaniu na komunikacji lokalnej. Nie opublikowano aktualizacji ani
podpisanego APK i nie zaliczono nowego testu sprzętowego. Wersja właściciela
`1.0.0-deploy.2` nie zawiera tej poprawki.

### Alarmy wybudzające po próbie deploy.3

Właściciel potwierdził, że na `1.0.0-deploy.3`, przy włączonym automatycznym
uruchamianiu, opóźnione powiadomienie pojawia się po otwarciu aplikacji także
bez internetu. Poprawka statusu nie rozwiązała tego zachowania.

Następna poprawka zastępuje rejestrację timerów pluginu przez natywne
`AlarmManager.setAlarmClock`, z tym samym `PendingIntent` i odbiornikiem
powiadomienia. Alarmy są jawne w Androidzie: system może pokazywać ikonę budzika
i godzinę najbliższego terminu. Nie dodajemy ekranu pełnoekranowego ani usługi
działającej stale. Odbiór powiadomienia i odtwarzanie po restarcie nie wymagają
JavaScript ani połączenia z API.

Stan „zapisany” wymaga zarówno zgodnego payloadu pluginu, jak i natywnego
potwierdzenia rejestracji. Nowy zapis lub zmiana treści wymusza rejestrację
we właściwym trybie. Trwałe potwierdzenia zawierają ID i SHA-256 fingerprintu,
bez nowej kopii treści wydarzeń. Brak operacji systemowej odtwarza ją z payloadu
pluginu. Częściowa awaria nie zapisuje potwierdzenia dla wadliwego alarmu.
Anulowanie i wylogowanie wykorzystują ten sam identyfikator, więc usuwają
również alarm wybudzający; wylogowanie usuwa także potwierdzenia rejestracji.

Własny odbiornik obsługuje boot/odblokowanie, zmianę czasu/strefy, aktualizację
APK i ponowne udzielenie zgody na dokładne alarmy. Zastępuje odbiornik odtwarzania
pluginu, aby drugi odbiornik nie nadpisywał trybu rejestracji. Przetwarza wyłącznie
przyszłe lokalne alarmy kalendarza. Nie odtwarza ponownie przeszłych powiadomień.

Próba na telefonie po publikacji i aktualizacji:

1. Otwórz APK raz po aktualizacji. Natywna część migruje przyszłe zapisane alarmy
   do nowego trybu; dotychczasowe zgody i konto pozostają zachowane.
2. Dodaj przypomnienie za co najmniej 10 minut i potwierdź jego termin oraz
   zapis `1 z 1`. Przy kilku alarmach wcześniej ustawionych w innych aplikacjach
   Android może pokazywać w systemie wcześniejszy alarm innej aplikacji.
3. Wyłącz sieć, usuń APK z ostatnich aplikacji i zablokuj telefon. Zanotuj czas
   odbioru i opóźnienie. W tej próbie nie otwieraj aplikacji do czasu oceny wyniku.
4. Powtórz po restarcie i pierwszym odblokowaniu, nadal bez sieci. Sprawdź też
   anulowanie, zmianę terminu i wylogowanie — bez starych ani podwójnych alarmów.

Rejestracja systemowa nie potwierdza faktycznego wyświetlenia. Bez tej próby
nie uznajemy problemu OPPO za rozwiązany. Pozostają ograniczenia wymuszonego
zatrzymania, wyłączonego telefonu, cofniętych zgód i mechanizmów producenta.

Weryfikacja lokalna: Vitest 445/445 w 49 plikach, w tym 57 testów powiadomień
i sesji; 8/8 testów JVM (5 nowych testów rejestracji), Android Lint,
`android:debug`, lint, format:check, typecheck, build i `release:smoke` przechodzą.
Headless Playwright 2/2 przy 390 i 1280 px; obejrzano mobilny zrzut z opisem
alarmów wybudzających. Sprawdzono wynikowy manifest APK: własny odbiornik
odtwarzania, bez konkurencyjnego odbiornika pluginu. Nie wykonano publikacji
ani fizycznego testu zamkniętego OPPO na tej implementacji; `deploy.3` jej
nie zawiera. Brak nowych zmiennych API, cronów, migracji, uprawnień i zależności.

## Wycofanie PWA — krok 4.8 (19.10.2026)

Aktualna wersja webowa jest zwykłą stroną. Nie generuje manifestu, nie rejestruje
SW i nie uruchamia klienta Web Push. Powiadomienia na stronie pokazują informację
o APK i jego pobieranie; ekran i baner lokalnych alarmów APK działają nadal.
Poniższe instrukcje PWA dotyczą starszych wydań i zostaną uporządkowane w 4.10.
W stanie 4.8 backend, VAPID i job/crony Web Push pozostawały do kroku 4.9.

Test migracji uruchamiaj na buildzie produkcyjnym: `npm run build`, następnie
`npm run test:e2e -- e2e/retire-pwa.spec.ts e2e/notifications.spec.ts e2e/local-alarms.spec.ts`.
Playwright działa headless przy 390 i 1280 px. Test migracji jako jedyny włącza
service workery i tworzy starą rejestrację oraz cache w odrębnym kontekście.
Sprawdza sprzątanie przez nowy frontend i niezależną aktualizację starego SW,
zachowanie sesji, localStorage i cache spoza PWA oraz nową wizytę bez rejestracji.
Test ekranu APK korzysta z atrapy mostka, więc nie potwierdza dostarczenia alarmu.
`release:smoke` sprawdza także 410 manifestu i przejściowy SW z `no-store`.

Przy ręcznej próbie istniejącej PWA otwórz ją online, zamknij i ponownie otwórz.
Sprawdź w Chrome brak rejestracji `/sw.js`, brak precache Workbox Rodziny,
zachowaną sesję i dostęp do kalendarza. Ikonę starej instalacji usuń ręcznie.
Nie czyść wszystkich danych witryny — nie jest to część migracji.

### Wyniki kroku 4.8 — 19.10.2026

- `npm run lint`: bez błędów, 2 istniejące ostrzeżenia Fast Refresh w `auth.tsx`.
  `npm run typecheck`, `npm run format:check` i `npm run build`: poprawne.
- `npm test`: 49 plików, 425 testów poprawnych. Pierwszy przebieg w piaskownicy
  miał błędy ENOENT plików tymczasowych Vitest oraz kontroli dowiązań;
  pełny przebieg poza piaskownicą przeszedł.
- `npm run test:e2e`: 22/22, wyłącznie headless, szerokości 390 i 1280 px.
  Migracja zachowuje sesję, localStorage i cache `family-data`; nowa wizyta nie
  rejestruje SW; stara rejestracja aktualizuje się także bez nowego frontendu.
  Sprawdzono logowanie, kalendarz, linki, pobieranie APK i ekran alarmów z atrapą
  mostka. Zrzuty `android-reminders-published.png` oceniono wizualnie w obu
  szerokościach: tekst i przycisk mieszczą się, nawigacja jest dostępna.
- Test migracji wykrył, że samo `unregister()` zostawia starego workera przy
  otwartej karcie. Frontend najpierw aktualizuje starego SW i czeka na przejęcie
  przez skrypt wycofujący, a potem sprząta. Błąd aktualizacji zachowuje stary
  cache do ponowienia. Regresja sprawdza także żądanie po usunięciu cache.
- `npm run release:smoke`: poprawny ZIP, health i SPA, 410 manifestu,
  przejściowy SW z `no-store`, zachowane job Web Push i backup. Wymagana była
  praca poza piaskownicą z instalacją zależności w katalogu tymczasowym.
- `npm run android:debug`: BUILD SUCCESSFUL. Pierwszy przebieg w piaskownicy
  nie mógł połączyć się z daemonem Gradle; powtórzenie poza nią przeszło.
  Kontrola zawartości APK potwierdziła lokalny `assets/public/index.html` oraz
  brak `sw.js`, manifestu PWA i Workbox. Nie zmieniono kodu natywnych alarmów.
- Usunięcie `vite-plugin-pwa` usunęło 258 zbędnych pakietów; wersje pozostałych
  zależności nie zostały podniesione. Bez nowych zmiennych API, migracji i cronów.
- Bez wdrożenia, podpisania nowego wydania produkcyjnego lub testu fizycznego
  telefonu. Dotychczasowe niepotwierdzone próby alarmów pozostają niepotwierdzone.

## Usunięcie serwerowego Web Push — krok 4.9 (19.10.2026)

API nie rejestruje `/api/push/*`. Usunięto adapter i job wysyłki, `dev:cron`,
`job:reminders`, `vapid:generate`, schematy subskrypcji i zależności Web Push.
`apps/api/.env.example` nie zawiera VAPID; można uruchomić serwer i backup bez
tych kluczy. Stary `.env` z dodatkowymi, także niepoprawnymi zmiennymi działa.
Przypomnienia tworzymy jak wcześniej; odbiorcy, obliczenia czasu i
`/api/reminders/schedule` dla APK pozostają zgodne. Backup:
`npm run job:backup` po buildzie, bez nowej konfiguracji i bez nowego crona.
Historyczne instrukcje Web Push powyżej nie dotyczą obecnego wydania.

Wyniki lokalne:

- `npm test`: 361/361, 46 plików. Usunięto testy usuniętego Web Push i generatora;
  testy odbiorców, harmonogramu, dat i backupu pozostają. Nowy test migracji
  sprawdza świeżą bazę oraz istniejący plik po 0012 z subskrypcją, wydarzeniem,
  uczestnikiem, wyjątkiem, przypomnieniami wspólnymi/osobistymi i sesją.
  Po 0013 oraz powtórzeniu migracji dane są identyczne, znika tylko tabela
  subskrypcji, snapshot zachowuje cały kontrakt, a stara sesja nadal działa.
- `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run build`:
  poprawne. Lint ma 2 dotychczasowe ostrzeżenia Fast Refresh w `auth.tsx`.
- `npm run test:e2e`: 22/22, wyłącznie headless, 390 i 1280 px, bez generatora
  VAPID w serwerze e2e. Zachowane testy sesji, kalendarza, linków, pobierania APK,
  migracji starego SW i ekranu alarmów z atrapą mostka.
- `npm run release:smoke`: poprawny start spakowanego serwera i CLI backupu
  bez VAPID, integralna kopia z tabelą przypomnień bez `push_subscriptions`.
  ZIP nie zawiera joba wysyłki, zachowuje przejściowy SW i 410 manifestu.
- `npm run android:debug`: BUILD SUCCESSFUL, APK z lokalnym frontendem.
  Nie zmieniano natywnego mechanizmu alarmów ani sesji APK.
- Piaskownica blokowała tymczasowe pliki SQLite i połączenie z daemonem Gradle;
  smoke i e2e nie postępowały. Pełne przebiegi poza nią przeszły. Pierwszy test
  migracji wymagał poprawienia identyfikatorów fixture na UUID, zgodnie z kontraktem.
- Nie wykonano aktualizacji serwera, publikacji podpisanego APK ani nowych prób
  fizycznego telefonu. To pozostaje oddzielne od zaliczonych kontroli lokalnych.
  Instrukcja w DEPLOY wymaga zatrzymania starego crona przed podmianą paczki,
  usunięcia resztek joba po wdrożeniu nakładkowym i kopii sprzed migracji do odzyskiwania.
