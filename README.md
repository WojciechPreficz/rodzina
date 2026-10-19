# Rodzina

Rodzinna aplikacja Android i strona WWW do wspólnego organizowania codziennych spraw.

Przypomnienia offline są funkcją APK. Strona pozwala zarządzać danymi i pobrać
aplikację Android. Wycofanie PWA jest podzielone na kroki 4.8-4.10 w `docs/PLAN.md`;
starsze instrukcje PWA poniżej i w dokumentacji opisują poprzednie wydania.

## Lokalny start

Wymagane: Node.js 22 lub 24 oraz npm.

1. Zainstaluj zależności: `npm ci`.
2. Skopiuj `apps/api/.env.example` do `apps/api/.env`.
3. Uruchom `npm run dev` i otwórz `http://localhost:5173`.

Dokładne instrukcje, testowanie PWA na Androidzie i komendy weryfikacyjne znajdują się w [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Instrukcja przyszłego wdrożenia jest w [docs/DEPLOY.md](docs/DEPLOY.md); w Fazie 0 nie wdrażamy aplikacji na serwer.
