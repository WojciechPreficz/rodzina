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

Skopiuj `apps/api/.env.example` do `apps/api/.env`. `npm run dev` uruchamia Fastify na porcie 3000 i Vite na 5173. Otwórz `http://localhost:5173`; wywołanie `/api/health` przechodzi przez proxy Vite do API.

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

Lokalny heartbeat można wykonać poleceniem `npm run job:heartbeat`. Symulacja crona co minutę: `npm run dev:cron`. Oba polecenia wymagają konfiguracji `.env` i używają tej samej bazy co API.

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
