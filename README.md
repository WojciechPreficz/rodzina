# Rodzina

Rodzinna aplikacja Android i strona WWW: kalendarz, zakupy, zadania,
dokumenty i kontakty. Działa pod [rodzina.preficze.pl](https://rodzina.preficze.pl).
Przypomnienia dostarcza APK. WWW pozwala zarządzać danymi i pobrać aplikację.

## Lokalny start

Node.js 22 lub 24 oraz npm (CI i hosting: 24).

1. npm ci
2. Skopiuj apps/api/.env.example do apps/api/.env.
3. npm run dev i http://localhost:5173.

Wariant produkcyjny: npm run build, npm run db:migrate i npm start
na porcie 3000; ustaw RODZINA_PUBLIC_URL=http://localhost:3000.

## Dokumentacja

- [Plan i statusy](docs/plan.md)
- [Architektura i reguły aplikacji](docs/ARCHITECTURE.md)
- [Praca lokalna, testy i odbiór telefonu](docs/DEVELOPMENT.md)
- [Konfiguracja, aktualizacje i odzyskiwanie](docs/DEPLOY.md)
- [Istotne decyzje](docs/DECISIONS.md)
- [Zasady dla agentów](AGENTS.md)

Build testowy APK: npm run android:debug (JDK 21, SDK 36).
Aktualizacja release wymaga istniejącego klucza i zachowuje dane.
Push na main uruchamia CI; ręczny workflow Deploy publikuje API/WWW i nowe APK,
a instalację na telefonie zatwierdza użytkownik.
