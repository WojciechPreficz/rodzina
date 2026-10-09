# Wdrożenie na cPanel vh.pl (instrukcja dla Fazy 8)

**Ta instrukcja opisuje przyszłe wdrożenie. W Fazach 0-7 wszystko uruchamiamy i testujemy lokalnie; nie wykonuj poniższych kroków na serwerze.**

## 1. Domena i certyfikat

1. W cPanel utwórz subdomenę, np. `rodzina.<domena>`.
2. Włącz AutoSSL dla subdomeny i sprawdź w przeglądarce ważny certyfikat HTTPS.

## 2. Zbudowanie i wgranie paczki

Lokalnie uruchom `npm ci` i `npm run release`. Wgraj `release.zip` do katalogu `~/rodzina/` i rozpakuj go. Paczka zawiera `server.cjs`, `dist/`, `public/`, `drizzle/` oraz produkcyjny `package.json`.

## 3. Konfiguracja aplikacji Node

W cPanel **Setup Node.js App** wybierz Node.js 24 albo 22, ustaw app root `rodzina`, startup file `server.cjs` i URL subdomeny. Utwórz katalogi `~/rodzina-data/`, `~/rodzina-data/logs/` oraz `~/rodzina-data/backups/`.

Utwórz `~/rodzina-data/.env` na podstawie `apps/api/.env.example` (plik dostarczony właścicielowi przed wdrożeniem) i ustaw co najmniej:

```dotenv
NODE_ENV=production
RODZINA_DATABASE_PATH=/home/<user>/rodzina-data/rodzina.db
RODZINA_WEB_DIR=./public
RODZINA_PUBLIC_URL=https://rodzina.<domena>
RODZINA_ALLOW_REGISTRATION=true
```

Konfigurację odczytuje `server.cjs` przez `RODZINA_ENV_FILE` albo domyślnie `/home/<user>/rodzina-data/.env`. Nie umieszczaj `.env` w paczce ani repozytorium. Sesje są losowymi tokenami przechowywanymi w bazie jako hash; nie potrzeba sekretu podpisującego cookie.

W aplikacji Node wykonaj **Run NPM Install**. Zależności runtime w paczce są gotowymi pakietami; nie uruchamiaj kompilacji aplikacji na serwerze.

### Konfiguracja kont i sesji (faza 1)

- `RODZINA_PUBLIC_URL` jest adresem linków zaproszeń i resetu hasła. Na serwerze ustaw dokładny adres HTTPS subdomeny. Lokalnie: `http://localhost:5173` dla `npm run dev`, `http://localhost:3000` dla `npm start`.
- `RODZINA_ALLOW_REGISTRATION=true` pozwala założyć rodzinę. Po utworzeniu pierwszego administratora ustaw `false` i zrestartuj aplikację. Dołączanie przez zaproszenie nadal działa.
- Cookie `sid` jest HttpOnly, SameSite=Lax i Secure w produkcji. Sesja i cookie są ważne 60 dni i odnawiane przy aktywności. Token sesji jest przechowywany w bazie jako SHA-256; hasła i PIN-y jako Argon2id.
- Zaproszenie jest jednorazowe i ważne 7 dni. Link resetu hasła tworzy administrator, jest jednorazowy i ważny 24 godziny. Aplikacja nie wysyła e-maili: link należy skopiować lub udostępnić z ekranu Rodzina.
- Role dorosłych można zmieniać między administratorem i dorosłym. Kont dzieci nie zamieniamy w dorosłych ani odwrotnie. Ostatni administrator nie może zostać usunięty ani zdegradowany.
- Faza 1 nie dodaje nowych zmiennych, zadań crona ani zależności runtime. Paczka zawiera istniejące migracje auth oraz natywne pakiety `better-sqlite3` i `@node-rs/argon2`; instalacja musi użyć gotowych binariów. Nie wdrażamy jej przed fazą 8.

## 4. Migracje, restart i weryfikacja

Migracje Drizzle są dołączone w `drizzle/` i wykonywane przy starcie API. Zrestartuj aplikację przez utworzenie/odświeżenie `~/rodzina/tmp/restart.txt`. Sprawdź:

```text
https://rodzina.<domena>/api/health
```

Oczekiwana odpowiedź zawiera `ok: true` oraz `dbOk: true`. Zweryfikuj także stronę główną. W fazie 8 załóż rodzinę, utwórz zaproszenie i otwórz je w drugim profilu przeglądarki. Obie osoby powinny być widoczne w Więcej > Rodzina. Sprawdź też dodanie dziecka, logowanie kodem rodziny i PIN-em oraz reset hasła przez wygenerowany link.

## 5. Cron cPanel

Passenger może usypiać proces; nie uruchamiaj schedulera w pamięci. Cała konfiguracja crona jest niezależna od zmiennych środowiskowych aplikacji, dlatego każde polecenie joba jawnie wczytuje `~/rodzina-data/.env`.

Na etapie Fazy 0 heartbeat służy wyłącznie do sprawdzenia dostępu crona do bazy. Przykładowy wpis tymczasowy co 5 minut (zastąp `<user>` rzeczywistą ścieżką do Node z nodevenv):

```cron
*/5 * * * * /home/<user>/nodevenv/rodzina/24/bin/node --env-file=/home/<user>/rodzina-data/.env /home/<user>/rodzina/dist/jobs/heartbeat.js >> /home/<user>/rodzina-data/logs/heartbeat.log 2>&1
```

Job heartbeat nie jest funkcją docelową i zostanie usunięty w Fazie 3. Docelowe zadania okresowe dla przypomnień i backupu zostaną opisane w swoich fazach.

## 6. Aktualizacja

Procedura aktualizacji aplikacji zostanie uzupełniona i zweryfikowana w Fazie 8. Przed aktualizacją bazy należy wykonać kopię zapasową; w Fazie 0 backup nie jest jeszcze implementowany.
