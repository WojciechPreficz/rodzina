# Aktualizacja i konfiguracja

Istniejąca instalacja: https://rodzina.preficze.pl, cPanel vh.pl, Passenger,
Node 24. Nie powtarzamy pierwszego wdrożenia ani rejestracji rodziny.
Push uruchamia CI; wdrożenie jest ręczne: Actions → Deploy → Run workflow → main.
Deploy weryfikuje dokładny commit, buduje i publikuje API/WWW oraz podpisane APK.
Instalację aktualizacji na telefonie zatwierdza użytkownik.

## Konfiguracja API

Konfiguracja jest poza aplikacją, domyślnie ~/rodzina-data/.env,
lub pod RODZINA_ENV_FILE. Wzór: apps/api/.env.example.
Katalog bazy, backupów i APK musi być trwały, prywatny i poza zarządzanymi
plikami aplikacji. W cPanel: app root rodzina, startup server.cjs.

```dotenv
NODE_ENV=production
RODZINA_DATABASE_PATH=/home/<user>/rodzina-data/rodzina.db
RODZINA_BACKUP_DIR=/home/<user>/rodzina-data/backups
RODZINA_WEB_DIR=./public
RODZINA_PUBLIC_URL=https://rodzina.preficze.pl
RODZINA_ALLOW_REGISTRATION=false
RODZINA_ANDROID_DOWNLOAD_DIR=/home/<user>/rodzina-android
RODZINA_ANDROID_SHA256_CERT_FINGERPRINTS=
RODZINA_TRUSTED_PROXIES=
RODZINA_PASSWORD_RESET_EMAIL_ENABLED=false
RODZINA_SMTP_HOST=
RODZINA_SMTP_PORT=587
RODZINA_SMTP_SECURE=false
RODZINA_SMTP_USER=
RODZINA_SMTP_PASSWORD=
RODZINA_MAIL_FROM=
```

RODZINA_ALLOW_REGISTRATION włączamy tylko na czas zakładania rodziny.
PUBLIC_URL określa linki zaproszeń/resetu. DOWNLOAD_DIR puste oznacza brak
wydania (404 JSON). SHA256_CERT_FINGERPRINTS to publiczne odciski certyfikatów,
32 pary hex z dwukropkami, wiele wartości oddzielonych przecinkiem.
Puste odciski wyłączają weryfikację App Links.

RODZINA_TRUSTED_PROXIES to lista IP/CIDR zaufanych pośredników, rozdzielona
przecinkami. Domyślnie pusta: API nie ufa X-Forwarded-For i limity używają IP
bezpośredniego połączenia. Za proxy może to oznaczać wspólny limit dla wielu osób.
Przed włączeniem wysyłki ustal z operatorem faktyczne adresy i łańcuch proxy,
nadpisywanie X-Forwarded-* oraz brak bezpośredniego dostępu do portu API.
Nie wpisuj wszystkich adresów ani niepotwierdzonych zakresów. Kontrolowana próba
z własnym X-Forwarded-For nie może zmienić IP używanego przez limity.

### Reset hasła przez e-mail

RODZINA_PASSWORD_RESET_EMAIL_ENABLED=false ukrywa akcję odzyskiwania; obecne
logowanie i linki administratora działają nadal. Aby włączyć funkcję, przygotuj
skrzynkę nadawczą i ustaw HOST, PORT, SECURE, USER, PASSWORD oraz MAIL_FROM.
MAIL_FROM to sam adres skrzynki, np. rodzina@preficze.pl, a nie automatycznie
utworzone konto. Wiadomości mają nazwę nadawcy „Rodzina”. Dane logowania i adres
nadawcy muszą być dozwolone przez dostawcę SMTP.

Port 587 z SECURE=false wymusza STARTTLS; port 465 z SECURE=true uruchamia TLS
od początku. Weryfikacja certyfikatów jest obowiązkowa, minimum TLS 1.2.
PUBLIC_URL musi być adresem origin HTTPS, bez ścieżki, danych logowania,
query i fragmentu. Niepełna konfiguracja przy włączonej funkcji zatrzymuje start.
Sekrety wpisz wyłącznie do prywatnego .env poza aplikacją; nie do repo ani Actions.
Po zmianie konfiguracji zrestartuj aplikację.

Wysyłka odbywa się w żądaniu, bez nowego crona ani workera. Cała próba SMTP ma
limit 4 s; odpowiedź na przyjęte żądanie trwa co najmniej 4,5 s również dla
nieznanego adresu i błędów wysyłki. Timeout lub niepewny wynik unieważnia nowy
link. Nie ponawiamy wysyłki automatycznie. Publiczne 202 nie potwierdza dostawy.
Limity korzystają z istniejącej tabeli auth_rate_limits: 10 przyjętych prób
na 15 minut/IP i 3 na godzinę/adres, także dla nieistniejących kont.
Nie ma nowej migracji; obowiązuje zwykła procedura sprawdzenia migracji wydania.

Przed odbiorem sprawdź SPF, DKIM i DMARC według dostawcy oraz rzeczywisty odbiór
wiadomości na kontrolowanej skrzynce, folder Spam i poprawność linku HTTPS.
Sprawdź logi aplikacji i hostingu: URL /reset-hasla/:token nie może ujawniać
tokenu w logach dostępowych. Aplikacja pomija URL w logach żądań i nie zapisuje
surowych błędów SMTP; ustawienia logów hostingu wymagają osobnego potwierdzenia.
Próby lokalne z atrapą nie potwierdzają dostarczalności produkcyjnej.

## Paczka i migracje

Migracja 0028 dodaje fundament serii i wystąpień zadań, bez zmiany danych
zadań jednorazowych. C.1 nie udostępnia jeszcze tworzenia serii przez API
ani UI. Wymaga zwykłego backupu i jawnego joba migracji opisanego poniżej;
bez nowych zmiennych, zależności runtime i crona. Przed cofnięciem API
po uruchomieniu cykliczności w kolejnych krokach trzeba sprawdzić zgodność
zapisanych serii ze starszym kodem.

Migracja 0027 dodaje checklisty i licznik wersji kolejno�ci do zada�, zachowuj�c
ich tre�� i stan wykonania. Stosuj poni�sz� procedur� backupu i jawnego joba;
nie wymaga nowych zmiennych ani crona. Wdro�enie API nie publikuje nowego APK.

Lokalnie dobieramy kontrole do zmiany według [AGENTS.md](../AGENTS.md).
npm run release buduje release.zip: server.cjs, dist, public, drizzle oraz
produkcyjny manifest i lockfile. Nie kopiujemy lokalnego node_modules.
Po zmianie zależności API aktualizujemy lockfile monorepo i uruchamiamy
npm run release:lock; oba pliki scripts/release commitujemy razem ze zmianą.
Pakowanie wymaga zgodności manifestu i lockfile i nie rozwiązuje wersji ponownie.

Deploy i release:smoke instalują przez npm ci --omit=dev --ignore-scripts
--no-audit --no-fund, jawnie pobierają gotowe binarium better-sqlite3 przez
prebuild-install i sprawdzają SQLite oraz Argon2. Brak binarium przerywa
procedurę bez kompilacji na hostingu. Smoke sprawdza również migracje,
start serwera, frontend i backup na tymczasowej bazie.

Produkcja nie migruje przy starcie: po backupie job nowej paczki wykonuje
migracje, a API jedynie sprawdza ich zastosowanie. Polecenie w katalogu paczki:

```sh
/home/<user>/nodevenv/rodzina/24/bin/node --env-file=/home/<user>/rodzina-data/.env dist/jobs/migrate-db.js
```

Używaj joba aplikacji: rejestruje również random_uuid() wymagane przez migracje.
Nie wykonuj bezpośrednio SQL ani drizzle-kit migrate. Błąd migracji daje kod 1
i zatrzymuje deploy przed podmianą. Development migruje automatycznie;
lokalny npm start wymaga wcześniejszego npm run db:migrate po buildzie.

## Backup i cron

Jedyny cron: backup dziennie o 03:15 czasu serwera. Sprawdź istniejący wpis,
ścieżkę Node i strefę crona; nie dodawaj duplikatu. Utwórz prywatne katalogi
~/rodzina-data/logs i backups. Cron jawnie wczytuje .env:

```cron
15 3 * * * cd /home/<user>/rodzina && /home/<user>/nodevenv/rodzina/24/bin/node --env-file=/home/<user>/rodzina-data/.env /home/<user>/rodzina/dist/jobs/backup-db.js >> /home/<user>/rodzina-data/logs/backup.log 2>&1
```

VACUUM INTO tworzy samodzielną bazę bez WAL/SHM. Pozostaje 14 kopii dziennych
rodzina-YYYY-MM-DD.db, według Europe/Warsaw. Nowa kopia zastępuje dzisiejszą
dopiero po sukcesie; błąd nie uruchamia rotacji i kończy job kodem 1.
Po udanym backupie job sprząta wygasłe sesje i limity logowania; błąd sprzątania
jest logowany oddzielnie i nie unieważnia kopii. Monitoruj log oraz wolne miejsce.
Przed aktualizacją wykonaj polecenie crona bez harmonogramu i przekierowania.
Backup zachowuje także odpowiedzi idempotentne operacji; nie usuwaj ich ręcznie.
Usuwanie konta lub rodziny czyści aktywną bazę, nie przepisuje istniejących
backupów; usunięte dane pozostają w nich do rotacji 14 kopii dziennych.
Odtworzenie starszej kopii może przywrócić usunięte konta, dane i sesje;
uwzględnij późniejsze usunięcia przy uzgadnianiu zakresu odtworzenia.

Usuwanie kont wymaga nowego frontendu/APK z potwierdzeniem hasłem.
Starsze APK zachowuje pozostałe funkcje, ale dotychczasowe usuwanie bez hasła
otrzymuje 409 ACCOUNT_DELETION_UPDATE_REQUIRED z komunikatem aktualizacji.
To uzgodniony wyjątek zgodności; ZIP i podpisane APK aktualizujemy osobno.

Odtworzenie bazy wymaga zatrzymania API, zapisów i jobów, zachowania obecnej bazy,
usunięcia jej starych WAL/SHM i umieszczenia kopii pod DATABASE_PATH.
Po restarcie sprawdź health i dane rodziny. Utrata zapisów po backupie wymaga
osobnej decyzji właściciela; workflow nie cofa bazy automatycznie.

## GitHub Actions

### Jednorazowa konfiguracja repozytorium

W **Settings → Secrets and variables → Actions → Variables** ustaw:

| Zmienna           | Wartość                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------- |
| `DEPLOY_HOST`     | Nazwa hosta SSH podana przez vh.pl, bez protokołu                                             |
| `DEPLOY_PORT`     | Port SSH; domyślnie `22`                                                                      |
| `DEPLOY_USER`     | Użytkownik SSH/cPanel                                                                         |
| `DEPLOY_PATH`     | Kanoniczna ścieżka istniejącej aplikacji, np. `/home/USER/rodzina`                            |
| `DEPLOY_NODE`     | Pełna ścieżka Node 24 z nodevenv tej aplikacji, np. `/home/USER/nodevenv/rodzina/24/bin/node` |
| `DEPLOY_ENV_FILE` | Istniejący plik konfiguracji, np. `/home/USER/rodzina-data/.env`                              |

Ścieżki są bezwzględne, bez końcowego ukośnika, spacji, `..` i znaków powłoki.
Nie wybieraj katalogu domowego, subdomeny innej aplikacji ani systemowego Node.
Skrypt sprawdza `package.json` z nazwą `rodzina-release`, istniejące pliki, wersję
Node, właściwy npm CLI tej wersji Node, `unzip` i `tar`. Runner potrzebuje OpenSSH
(`ssh` i `scp`, dostępne na Ubuntu). Konto SSH musi mieć prawo zapisu do aplikacji,
docelowego katalogu `node_modules` i katalogu nadrzędnego aplikacji.

Na vh.pl `nodevenv/bin/npm` jest dowiązaniem do skryptu Bash
`/usr/share/l.v.e-manager/utils/npm_wrapper`. Wrapper przy `npm install` wymusza
`--prefix` wskazujący zależności produkcyjnej aplikacji i modyfikuje jej dowiązania,
niezależnie od katalogu roboczego. Nie używamy go do przygotowania aktualizacji.
Zdalny helper uruchomiony przez `DEPLOY_NODE` ustala faktyczny interpreter przez
`process.execPath`, rozwiązuje sąsiedni `bin/npm` do pliku `npm-cli.js` i uruchamia
ten CLI właściwym Node. Instalacja ma jawny `--prefix` katalogu tymczasowego,
pusty `NODE_PATH` i katalog rzeczywistego Node na początku `PATH`. Nie uruchamiamy
skryptów Bash przez Node. Nie wymaga to zmiany `.env`, zmiennych Actions ani npm
na serwerze.

„Staging” w tym skrypcie oznacza wyłącznie prywatny katalog tymczasowy na serwerze
produkcyjnym, obok aplikacji. Nie jest osobnym środowiskiem ani drugą instalacją
aplikacji; katalog służy do przygotowania i sprawdzenia paczki przed podmianą.

W **Secrets** dodaj:

- `DEPLOY_SSH_KEY`: prywatny klucz konta wdrożeniowego bez interaktywnego hasła;
  publiczną część dodaj do uprawnionych kluczy SSH w cPanel. Ogranicz uprawnienia
  konta do potrzeb tej instalacji; nie używaj klucza podpisującego APK.
- `DEPLOY_KNOWN_HOSTS`: wpis hosta SSH uzyskany i zweryfikowany niezależnie,
  np. z administratorem hostingu lub porównany z potwierdzonym odciskiem.
  Dla niestandardowego portu wpis musi wskazywać `[HOST]:PORT`. Sam wynik
  `ssh-keyscan` bez porównania odcisku nie wystarcza. Nie wyłączaj sprawdzania hosta.

Klucze są zapisywane wyłącznie w prywatnym katalogu tymczasowym runnera, usuwanym
w `finally`. Nie są artefaktami Actions. Skrypt nie wypisuje środowiska, zawartości
`.env` ani diagnostyki npm/SSH mogącej zawierać dane prywatne. Nie włączaj `set -x`.
W razie awarii log pokazuje bezpieczną nazwę etapu; szczegółową diagnostykę wykonuj
w prywatnej sesji SSH, bez kopiowania sekretów do issue lub logów Actions.

### Podpisywanie Androida w Actions

Secrets: ANDROID_KEYSTORE_BASE64 (istniejący keystore w Base64),
ANDROID_STORE_PASSWORD, ANDROID_KEY_PASSWORD. Variables: ANDROID_KEY_ALIAS
(np. rodzina), ANDROID_CERTIFICATE_SHA256 (64 cyfry hex, z dwukropkami lub bez).
Użyj klucza już zainstalowanego release; zmiana podpisu jest odrzucana.
Nie kopiuj sekretów do czatu, repo, logów ani na hosting. Runner przechowuje
klucz tymczasowo poza checkoutem i usuwa go także po błędzie.

Nowy versionCode to max(kod repo + 1, opublikowany kod + 1).
Numer zmienia się tylko podczas builda; workflow nie commituje wersji.
Katalog APK powstaje obok aplikacji, jeśli nie został skonfigurowany.
Deploy atomowo uzupełnia pusty DOWNLOAD_DIR w istniejącym .env; inne ustawienia
zachowuje. Nie ustawiaj konfliktującej wartości w panelu cPanel.

### Przebieg aktualizacji

1. Workflow wykonuje pełne kontrole API/WWW, smoke, podpisane APK, testy JVM
   i Android Lint. Weryfikuje commit, sumy paczek i zgodność poprzedniego APK.
2. SSH sprawdza instalację i blokadę .rodzina-deploy-lock. Prywatny staging
   obok aplikacji służy przygotowaniu paczki i zależności, nie jest drugim środowiskiem.
3. Dotychczasowy job tworzy backup. Job nowej paczki wykonuje migracje.
   Historia rodzina-deploy-history zachowuje previous.tar.gz, release.zip
   i metadane transakcji; bez .env i bazy. Administrator rotuje historię ręcznie.
4. Skrypt kopiuje przygotowane zależności i zarządzane pliki aplikacji,
   zachowuje konfigurację, bazę, APK i dowiązanie node_modules cPanel.
   Restart przez tmp/restart.txt. Podmiana jest sekwencyjna: wybierz mały ruch
   i nie przerywaj kopiowania. Równoległe wdrożenia czekają na blokadę.
5. HTTPS sprawdza health JSON (ok i dbOk), stronę HTML, 401 auth/me bez sesji
   oraz stare metadane/sumę APK. Dopiero potem publikuje nowe APK pod niezmienną
   nazwą z wersją, a na końcu atomowo latest.json. Ponownie sprawdza pobranie.
6. Podsumowanie podaje commit, sumy i wynik. Zielone CI nie zastępuje udanego
   Deploy; sam restart lub działająca strona nie potwierdza całej aktualizacji.

## Lokalne podpisywanie i publikacja APK

Zachowaj pl.preficze.rodzina, istniejący keystore i jego niezależną zaszyfrowaną
kopię wraz z aliasem i hasłami. Utrata klucza uniemożliwia aktualizację.
Odcisk sprawdzisz interaktywnie: keytool -list -v -keystore <plik>.
JDK 21 i SDK 36; konfiguracja budowania w .env.android.example.

Najprościej: npm run android:release:interactive w terminalu bez przekierowań.
Domyślny klucz: ~/rodzina-signing/rodzina-release.jks, alias rodzina.
Inną ścieżkę/alias wskaż przez RODZINA_ANDROID_KEYSTORE i
RODZINA_ANDROID_KEY_ALIAS. Nie generuj nowego klucza dla istniejącej aplikacji.
Automatyzacja używa także RODZINA_ANDROID_STORE_PASSWORD i
RODZINA_ANDROID_KEY_PASSWORD tylko w środowisku procesu. android:check-signing
sprawdza je przed budową; po użyciu usuń hasła z sesji. Nie loguj środowiska.

1. Dla ręcznego wydania zwiększ versionCode (maks. 2100000000) i versionName
   w android/version.properties. Zbuduj npm run android:release.
2. Wynik w android-releases/<kod>-<wersja>: APK, latest.json i publiczny odcisk.
   android:package pakuje już zbudowane APK. Podpis i tożsamość są sprawdzane.
3. Wykonaj odbiór fizycznego telefonu z [DEVELOPMENT.md](DEVELOPMENT.md),
   również aktualizację wcześniejszego release bez czyszczenia danych.
4. Opublikuj najpierw zgodne API. Wgraj APK tymczasowo do DOWNLOAD_DIR,
   sprawdź SHA-256 i zmień nazwę na docelową. Dopiero potem atomowo podmień
   latest.json. Nigdy nie zastępuj opublikowanego pliku inną zawartością.
5. Sprawdź /downloads/android/latest.json (JSON, no-store), APK (właściwy
   MIME, attachment, nosniff, immutable) i SHA-256. Hosting nie może zwracać
   HTML SPA zamiast brakującego APK. Cofnięcie metadanych nie instaluje downgrade'u.

App Links: /.well-known/assetlinks.json musi zwracać 200 JSON bez logowania
i przekierowań, z pl.preficze.rodzina i odciskiem podpisu zainstalowanego APK.
Trasy: /zaproszenie/ i /reset-hasla/. HTTP 200 nie dowodzi weryfikacji Androida;
sprawdź ją na telefonie. Brak APK pozostawia działające trasy WWW.

## Zgodność urządzeń

API zachowuje poprzednią wspieraną wersję APK. ZIP nie aktualizuje telefonu.
Aktualizacja APK zachowuje dane i podpis. Obecna pamięć urządzenia używa IDB v3:
nie cofaj klienta do starszego silnika, nie czyść niewysłanych zmian i nie
odinstalowuj aplikacji w celu naprawy migracji. Import po zamknięciu starszych
instancji; przerwany import wznawia się. Backup serwera nie zawiera kolejki
telefonu. Rollback wymaga klienta zgodnego z jej formatem i obu modułów zapisu.

### Awaria i bezpieczne odzyskiwanie

- Etapy `android-checksum`, `android-configuration`, `android-apk` i
  `android-metadata` identyfikują kontrolę transferu, pierwszą konfigurację,
  kopiowanie APK i zatwierdzanie metadanych. Do czasu podmiany `latest.json`
  użytkownicy otrzymują poprzednie wydanie. Jeśli po awarii pozostało nowe APK
  bez metadanych, nie nadpisuj go inną zawartością. Ustaw większy bazowy kod
  w `android/version.properties` i uruchom Deploy ponownie. Stare linki pozostają
  niezmienne. Zmiana klucza podpisującego jest odrzucana.

- Etapy walidacji, transferu, rozpakowania, zależności, backupu, `migration` i archiwizacji
  kończą się przed podmianą aplikacji. Błąd `migration` nie powoduje restartu.
  Migrator SQLite wykonuje migracje w transakcji; po błędzie sprawdź stan bazy
  i zgodność działającego kodu. Także błąd późniejszego etapu może pozostawić
  bazę po udanej migracji. Backup pozostaje, ale nie odtwarzamy go automatycznie.
  Popraw przyczynę i uruchom ponownie.
- Błąd w etapie `promotion`, `restart` albo kontroli HTTP może oznaczać częściową
  aktualizację. Sprawdź podsumowanie Actions i prywatne logi Passengera/cPanel,
  porównaj health oraz logi cronów. Nie uznawaj samego restartu za udany deploy.
- Ustal UUID ostatniego wdrożenia z historii. Zachowaj dodatkową kopię obecnej
  bazy istniejącym jobem przed odzyskiwaniem. Poprzednia paczka nie zawiera
  `node_modules`; zależności trzeba przygotować ponownie dla jej `package.json`
  w prywatnym katalogu tymczasowym, właściwym npm CLI tej samej wersji Node,
  z jawnym `--prefix` i pominięciem wrappera cPanel, bez kompilacji ze źródeł.
- **Wycofanie do paczki z lockfile:** przygotuj ją przez `npm ci --omit=dev
--ignore-scripts --no-audit --no-fund`, potem jawny `prebuild-install` i sprawdzenie
  obu modułów natywnych. Przywróć zgodną parę manifest–lockfile z tej paczki.
- **Starsza paczka bez lockfile:** automatyczny deploy jej nie przyjmie. Odzyskiwanie
  jest osobną ręczną procedurą w prywatnym stagingu: zachowaj kopię obecnej pary
  manifest–lockfile, użyj właściwego npm CLI z `install --omit=dev --ignore-scripts
--no-audit --no-fund --prefix KATALOG_STAGINGU`, potem jawnego pobrania binarium
  SQLite i sprawdzenia modułów jak wyżej. Taka instalacja ponownie rozwiązuje zakresy
  i **nie odtwarza gwarantowanie poprzednich wersji**. Zachowaj wygenerowany lockfile
  z przygotowanym manifestem jako zapis odzyskiwania; nie łącz starszego manifestu
  z lockfile aktualnie działającego wydania. W razie braku gotowych binariów przerwij
  odzyskiwanie i przygotuj poprawkę do przodu. Nie uruchamiaj kompilacji na hostingu.
- Przed cofnięciem kodu porównaj `drizzle/meta/_journal.json` obu paczek i oceń
  zgodność starszego API z obecną bazą. Przy niezgodnej migracji preferuj poprawkę
  do przodu. Nie uruchamiaj starego kodu bez tej oceny. Cofnięcie produkcyjnej bazy
  wymaga osobnej decyzji właściciela, zatrzymania zapisów i cronów oraz uwzględnienia
  utraty danych powstałych po backupie; workflow tego nie robi.
- Rozpakuj `previous.tar.gz` do nowego prywatnego katalogu, sprawdź jego zawartość,
  przygotuj zależności, a następnie podmień zarządzane ścieżki (każdą osobno).
  Nie usuwaj katalogu aplikacji, `.env`, bazy, APK, konfiguracji ani symlinku cPanel.
  Przy cofnięciu migracji sam overlay może zostawić nowsze pliki: po ocenie
  zgodności odtwórz `drizzle` dokładnie z właściwej paczki, zachowując kopię obecnego.
  Wykonaj restart i wszystkie kontrole HTTP, łącznie z APK i 401 bez sesji.
- Po awarii runnera/zerwaniu SSH może pozostać `.rodzina-deploy-lock`. Najpierw
  upewnij się w Actions i na serwerze, że żaden deploy nie działa. Odczytaj prywatny
  `transaction.json`, sprawdź pełną ścieżkę stagingu i dopiero wtedy usuń wyłącznie
  wskazany staging i blokadę. Nie usuwaj historii ani bazy, aby odblokować deploy.

## Starsze instalacje WWW

Przed aktualizacją instalacji z Web Push usuń dawny cron send-reminders
i poczekaj na zakończenie joba; wykonaj i zachowaj kopię sprzed migracji 0013.
Nie dodawaj crona przypomnień ani VAPID. W kolejnych wydaniach zachowujemy
przejściowy /sw.js z no-store oraz manifest.webmanifest zwracający 410,
również po deployu nakładkowym. Worker wyrejestrowuje dawną instalację
i usuwa wyłącznie jej precache; nie czyści sesji i danych użytkownika.
Powrót przed usunięcie tabel Web Push wymaga zgodnej paczki i osobno
zatwierdzonego odtworzenia kopii przy zatrzymanych zapisach i jobach.
