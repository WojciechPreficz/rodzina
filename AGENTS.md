# Instrukcje dla agentów

## Zakres projektu

- Przed pracą przeczytaj docs/plan.md: status i zakres wskazanego kroku. ARCHITECTURE.md, DEVELOPMENT.md, DEPLOY.md i DECISIONS.md czytaj tylko według zależności zmiany. Nie czytaj rutynowo całej dokumentacji ani ponownie niezmienionych treści.
- Realizuj dokładnie jedną wskazaną fazę naraz. Nie implementuj elementów z sekcji „Poza zakresem” ani z kolejnych faz.
- Zaimplementowane moduły i pozostałe prace opisuje tabela statusów w docs/plan.md. Numeracja faz i kroków pozostaje zachowana. Pierwszy deploy jest wykonany; nie powtarzaj go. Nie planujemy wydania open source.
- Funkcje rozwijamy i sprawdzamy lokalnie w zakresie zmiany; pełną weryfikację końcową wykonuje istniejący `.github/workflows/ci.yml`. Istniejący serwer aktualizujemy sprawdzoną paczką release według `docs/DEPLOY.md`; APK budujemy, podpisujemy i aktualizujemy osobno.
- Docelowe platformy: zwykła WWW i APK. Nie przywracaj PWA ani Web Push; API harmonogramu, odbiorcy i alarmy Androida pozostają.
- Interfejs użytkownika oraz dokumentacja w `docs/` są po polsku. Kod, nazwy, komentarze i commity są po angielsku.

## Stack

- Node.js 22 lub 24, npm workspaces.
- `apps/web`: React, TypeScript, Vite i Mantine; wspólny interfejs strony i APK.
- `apps/api`: Fastify, TypeScript, Drizzle ORM i `better-sqlite3`.
- `packages/shared`: współdzielone typy i schematy.
- Testy: Vitest i Playwright. Testy przeglądarkowe uruchamiaj wyłącznie headless.

## Komendy

- `npm run dev` — API i Vite lokalnie.
- `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`.
- `npm run build`, `npm run release:smoke`.
- `npm run db:generate` — generowanie migracji Drizzle.
- `npm start` — lokalny build produkcyjny na porcie 3000; wymaga `apps/api/.env`.

## Uruchamianie testów i zapis logów

- Uruchamiaj testy bezpośrednio przez `npm test`, `npm run test:e2e` lub `npm run release:smoke`, z argumentami potrzebnymi do sprawdzenia zmiany.
- Korzystaj z zapisanych zgód dla tych prefiksów. Gdy wymagana jest zgoda na wykonanie poza sandboxem, proponuj odpowiedni prefiks npm, zamiast całego jednorazowego polecenia.
- Nie opakowuj tych komend w dodatkowe `pwsh -Command` ani nie doklejaj przekierowań, zmiennych i kolejnych instrukcji PowerShell do zatwierdzanego polecenia.
- Jeśli potrzebny jest zapis pełnych logów, podsumowanie lub obsługa kodu wyjścia, korzystaj ze stałego skryptu projektu, a w razie jego braku dodaj skrypt Node `.mjs` zgodny z konwencjami projektu. Zachowuj kod wyjścia testów i zapisuj logi poza repozytorium lub w ignorowanym katalogu roboczym.
- Te instrukcje nie nadają uprawnień ani nie zastępują wymaganej zgody środowiska wykonawczego.

## Weryfikacja i zakończenie kroku

- Podczas pracy uruchamiaj testy zmienianej funkcji i powiązanych modułów. Przed wysłaniem zmian sprawdź lint i formatowanie zmienionych plików oraz `npm run typecheck` dla zmian kodu, typów lub konfiguracji wpływającej na kompilację. Zmiany wyłącznie dokumentacyjne wymagają lokalnie przeglądu treści, diffu i formatowania, bez testów aplikacji.
- Build, odpowiednie testy Playwright, `release:smoke` i kontrole Androida uruchamiaj lokalnie, gdy są potrzebne do sprawdzenia zmiany lub wymaganej próby ręcznej. Pełnego zestawu kontroli nie powtarzaj lokalnie tylko po to, by odtworzyć CI.
- Zachowaj wymagane próby UI przy 390 i 1280 px, sprawdzenie wspólnego frontendu w APK i wskazane testy fizycznego telefonu. Zielone CI nie zastępuje tych prób.
- Krok jest gotowy dopiero po spełnieniu jego kryteriów i sukcesie wszystkich wymaganych zadań CI dla końcowego commita. Przed commitem/pushem lub przy oczekującym CI raportuj „zweryfikowane lokalnie, oczekuje na CI”; brakujących prób ręcznych nie oznaczaj jako zaliczonych. Polecenie właściciela, by nie commitować lub nie wysyłać zmian, ma pierwszeństwo.
- Pełne logi zapisuj do plików poza repozytorium lub w ignorowanym katalogu roboczym. Odczytuj podsumowania, a przy błędach potrzebne fragmenty. Status CI sprawdzaj zbiorczo; nie powtarzaj udanych kontroli bez istotnej zmiany kodu, konfiguracji lub środowiska.

## Konwencje API

- Endpointy pod `/api`, dane JSON walidowane schematem Zod.
- Błędy API mają kształt `{ "error": { "code": "...", "message": "..." } }`, a komunikaty dla UI są po polsku.
- Identyfikatory generuj przez `crypto.randomUUID()`. Daty i czasy zapisuj zgodnie z `docs/ARCHITECTURE.md`.
- Nie dodawaj sekretów do repozytorium; nowe zmienne środowiskowe opisz w `.env.example` i `docs/DEPLOY.md`.

## Gotowość do deployu

Nowe zmienne opisz w apps/api/.env.example i DEPLOY.md, a crony gotową linią dla cPanel. Commituj migracje; produkcja wykonuje je jawnym jobem po backupie, start API tylko je sprawdza. Zależności runtime mają używać gotowych binariów, bez kompilacji na serwerze; wyjątek wymaga decyzji i konfiguracji bundlera. Utrzymuj release:smoke. Nie zakładaj stałego workera, WebSocketów, Dockera ani Redisa. API zachowuje zgodność z poprzednim wspieranym APK; ZIP i podpisane APK są osobnymi artefaktami. Sekrety nie trafiają do repo ani paczki.

## Zakres kroku i CI

- Jeden wskazany krok na czat i commit (Conventional Commits); bez nieużywanego kodu na zapas. Zależność wymagająca następnego kroku oznacza konieczność opisania problemu i doprecyzowania zakresu.
- Kroki API/logiki mają testy automatyczne, UI także testy komponentów i próby przy 390/1280 px. Zmiana shared wymaga sprawdzenia jego użytkowników.
- Pełne CI w .github/workflows/ci.yml: npm ci, lint, format:check, typecheck, Vitest, build, Playwright headless i release:smoke na Node 24; osobny job Android: debug APK, JVM i Android Lint. Nie odtwarzaj całego zestawu lokalnie bez potrzeby.
- Lokalny release:smoke jest wymagany dla pakowania/deployu, migracji, konfiguracji startu, jobów i zależności runtime lub jawnej próby paczki. Kontrole natywne dobieraj do zmiany.
- Zakończenie kroku wymaga jego kryteriów, lokalnych kontroli, wskazanych prób ręcznych i sukcesu CI dla końcowego commita. Ostatni krok obejmuje też kryteria całej fazy i gotowość do deployu. Raport podaje commit, link i wynik CI oraz faktycznie wykonane próby.
- Push nie oznacza deployu. Workflow Deploy pozostaje ręczny i wykonuje własne kontrole; nie zmieniaj workflow przy porządkowaniu dokumentacji.

## Utrzymanie dokumentacji

- Zasady pracy są tutaj, statusy i przyszłe wymagania w plan.md, aktualne zachowanie w ARCHITECTURE.md, uruchomienie i brakujące próby w DEVELOPMENT.md, operacje produkcyjne w DEPLOY.md.
- Aktualizuj istniejący opis zamiast dopisywać relację z implementacji. DECISIONS.md zawiera tylko istotną decyzję, powód i konsekwencje; wyniki przebiegów pozostają w Git/CI.
- Nie twórz osobnych dokumentów offline, archiwów ani raportów porządkowania. Dane testowe przechowuj poza docs. Nie oznaczaj niewykonanych prób jako zaliczonych przy skracaniu dokumentacji.
