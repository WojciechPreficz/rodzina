# Praca lokalna

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

## PWA na Androidzie przez USB

Service worker, instalację PWA i push (w późniejszej fazie) weryfikuj na buildzie produkcyjnym. Podłącz telefon przez USB, włącz debugowanie USB i w Chrome na komputerze otwórz `chrome://inspect`. W sekcji Port forwarding dodaj `5173 -> localhost:5173` dla pracy nad UI albo `3000 -> localhost:3000` dla builda produkcyjnego. Następnie na telefonie otwórz odpowiednio `http://localhost:5173` albo `http://localhost:3000`.

Tryb dev służy do pracy nad UI; instalację PWA i service worker sprawdzaj po `npm run build && npm start` na porcie 3000. Aplikacja jest wtedy dostępna dla Chrome Androida jako `localhost` i działa w bezpiecznym kontekście.
