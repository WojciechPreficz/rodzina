# Wdrożenie i aktualizacje na cPanel vh.pl

**Pierwsze wdrożenie wykonano po fazie 3; aplikacja działa pod https://rodzina.preficze.pl (potwierdzenie właściciela z 16.10.2026).** W planie jest to zapis historyczny z krokami D.1-D.4, bez numeru fazy. Dalsza kolejność to: faza 4 Android, 5 zakupy, 6 obiady, 7 zadania i 8 dokumenty. Funkcje rozwijamy i testujemy lokalnie, a serwer aktualizujemy sprawdzoną paczką release. Nie powtarzamy pierwszego wdrożenia ani zakładania istniejącej rodziny.

Historyczny stan lokalnej weryfikacji z 16.10.2026, zapisany przed potwierdzeniem wdrożenia: `npm ci`, lint, typecheck, release (z buildem)
i `release:smoke` zakończyły się powodzeniem. `npm test`: 375 testów przeszło, 12 nie przeszło
w 6 plikach testów UI kalendarza i przypomnień. Przed kolejną aktualizacją trzeba wyjaśnić te błędy, jeśli nadal występują;
gotowy ZIP i poprawny smoke nie oznaczają zaliczenia pełnej weryfikacji. Później właściciel potwierdził działanie strony; testy push na Androidzie i obserwacja cronów wymagają osobnego potwierdzenia.

## 1. Domena i certyfikat

1. W cPanel utwórz subdomenę, np. `rodzina.<domena>`.
2. Włącz AutoSSL dla subdomeny i sprawdź w przeglądarce ważny certyfikat HTTPS.

## 2. Zbudowanie i wgranie paczki

Przed instalacją zatrzymaj lokalną aplikację (`npm run dev`, `npm run dev:api`, `npm start`), `npm run dev:cron` i testy w trybie watch. W każdym terminalu, w którym działają, użyj `Ctrl+C` i poczekaj na zakończenie procesu.

Lokalnie, w katalogu repozytorium, uruchom kolejno:

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run release
npm run release:smoke
```

`npm run release` wykonuje również build. `release:smoke` sprawdza paczkę, start serwera i oba joby na tymczasowej bazie. Wgraj `release.zip` do katalogu `~/rodzina/` i rozpakuj go. Paczka zawiera `server.cjs`, `dist/`, `public/`, `drizzle/` oraz produkcyjny `package.json`. Nie kopiuj lokalnego `node_modules` na hosting — binaria dla Windows nie działają na Linuksie.

### Windows: `npm ci` kończy się `EPERM ... unlink ... argon2.win32-x64-msvc.node`

`npm ci` usuwa dotychczasowe zależności przed instalacją. Windows nie pozwala usunąć natywnego modułu Argon2, gdy jest załadowany przez działające API lub testy. `Ctrl+C` w terminalu, w którym instalacja już się zakończyła błędem, nie zatrzymuje API z innego terminala.

1. Zatrzymaj aplikację i testy w ich terminalach, jak opisano wyżej, po czym ponów `npm ci`.
2. Jeśli terminal został zamknięty, sprawdź procesy w PowerShell:

   ```powershell
   Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
     Select-Object ProcessId, ParentProcessId, CommandLine | Format-List
   ```

   Zidentyfikuj proces API lub watchera tej aplikacji po ścieżce repozytorium i poleceniu. Zatrzymaj tylko ustalony proces przez `Stop-Process -Id <PID>`, a następnie ponów instalację. Nie zatrzymuj wszystkich procesów Node: mogą należeć do innych aplikacji, w tym Codex.

3. Jeżeli blokada pozostaje, uruchom ponownie Windows i wykonaj `npm ci` przed ponownym startem aplikacji. Jeśli błąd występuje także wtedy, sprawdź uprawnienia pliku i historię ochrony antywirusa.

Nie usuwaj `package-lock.json` ani lokalnej bazy w celu naprawy tego błędu.

## 3. Konfiguracja aplikacji Node

W cPanel **Setup Node.js App** wybierz Node.js 24 albo 22, ustaw app root `rodzina`, startup file `server.cjs` i URL subdomeny. Utwórz katalogi `~/rodzina-data/`, `~/rodzina-data/logs/` oraz `~/rodzina-data/backups/`.

Utwórz `~/rodzina-data/.env` na podstawie `apps/api/.env.example` (plik dostarczony właścicielowi przed wdrożeniem) i ustaw co najmniej:

```dotenv
NODE_ENV=production
RODZINA_DATABASE_PATH=/home/<user>/rodzina-data/rodzina.db
RODZINA_BACKUP_DIR=/home/<user>/rodzina-data/backups
RODZINA_WEB_DIR=./public
RODZINA_PUBLIC_URL=https://rodzina.<domena>
RODZINA_ALLOW_REGISTRATION=true
RODZINA_VAPID_PUBLIC_KEY=<klucz publiczny z generatora>
RODZINA_VAPID_PRIVATE_KEY=<klucz prywatny z tej samej pary>
RODZINA_VAPID_SUBJECT=mailto:admin@twoja-domena.pl
```

Konfigurację odczytuje `server.cjs` przez `RODZINA_ENV_FILE` albo domyślnie `/home/<user>/rodzina-data/.env`. Nie umieszczaj `.env` w paczce ani repozytorium. Sesje są losowymi tokenami przechowywanymi w bazie jako hash; nie potrzeba sekretu podpisującego cookie.

W aplikacji Node wykonaj **Run NPM Install**. Zależności runtime w paczce są gotowymi pakietami; nie uruchamiaj kompilacji aplikacji na serwerze.

### Konfiguracja kont i sesji (faza 1)

- `RODZINA_PUBLIC_URL` jest adresem linków zaproszeń i resetu hasła. Na serwerze ustaw dokładny adres HTTPS subdomeny. Lokalnie: `http://localhost:5173` dla `npm run dev`, `http://localhost:3000` dla `npm start`.
- `RODZINA_ALLOW_REGISTRATION=true` pozwala założyć rodzinę. Po utworzeniu pierwszego administratora ustaw `false` i zrestartuj aplikację. Dołączanie przez zaproszenie nadal działa.
- Cookie `sid` jest HttpOnly, SameSite=Lax i Secure w produkcji. Sesja i cookie są ważne 60 dni i odnawiane przy aktywności. Token sesji jest przechowywany w bazie jako SHA-256; hasła i PIN-y jako Argon2id.
- Zaproszenie jest jednorazowe i ważne 7 dni. Link resetu hasła tworzy administrator, jest jednorazowy i ważny 24 godziny. Aplikacja nie wysyła e-maili: link należy skopiować lub udostępnić z ekranu Rodzina.
- Role dorosłych można zmieniać między administratorem i dorosłym. Kont dzieci nie zamieniamy w dorosłych ani odwrotnie. Ostatni administrator nie może zostać usunięty ani zdegradowany.
- Faza 1 nie dodaje nowych zmiennych, zadań crona ani zależności runtime. Paczka zawiera istniejące migracje auth oraz natywne pakiety `better-sqlite3` i `@node-rs/argon2`; instalacja musi użyć gotowych binariów. Pierwszy deploy obejmował stan po fazie 3.

## 4. Migracje, restart i weryfikacja

Migracje Drizzle są dołączone w `drizzle/` i wykonywane przy starcie API. Zrestartuj aplikację przez utworzenie/odświeżenie `~/rodzina/tmp/restart.txt`. Sprawdź:

```text
https://rodzina.<domena>/api/health
```

Oczekiwana odpowiedź zawiera `ok: true` oraz `dbOk: true`. Zweryfikuj także stronę główną. Przy pierwszym uruchomieniu załóż rodzinę, utwórz zaproszenie i otwórz je w drugim profilu przeglądarki. Obie osoby powinny być widoczne w Więcej > Rodzina. Sprawdź też dodanie dziecka, logowanie kodem rodziny i PIN-em oraz reset hasła przez wygenerowany link.

## 5. Cron cPanel

Passenger może usypiać proces; nie uruchamiaj schedulera w pamięci. Cała konfiguracja crona jest niezależna od zmiennych środowiskowych aplikacji, dlatego każde polecenie joba jawnie wczytuje `~/rodzina-data/.env`.

Po kroku 3.5 dostępne są dwa docelowe joby: przypomnienia co 5 minut i backup raz dziennie.
Techniczny job heartbeat został usunięty; nie dodawaj jego wpisu do crona.

### Wysyłka przypomnień — krok 3.2

Przed uruchomieniem serwera i jobów wygeneruj `npm run vapid:generate`. Wklej obydwa klucze
do `.env` i ustaw `RODZINA_VAPID_SUBJECT` na kontakt administratora (`mailto:` albo HTTPS).
Trzy zmienne są wymagane; walidacja sprawdza długości, format i zgodność pary P-256.
Klucz prywatny pozostaje wyłącznie w `.env`; zachowaj tę samą parę przy aktualizacjach.
Zmiana pary wymaga ponownej subskrypcji urządzeń. Generator używa kryptografii Node.

Nowa migracja `0012_gigantic_maelstrom.sql` dodaje `push_subscriptions` z unikalnym endpointem
i usuwaniem kaskadowym po usunięciu użytkownika. Serwer uruchamia migracje przed startem.
Job zakłada już zmigrowaną bazę. `web-push` oraz jego zależności są pakietami JavaScript;
nie wymagają nowych kompilacji natywnych na serwerze i trafiają do zależności paczki release.

Docelowy wpis crona przypomnień (konfiguracja pierwszego wdrożenia; przy aktualizacji sprawdź istniejący wpis, nie dodawaj duplikatu):

```cron
*/5 * * * * cd /home/<user>/rodzina && /home/<user>/nodevenv/rodzina/24/bin/node --env-file=/home/<user>/rodzina-data/.env /home/<user>/rodzina/dist/jobs/send-reminders.js >> /home/<user>/rodzina-data/logs/reminders.log 2>&1
```

Zastąp `<user>` loginem hostingu i zweryfikuj ścieżkę Node w nodevenv. Wpis nie wymaga
aktywnego procesu Passengera. Rezerwacja wszystkich należnych przypomnień i zapis kolejnych
terminów odbywają się w jednej transakcji SQLite `BEGIN IMMEDIATE`, przed wysyłką HTTP.
Job pomija spóźnienia ponad 2 godziny; dla offsetów od dat bez godziny (baza 09:00) ponad
12 godzin. Graniczne 2 i 12 godzin są jeszcze wysyłane. Spóźnione są również rezerwowane,
a kolejne terminy cyklu obliczane względem czasu joba, bez nadrabiania wszystkich zaległych.
Odpowiedzi 404/410 usuwają nieważną subskrypcję. Sukces zapisuje `last_success_at`.
Inne błędy pozostawiają subskrypcję, nie cofają rezerwacji i dają niezerowy kod zakończenia.
Logi JSON trafiają do stdout bez kluczy, endpointów ani treści powiadomień.

Rezerwacja oznacza jedną próbę wysyłki. Awaria po jej zatwierdzeniu lub błąd dostawcy może
spowodować pominięcie powiadomienia; job nie ponawia go automatycznie. Ten kompromis chroni
przed podwójnymi próbami przy równoległym cronie. Nie gwarantuje dostarczenia przez dostawcę.
Krok 3.2 nie dodaje jeszcze API subskrypcji ani obsługi push w service workerze (krok 3.3).
Smoke generuje tymczasową parę VAPID i uruchamia z paczki job na pustej bazie, bez wysyłki.

### Backup SQLite — krok 3.5

`RODZINA_BACKUP_DIR` wskazuje katalog kopii. Domyślnie jest to `./apps/api/data/backups`
względem katalogu roboczego; na hostingu ustaw bezwzględne
`/home/<user>/rodzina-data/backups`. Job tworzy katalog, jeśli go brakuje.
Katalog powinien być dostępny wyłącznie dla konta aplikacji i leżeć poza katalogiem publicznym.

Wpis dzienny o 03:15 czasu serwera (konfiguracja pierwszego wdrożenia; przy aktualizacji sprawdź istniejący wpis, nie dodawaj duplikatu):

```cron
15 3 * * * cd /home/<user>/rodzina && /home/<user>/nodevenv/rodzina/24/bin/node --env-file=/home/<user>/rodzina-data/.env /home/<user>/rodzina/dist/jobs/backup-db.js >> /home/<user>/rodzina-data/logs/backup.log 2>&1
```

Zastąp `<user>` loginem hostingu i sprawdź ścieżkę Node oraz strefę czasową crona.
Backup wykonuje `VACUUM INTO` na działającej bazie SQLite (również w trybie WAL).
Nazwa `rodzina-YYYY-MM-DD.db` używa daty w `Europe/Warsaw`. Ponowne uruchomienie
tego samego dnia zastępuje kopię dopiero po zakończeniu nowego snapshotu.
Po sukcesie pozostaje 14 ostatnich kopii według dat w nazwach; inne pliki i katalogi
nie podlegają rotacji. Błąd tworzenia kopii nie uruchamia rotacji. Job loguje wynik
do stdout, a błąd do stderr i kończy się kodem 1. Monitoruj `backup.log` i wolne miejsce.

Lokalnie po buildzie uruchom `npm run job:backup` z katalogu repozytorium.
Na serwerze przed aktualizacją uruchom ręcznie polecenie z wpisu crona (bez harmonogramu
i przekierowania logów). Kopię można otworzyć jako samodzielną bazę SQLite; nie wymaga
plików WAL ani SHM. Przy odtwarzaniu zatrzymaj API i joby, zachowaj dotychczasową bazę,
usuń jej stare pliki `-wal` i `-shm`, a wybraną kopię umieść pod `RODZINA_DATABASE_PATH`.
Po restarcie sprawdź `/api/health` i dane rodziny.

Krok nie dodaje migracji ani zależności runtime. Istniejące migracje, w tym historyczna
tabela `job_runs`, pozostają bez zmian. `release:smoke` uruchamia oba joby z paczki
i sprawdza integralność kopii oraz obecność tabel przypomnień i subskrypcji.

## 6. Aktualizacja

Procedurę aktualizacji opisuje krok D.4 historycznego etapu pierwszego wdrożenia w `PLAN.md`; jej przećwiczenie wymaga osobnego potwierdzenia. Przed aktualizacją bazy wykonaj kopię jobem `backup-db.js` opisanym powyżej.

### Aktualizacja istniejącego serwera od fazy 4

API/PWA i Android mają osobne artefakty i terminy publikacji:

| Artefakt              | Zawartość i sposób aktualizacji                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `release.zip`         | API, migracje i PWA; wgrywany do istniejącej aplikacji Node w `~/rodzina/`.                                                                              |
| Podpisane release APK | Lokalny frontend i kod Androida; budowane na komputerze, publikowane osobno i instalowane na telefonie. Dystrybucja i aktualizator powstaną w kroku 4.6. |
| `latest.json`         | Informacja o najnowszym APK; publikowana po wgraniu i sprawdzeniu tego APK, od kroku 4.6.                                                                |

1. Lokalnie wykonaj weryfikację i zbuduj ZIP według sekcji 2. Dla zmian wspólnego frontendu sprawdź także build Androida i właściwe scenariusze na telefonie. Sam `release:smoke` nie testuje APK.
2. Zachowaj poprzedni ZIP i wykonaj backup produkcyjnej bazy jobem z sekcji 5. Zachowaj istniejącą konfigurację `.env`, klucze VAPID, bazę i crony.
3. Wgraj i rozpakuj sprawdzony ZIP w istniejącym `~/rodzina/`, aktualizując `server.cjs`, `dist/`, `public/`, `drizzle/` i produkcyjny `package.json`. Nie zastępuj produkcyjnej bazy lokalną. Wykonaj **Run NPM Install** i restart przez `tmp/restart.txt`.
4. Sprawdź `/api/health`, logowanie, odczyt i zapis kalendarza w przeglądarce oraz w poprzedniej wspieranej wersji APK. Nowy backend musi nadal obsługiwać telefony, które nie zainstalowały aktualizacji.
5. Jeżeli wydanie wymaga nowego APK, opublikuj je dopiero po zgodnym API według sekcji 7. Nie uruchamiaj ponownie konfiguracji pierwszego wdrożenia ani rejestracji rodziny.

Powrót do poprzedniego ZIP wymaga zgodności ze schematem bazy po migracjach. Nie cofaj bazy automatycznie: odtworzenie backupu może usunąć dane zapisane od chwili jego wykonania. Wycofanie publikacji APK opisuje sekcja 7.5.

Krok 2.3 dodaje migrację `0011_chubby_gateway.sql` z tabelą przypomnień. Nie dodaje konfiguracji, zależności runtime ani cronów. Terminy przypomnień są zapisywane i przeliczane przy zapisie wydarzeń; wysyłka będzie realizowana w fazie 3.

### Kalendarz i przypomnienia — stan po kroku 2.7

Formularz wydarzenia zapisuje przypomnienia wspólne (uczestnicy, dorośli, cała rodzina lub twórca).
„Moje przypomnienia” w szczegółach zapisują „Tylko ja” przez `/api/reminders/mine`, również dla
dziecka oglądającego cudze wydarzenie. Zapis wydarzenia nie zmienia cudzych przypomnień osobistych.
Przypomnienia absolutne bez przyszłego terminu są oznaczone jako „nieaktualne” i można je usunąć.
W tej fazie aplikacja definiuje terminy; wysyłka push i jej cron powstaną w fazie 3.

Krok 2.7 nie dodaje zmiennych środowiskowych, cronów, migracji ani zależności runtime.
Paczka nadal korzysta z dotychczasowych migracji i sposobu uruchamiania; nie wymaga nowego
procesu w tle, WebSocketów, Dockera ani Redisa. Na prośbę właściciela podczas realizacji tego
kroku nie uruchomiono testów ani `release:smoke`; pełne zamknięcie kryteriów fazy 2 wymaga
jeszcze weryfikacji opisanej w `DEVELOPMENT.md`.

## 7. Android — konfiguracja, publikacja APK i aktualizacje

### 7.1 Stan obecny i konfiguracja od kroku 4.1

Stan na 16.10.2026 według kodu repozytorium: dostępne są `android:sync` i
`android:debug`, aplikacja ma identyfikator `pl.preficze.rodzina`, a Gradle ustawia
`versionCode 1` i `versionName "1.0"`. Nie skonfigurowano podpisywania release.
Przycisk pobierania, metadane wydania i aktualizator na telefonie są zakresem
kroku 4.6 w `PLAN.md`; poniższe sekcje 7.3–7.5 opisują docelową procedurę,
którą trzeba uzupełnić i potwierdzić przy implementacji. Nie oznaczają gotowości
obecnego debug APK do dystrybucji produkcyjnej.

API nie wymaga nowych zmiennych środowiskowych, migracji, CORS ani nowych cronów.
Przeglądarka nadal używa cookie HttpOnly/SameSite=Lax i dotychczasowej kontroli
Origin. APK korzysta z natywnego klienta i tego samego kontraktu sesji oraz API.
Nie dodawaj originu `https://localhost` jako wyjątku od ochrony CSRF.

Na komputerze budującym APK `RODZINA_ANDROID_API_ORIGIN` wybiera
`https://rodzina.preficze.pl` (domyślnie) albo `http://localhost:3000` (tylko debug,
przez `adb reverse`). Konfigurację opisuje główny `.env.android.example`.
Zmienna jest odczytywana podczas Capacitor sync; jej zmiana wymaga ponownej
kompilacji APK. Żadne VAPID, plik API `.env`, baza ani sekrety serwera nie są
kopiowane do aplikacji. JDK/SDK/Gradle i OkHttp dotyczą wyłącznie lokalnego Androida;
nie wymagają nowych zależności runtime ani kompilacji na vh.pl.

`release.zip` nadal zawiera serwer i PWA z `apps/web/dist`, bez projektu Androida,
SDK, zaszyfrowanych sesji czy APK. `release:smoke` sprawdza wyłącznie paczkę serwera.
Wgranie ZIP nie aktualizuje frontendu zainstalowanego APK. Build debug służy do
lokalnego sprawdzenia kroku 4.1; podpisywanie i dystrybucja release APK należą do
kroku 4.6. Instrukcja narzędzi i testów: `docs/DEVELOPMENT.md`, sekcja Android.
Istniejący kontrakt cookie sesji i endpointów kalendarza pozostaje zgodny z PWA.

### 7.2 Obecne budowanie lokalne

Na komputerze wymagane są Node 22 lub 24, JDK 21 i Android SDK 36; szczegóły
narzędzi oraz testów lokalnych opisuje `DEVELOPMENT.md`. W PowerShell, po ustawieniu
`JAVA_HOME` i `ANDROID_HOME`, można jawnie wskazać produkcyjny adres API:

```powershell
$env:RODZINA_ANDROID_API_ORIGIN = 'https://rodzina.preficze.pl'
npm run android:debug
```

Polecenie buduje shared i frontend w `apps/web/dist-android`, synchronizuje
Capacitor i uruchamia `assembleDebug`. Wynik to
`android/app/build/outputs/apk/debug/app-debug.apk`. Służy do testów; nie publikuj go
jako docelowego wydania dla rodziny. Nie dodajemy polecenia `android:release`
do instrukcji jako działającego — obecnie taki skrypt nie istnieje.

### 7.3 Podpisane wydanie i miejsce na pliki — do wdrożenia w kroku 4.6

Przy implementacji kroku 4.6 dodaj sprawdzoną instrukcję budowania i podpisywania
release APK oraz konkretne polecenia i nazwy zmiennych. Zachowaj identyfikator
`pl.preficze.rodzina`, podpisuj wszystkie wydania tym samym kluczem i zwiększaj
`versionCode` przy każdym nowym APK. `versionName` to numer pokazywany użytkownikowi;
nie porównujemy go tekstowo przy wykrywaniu aktualizacji. Przed buildem sprawdź,
że APK korzysta z `https://rodzina.preficze.pl`, zawiera lokalny frontend i nie ma
konfiguracji lokalnego API.

Keystore, jego hasła i bezpieczna kopia klucza pozostają poza repo, paczką ZIP
i katalogiem publicznym serwera. Zapisz bezpiecznie odcisk certyfikatu wydania.
Debug i release używają różnych kluczy: debug APK nie jest podstawą testu
aktualizacji produkcyjnej. Testuj przejście między dwoma wydaniami podpisanymi
kluczem release bez odinstalowywania aplikacji i czyszczenia jej danych.

Docelowo pliki wydań przechowuj w osobnym trwałym katalogu, np.
`/home/<user>/rodzina-downloads/android/`, poza `~/rodzina/public/` i poza prywatnym
`rodzina-data`. W kroku 4.6 zaimplementuj i opisz serwowanie wyłącznie tego katalogu
pod `/downloads/android/` na tej samej domenie. Jeżeli potrzebna będzie zmienna
konfiguracji API, dodaj jej ostateczną nazwę i przykład do `apps/api/.env.example`
oraz tej instrukcji. Obecny serwer nie ma takiego mapowania; samo utworzenie
katalogu poza `public/` nie udostępni plików.

Wymagania dla serwowania w kroku 4.6:

- APK i metadane są dostępne przez HTTPS bez sesji, także z ekranu logowania.
- APK ma typ `application/vnd.android.package-archive`, a JSON `application/json`.
- `latest.json` ma `Cache-Control: no-store`; service worker nie zapisuje metadanych ani APK w precache lub cache runtime.
- APK ma niezmienny adres z numerem wersji, np. `/downloads/android/rodzina-1.1.0-2.apk`; opublikowanego pliku nie zastępuj inną zawartością.
- Brak pliku w `/downloads/android/` zwraca 404, a nie HTML aplikacji z fallbacku SPA. Brak wydania wyświetla na stronie informację o niedostępności pobierania.
- Aktualizacja i sprzątanie plików serwera z `release.zip` zachowują katalog wydań. Nie dodajemy crona, SDK/JDK ani kompilacji APK na vh.pl.

### 7.4 Publikowanie i aktualizacja na telefonie — do wdrożenia w kroku 4.6

1. Zbuduj podpisane release APK i przetestuj je lokalnie na fizycznym telefonie. Zapisz `versionCode`, `versionName`, nazwę pliku i sumę SHA-256. W PowerShell sumę policz przez `Get-FileHash -LiteralPath '<ścieżka do podpisanego APK>' -Algorithm SHA256`.
2. Wgraj APK do trwałego katalogu pod nową nazwą zawierającą wersję, początkowo jako plik tymczasowy. Po zakończeniu transferu nadaj docelową nazwę i sprawdź pobieranie przez HTTPS oraz zgodność sumy pobranego pliku. Dotychczasowe wydanie pozostaje dostępne.
3. Przygotuj `latest.json` zgodny z rzeczywistym APK. Poniższy przykład przedstawia format; przed publikacją zastąp znacznik `sha256` pełną sumą 64 znaków szesnastkowych:

   ```json
   {
     "versionCode": 2,
     "versionName": "1.1.0",
     "apkUrl": "https://rodzina.preficze.pl/downloads/android/rodzina-1.1.0-2.apk",
     "sha256": "<suma SHA-256 podpisanego APK>"
   }
   ```

4. Wgraj metadane jako plik tymczasowy w tym samym katalogu, a po sprawdzeniu zastąp nimi `latest.json` przez zmianę nazwy. Metadane publikuj jako ostatnie, żeby klienci nie otrzymali linku do niekompletnego APK. Sprawdź publiczny adres `/downloads/android/latest.json`, typ odpowiedzi i nagłówki cache.
5. W przeglądarce sprawdź „Pobierz aplikację na Androida” na logowaniu i w „Więcej”, numer wydania oraz pierwszą instalację pobranego APK. Nie utożsamiaj tego przycisku z instalacją PWA.
6. Na telefonie ze starszym podpisanym wydaniem sprawdź automatyczne wykrycie aktualizacji po uruchomieniu/wznowieniu lub powrocie sieci oraz ręczne „Więcej > Wersja aplikacji > Sprawdź aktualizacje”. Propozycja aktualizacji pojawia się wyłącznie dla wyższego `versionCode`.
7. Po „Aktualizuj” aplikacja pobiera plik, pokazuje postęp, weryfikuje SHA-256 i otwiera instalator Androida. W razie potrzeby użytkownik zezwala na instalację z tego źródła, a następnie zatwierdza aktualizację w systemie. Nie jest to cicha instalacja ani aktualizacja przy zamkniętym APK.
8. Po aktualizacji sprawdź nowy numer wersji, zachowanie sesji i harmonogramu oraz odebranie wcześniej zapisanego alarmu offline bez duplikatów. Sprawdź też anulowanie instalacji, odmowę zgody, brak miejsca, przerwanie transferu, niezgodną sumę i brak sieci; błędy aktualizatora nie mogą blokować używania aplikacji ani lokalnych alarmów.

Przy każdym wydaniu zachowaj lokalny rejestr wersji, podpisane APK, jego sumę
i metadane. Wyniki testów telefonu zapisuj w `DEVELOPMENT.md`, oddzielając
wykonane scenariusze od niepotwierdzonych. W kroku 4.6 `release:smoke` ma również
sprawdzać poprawne działanie strony bez opublikowanego APK; obecnie nie sprawdza
publikacji ani instalatora Androida.

### 7.5 Wycofanie publikacji APK — do wdrożenia w kroku 4.6

Jeżeli nowe APK jest wadliwe, przywróć poprzednie sprawdzone `latest.json`, aby
wstrzymać proponowanie wadliwej wersji. Zachowaj wcześniej opublikowane pliki,
ponieważ część telefonów może być w trakcie pobierania. Przywrócenie metadanych
nie obniża wersji już zainstalowanej na telefonie. Dla takich telefonów przygotuj
poprawione APK z jeszcze wyższym `versionCode`, podpisane tym samym kluczem;
nie wymagaj odinstalowania aplikacji ani usunięcia jej danych.

### Synchronizacja harmonogramu — krok 4.4

Zmiana wymaga nowego APK z pluginami Capacitor App 8.1.2 i Network 8.0.1
(`npm run android:sync`, następnie build Androida). Zwykła aktualizacja paczki
API/PWA nie aktualizuje lokalnych plików ani pluginów zainstalowanego APK.
Brak nowych zmiennych środowiskowych, migracji i cronów; API harmonogramu
pozostaje zgodne z krokiem 4.2. Zależności App/Network dotyczą Androida,
nie wymagają kompilacji nowych zależności runtime na vh.pl.

APK pobiera zmiany po wznowieniu, odzyskaniu sieci i co 20 s w aktywnym
interfejsie. Zamknięte APK nie pobiera zmian z serwera. Ekran powiadomień
pokazuje ostatnią udaną synchronizację oraz zakres zabezpieczenia offline;
zmiany na innym urządzeniu mogą pozostawić stary alarm do kolejnej synchronizacji.
PWA zachowuje dotychczasowy Web Push. Procedura i niepotwierdzone testy telefonu
są w `DEVELOPMENT.md`, w sekcji kroku 4.4.

## Android App Links — krok 4.5

Nowa opcjonalna zmienna serwera: `RODZINA_ANDROID_SHA256_CERT_FINGERPRINTS`.
Wpisz publiczny odcisk SHA-256 certyfikatu podpisującego zainstalowane APK,
w formacie 32 par hex oddzielonych dwukropkami. Kilka odcisków rozdziel przecinkiem.
Nie wpisuj hasła ani zawartości keystore. Wartość pusta zwraca `[]` i pozostawia
otwieranie linków w przeglądarce jako ścieżkę awaryjną; nie oznacza weryfikacji APK.

Odcisk ustalisz przez `keytool -list -v -keystore <ścieżka-do-keystore>`
(hasło podaj interaktywnie). Dla testowego debug APK użyj lokalnego debug.keystore;
nie traktuj jego certyfikatu jako certyfikatu późniejszego wydania release z kroku 4.6.
Nie generujemy nowego klucza produkcyjnego w kroku 4.5.

Po lokalnych testach aktualizuj sprawdzoną paczkę według istniejącej procedury,
ustaw zmienną w `.env` serwera i zrestartuj aplikację. Endpoint
`https://rodzina.preficze.pl/.well-known/assetlinks.json` musi zwracać HTTP 200,
`Content-Type: application/json`, bez logowania i bez przekierowania. Odpowiedź
wskazuje `pl.preficze.rodzina`, relację `delegate_permission/common.handle_all_urls`
oraz skonfigurowane odciski. Cache ma 5 minut. Sprawdź, czy konfiguracja hostingu
nie przechwytuje `/.well-known/` przed Passengerem. Test instalacji musi potwierdzić
faktyczną weryfikację domeny przez Androida; samo HTTP 200 jej nie dowodzi.

Powiązanie obejmuje `/zaproszenie/` i `/reset-hasla/`. Bez APK pozostają dotychczasowe
trasy SPA w przeglądarce. Do obsługi nowych intentów, Wstecz, insets i adaptera
linków wymagane jest nowe APK (`npm run android:debug` do testów); ZIP serwera
nie aktualizuje APK. Nie dodano migracji, cronów ani zależności runtime serwera.
`release:smoke` sprawdza również publiczną odpowiedź JSON assetlinks.

Na 17.10.2026 w ramach kroku 4.5 nie aktualizowano produkcji ani odcisków certyfikatów
na domenie. Testy App Links na telefonie pozostają do wykonania według DEVELOPMENT.md.
