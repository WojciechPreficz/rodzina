# Instrukcje dla agentów

## Zakres projektu

- Zanim zaczniesz pracę, przeczytaj `docs/PLAN.md` w całości.
- Realizuj dokładnie jedną wskazaną fazę naraz. Nie implementuj elementów z sekcji „Poza zakresem” ani z kolejnych faz.
- Fazy 0-7 uruchamiamy i testujemy wyłącznie lokalnie. Nie wdrażaj na serwer przed fazą 8.
- Interfejs użytkownika oraz dokumentacja w `docs/` są po polsku. Kod, nazwy, komentarze i commity są po angielsku.

## Stack

- Node.js 22 lub 24, npm workspaces.
- `apps/web`: React, TypeScript, Vite, Mantine i `vite-plugin-pwa`.
- `apps/api`: Fastify, TypeScript, Drizzle ORM i `better-sqlite3`.
- `packages/shared`: współdzielone typy i schematy.
- Testy: Vitest; testy przeglądarkowe Playwright, jeśli pojawią się w późniejszej fazie, uruchamiaj wyłącznie headless.

## Komendy

- `npm run dev` — API i Vite lokalnie.
- `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`.
- `npm run build`, `npm run release:smoke`.
- `npm run db:generate` — generowanie migracji Drizzle.
- `npm start` — lokalny build produkcyjny na porcie 3000; wymaga `apps/api/.env`.

## Konwencje API

- Endpointy pod `/api`, dane JSON walidowane schematem Zod.
- Błędy API mają kształt `{ "error": { "code": "...", "message": "..." } }`, a komunikaty dla UI są po polsku.
- Identyfikatory generuj przez `crypto.randomUUID()`. Daty i czasy zapisuj zgodnie z `docs/PLAN.md`.
- Nie dodawaj sekretów do repozytorium; nowe zmienne środowiskowe opisz w `.env.example` i `docs/DEPLOY.md`.

## Gotowość do deployu

W każdej fazie stosuj wymagania „Gotowość do deployu” z sekcji 1.1 `docs/PLAN.md`: dokumentuj konfigurację i cron, commituj migracje, nie wymagaj kompilacji nowych zależności runtime na serwerze oraz utrzymuj działający `npm run release:smoke`. Nie zakładaj stałego procesu w tle, WebSocketów, Dockera ani Redisa.
