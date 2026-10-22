# Plan — fazy 0–4 i pierwsze wdrożenie D.1–D.4

Przeniesiono 22.10.2026 z docs/plan.md. Zachowano treść i statusy z chwili zapisu;
przeniesienie nie potwierdza zakończenia faz, CI, prób telefonu ani wdrożenia.
Archiwum czytaj tylko w zakresie potrzebnym do zadania. Bieżące wymagania
i reguły pierwszeństwa określa [plan](../plan.md).

## 6. Fazy

---

### Faza 0 - szkielet, jakość i paczka wdrożeniowa

**Zapis historyczny faz 0-3:** wymagania instalacji PWA, SW, VAPID, Web Push i joba wysyłki w tych fazach są zastąpione krokami 4.8-4.10. Pozostałe reguły kont, kalendarza, odbiorców, czasu, backupu i wdrożenia obowiązują nadal.

**Cel:** pusta aplikacja działa lokalnie w trybie dev i w trybie produkcyjnym z paczki release, jest instalowalna jako PWA na Androidzie (przez przekierowanie portów), a lokalny "cron" potrafi zapisać do SQLite.

**Zakres:**

- Monorepo według sekcji 4, `tsconfig` strict, ESLint (flat config) i Prettier.
- `AGENTS.md` ze stackiem, komendami i konwencjami API oraz regułami: "jedna faza naraz", "Playwright tylko headless", "gotowość do deployu (sekcja 1.1 plan.md)" i "aktualizujemy serwer według DEPLOY.md po lokalnej weryfikacji". Do repo trafiają też `docs/plan.md` (ten dokument), `docs/DECISIONS.md` i `docs/DEVELOPMENT.md`.
- API:
  - `config.ts` (zod, m.in. `NODE_ENV`, `RODZINA_DATABASE_PATH`, `RODZINA_WEB_DIR`, `RODZINA_PUBLIC_URL`, `RODZINA_ALLOW_REGISTRATION`) oraz `apps/api/.env.example`. Sesje to losowe tokeny przechowywane w bazie jako hash, więc nie ma sekretu do podpisywania cookie.
  - Drizzle z tabelą techniczną `job_runs` (id, job, ran_at) i migracje uruchamiane przy starcie.
  - `GET /api/health` zwracające `{ ok: true, version, dbOk }`.
- API w produkcji serwuje katalog `RODZINA_WEB_DIR` przez `@fastify/static` z fallbackiem SPA na `index.html` dla ścieżek innych niż `/api`. W paczce release to `public/` obok `server.cjs`, a przy `npm start` w repo `apps/web/dist`. `trustProxy: true`.
- `server.cjs` wczytuje `.env` przez `process.loadEnvFile` i importuje `dist/server.js`.
- Web:
  - Mantine `AppShell` z dolną nawigacją (Kalendarz, Zakupy, Obiady, Więcej) i pustymi stronami.
  - Manifest: `name` "Rodzina", `lang` "pl", `display` "standalone", ikony 192/512/maskable, `theme_color`.
  - `sw.ts` z precache app shella.
- Job `jobs/heartbeat.ts`, który zapisuje wiersz do `job_runs`. Służy do weryfikacji crona i później zostanie usunięty.
- `scripts/build-release.mjs` tworzy `release.zip` z:
  - `server.cjs` i `dist/` z API
  - `public/` ze zbudowanym webem
  - `drizzle/` z migracjami
  - produkcyjnym `package.json`, który zawiera wyłącznie zależności natywne i external
- `scripts/smoke-release.mjs` rozpakowuje zip do katalogu tymczasowego, uruchamia `npm install --omit=dev`, startuje `node server.cjs` z tymczasowym `.env` i bazą, sprawdza `/api/health` i `/`, uruchamia `node --env-file=... dist/jobs/heartbeat.js` i sprawdza wpis w `job_runs`, a na koniec sprząta.
- `docs/DEPLOY.md` (PL, **instrukcja na pierwsze wdrożenie, nie wykonywana teraz**):
  - utworzenie subdomeny i SSL (AutoSSL)
  - **Setup Node.js App** (wersja Node, app root, startup file `server.cjs`)
  - Run NPM Install
  - katalog `~/rodzina-data/` i plik `.env`
  - wpisy crona z pełną ścieżką do node z nodevenv
  - restart przez `tmp/restart.txt`
  - checklista weryfikacji po wdrożeniu
- CI (`.github/workflows/ci.yml`): `npm ci`, lint, typecheck, test, build i `release:smoke` na Node 22 i 24.

**Kryteria akceptacji:**

- `npm run dev` otwiera aplikację z działającą dolną nawigacją, a `/api/health` zwraca `dbOk: true`.
- `npm run release:smoke` przechodzi lokalnie i w CI.
- `npm run build && npm start` serwuje aplikację na porcie 3000. Chrome DevTools pokazuje w zakładce Application poprawny manifest i aktywny service worker. Na telefonie z Androidem (przez przekierowanie portu 3000) da się zainstalować aplikację i otworzyć ją w trybie standalone.
- `DEPLOY.md` zawiera komplet kroków dla pierwszego wdrożenia.
- CI jest zielone.

**Poza zakresem:** wdrożenie na serwer, logowanie, jakiekolwiek moduły domenowe, push.

---

### Faza 1 - konta rodziny i domownicy

**Cel:** rodzina zakłada konto, admin dodaje domowników, a każdy loguje się na swoim telefonie i pozostaje zalogowany.

**Endpointy:**

- `POST /api/auth/register-family` z `{ familyName, displayName, email, password }`. Tworzy rodzinę i admina, loguje. Wyłączone, gdy `RODZINA_ALLOW_REGISTRATION=false` (wtedy 403).
- `POST /api/auth/login` z `{ email, password }`.
- `POST /api/auth/login-child` z `{ joinCode, userId, pin }`.
- `GET /api/auth/family-members?joinCode=` zwraca wyłącznie `id`, imię i kolor dzieci (do ekranu wyboru profilu, `id` trafia potem do `login-child`).
- `POST /api/auth/logout`, `GET /api/auth/me` (zwraca user i family).
- `POST /api/invitations` z `{ role: 'admin' | 'member' }` (admin). Zwraca link `${PUBLIC_URL}/zaproszenie/<token>`. Konta dzieci nie powstają przez zaproszenia, tylko przez `POST /api/members/child`.
- `GET /api/invitations/:token` (podgląd: nazwa rodziny), `POST /api/invitations/:token/accept` z `{ displayName, email, password }`.
- `GET /api/members`.
- `POST /api/members/child` z `{ displayName, pin, color }` (admin).
- `PATCH /api/members/:id` (admin albo sam użytkownik: imię, kolor; admin: rola i nowy PIN dziecka).
- `DELETE /api/members/:id` (admin, nie można usunąć ostatniego admina).
- `POST /api/members/:id/password-reset-link` (admin), `POST /api/auth/reset-password` z `{ token, password }`.
- `PATCH /api/family` (admin: nazwa; strefa czasu jest stała `Europe/Warsaw`), `POST /api/family/join-code/rotate` (admin).

**Zasady:**

- Hasła: argon2id, minimum 8 znaków. PIN: 4-6 cyfr, również hashowany.
- Sesja to losowy token 32 bajty w cookie `sid` (`httpOnly`, `Secure` w produkcji, `SameSite=Lax`). Jest ważna 60 dni i przedłużana przy aktywności, bo PWA ma pozostać zalogowana.
- Rate limit: 10 prób logowania na 15 minut na IP i login.
- Uprawnienia ról, obowiązujące we wszystkich kolejnych fazach:
  - `admin`: wszystko, w tym zarządzanie domownikami.
  - `member`: tworzy, edytuje i usuwa wszystkie wspólne treści rodziny.
  - `child`, według modułów:
    - Kalendarz: przegląda, tworzy wydarzenia, a edytuje i usuwa tylko te, które sam utworzył.
    - Zakupy: przegląda, dodaje pozycje i odhacza dowolne pozycje. Edytuje i usuwa tylko własne pozycje. Nie może użyć "Wyczyść kupione" ani zarządzać listami.
    - Obiady (faza 6): tylko odczyt.
    - Zadania (faza 7): pełne prawa do własnych list i do list, które mu udostępniono, na zasadach tej fazy.
    - Dokumenty (faza 8): tylko odczyt.
    - Rodzina: zmienia tylko własne imię i kolor.

**Ekrany:**

- Powitanie z wyborem "Załóż rodzinę", "Zaloguj się" i "Jestem dzieckiem".
- Rejestracja i logowanie.
- Logowanie dziecka: kod rodziny, kafelki z imionami, klawiatura PIN.
- Akceptacja zaproszenia i reset hasła.
- Więcej, a w nim Rodzina: lista domowników z kolorami, generowanie zaproszenia z przyciskiem kopiuj/udostępnij (Web Share API), dodanie dziecka, kod rodziny.

**Kroki realizacji:**

#### Krok 1.1 - Fundament auth: schemat, sesje, rejestracja i logowanie

- **Zakres:** migracje `families`, `users`, `sessions`, `invitations`, `password_resets`. Hashowanie argon2id (hasło i PIN). Plugin sesji (cookie `sid`, 60 dni, przedłużanie przy aktywności, `request.user`). Wymuszanie sesji na `/api/*` z listą wyjątków publicznych z sekcji 4. Ochrona CSRF (`Origin` kontra `request.host`, tylko `application/json`). Rate limit logowania. Jednolita obsługa błędów z kodami z sekcji 4. Endpointy `register-family` (z `RODZINA_ALLOW_REGISTRATION`), `login`, `logout`, `me`.
- **Gotowe, gdy:** testy API (`app.inject`, baza `:memory:`) pokrywają rejestrację, logowanie poprawne i błędne, rate limit, brak sesji (401), wygasłą sesję, wyłączoną rejestrację (403) oraz CSRF (obcy `Origin` dostaje 403, właściwy przechodzi). Hasła i PIN-y nie pojawiają się w odpowiedziach ani w logach. (+ `release:smoke`, bo dochodzą migracje i zmienne środowiskowe.)

#### Krok 1.2 - Domownicy, uprawnienia i ustawienia rodziny

- **Zakres:** `GET /api/members`, `POST /api/members/child`, `PATCH /api/members/:id`, `DELETE /api/members/:id`, `PATCH /api/family`, `POST /api/family/join-code/rotate`. Moduł uprawnień (`permissions.ts`) z macierzą ról `admin` / `member` / `child` z tej fazy, który wykorzystają kolejne fazy. Reguła ostatniego admina. Usunięcie domownika kasuje jego sesje. Repozytoria przyjmują `familyId` jako pierwszy argument.
- **Gotowe, gdy:** testy macierzy ról, dziecko zmienia tylko własne imię i kolor, nie da się usunąć ostatniego admina, użytkownik rodziny A dostaje 404 na zasobach rodziny B.

#### Krok 1.3 - Zaproszenia, logowanie dzieci i reset hasła (API kompletne)

- **Zakres:** `POST /api/invitations`, `GET /api/invitations/:token`, `POST /api/invitations/:token/accept`, `GET /api/auth/family-members?joinCode=`, `POST /api/auth/login-child`, `POST /api/members/:id/password-reset-link`, `POST /api/auth/reset-password`. Tokeny zapisywane jako hash.
- **Gotowe, gdy:** testy zaproszenia (ważne, wygasłe, użyte), `family-members` zwraca wyłącznie `id`, imię i kolor dzieci, `login-child` (poprawny PIN, błędny PIN, zły kod rodziny, rate limit), reset hasła (ważny, wygasły, użyty), rotacja kodu rodziny unieważnia stary kod.

#### Krok 1.4 - UI: klient API, sesja i ekrany dla dorosłych

- **Zakres:** klient `fetch` (JSON, ciasteczka, komunikaty błędów z `error.message`), hook `useMe`, strażnik tras z parametrem `next` (tylko ścieżki wewnętrzne, wykorzystają go deep linki z faz 2 i 3). Ekrany: powitanie (z przyciskami "Załóż rodzinę" i "Zaloguj się"; przycisk "Jestem dzieckiem" dochodzi w kroku 1.6), rejestracja, logowanie, wylogowanie w Więcej. Teksty w `i18n/pl.ts`.
- **Gotowe, gdy:** testy komponentów (walidacja formularzy, przekierowanie na logowanie i powrót na `next`, odrzucenie `next` spoza aplikacji). Ręcznie: rejestracja, widoczna dolna nawigacja, odświeżenie strony nie wylogowuje, wylogowanie działa.

#### Krok 1.5 - UI: Więcej > Rodzina

- **Zakres:** lista domowników z kolorami, generowanie zaproszenia z przyciskiem kopiuj/udostępnij (Web Share API), dodanie dziecka (imię, PIN, kolor), kod rodziny z rotacją, edycja własnego imienia i koloru, a dla admina zmiana roli, nowy PIN dziecka, usunięcie domownika i link resetu hasła.
- **Gotowe, gdy:** testy komponentów (widoczność akcji zależna od roli). Ręcznie: admin dodaje dziecko i generuje link zaproszenia, a link da się skopiować.

#### Krok 1.6 - UI: dołączanie i logowanie dzieci, e2e i domknięcie fazy

- **Zakres:** ekran "Jestem dzieckiem" (kod rodziny, kafelki z imionami, klawiatura PIN), `/zaproszenie/:token` (podgląd rodziny i akceptacja), reset hasła. Smoke e2e Playwright (headless): rejestracja, zaproszenie, akceptacja w drugim kontekście, obie osoby na liście. Aktualizacja `.env.example` i `DEPLOY.md`.
- **Gotowe, gdy:** wszystkie kryteria akceptacji fazy 1, punkty z sekcji 1.1 i `release:smoke`. Ręcznie na Androidzie: po zamknięciu i ponownym otwarciu PWA użytkownik nadal jest zalogowany.

**Kryteria akceptacji:**

- Testy API (`app.inject`, baza `:memory:`) pokrywają: rejestrację, logowanie poprawne i błędne, rate limit, zaproszenie (ważne, wygasłe, użyte), logowanie dziecka, izolację rodzin (użytkownik rodziny A dostaje 404 na zasobach rodziny B) i uprawnienia ról.
- Smoke e2e (Playwright headless): rejestracja, wygenerowanie zaproszenia, akceptacja w drugim kontekście przeglądarki i widoczność obu osób na liście.
- Po zamknięciu i ponownym otwarciu PWA na Androidzie użytkownik nadal jest zalogowany.
- Spełnione punkty z sekcji 1.1 (nowe zmienne w `.env.example` i `DEPLOY.md`, `release:smoke` zielony).

**Poza zakresem:** e-maile, logowanie przez Google, 2FA, wiele rodzin na jednym użytkowniku, zmiana strefy czasowej rodziny.

---

### Faza 2 - kalendarz

**Cel:** wspólny kalendarz z trzema trybami tworzenia wydarzeń oraz definiowaniem przypomnień. Wysyłka przypomnień przychodzi w fazie 3.

**Reguły walidacji wydarzeń** (schemat zod w `shared`):

- `kind=single`: `rrule` = null, `date_precision` = `day`.
- `kind=recurring`: `rrule` wymagane, `date_precision` = `day`.
- `kind=distant`: `rrule` = null, `date_precision` = `day` albo `month`. Przy `month` pola `start_date` przechowuje pierwszy dzień miesiąca, a `start_time` i `duration_minutes` są null (wydarzenie całodniowe).
- Wydarzenia `distant` z precyzją `month` **nie są zwracane przez `/api/occurrences`** i nie pojawiają się w siatce kalendarza. Widać je tylko w sekcji "Odległe terminy" jako "maj 2028". Wydarzenia `distant` z precyzją `day` pojawiają się w obu miejscach.

**Logika w `packages/shared/src/time.ts`** (pokryta testami jednostkowymi):

- `expandOccurrences(event, exceptions, fromDate, toDate, tz)`:
  - RRULE rozwijane w czasie "floating", jako lokalne daty bez strefy.
  - Zastosowanie wyjątków.
  - Konwersja na UTC przez `@date-fns/tz`.
  - Zwraca `{ eventId, occurrenceDate, startUtc, endUtc, allDay, isException }`.
- `computeNextFireAt(reminder, source, nowUtc, tz)`:
  - Dla `offset` to najbliższe przyszłe wystąpienie (albo termin) minus `offset_value` × `offset_unit`. `minute` i `hour` odejmujemy od momentu UTC, a `day`, `week` i `month` od lokalnej daty, z zachowaniem lokalnej godziny (`@date-fns/tz`, `subDays`/`subWeeks`/`subMonths`). Przy `month`, gdy dzień nie istnieje, bierzemy ostatni dzień miesiąca: "1 miesiąc przed 31 marca" to 28 lub 29 lutego.
  - Dla całodniowych, miesięcznych i dat bez godziny bazą jest godzina 09:00 lokalnie w dniu (dla `date_precision=month` pierwszy dzień miesiąca).
  - Dla `absolute` to `remind_at`, o ile jest w przyszłości.
  - Funkcja przyjmuje źródło jako "coś z terminem lub wystąpieniami", żeby fazy 7 i 8 użyły jej bez zmian.
- Obowiązkowe testy:
  - Wydarzenie cykliczne przed i po zmianie czasu: ostatnia niedziela marca i ostatnia niedziela października. Zajęcia "wtorek 17:00" zawsze o 17:00 lokalnie.
  - `UNTIL` i `COUNT`.
  - Wyjątek anulowany i przesunięty.
  - Wydarzenie odległe za 2 lata z trzema przypomnieniami.
  - "1 dzień przed" dla zajęć we wtorek 17:00, gdy noc zmiany czasu wypada między przypomnieniem a zajęciami: przypomnienie przychodzi w poniedziałek o 17:00 lokalnie.
  - "3 miesiące przed" dla terminu 31 maja przypada na 28 lutego (albo 29 w roku przestępnym), a "1 miesiąc przed 31 marca" na ostatni dzień lutego.
  - Przypomnienie `offset` po przesunięciu daty wydarzenia podąża za nową datą, a `absolute` nie.

**Endpointy:**

- `GET /api/occurrences?from=YYYY-MM-DD&to=YYYY-MM-DD&userId=` zwraca rozwinięte wystąpienia (maksymalny zakres 62 dni) z danymi do wyświetlenia (tytuł, kolory uczestników).
- `GET /api/events/upcoming-distant` zwraca wydarzenia `kind=distant` posortowane po dacie.
- `GET /api/events/:id` (z uczestnikami, przypomnieniami i wyjątkami), `POST /api/events`.
- `PATCH /api/events/:id?scope=all|this|following&occurrenceDate=`:
  - `this` tworzy lub aktualizuje wyjątek.
  - `following` kończy serię przez `UNTIL` w dniu poprzedzającym i tworzy nową serię od `occurrenceDate`, kopiując uczestników i **wszystkie** przypomnienia, wspólne i osobiste. Osobiste zachowują `user_id` i `created_by`. Dzięki temu cudze "tylko ja" nie zostają przy zakończonej serii.
- `DELETE /api/events/:id?scope=all|this|following&occurrenceDate=` działa analogicznie (`this` oznacza wyjątek `is_cancelled`).
- **Przypomnienia wspólne** (`audience` inne niż `user`) są zapisywane w body wydarzenia (`reminders: [...]`) przez osoby, które mogą edytować wydarzenie. Tablica zastępuje wyłącznie przypomnienia wspólne i nie dotyka osobistych. Przy każdym zapisie serwer przelicza `next_fire_at`.
- **Przypomnienia osobiste** (`audience=user`) mają osobne, wspólne dla wszystkich modułów endpointy:
  - `GET /api/reminders/mine?eventId=|taskId=|documentId=` zwraca moje osobiste przypomnienia dla źródła;
  - `POST /api/reminders/mine` z `{ eventId | taskId | documentId, type, offsetValue?, offsetUnit? | remindAt? }` (serwer ustawia `audience=user`, `user_id` = zalogowany);
  - `DELETE /api/reminders/mine/:id` (tylko własne).
  - Wymagany jest tylko dostęp do odczytu źródła, więc dziecko może ustawić sobie przypomnienie o wydarzeniu utworzonym przez rodzica.
  - W fazie 2 obsługiwane jest `eventId`, a fazy 7 i 8 dokładają `taskId` i `documentId`.

**UI:**

- **Widok kalendarza** (Schedule-X):
  - Domyślnie miesiąc w trybie agendy, dodatkowo tydzień i dzień. Locale `pl-PL`, tydzień zaczyna się w poniedziałek.
  - Każdy domownik to osobny "calendar" Schedule-X z własnym kolorem. Filtr "pokaż tylko: [domownicy]".
  - Adapter `features/calendar/toScheduleX.ts` izoluje format dat biblioteki.
- **FAB "+"** otwiera wybór trybu: "Jednorazowe", "Powtarzające się", "Odległy termin".
- **Formularz wspólny:** tytuł, opis, miejsce, uczestnicy (multi-select domowników), całodniowe tak/nie, data, godzina, czas trwania, przypomnienia.
- **Tryb "Powtarzające się":** kreator bez wpisywania RRULE:
  - "Co [N] [dzień/tydzień/miesiąc/rok]".
  - Przy tygodniu wybór dni (pon-nd).
  - Zakończenie: nigdy, w dniu albo po N razach.
  - Podgląd tekstowy po polsku, np. "co tydzień we wtorek i czwartek do 30 czerwca".
- **Tryb "Odległy termin":** data z precyzją "dzień" albo "miesiąc" i lista przypomnień. Każde przypomnienie to "N dni/tygodni/miesięcy przed" (`offset` z jednostką kalendarzową) albo "w wybranym dniu" (`absolute`).
- **Presety przypomnień:** w chwili rozpoczęcia, 15 min, 1 godz., 1 dzień, 2 dni, 1 tydzień przed oraz własne. Wybór odbiorcy: uczestnicy (domyślnie), dorośli, cała rodzina albo "tylko ja". "Tylko ja" zapisuje się przez `/api/reminders/mine`, więc jest dostępne także dla osób, które nie mogą edytować wydarzenia (np. dziecka). Wtedy formularz pokazuje wyłącznie sekcję "Moje przypomnienia".
- **Szczegóły wydarzenia:** przy edycji lub usunięciu wystąpienia cyklu pytanie "Tylko to / To i następne / Wszystkie".
- **Adres szczegółów (deep link):** trasa `/kalendarz/wydarzenie/:eventId?data=YYYY-MM-DD`, gdzie `data` to `occurrenceDate` wystąpienia. Dla wydarzeń jednorazowych i odległych `data` jest opcjonalna (domyślnie `start_date`). Trasa działa po wejściu z zewnątrz (powiadomienie, zakładka, odświeżenie). Niezalogowany użytkownik trafia na logowanie i po zalogowaniu wraca na ten adres (parametr `next`, dozwolone tylko ścieżki wewnętrzne). Gdy wydarzenie albo wystąpienie nie istnieje (usunięte, anulowane), strona pokazuje komunikat "Tego wydarzenia już nie ma" z linkiem do kalendarza. Adres jest wspólny dla UI i powiadomień, a budowany w jednej funkcji `eventUrl(eventId, occurrenceDate)` w `packages/shared`.
- **Sekcja "Odległe terminy"** na stronie kalendarza: lista najbliższych wydarzeń `distant` z odliczaniem ("za 1 rok i 7 mies.").

**Kroki realizacji:**

#### Krok 2.1 - Logika czasu w `shared` (bez bazy i UI)

- **Zakres:** `packages/shared/src/time.ts` z `expandOccurrences` i `computeNextFireAt` według opisu powyżej (typy `offset` i `absolute`, jednostki kalendarzowe, baza 09:00 dla terminów bez godziny, ostatni dzień miesiąca). Źródło przypomnienia jako "coś z terminem lub wystąpieniami", żeby fazy 7 i 8 użyły funkcji bez zmian.
- **Gotowe, gdy:** wszystkie obowiązkowe testy `time.ts` z tej fazy przechodzą (zmiana czasu w marcu i październiku, `UNTIL` i `COUNT`, wyjątki, wydarzenie odległe z trzema przypomnieniami, "1 dzień przed" przy zmianie czasu, "3 miesiące przed 31 maja", "1 miesiąc przed 31 marca", `offset` podąża za terminem, a `absolute` nie).

#### Krok 2.2 - Wydarzenia: tabele i CRUD całych wydarzeń

- **Zakres:** schematy zod w `shared` z regułami walidacji `kind` / `date_precision`. Migracje `events`, `event_participants`, `event_exceptions` (klucze `created_by` z `ON DELETE SET NULL`). Endpointy `POST /api/events` (single, recurring, distant), `GET /api/events/:id`, `PATCH` i `DELETE` wyłącznie dla `scope=all` (inne wartości `scope` dostają 400 do kroku 2.4), `GET /api/occurrences` (maksymalnie 62 dni, filtr `userId`, bez wydarzeń `distant` z precyzją `month`), `GET /api/events/upcoming-distant`. Uprawnienia: dziecko edytuje i usuwa tylko własne wydarzenia.
- **Gotowe, gdy:** testy API: CRUD, walidacja trzech rodzajów wydarzeń, `occurrences` dla cyklu i dla `distant` (dzień a miesiąc), 403 dla dziecka na cudzym wydarzeniu, izolacja rodzin, usunięcie domownika zostawia jego wydarzenia z `created_by = null`.

#### Krok 2.3 - Przypomnienia wydarzeń (wspólne i osobiste)

- **Zakres:** migracja `reminders` (wszystkie kolumny z sekcji 5, w tym nullable `task_id` i `document_id`). Przypomnienia wspólne w body wydarzenia (`reminders: [...]`, tablica zastępuje tylko wspólne). Przypomnienia osobiste: `GET/POST/DELETE /api/reminders/mine` z `eventId` (moduł wspólny dla przyszłych źródeł). Walidacja `audience` dla wydarzeń i zasada "dokładnie jedno źródło". Przeliczanie `next_fire_at` przy każdym zapisie przez `computeNextFireAt`. Kaskady przy usuwaniu wydarzenia i domownika.
- **Gotowe, gdy:** testy API: edycja wydarzenia przez jedną osobę nie usuwa osobistych przypomnień innych osób, dziecko dodaje sobie przypomnienie do cudzego wydarzenia (200), ale nie może go edytować (403), `offset` podąża za zmianą daty, `absolute` z przeszłości ma `next_fire_at = null`, usunięcie domownika kasuje jego przypomnienia osobiste.

#### Krok 2.4 - Serie: wyjątki oraz zakresy `this` i `following`

- **Zakres:** `PATCH` i `DELETE` z `scope=this|following` i `occurrenceDate`. `this` tworzy lub aktualizuje wyjątek (albo `is_cancelled`). `following` kończy serię przez `UNTIL` w dniu poprzednim i tworzy nową serię od `occurrenceDate`, kopiując uczestników i wszystkie przypomnienia (wspólne i osobiste, z zachowaniem `user_id` i `created_by`). `GET /api/events/:id` zwraca wyjątki, a `occurrences` je stosuje. Przeliczenie `next_fire_at` po zmianie serii.
- **Gotowe, gdy:** testy API: "To i następne" nie zmienia przeszłych wystąpień i przenosi do nowej serii osobiste przypomnienia innych osób, wyjątek anulowany i przesunięty jest widoczny w `occurrences`, brak `occurrenceDate` przy `this` / `following` daje 400. API kalendarza jest kompletne.

#### Krok 2.5 - UI: widok kalendarza, szczegóły i wydarzenia jednorazowe

- **Zakres:** Schedule-X (agenda miesiąca, tydzień, dzień, `pl-PL`, poniedziałek jako początek tygodnia), adapter `features/calendar/toScheduleX.ts`, kolory domowników i filtr "pokaż tylko", odświeżanie po powrocie do karty i co 20 s. FAB "+" otwiera na tym etapie formularz wydarzenia jednorazowego (tytuł, opis, miejsce, uczestnicy, całodniowe, data, godzina, czas trwania). Szczegóły wydarzenia z edycją i usunięciem (`scope=all`), ukrywanie przycisków dziecku przy cudzym wydarzeniu. Trasa `/kalendarz/wydarzenie/:eventId?data=` (deep link) i funkcja `eventUrl` w `shared`.
- **Gotowe, gdy:** testy komponentów (formularz, adapter dat, ukrywanie przycisków dla dziecka), test e2e deep linku (także przez logowanie), ręcznie: wydarzenie dodane w jednym kontekście przeglądarki pojawia się w drugim po maksymalnie 20 s albo od razu po powrocie do karty.

#### Krok 2.6 - UI: powtarzanie, odległe terminy i zakresy edycji

- **Zakres:** wybór trybu po kliknięciu FAB ("Jednorazowe", "Powtarzające się", "Odległy termin"). Kreator powtarzania bez wpisywania RRULE, z funkcjami `rruleFromWizard` i `wizardFromRrule` oraz opisem po polsku w `shared`. Tryb "Odległy termin" (precyzja dzień albo miesiąc). Sekcja "Odległe terminy" z odliczaniem. Dialog "Tylko to / To i następne / Wszystkie" przy edycji i usuwaniu wystąpienia cyklu.
- **Gotowe, gdy:** test round-trip RRULE (kreator, zapis, odczyt, te same ustawienia), test opisu po polsku (np. "co tydzień we wtorek i czwartek do 30 czerwca"), testy komponentów. Ręcznie: seria "co tydzień we wtorek i czwartek", edycja "To i następne" nie rusza przeszłości, termin "maj 2028" widać tylko w sekcji odległych.

#### Krok 2.7 - UI: przypomnienia i domknięcie fazy

- **Zakres:** wspólny komponent `ReminderPicker` (użyją go też fazy 7 i 8): presety (w chwili rozpoczęcia, 15 min, 1 godz., 1 dzień, 2 dni, 1 tydzień przed), własne "N dni/tygodni/miesięcy przed", "w wybranym dniu" (`absolute`), wybór odbiorcy (uczestnicy domyślnie, dorośli, cała rodzina, "tylko ja"). Sekcja "Moje przypomnienia" dla osób bez prawa edycji (np. dziecko). Oznaczenie "nieaktualne" z opcją usunięcia. Aktualizacja `DEPLOY.md`.
- **Gotowe, gdy:** testy komponentów (wspólne trafiają do body wydarzenia, "tylko ja" do `/api/reminders/mine`), wszystkie kryteria akceptacji fazy 2, punkty z sekcji 1.1 i `release:smoke`.

**Kryteria akceptacji:**

- Wszystkie testy `time.ts` przechodzą, łącznie z przypadkami zmiany czasu.
- Wydarzenie dodane w jednym kontekście przeglądarki pojawia się w drugim po maksymalnie 20 s albo od razu po powrocie do karty.
- Z `rrule` zapisanym przez kreator i odczytanym z powrotem kreator pokazuje te same ustawienia (test round-trip).
- Edycja "To i następne" nie zmienia przeszłych wystąpień.
- Wejście na `/kalendarz/wydarzenie/:eventId?data=...` otwiera właściwe wystąpienie (także po odświeżeniu), a dla niezalogowanego prowadzi przez logowanie z powrotem na ten adres (test e2e). Dla usuniętego wydarzenia pokazuje komunikat, nie błąd.
- Dziecko nie może edytować cudzego wydarzenia, ani w API (403), ani w UI (brak przycisków), ale może dodać do niego własne przypomnienie przez `/api/reminders/mine`.
- Edycja wydarzenia przez jedną osobę nie usuwa osobistych przypomnień innych osób (test API).
- Edycja "To i następne" przenosi do nowej serii osobiste przypomnienia innych osób (test API).
- Usunięcie domownika nie usuwa wydarzeń, które utworzył: `created_by` staje się `null`, a UI pokazuje "były domownik" (test API).
- Spełnione punkty z sekcji 1.1.

**Poza zakresem:** wysyłka powiadomień, import i eksport iCal, załączniki, komentarze.

---

### Faza 3 - powiadomienia push (Android)

**Zakres historyczny:** ta faza dotyczy PWA w Chrome na Androidzie. Pozostaje podstawą powiadomień przeglądarkowych; nie realizuje alarmów offline ani powiadomień natywnych APK. Te wymagania należą do fazy 4.

**Cel:** przypomnienia zdefiniowane w fazie 2 docierają jako push na zainstalowaną PWA na Androidzie. Lokalnie testujemy przez przekierowanie portów, a wszystko, co potrzebne na serwer (klucze VAPID w `.env`, crony), jest opisane w `DEPLOY.md`.

**Zakres:**

- `npm run vapid:generate` wypisuje `RODZINA_VAPID_PUBLIC_KEY`, `RODZINA_VAPID_PRIVATE_KEY` i `RODZINA_VAPID_SUBJECT` (mailto) do wklejenia w `.env`. Zmienne trafiają do `.env.example` i `DEPLOY.md`.
- Endpointy:
  - `GET /api/push/public-key`
  - `POST /api/push/subscriptions` (upsert po endpoint)
  - `DELETE /api/push/subscriptions` z `{ endpoint }`
  - `POST /api/push/test` (wysyła test na wszystkie urządzenia użytkownika)
- `sw.ts`:
  - `push` wywołuje `showNotification(title, { body, tag, data: { url }, icon, badge })`.
  - `notificationclick` fokusuje istniejące okno albo otwiera `data.url`.
- `jobs/send-reminders.ts`:
  - Przyjmuje opcjonalną flagę `--now=<ISO>`, która nadpisuje bieżący czas (do testów manualnych i jednostkowych).
  - **Rezerwacja w jednej transakcji SQLite** (`BEGIN IMMEDIATE`): wybiera `reminders` z `next_fire_at <= now` i od razu, w tej samej transakcji, ustawia im `last_sent_at = now` oraz **nowe `next_fire_at`** (kolejny termin wyliczony przez `computeNextFireAt` albo null dla jednorazowych). Dopiero po zatwierdzeniu transakcji wysyła powiadomienia. Dzięki temu drugie równoległe uruchomienie nie wybierze tych samych wierszy.
  - Treść buduje przez `buildReminderPayload` per źródło (na razie tylko wydarzenia), np. "Jutro 17:00: Basen (Zosia)" albo "Za 3 miesiące: USG nogi". Payload zawiera `url` zbudowany przez `eventUrl(eventId, occurrenceDate)` z fazy 2, gdzie `occurrenceDate` to wystąpienie, którego dotyczy przypomnienie. Fazy 7 i 8 dodają własne adresy w tej samej funkcji.
  - Odbiorców wyznacza przez `resolveRecipients` (sekcja 2).
  - Subskrypcje z odpowiedzią 404/410 usuwa.
  - Przypomnienia spóźnione o więcej niż 2 godziny (np. po awarii crona) rezerwuje tak samo, ale bez wysyłki, i loguje. Wyjątek: przypomnienia liczone od daty bez godziny (bazowa 09:00) mają tolerancję 12 godzin.
  - Loguje do stdout.
- `jobs/backup-db.ts`: `VACUUM INTO <RODZINA_BACKUP_DIR>/rodzina-YYYY-MM-DD.db`, przechowuje 14 ostatnich kopii. Nowa zmienna `RODZINA_BACKUP_DIR` trafia do `.env.example` i `DEPLOY.md`.
- `DEPLOY.md`:
  - cron co 5 min dla przypomnień i cron dzienny dla backupu, z przekierowaniem wyjścia do `~/rodzina-data/logs/`
  - usunięcie `heartbeat` (job i wpis)
- `smoke-release.mjs`: generuje testowe klucze VAPID do tymczasowego `.env` (konfiguracja ich wymaga, więc bez nich serwer nie wystartuje) i dodatkowo uruchamia `send-reminders.js` i `backup-db.js` z paczki (bez wysyłki, z pustą bazą).
- UI, sekcja Więcej > Powiadomienia:
  - Status (nieobsługiwane, zablokowane, włączone na tym urządzeniu).
  - Przycisk "Włącz powiadomienia". Prośba o zgodę wyłącznie po kliknięciu, nigdy automatycznie.
  - Przycisk "Wyślij testowe".
  - Krótka instrukcja instalacji PWA na Androidzie (Chrome, menu, "Zainstaluj aplikację").
- Baner w kalendarzu "Włącz powiadomienia, aby dostawać przypomnienia", pokazywany, gdy użytkownik ma przypomnienia, a nie ma subskrypcji.

**Kroki realizacji:**

#### Krok 3.1 - Odbiorcy i treść przypomnień (bez wysyłki)

- **Zakres:** `resolveRecipients(reminder, source)` dla wartości `participants`, `family`, `adults`, `owner` i `user` (reguła `list_members` dojdzie w fazie 7), z filtrem widoczności i awaryjnym odbiorcą `adults`. `buildReminderPayload` dla wydarzeń z polem `url` budowanym przez `eventUrl`. Czysty serwis w API, bez `web-push` i bez joba.
- **Gotowe, gdy:** testy każdej wartości `audience`, brak uczestników kieruje do twórcy, usunięty twórca kieruje do dorosłych, treści "Jutro 17:00: Basen (Zosia)" i "Za 3 miesiące: USG nogi".

#### Krok 3.2 - Job wysyłki i subskrypcje

- **Zakres:** migracja `push_subscriptions`. Konfiguracja VAPID w `config.ts` i `npm run vapid:generate`. `jobs/send-reminders.ts` z flagą `--now=<ISO>`, rezerwacją w jednej transakcji `BEGIN IMMEDIATE` (z nowym `next_fire_at`), obsługą spóźnień (2 godziny, 12 godzin dla terminów bez godziny), usuwaniem subskrypcji przy 404 i 410 oraz logiem do stdout. Wysyłka przez wstrzykiwany interfejs `PushSender` (w testach mock `web-push`). `dev:cron` uruchamia job w pętli. `smoke-release.mjs` generuje testowe klucze VAPID i uruchamia `send-reminders.js`. Aktualizacja `.env.example` i `DEPLOY.md`.
- **Gotowe, gdy:** testy joba na sztucznym czasie: przypomnienie wysyłane dokładnie raz także przy dwóch równoległych uruchomieniach, cykliczne dostaje kolejne `next_fire_at`, 410 usuwa subskrypcję, pusta lista odbiorców kieruje do dorosłych, spóźnione jest rezerwowane bez wysyłki. (+ `release:smoke`.)

#### Krok 3.3 - Push API i service worker

- **Zakres:** `GET /api/push/public-key`, `POST /api/push/subscriptions` (upsert po `endpoint`), `DELETE /api/push/subscriptions`, `POST /api/push/test` (przez ten sam `PushSender`). W `sw.ts` obsługa `push` (`showNotification` z `tag`, `data.url`, `icon`, `badge`) i `notificationclick` (fokus istniejącego okna albo otwarcie `data.url`).
- **Gotowe, gdy:** testy API (upsert, usunięcie, test z mockiem, tylko własne subskrypcje, 401 bez sesji). Ręcznie można wysłać push z DevTools (Application > Service Workers > Push), jeszcze bez ekranu w UI.

#### Krok 3.4 - UI: Powiadomienia

- **Zakres:** Więcej > Powiadomienia (status: nieobsługiwane, zablokowane, włączone na tym urządzeniu; "Włącz powiadomienia" wyłącznie po kliknięciu; "Wyślij testowe"; krótka instrukcja instalacji PWA na Androidzie). Baner w kalendarzu "Włącz powiadomienia, aby dostawać przypomnienia", gdy użytkownik ma przypomnienia, a nie ma subskrypcji.
- **Gotowe, gdy:** testy komponentów statusów i baneru. Ręcznie, na buildzie produkcyjnym z równoległym `npm run dev:cron`, na desktopie i Androidzie: testowy push dociera, przypomnienie "za 10 minut" przychodzi o czasie, a kliknięcie otwiera szczegóły właściwego wystąpienia.

#### Krok 3.5 - Backup, porządki i domknięcie fazy

- **Zakres:** `jobs/backup-db.ts` (`VACUUM INTO <RODZINA_BACKUP_DIR>/rodzina-YYYY-MM-DD.db`, 14 ostatnich kopii), skrypt `job:backup`, zmienna `RODZINA_BACKUP_DIR`. Usunięcie joba `heartbeat` i jego wpisu w `smoke-release.mjs`. `smoke-release.mjs` uruchamia też `backup-db.js`. `DEPLOY.md`: cron co 5 minut dla przypomnień i dzienny dla backupu, wyjście do `~/rodzina-data/logs/`.
- **Gotowe, gdy:** test backupu (plik powstaje, rotacja do 14 kopii), wszystkie kryteria akceptacji fazy 3, punkty z sekcji 1.1 i `release:smoke`.

**Kryteria akceptacji:**

- Test jednostkowy joba (mock `web-push`, sztuczny czas):
  - Przypomnienie wysyłane jest dokładnie raz, także przy dwóch równoległych uruchomieniach.
  - Cykliczne dostaje kolejne `next_fire_at`.
  - 410 usuwa subskrypcję.
  - Przy pustej liście odbiorców (usunięty twórca) przypomnienie trafia do dorosłych.
- Lokalnie na Androidzie, na buildzie produkcyjnym (`npm run build && npm start`, przekierowanie portu 3000, równolegle `npm run dev:cron`):
  - testowy push dociera,
  - przypomnienie "za 10 minut" przychodzi o czasie z dokładnością do cyklu crona,
  - kliknięcie powiadomienia otwiera `/kalendarz/wydarzenie/:eventId?data=...` właściwego wystąpienia, także gdy aplikacja była zamknięta albo użytkownik był wylogowany (wraca na ten adres po zalogowaniu).
- Spełnione punkty z sekcji 1.1, w tym `release:smoke` z jobami.

**Poza zakresem:** iOS, powiadomienia o zmianach dokonanych przez innych, ciche godziny, e-mail/SMS.

---

### Pierwsze wdrożenie na subdomenę vh.pl (wykonane; zapis historyczny)

**Status na 16.10.2026:** wdrożenie wykonane według informacji właściciela; aplikacja działa pod https://rodzina.preficze.pl. Poniższe kroki pozostają dokumentacją pierwszego uruchomienia, nie listą do powtórzenia. Potwierdzenie strony nie stanowi potwierdzenia dostarczenia push, logów cronów po dobie, backupu ani przećwiczenia aktualizacji. Te wyniki zapisujemy osobno w `DEPLOY.md`, gdy zostaną sprawdzone. Kolejne zmiany to aktualizacje istniejącej instalacji, z zachowaniem bazy, konfiguracji i kluczy.

**Cel:** aplikacja z faz 0-3 działa produkcyjnie na subdomenie właściciela przez HTTPS, a crony i push działają na Androidzie. Pierwsze wdrożenie wykonano po fazie 3, przed etapem Androida i dalszymi modułami. Procedurę wykonywał **właściciel z pomocą agenta**: właściciel klika w cPanel, a agent prowadzi według `DEPLOY.md` i poprawia kod lub instrukcję, gdy coś nie działa.

**Procedura wdrożenia** (wszystkie punkty są opisane w `DEPLOY.md`; zachowujemy procedurę jako zapis pierwszego uruchomienia):

1. W cPanel utworzenie subdomeny (np. `rodzina.<domena>`) i włączenie SSL przez AutoSSL. Sprawdzenie, że `https://` działa i ma ważny certyfikat.
2. Sprawdzenie dostępnej wersji Node w **Setup Node.js App** i wybór 24 albo 22 (obie testuje CI). Jeśli dostępne są tylko starsze wersje, zatrzymujemy się i agent ocenia, co trzeba zmienić. Decyzja trafia do `DECISIONS.md`.
3. `npm run release` lokalnie, wgranie `release.zip` do `~/rodzina/` i rozpakowanie.
4. Utworzenie katalogów `~/rodzina-data/`, `~/rodzina-data/logs/` i `~/rodzina-data/backups/` oraz pliku `~/rodzina-data/.env` na podstawie `.env.example`:

- `NODE_ENV=production`
- `RODZINA_PUBLIC_URL=https://rodzina.<domena>`
- `RODZINA_DATABASE_PATH=/home/<user>/rodzina-data/rodzina.db`
- `RODZINA_BACKUP_DIR=/home/<user>/rodzina-data/backups`
- `RODZINA_WEB_DIR`: zostawić domyślne (`public/` obok `server.cjs`)
- nowe klucze VAPID z `npm run vapid:generate` (`RODZINA_VAPID_PUBLIC_KEY`, `RODZINA_VAPID_PRIVATE_KEY`, `RODZINA_VAPID_SUBJECT`)
- `RODZINA_ALLOW_REGISTRATION=true` na czas założenia rodziny, potem `false`
- wszystkie pozostałe zmienne z `.env.example`, porównane linia po linii

5. Setup Node.js App: app root `rodzina`, startup file `server.cjs`, URL na subdomenie. Run NPM Install.

- **Jeśli `better-sqlite3` się nie zainstaluje**, agent podmienia sterownik na `@libsql/client` w `db/client.ts`, aktualizuje `DECISIONS.md`, a właściciel buduje i wgrywa paczkę ponownie.

6. Restart (`tmp/restart.txt`) i sprawdzenie `/api/health`.
7. Dodanie cronów z `DEPLOY.md` (przypomnienia co 5 min i backup dzienny) z pełną ścieżką do node z nodevenv.
8. Założenie rodziny, potem `RODZINA_ALLOW_REGISTRATION=false` i restart.
9. Opisanie w `DEPLOY.md` procedury aktualizacji wersji: nowy zip, rozpakowanie z nadpisaniem `dist/`, `public/` i `drizzle/`, Run NPM Install, restart. Migracje uruchamiają się same. Przed aktualizacją trzeba zrobić backup na serwerze: `cd ~/rodzina && <ścieżka do node z nodevenv> --env-file=/home/<user>/rodzina-data/.env dist/jobs/backup-db.js`.

**Kroki realizacji** (numery w nawiasach to punkty procedury wdrożenia powyżej):

#### Krok D.1 - Hosting i paczka (punkty 1-3)

- **Zakres:** subdomena i AutoSSL, sprawdzenie dostępnych wersji Node i decyzja w `DECISIONS.md`, `npm run release`, wgranie i rozpakowanie `release.zip`.
- **Gotowe, gdy:** `https://` na subdomenie działa z ważnym certyfikatem, wersja Node jest zapisana w `DECISIONS.md`, a `DEPLOY.md` poprawiono tam, gdzie panel cPanel różnił się od instrukcji.

#### Krok D.2 - Konfiguracja i pierwsze uruchomienie (punkty 4-6)

- **Zakres:** katalogi `~/rodzina-data/`, `logs/`, `backups/`, plik `.env` (porównany linia po linii z `.env.example`, nowe klucze VAPID), Setup Node.js App, Run NPM Install (w razie problemu z `better-sqlite3` podmiana sterownika na `@libsql/client` w `db/client.ts` i nowa paczka), restart.
- **Gotowe, gdy:** `/api/health` zwraca `ok: true` i `dbOk: true`, a opis napotkanych problemów jest w `DEPLOY.md`.

#### Krok D.3 - Crony, rodzina i push (punkty 7-8)

- **Zakres:** crony przypomnień (co 5 minut) i backupu (dziennie) z pełną ścieżką do node z nodevenv. Założenie rodziny, potem `RODZINA_ALLOW_REGISTRATION=false` i restart. Instalacja PWA z subdomeny na Androidzie.
- **Gotowe, gdy:** na Androidzie aplikacja instaluje się i loguje, sesja przetrwa zamknięcie aplikacji, testowy push dociera, a przypomnienie "za 15 minut" przychodzi z opóźnieniem nie większym niż 5 minut.

#### Krok D.4 - Weryfikacja końcowa i procedura aktualizacji (punkt 9)

- **Zakres:** druga osoba dołącza przez link zaproszenia. Po dobie kontrola backupu i logów obu cronów. Opisanie i jednokrotne przećwiczenie aktualizacji (backup, nowy zip, nadpisanie `dist/`, `public/` i `drizzle/`, Run NPM Install, restart).
- **Gotowe, gdy:** spełnione są wszystkie kryteria akceptacji etapu pierwszego wdrożenia, a `DEPLOY.md` odzwierciedla faktycznie wykonane kroki.

**Kryteria akceptacji:**

- `https://rodzina.<domena>/api/health` zwraca `ok: true` i `dbOk: true` z ważnym certyfikatem.
- Na Androidzie aplikacja instaluje się z subdomeny i loguje. Sesja przetrwa zamknięcie aplikacji.
- Testowy push dociera, a przypomnienie "za 15 minut" przychodzi z opóźnieniem nie większym niż 5 minut.
- Po dobie w `~/rodzina-data/backups/` jest plik backupu, a `logs/` zawiera wpisy z obu cronów.
- Druga osoba dołącza przez link z zaproszenia i widzi wspólne dane.
- `DEPLOY.md` odzwierciedla faktycznie wykonane kroki, łącznie z napotkanymi problemami i rozwiązaniami.

**Poza zakresem tego historycznego etapu:** CI/CD z automatycznym wgrywaniem na serwer, monitoring zewnętrzny, wiele środowisk. Ręcznie uruchamiany deploy przez GitHub Actions dodajemy osobno w kroku 4.7; nie powtarzamy pierwszego wdrożenia.

---

### Faza 4 - Android przez Capacitor i przypomnienia offline

**Cel:** ta sama aplikacja React działa jako APK na Androidzie i zwykła strona WWW. API i SQLite pozostają na https://rodzina.preficze.pl. Telefon wyświetla wcześniej zaplanowane przypomnienie kalendarza bez internetu i przy zamkniętym interfejsie aplikacji. Fazę wykonujemy po pierwszym wdrożeniu, przed fazami 5-8. Kroki 4.1-4.7 dodają Androida i ręczny deploy GitHub Actions, a 4.8-4.10 wycofują PWA i Web Push. Implementacja lokalna nie potwierdza testów telefonu ani aktualizacji produkcji.

**Architektura i granice:**

- Jeden interfejs `apps/web`, wspólne typy i logika czasu w `packages/shared`, ten sam backend. Dodajemy konfigurację Capacitor i projekt `android/`, bez przepisywania UI na Kotlin lub React Native. Kod Kotlin/Java dopuszczamy dla funkcji systemowych, których plugin nie obsługuje wystarczająco.
- Pliki frontendu są dołączone do APK. Produkcyjne APK nie polega na `server.url` ładującym zdalną stronę. Brak internetu nie uniemożliwia uruchomienia interfejsu i obsługi lokalnych alarmów. Fastify, serwerowa baza i cron nie są uruchamiane na telefonie.
- Strona nie udostępnia manifestu, nie rejestruje SW ani Web Push. Przejściowy `/sw.js` wycofuje stare instalacje i pozostaje dostępny dla późno wracających użytkowników. APK ma adapter powiadomień lokalnych i nie zawiera tego workera. Lokalny alarm nie dostarcza zdalnych zmian do zamkniętego APK.
- W fazie 4 nie dodajemy FCM ani stałej synchronizacji w tle. Telefon pobiera zmiany przy otwarciu, wznowieniu i odzyskaniu sieci oraz co 20 s przy aktywnej aplikacji. Zmiana na innym telefonie przy zamkniętym APK będzie uwzględniona dopiero przy następnej synchronizacji. Rozszerzenie o natywny push jest osobnym punktem roadmapy; nie jest warunkiem alarmu już zapisanego na urządzeniu.
- Offline dotyczy lokalnego harmonogramu i minimalnych danych do obsługi przypomnienia. Nie wprowadzamy pełnej edycji kalendarza offline. Zapis wydarzenia nadal wymaga serwera. Zakupy otrzymują własną kolejkę offline dopiero w fazie 5.
- Faza obejmuje wyłącznie istniejący kalendarz. Zadania i dokumenty rozbudują ten sam kontrakt oraz adapter w fazach 7 i 8; nie tworzymy teraz ich tabel, ekranów ani endpointów.

**Zasady harmonogramu i prywatności:**

- Serwer wyznacza odbiorców przez `resolveRecipients` i oblicza konkretne terminy z wyjątkami i strefą `Europe/Warsaw`. Telefon otrzymuje wyłącznie przypomnienia zalogowanej osoby. Nie wykorzystujemy listy samych osobistych przypomnień, ponieważ pomija ona przypomnienia wspólne.
- Nowy, uwierzytelniony `GET /api/reminders/schedule` zwraca pełny snapshot przyszłych alarmów w oknie od teraz do 90 dni, `generatedAt` oraz `validUntil`. Wpis zawiera stabilny klucz wystąpienia, identyfikator i rodzaj źródła, termin UTC, treść i wewnętrzny URL. W fazie 4 jedynym źródłem jest wydarzenie. Okno jest niezależne od zakresu 62 dni widoku `/api/occurrences` i obejmuje także wydarzenia odległe z precyzją miesiąca.
- Harmonogram jest osobnym odczytem: nie zmienia `next_fire_at`, `last_sent_at` ani rezerwacji crona. Nie używamy tych pól jako potwierdzenia dostarczenia lokalnego alarmu. Reguły czasu z `shared` pozostają wspólne; nie kopiujemy RRULE do natywnych, uproszczonych reguł powtarzania.
- Urządzenie trwale przechowuje snapshot oraz mapowanie kluczy wystąpień na systemowe identyfikatory liczbowe, z obsługą kolizji. Powtórny odczyt nie dubluje alarmów. Po pełnej udanej synchronizacji usuwa nieobecne wpisy i aktualizuje zmienione. Błąd sieci lub częściowy odczyt nie kasuje dotychczasowego harmonogramu. Częściowy błąd planowania wymaga uzgodnienia z alarmami rzeczywiście zapisanymi w systemie i ponowienia, bez fałszywego komunikatu sukcesu.
- Nie obiecujemy nieograniczonego działania bez synchronizacji: alarmy są zabezpieczone tylko do pokazywanego `validUntil`. Po wyczerpaniu okna lub limitu urządzenia UI pokazuje potrzebę synchronizacji i rzeczywisty zakres zaplanowanych alarmów; brak miejsca nie może cicho pomijać przypomnień. Odległy termin poza oknem nadal jest w kalendarzu i wejdzie do harmonogramu po późniejszej synchronizacji.
- Treść alarmu podaje bezwzględną datę i godzinę wydarzenia, aby tekst zapisany wcześniej nie zawierał nieaktualnego „jutro”. Kliknięcie otwiera właściwe wystąpienie. Bez internetu dostępny jest minimalny podgląd zapisanego przypomnienia, z informacją o braku aktualnych danych.
- **Ograniczenie offline:** wydarzenie zmienione lub usunięte na innym urządzeniu może nadal wygenerować stary alarm do chwili synchronizacji. Nie można jednocześnie zagwarantować alarmu offline i sprawdzenia aktualnych uprawnień na serwerze w chwili wyświetlenia. Dla przyszłych prywatnych zadań (faza 7) powiadomienie lokalne będzie ogólne, bez tytułu, notatki i nazwy listy; wejście w szczegóły wymaga aktualnej autoryzacji online. Reguła filtrowania przy wysyłce z serwera pozostaje bez zmian.
- Własne wylogowanie lub zmiana konta usuwa alarmy, powiadomienia i lokalne dane poprzedniej osoby przed udostępnieniem nowej sesji. Potwierdzone 401/403 usuwa dane i alarmy odpowiednio do utraty sesji/dostępu; błąd transportu nie jest traktowany jako cofnięcie uprawnień. Usunięcia użytkownika na serwerze telefon offline nie pozna przed ponownym połączeniem.
- Powiadomienia wymagają świadomej zgody. Dokładne alarmy wymagają sprawdzenia zgody Androida i obsługi cofnięcia. Ekran odróżnia „dozwolone powiadomienia”, „dokładne alarmy” i „harmonogram zapisany”. Dla uśpienia stosujemy mechanizm systemowy z obsługą Doze; kilka bliskich terminów grupujemy, jeśli wymagają tego ograniczenia systemu.
- Alarmy muszą być odtwarzane z trwałych danych po restarcie telefonu, także bez internetu; jeśli plugin nie zapewnia tego zachowania, dodajemy natywną obsługę. Zmiana czasu, aktualizacja APK i powrót z ustawień wymagają ponownego uzgodnienia alarmów. Telefon wyłączony, wymuszone zatrzymanie aplikacji, cofnięte zgody i ograniczenia producenta nie dają bezwarunkowej gwarancji; UI i instrukcja opisują te sytuacje.

**Kroki realizacji:**

**Zapis historyczny kroków 4.1-4.7:** wzmianki o zachowaniu PWA, jej Web Push i publikowaniu API/PWA opisują wcześniejszy zakres. Obowiązują teraz strona WWW + APK oraz kryteria po kroku 4.10; wymagania Androida, sesji i zgodności API pozostają.

#### Krok 4.1 - Projekt Android, połączenie z API i sesja

- **Zakres:** zależności Capacitor zgodne z wybraną wersją Node, Android SDK/JDK/Gradle i instrukcja w `DEVELOPMENT.md`. Konfiguracja lokalnego frontendu w APK, adres API, oddzielenie buildów PWA i Android. Przed implementacją zapis w `DECISIONS.md` konkretnego sposobu obsługi sesji: transport, przechowywanie i odnawianie poświadczeń oraz wylogowanie. Można wykorzystać natywny transport z magazynem cookies lub osobny kontrakt sesji mobilnej; nie zakładamy działania `SameSite=Lax` między lokalnym WebView a zdalnym API. Zachowujemy ochronę CSRF dla przeglądarki; ewentualne CORS ma ścisłą listę originów, bez `*` z credentials. Nie osłabiamy globalnie walidacji `Origin`, aby „uruchomić APK”. Poświadczenia poza localStorage i poza repo; w razie tokenów natywny magazyn chroniony przez Androida. Sekrety serwera nigdy nie trafiają do APK.
- **Gotowe, gdy:** debug APK startuje z lokalnych plików, działa logowanie dorosłego i dziecka oraz odczyt i zapis kalendarza przez API; sesja przetrwa zamknięcie procesu i ponowne uruchomienie. Wylogowanie i zmiana konta czyszczą dane. Testy API potwierdzają zachowanie ochrony CSRF, izolację rodzin i brak dostępu bez sesji. PWA nadal się loguje i działa. Nowa konfiguracja jest opisana w `.env.example` i `DEPLOY.md`; `release:smoke` przechodzi.

#### Krok 4.2 - API harmonogramu dla bieżącego użytkownika

- **Zakres:** schemat snapshotu w `shared`, `GET /api/reminders/schedule` dla wydarzeń i autoryzacja z kroku 4.1. Wspólne i osobiste przypomnienia, RRULE z wyjątkami, terminy odległe, godzina 09:00 dla dat bez godziny, filtr odbiorców i 90-dniowe okno. Brak mutowania stanu wysyłki joba. Testy przewidywalnej treści i stabilnych kluczy. Brak endpointów zadań i dokumentów.
- **Gotowe, gdy:** testy pokrywają rodzinę, dorosłych, uczestników i „tylko ja”, brak dostępu do innej rodziny, przesunięcie i anulowanie wystąpienia, „To i następne”, zmianę czasu, precyzję miesiąca, granice okna oraz usunięcie źródła. Dwa odczyty nie zmieniają rezerwacji joba ani kluczy niezmienionych wystąpień. Test dowodzi, że przypomnienie wspólne nie jest pomijane.

#### Krok 4.3 - Trwały harmonogram i alarmy systemowe offline

- **Zakres:** adapter `@capacitor/local-notifications`, trwały zapis per konto, mapowanie ID, idempotentne planowanie i anulowanie, kanał i ikona Androida, grupowanie bliskich alarmów oraz obsługa błędów i limitów. Odtwarzanie po restarcie offline, bez uruchamiania JavaScript o zaplanowanej godzinie. Potrzebny kod natywny i manifest należą do tego kroku. Prosty ekran pozwala świadomie udzielić zgód, pobrać harmonogram i zobaczyć wynik, aby funkcja była używalna od początku do końca.
- **Gotowe, gdy:** testy adaptera pokrywają kolizje ID, wielokrotne planowanie, zmianę i usunięcie alarmu oraz częściową awarię. Na prawdziwym Androidzie: pobranie przypomnienia online, tryb samolotowy, zamknięcie interfejsu i odebranie alarmu przy zablokowanym ekranie. Drugi test powtarza scenariusz po restarcie telefonu nadal bez internetu. Testów sprzętowych nie zastępują mocki ani `job --now`.

#### Krok 4.4 - Synchronizacja harmonogramu i ekran powiadomień

- **Zakres:** pobranie i uzgodnienie po zalogowaniu, lokalnych zmianach wydarzeń/przypomnień, uruchomieniu, wznowieniu, powrocie sieci oraz co 20 s w aktywnym widoku. Integracja zdarzeń Capacitor App/Network z TanStack Query. Serializacja synchronizacji i odrzucanie spóźnionych odpowiedzi poprzedniego konta/snapshotu. Pełny ekran: zgody, dokładne alarmy, ostatnia udana synchronizacja, `validUntil`, liczba alarmów, komunikaty błędów i „Synchronizuj teraz”. Baner Androida nie wymaga subskrypcji Web Push. PWA zachowuje dotychczasowy ekran i test push.
- **Gotowe, gdy:** edycja lub usunięcie na drugim urządzeniu po synchronizacji zmienia/anuluje alarm. Ponowienie nie dubluje alarmów, przerwany request zachowuje poprzedni harmonogram, odpowiedź poprzedniego konta nie odtwarza jego danych. Wylogowanie offline usuwa alarmy. Ekran nie pokazuje sukcesu po braku zgody lub błędzie planowania. Udokumentowany test zamkniętego APK potwierdza, że zmiany z serwera wymagają wznowienia/synchronizacji.

#### Krok 4.5 - Nawigacja Androida, linki i użyteczność

- **Zakres:** kliknięcie lokalnego powiadomienia otwiera adres właściwego wystąpienia przy uruchomionym i zamkniętym APK; bez internetu pokazuje zapisany podgląd. Linki zaproszeń i resetu działają przez Android App Links z `assetlinks.json` na domenie oraz przekazanie do React Router; przeglądarka pozostaje ścieżką awaryjną bez APK. Powrót po logowaniu zachowuje wewnętrzny adres. Obsługa systemowego „Wstecz”, klawiatury, obszarów przy paskach systemu i kopiowania/udostępniania linków (adapter natywny, jeśli API webowe jest niedostępne).
- **Gotowe, gdy:** na telefonie link zaproszenia i resetu otwiera właściwy ekran, a kliknięcie alarmu wskazuje właściwą datę cyklu. Brak uprawnień lub usunięte wydarzenie daje komunikat po synchronizacji. Testy odrzucają zewnętrzny URL w danych powiadomienia i parametrze `next`. Układ działa na ok. 390 px oraz desktopie; „Wstecz” nie gubi nieświadomie formularza. Linki nadal działają w przeglądarce bez APK.

#### Krok 4.6 - Podpisane APK, pobieranie ze strony i aktualizacje na telefonie

- **Zakres:** skrypty budowania i synchronizacji Androida, podpisywanie release APK, `versionCode`/`versionName`, instrukcja instalacji z pliku i aktualizacji tym samym kluczem. Keystore, hasła i kopia klucza poza repo; wykluczenia buildów i sekretów. `DEPLOY.md` opisuje osobno aktualizację API/PWA oraz APK i zgodność starszego klienta z API. Aktualizacja zip na vh.pl nie aktualizuje plików frontendu w już zainstalowanym APK. CI sprawdza build debug bez sekretów; podpisanie release korzysta z lokalnego klucza. Przenosimy do aktualnego zakresu przegląd ochrony danych i nagłówków/CSP z usuniętej fazy OSS; bez dodawania Dockera ani publicznego wydania. Weryfikacja wszystkich kryteriów na podpisanym APK i regresja PWA.
- **Pobieranie ze strony:** na ekranie logowania i w sekcji „Więcej” wersji przeglądarkowej/PWA przycisk „Pobierz aplikację na Androida”, numer dostępnej wersji i krótka instrukcja otwarcia APK oraz udzielenia zgody na instalację z danego źródła. Przycisk pobiera najnowsze opublikowane, podpisane APK z tej samej domeny przez HTTPS. Jest odrębny od instalacji PWA i ukryty wewnątrz APK. Przy braku opublikowanego wydania pokazujemy informację o niedostępności zamiast niedziałającego linku.
- **Informacja o wydaniu:** statyczny plik `/downloads/android/latest.json` zawiera `versionCode`, `versionName`, `apkUrl` i `sha256`. APK ma niezmienny adres zawierający wersję; metadane publikujemy dopiero po pełnym wgraniu pliku. Metadane są walidowane, pobierane bez użycia nieaktualnego cache i wyłączone z precache/cache service workera. Adres APK musi wskazywać HTTPS na tej samej domenie, w katalogu pobierania. Publikowane pliki nie zawierają danych rodziny ani sekretów i są dostępne przed logowaniem. `DEPLOY.md` opisuje katalog trwały poza plikami nadpisywanymi przez `release.zip`, jego serwowanie, typ MIME APK, zasady cache i kolejność publikowania wydania; bez nowego crona ani stałego procesu.
- **Sprawdzanie wersji w APK:** automatycznie przy uruchomieniu aplikacji oraz po wznowieniu/powrocie sieci (z ograniczeniem częstotliwości), a także ręcznie przez „Więcej > Wersja aplikacji > Sprawdź aktualizacje”. Porównujemy `versionCode` zainstalowanej aplikacji z metadanymi serwera. Wyższa wartość pokazuje komunikat „Dostępna nowa wersja”, numer wydania i przycisk „Aktualizuj”. Równa lub niższa wartość nie proponuje aktualizacji ani obniżenia wersji. Brak sieci, nieprawidłowe metadane lub błąd serwera nie blokują działania aplikacji i lokalnych alarmów; ręczne sprawdzenie pokazuje czytelny wynik albo błąd.
- **Aktualizacja na telefonie:** po wybraniu „Aktualizuj” aplikacja pobiera APK, pokazuje postęp, sprawdza sumę SHA-256 z metadanych i przekazuje plik systemowemu instalatorowi Androida przez bezpieczny URI z uprawnieniem odczytu. W razie potrzeby prowadzi użytkownika do systemowej zgody na instalację z tego źródła i umożliwia ponowienie po powrocie. Użytkownik zatwierdza instalację w Androidzie; nie obiecujemy cichej instalacji ani aktualizacji przy zamkniętej aplikacji. Obsługujemy anulowanie, przerwany transfer, brak miejsca, niezgodną sumę i odmowę zgody, bez utraty sesji ani harmonogramu. Kolejne wydania mają ten sam identyfikator pakietu i klucz podpisujący oraz rosnący `versionCode`; Android weryfikuje podpis. Po aktualizacji aplikacja pokazuje nową wersję i uzgadnia zapisane alarmy bez duplikatów.
- **Gotowe, gdy:** podpisane APK można pobrać ze strony, zainstalować i zaktualizować z poziomu starszej wersji bez utraty konta/harmonogramu. Testy automatyczne obejmują porównanie wersji, walidację metadanych i URL, błąd sieci, widoczność przycisków oraz odrzucenie uszkodzonego pobrania. Na fizycznym telefonie sprawdzono pierwszą instalację ze strony, wykrycie nowego wydania, zgodę na instalację, zatwierdzenie i anulowanie aktualizacji, nowy numer wersji po aktualizacji, zachowanie sesji i odebranie wcześniej zapisanego alarmu offline. Przycisk i informację o wersji sprawdzono w przeglądarce przy ok. 390 px i na desktopie. Udokumentowano wersje narzędzi, polecenia, backup klucza, publikację APK/metadanych, ograniczenia systemu i wyniki testów fizycznego telefonu. Spełnione są kryteria Androida z tego kroku i wymagania sekcji 1.1 dotyczące jego zmian; przechodzą lint, typecheck, testy, build, `release:smoke` oraz build Androida. Pełne domknięcie fazy następuje w kroku 4.7. Smoke paczki serwera sprawdza również poprawne zachowanie strony bez opublikowanego APK. Testy webowe Playwright wyłącznie headless; nie uznajemy ich za test natywnych alarmów ani instalatora.

#### Krok 4.7 - Ręcznie uruchamiany deploy GitHub Actions i domknięcie fazy

- **Zakres:** `.github/workflows/deploy.yml` i wieloplatformowy skrypt w `scripts/` aktualizują istniejącą aplikację na vh.pl. Wzorzec przebiegu: repozytorium `portfel`, pliki `.github/workflows/deploy.yml` i `scripts/deploy.sh` (SSH, zachowanie danych serwera, restart Passengera, sprawdzenie po wdrożeniu). Dostosowujemy go do Node, npm workspaces i paczki `release.zip`; nie kopiujemy konfiguracji Pythona ani struktury katalogów `portfel`. Skrypt projektu pozostaje `.mjs` zgodnie z sekcją 2.
- **Uruchamianie:** workflow ma wyłącznie `workflow_dispatch`, bez `push`, `pull_request`, harmonogramu ani automatycznego uruchomienia po CI. Właściciel wybiera „Actions > Deploy > Run workflow” dla `main`. Job odrzuca inne gałęzie, wdraża konkretny commit wybrany przy uruchomieniu i zapisuje jego SHA w podsumowaniu. Zwykły push uruchamia dotychczasowe CI, ale nie zmienia serwera. Uprawnienia workflow: `contents: read`, checkout bez utrwalania poświadczeń, limit czasu i wspólna blokada `rodzina-production` z `cancel-in-progress: false`, aby nie przerywać wdrożenia podczas zmiany plików.
- **Weryfikacja i paczka:** na runnerze Linux z Node 24 wykonujemy `npm ci`, lint, format:check, typecheck, testy, build, Playwright wyłącznie headless oraz `release:smoke`. Wysyłamy dokładnie sprawdzoną paczkę, bez ponownego budowania z innego commita. Błąd któregokolwiek sprawdzenia kończy pracę przed zmianą serwera. Podsumowanie zawiera commit i sumę SHA-256 paczki.
- **Konfiguracja SSH:** zmienne GitHub Actions `DEPLOY_HOST`, `DEPLOY_PORT` (domyślnie 22), `DEPLOY_USER`, `DEPLOY_PATH`, `DEPLOY_NODE` (pełna ścieżka Node z nodevenv) i `DEPLOY_ENV_FILE` (pełna ścieżka istniejącego `.env`). Sekrety `DEPLOY_SSH_KEY` i `DEPLOY_KNOWN_HOSTS`; ścisła weryfikacja klucza hosta, bez wyłączania jej lub automatycznego ufania niesprawdzonemu hostowi. Walidujemy port i bezwzględne ścieżki, wskazanie właściwej aplikacji, dostęp do narzędzi transferu/rozpakowania i Node oraz konfigurację przed jakąkolwiek zmianą. Sekrety nie trafiają do logów, repo ani artefaktów; konfiguracja crona nadal używa dotychczasowego `.env` serwera.
- **Aktualizacja serwera:** przesłanie ZIP do katalogu tymczasowego, sprawdzenie sumy i rozpakowanie do stagingu; przed podmianą wykonanie backupu bazy istniejącym jobem i zachowanie poprzedniej paczki. Aktualizujemy wyłącznie pliki aplikacji z paczki, instalujemy zależności produkcyjne przy użyciu środowiska Node hostingu (bez budowania frontendu/API i bez kompilacji nowych zależności runtime), następnie odświeżamy `tmp/restart.txt`. Chronimy `.env`, produkcyjną bazę/WAL/SHM, backupy, logi, konfigurację cPanel, istniejące crony i trwały katalog APK/metadanych z kroku 4.6. Bez szerokiego usuwania zawartości katalogu aplikacji. Błąd transferu lub backupu przerywa wdrożenie przed podmianą.
- **Sprawdzenie i odzyskiwanie:** po restarcie ograniczone ponowienia odczytu `https://rodzina.preficze.pl/api/health` (JSON z `ok: true` i `dbOk: true`), strony głównej oraz oczekiwanego 401 z `/api/auth/me` bez sesji. Sprawdzamy także zachowanie opublikowanego `latest.json`/APK, jeśli wydanie Androida jest dostępne. Nieudana kontrola kończy workflow błędem z informacją o etapie awarii. `DEPLOY.md` opisuje konfigurację zmiennych i sekretów, ręczne uruchomienie, sprawdzenie logów, backup i bezpieczny powrót do poprzedniej paczki z uwzględnieniem migracji; bez automatycznego cofania produkcyjnej bazy.
- **Android przy każdym deployu (zmiana właściciela 18.10.2026):** workflow buduje i podpisuje APK istniejącym kluczem z sekretów Actions. Automatycznie zwiększa `versionCode` ponad bazowy kod z repo i ostatnie opublikowane wydanie oraz nadaje nazwę `<wersja>-deploy.<kod>`. Weryfikuje podpis, odcisk certyfikatu, pakiet, wersję i SHA-256. Po sprawdzeniu wdrożonego API/PWA publikuje APK w trwałym katalogu, a na końcu atomowo podmienia `latest.json`; stare APK zachowuje. Pierwszy katalog pobierania i brakującą/pustą zmienną `RODZINA_ANDROID_DOWNLOAD_DIR` w istniejącym `.env` ustawia automatycznie po backupie, bez zmiany pozostałych ustawień. Konfiguracja sekretów i odcisku jest jednorazowa; klucz nie trafia na hosting ani do artefaktów. Testy JVM i Android Lint również muszą przejść przed SSH. Aktualizacja na telefonie nadal wymaga potwierdzenia w instalatorze Androida. Paczka serwera i APK są odrębnymi plikami tego samego deployu, bez ręcznego wgrywania APK.
- **Gotowe, gdy:** testy i próba na lokalnym katalogu z atrapą SSH potwierdzają walidację konfiguracji, przerwanie przed podmianą przy błędzie testów/transferu/backupu, właściwy zestaw kopiowanych plików, zachowanie danych i APK oraz obsługę nieudanej kontroli po restarcie. Workflow nie zawiera automatycznych wyzwalaczy i odrzuca gałąź inną niż `main`. Właściciel może ręcznie uruchomić wdrożenie z GitHub Actions; jedno kontrolowane wykonanie na serwerze potwierdza aktualizację, restart, kontrole HTTP i zachowanie istniejących danych oraz plików Androida. Nie raportujemy wdrożenia jako sprawdzonego bez tego wykonania. Spełnione są wszystkie kryteria akceptacji fazy 4 i sekcji 1.1; przechodzą lint, format:check, typecheck, testy, build, `release:smoke` oraz build Androida. Nie powtarzamy pierwszego deployu ani konfiguracji rodziny.

**Kryteria akceptacji:**

- APK zawiera lokalny frontend, współpracuje z istniejącym API i zachowuje sesję. Strona działa na telefonie i desktopie; istniejąca produkcyjna baza nie jest zastępowana ani resetowana. Nowe wizyty nie rejestrują SW ani Web Push. Powrót ze starej PWA online wycofuje rejestrację i precache Rodziny, zachowując sesję i inne dane; manifest zwraca 410.
- Scenariusz właściciela: przypomnienie ustawione na **18.10.2026, 15:00 Europe/Warsaw**, zapisane w systemowym harmonogramie danego telefonu przed 10:00. Od 10:00 telefon nie ma internetu. O 15:00 wyświetla alarm przy zablokowanym ekranie i zamkniętym interfejsie, przy udzielonych zgodach i włączonym telefonie. Sprawdzamy na rzeczywistym urządzeniu i zapisujemy opóźnienie; dla pojedynczego alarmu w tym teście akceptujemy maksymalnie 60 s. Krótszy test względny wolno wykonać wcześniej, ale nie raportujemy datowanego scenariusza jako przetestowanego przed jego wykonaniem.
- Restart offline odtwarza alarmy; edycja, anulowanie i zmiana serii po synchronizacji nie zostawiają starych ani podwójnych alarmów. Brak internetu nie uruchamia webowego timera jako zamiennika alarmu systemowego.
- Godziny pozostają zgodne ze strefą rodziny, także przy zmianie czasu i innej strefie telefonu. Bliskie terminy, limity i brak zgód są jawnie obsłużone; nie obiecujemy obejścia wymuszonego zatrzymania ani wyłączonego urządzenia.
- Wylogowanie i zmiana użytkownika czyszczą lokalne dane i alarmy. API harmonogramu respektuje odbiorców oraz izolację rodzin. UI pokazuje czas ostatniej synchronizacji i zakres zabezpieczenia offline.
- Nie ma Web Push w APK ani wysyłki z serwera. Migracja 0013 usuwa tylko subskrypcje; istniejące wydarzenia, przypomnienia, odbiorcy i sesje pozostają. Serwer i backup startują bez VAPID, także ze starymi dodatkowymi zmiennymi `.env`. Stary cron wysyłki zatrzymujemy przed aktualizacją; cron backupu zostaje. Ikonę starej PWA użytkownik może usunąć ręcznie.
- Strona umożliwia pobranie najnowszego podpisanego APK. Zainstalowana aplikacja wykrywa nowsze wydanie i umożliwia jego pobranie oraz aktualizację przez systemowy instalator z potwierdzeniem użytkownika. Aktualizacja zachowuje sesję i harmonogram, pokazuje nowy numer wersji i nie dubluje alarmów. Brak sieci lub błąd sprawdzenia wersji nie blokuje aplikacji ani alarmów offline.
- Serwer przechodzi `release:smoke`. Dokumentacja opisuje osobne artefakty API/WWW oraz APK z metadanymi, zachowanie przejściowego `/sw.js`, blokadę manifestu i bezpieczny powrót po migracji. Pełne kontrole, Playwright headless, build Androida, testy JVM i Android Lint przechodzą. Niepotwierdzone próby telefonu i produkcji są wymienione jawnie.
- GitHub Actions aktualizuje istniejący serwer wyłącznie po ręcznym „Run workflow” z `main`, po poprawnej weryfikacji paczki. Push nie uruchamia deployu. Sprawdzone wdrożenie zachowuje dane, konfigurację i opublikowane APK, wykonuje backup, restart i kontrole HTTP; udokumentowano odzyskiwanie po awarii.

**Poza zakresem:** wydanie open source, Docker/VPS, publikacja w Google Play, iOS, FCM i zdalne budzenie APK, pełna edycja kalendarza/zadań/dokumentów offline, implementacja modułów faz 5-8, gwarancja wykrycia zmiany uprawnień bez połączenia z serwerem.

**Dokumentacja techniczna do implementacji:** [powiadomienia lokalne Capacitor](https://capacitorjs.com/docs/apis/local-notifications), [alarmy Androida](https://developer.android.com/develop/background-work/services/alarms), [linki aplikacji](https://capacitorjs.com/docs/guides/deep-links). Wersje i zachowanie pluginów sprawdzamy przy realizacji kroku; opis API nie zastępuje testów telefonu.

---

### Wycofanie PWA — kroki 4.8-4.10 przed fazą 5

**Decyzja właściciela, 19.10.2026:** pozostają strona WWW i aplikacja APK. Kluczową funkcją są alarmy offline Androida; PWA nie spełnia tego wymagania. Ta sekcja zastępuje wcześniejsze wymagania utrzymywania PWA i Web Push, nie zmienia zakresu modułów faz 5-8 ani statusu testów fizycznego telefonu. Każdy krok to osobny czat i commit. Lokalna realizacja nie oznacza wdrożenia produkcyjnego.

#### Krok 4.8 - Strona bez PWA i wycofanie istniejących instalacji

**Stan 19.10.2026:** zrealizowany i sprawdzony lokalnie; 425 testów Vitest i 22 Playwright headless, build strony/API, smoke paczki i debug APK przechodzą. Zrzuty UI oceniono przy 390 i 1280 px. Nie wdrożono na produkcję ani nie potwierdzono nowego testu alarmu na fizycznym telefonie. Szczegóły w DEVELOPMENT.

- **Zakres:** usunięcie `vite-plugin-pwa`, generowania manifestu i Workbox oraz klienta Web Push. Ekran powiadomień strony wyjaśnia, że przypomnienia wymagają APK, i korzysta z istniejącego pobierania Androida. Baner o zgodach pozostaje tylko w APK. Wspólne formularze nadal zapisują przypomnienia. Nowe wizyty nie rejestrują żadnego workera. Dotychczasowy `/sw.js` pozostaje jako skrypt przejściowy: przejmuje starego workera, anuluje subskrypcję, czyści wyłącznie precache Rodziny i wyrejestrowuje się; bez obsługi fetch i push. Nowy frontend również sprząta starą rejestrację. Nie usuwamy sesji, localStorage ani danych natywnych. Historyczny manifest zwraca 410, również jeśli plik pozostał po deployu nakładkowym. Skrypt przejściowy ma `Cache-Control: no-store` i nie trafia do APK.
- **Granica:** backend Web Push, VAPID, tabela subskrypcji i cron pozostają do kroku 4.9. Zachowujemy kontrakt `/api/reminders/schedule`, odbiorców i alarmy natywne. Ikony starych powiadomień pozostają w okresie przejścia. Nie obiecujemy zdalnego usunięcia ikony wcześniej zainstalowanej PWA.
- **Gotowe, gdy:** lint, format:check, typecheck, testy, build, `release:smoke` i build debug Androida przechodzą. Testy obejmują nową wizytę bez rejestracji i żądań `/api/push/*`, migrację starej rejestracji/cache i samodzielną aktualizację starego workera, zachowanie sesji i danych spoza cache PWA, ekran strony przy 390 i 1280 px, brak manifestu i workera w APK oraz regresję ekranu alarmów lokalnych. Weryfikacja UI i wyniki są zapisane w DEVELOPMENT. Testy przeglądarkowe wyłącznie headless. Stan testów fizycznego telefonu raportujemy oddzielnie.

#### Krok 4.9 - Usunięcie serwerowego Web Push

**Stan 19.10.2026:** zrealizowany lokalnie. Przechodzą lint, format:check, typecheck, 361 testów Vitest, 22 testy Playwright headless, build, `release:smoke` bez VAPID i build debug Androida. Migracja 0013 usuwa tylko subskrypcje; test zachowuje dane, sesję i identyczny snapshot APK na istniejącej bazie. Procedura aktualizacji i powrotu jest w DEPLOY, wyniki w DEVELOPMENT. Bez wdrożenia na produkcję i nowego testu fizycznego telefonu; krok 4.10 pozostaje osobnym zadaniem.

- **Zakres:** usunięcie `/api/push/*`, adaptera wysyłki, joba `send-reminders`, `dev:cron`, generatora VAPID, zależności `web-push` i jego typów. Usunięcie wymogu VAPID z konfiguracji serwera, testów, e2e i smoke; aktualizacja `.env.example`. Nowa migracja usuwa wyłącznie `push_subscriptions`, bez przepisywania historycznych migracji. Zachowujemy `reminders`, kontrakt ze starszym wspieranym APK, `resolveRecipients`, obliczenia czasu i `/api/reminders/schedule`. Usuwamy wyłącznie kod używany przez Web Push; backup i jego cron zostają.
- **Gotowe, gdy:** serwer i backup startują bez VAPID; nowa i istniejąca baza przechodzą migracje bez utraty wydarzeń, przypomnień i sesji. Testy potwierdzają zgodność harmonogramu/odbiorców i brak endpointów Web Push. DEPLOY opisuje zatrzymanie starego crona **przed** podmianą paczki, sprzątnięcie pozostałego pliku joba po nakładkowym deployu, backup i powrót do poprzedniej wersji. Stary `.env` z dodatkowymi zmiennymi nie blokuje serwera. Przechodzą standardowe kontrole, `release:smoke` i build Androida. Bez zmiany produkcji w ramach implementacji.

#### Krok 4.10 - Regresja i dokumentacja końcowego wydania

**Stan 19.10.2026:** implementacja i regresja lokalna są opisane w DEVELOPMENT, a procedura aktualizacji w DEPLOY. Właściciel zlecił wykonanie testów fizycznego telefonu dopiero po kroku 4.10. Ich brak oraz brak wdrożenia tego wydania nie są sukcesem; pełna akceptacja sprzętowa i produkcyjna fazy 4 pozostaje otwarta. Historyczny scenariusz 18.10 o 15:00 nadal nie ma potwierdzenia; nową próbę zapisujemy z jej rzeczywistą datą.

- **Zakres:** aktualizacja bieżących wymagań PLAN, README, DEVELOPMENT i DEPLOY do strony + APK, zachowanie oznaczonych zapisów historycznych oraz zmiana wymagań przypomnień przyszłych modułów z joba na harmonogram APK. Regresja logowania, kalendarza, zaproszeń/resetu, pobierania i aktualizacji APK. Procedura wdrożenia zachowuje przejściowy `/sw.js` dla użytkowników wracających po dłuższej przerwie i blokuje stary manifest. Test powrotu ze starej PWA po wdrożeniu oraz testy APK na telefonie bez sieci, z zamkniętym interfejsem i po restarcie.
- **Gotowe, gdy:** kryteria 4.8-4.9 i gotowości do deployu są spełnione; przechodzą pełne kontrole projektu, Playwright headless, `release:smoke`, build Androida i kontrole natywne. Wyniki telefonu i produkcji są potwierdzone osobno; ich brak nie oznacza sukcesu. Aktualizacja serwera i publikacja APK następują na polecenie właściciela według DEPLOY. Ten krok domyka rozszerzony zakres fazy 4.

**Poza zakresem:** FCM, dodatkowa synchronizacja w tle, zmiana mechanizmu alarmów, pełny kalendarz offline, implementacja faz 5-8 i automatyczne odinstalowanie starej ikony PWA.

---
