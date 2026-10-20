# Instrukcje dla agentów

## Zakres projektu

- Zanim zaczniesz pracę, przeczytaj aktualny kontekst i zasady z sekcji 1, 1.1 i 1.2 `docs/plan.md` oraz opis bieżącej fazy i kroku. Sekcje 2-5 i inne dokumenty czytaj w zakresie potrzebnym do zmiany i jej zależności. Nie wczytuj rutynowo zapisów historycznych, przyszłych faz ani ponownie treści już przeczytanych w tym czacie, jeśli się nie zmieniły.
- Realizuj dokładnie jedną wskazaną fazę naraz. Nie implementuj elementów z sekcji „Poza zakresem” ani z kolejnych faz.
- Kolejność prac: fazy 0-3, pierwszy deploy (wykonany: https://rodzina.preficze.pl), faza 4 (Android i przypomnienia offline), faza 5 (zakupy), faza 6 (obiady), faza 7 (zadania), faza 8 (dokumenty). Nie planujemy wydania open source. Pierwszy deploy ma osobne historyczne kroki D.1-D.4; nie powtarzaj go.
- Funkcje rozwijamy i sprawdzamy lokalnie w zakresie zmiany; pełną weryfikację końcową wykonuje istniejący `.github/workflows/ci.yml` według sekcji 1.2 planu. Istniejący serwer aktualizujemy sprawdzoną paczką release według `docs/DEPLOY.md`; APK budujemy, podpisujemy i aktualizujemy osobno.
- Przed fazą 5 wykonujemy kroki 4.8-4.10 wycofania PWA. Docelowo zostają zwykła strona WWW i APK; przypomnienia działają w APK. Starsze wymagania PWA/Web Push ustępują sekcji „Wycofanie PWA” w planie. Zachowujemy API harmonogramu, logikę odbiorców, dane przypomnień i alarmy Androida.
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
- Build, odpowiednie testy Playwright, `release:smoke` i kontrole Androida uruchamiaj lokalnie, gdy są potrzebne do sprawdzenia zmiany lub wymaganej próby ręcznej. Pełnego zestawu kontroli nie powtarzaj lokalnie tylko po to, by odtworzyć CI. Szczegóły zakresu są w sekcji 1.2 planu.
- Zachowaj wymagane próby UI przy 390 i 1280 px, sprawdzenie wspólnego frontendu w APK i wskazane testy fizycznego telefonu. Zielone CI nie zastępuje tych prób.
- Krok jest gotowy dopiero po spełnieniu jego kryteriów i sukcesie wszystkich wymaganych zadań CI dla końcowego commita. Przed commitem/pushem lub przy oczekującym CI raportuj „zweryfikowane lokalnie, oczekuje na CI”; brakujących prób ręcznych nie oznaczaj jako zaliczonych. Polecenie właściciela, by nie commitować lub nie wysyłać zmian, ma pierwszeństwo.
- Pełne logi zapisuj do plików poza repozytorium lub w ignorowanym katalogu roboczym. Odczytuj podsumowania, a przy błędach potrzebne fragmenty. Status CI sprawdzaj zbiorczo; nie powtarzaj udanych kontroli bez istotnej zmiany kodu, konfiguracji lub środowiska.

## Konwencje API

- Endpointy pod `/api`, dane JSON walidowane schematem Zod.
- Błędy API mają kształt `{ "error": { "code": "...", "message": "..." } }`, a komunikaty dla UI są po polsku.
- Identyfikatory generuj przez `crypto.randomUUID()`. Daty i czasy zapisuj zgodnie z `docs/PLAN.md`.
- Nie dodawaj sekretów do repozytorium; nowe zmienne środowiskowe opisz w `.env.example` i `docs/DEPLOY.md`.

## Gotowość do deployu

W każdej fazie stosuj wymagania „Gotowość do deployu” z sekcji 1.1 `docs/PLAN.md`: dokumentuj konfigurację i cron, commituj migracje, nie wymagaj kompilacji nowych zależności runtime na serwerze oraz utrzymuj działający `npm run release:smoke`. Nie zakładaj stałego procesu w tle, WebSocketów, Dockera ani Redisa.
