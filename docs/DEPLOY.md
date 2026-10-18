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

# Krok 4.6 — osobne wydania API/PWA oraz Androida

ZIP serwera aktualizuje API i PWA. Nie zmienia lokalnych plików frontendu w już
zainstalowanym APK. APK stanowi odrębny plik wydania. Poniżej opisano procedurę
lokalną; workflow Deploy z kroku 4.7 buduje i publikuje APK automatycznie przy każdej
aktualizacji serwera.
Nie usuwaj produkcyjnej bazy ani sesji przy żadnym z tych wydań. Dotychczasowy
kontrakt sesji i `/api/reminders/schedule` pozostaje zgodny ze starszym APK;
przed kolejną zmianą API wykonaj regresję poprzedniej wspieranej wersji APK.

## Klucz podpisujący — pierwsze przygotowanie

Klucz potwierdza tożsamość wydawcy. Android instaluje aktualizację tej samej
aplikacji wyłącznie przy zgodnym podpisie. Utrata klucza uniemożliwi aktualizowanie
istniejącej instalacji. Nie używaj klucza debug do zwykłych wydań.

Utwórz prywatny katalog poza repo, np. `C:\Users\<user>\rodzina-signing`. W terminalu
z JDK 21 uruchom (zastąp ścieżkę własną):

```powershell
keytool -genkeypair -v -keystore C:\Users\<user>\rodzina-signing\rodzina-release.jks -storetype JKS -alias rodzina -keyalg RSA -keysize 3072 -validity 10000
```

Hasła podaj interaktywnie, bez wklejania ich do czatu, polecenia ani repo. Zachowaj
keystore, alias i hasła w bezpiecznym miejscu oraz drugą zaszyfrowaną kopię na
niezależnym nośniku. Sprawdź odtworzenie kopii przez `keytool -list -v -keystore
<kopia.jks>`. Nie kopiuj klucza na hosting ani do GitHub Actions. Odcisk certyfikatu
SHA-256 jest publiczny: wpisz go w `RODZINA_ANDROID_SHA256_CERT_FINGERPRINTS`
zgodnie z procedurą App Links z kroku 4.5.

Podpisane APK można zbudować na dwa sposoby:

Najprostsza metoda przy domyślnej ścieżce `~/rodzina-signing/rodzina-release.jks`
i aliasie `rodzina`: uruchom `npm run android:release:interactive` bez przekierowania
wyjścia, bezpośrednio w terminalu. JDK zapyta o hasło magazynu i klucza, tak jak
`keytool`; Enter przy drugim pytaniu użyje pierwszego hasła. Hasła nie są zapisywane
w historii ani pliku. Sprawdzamy otwarcie keystore i odzyskanie klucza przed buildem.
To pozwala odróżnić błędne hasło magazynu, brak aliasu i błędne hasło klucza.
Dla innej lokalizacji/aliasu ustaw `RODZINA_ANDROID_KEYSTORE` i
`RODZINA_ANDROID_KEY_ALIAS`; pozostałe zmienne haseł nie są potrzebne w tej metodzie.

Alternatywnie, dla środowiska bez interaktywnego terminala:

```powershell
$env:RODZINA_ANDROID_KEYSTORE = 'C:\Users\<user>\rodzina-signing\rodzina-release.jks'
$env:RODZINA_ANDROID_KEY_ALIAS = 'rodzina'
$env:RODZINA_ANDROID_STORE_PASSWORD = [System.Net.NetworkCredential]::new('', (Read-Host 'Hasło keystore' -AsSecureString)).Password
$env:RODZINA_ANDROID_KEY_PASSWORD = [System.Net.NetworkCredential]::new('', (Read-Host 'Hasło klucza' -AsSecureString)).Password
npm run android:release
Remove-Item Env:RODZINA_ANDROID_STORE_PASSWORD, Env:RODZINA_ANDROID_KEY_PASSWORD
```

Takie zmienne nie są szyfrowanym magazynem; ogranicz je do bieżącej sesji i usuń
po budowie. Nie włączaj logowania środowiska ani diagnostyki Gradle `--debug`.
Na Linux/macOS ustaw analogiczne zmienne środowiskowe bez zapisywania haseł
w historii. `JAVA_HOME`: JDK 21, `ANDROID_HOME`: SDK 36. Skrypt lokalnie wykrywa
także narzędzia w `.android-tools`, jeśli zmienne nie zostały ustawione.

`npm run android:check-signing` sprawdza wyłącznie poświadczenia ze zmiennych,
bez budowania frontendu i APK. Release zawsze wykonuje tę kontrolę, następnie
uruchamia Gradle z `--no-daemon --no-configuration-cache`, aby nie współdzielić
procesu podpisującego między próbami. Sukces `keytool -list` z hasłem wpisanym
interaktywnie nie potwierdza jeszcze wartości przekazanej przez PowerShell
w zmiennej środowiskowej ani hasła samego klucza. Nie zmieniaj formatu ani nie
generuj ponownie klucza tylko na podstawie ogólnego błędu podpisywania Gradle.

## Budowanie i publikacja

1. Zwiększ `versionCode` w `android/version.properties` (maks. 2100000000), zmień
   `versionName`, np. `1.0.1`. Zachowaj `pl.preficze.rodzina` i ten sam klucz.
   Pierwsze wydanie ma kod 1; poprzednie debug APK wymaga osobnego usunięcia przed
   instalacją release, jeśli podpisy są różne. Przetestuj to na koncie testowym.
2. Przeprowadź lint, format:check, typecheck, testy, build, testy Playwright headless,
   `release:smoke`, a następnie `npm run android:release`. Release odrzuca API HTTP
   i klucz w repo. Skrypt sprawdza podpis przez apksigner i identyfikator/wersję
   przez aapt; odrzuca debug APK. Wynik w `android-releases/<kod>-<wersja>/`:
   `rodzina-<kod>-<wersja>.apk`, `latest.json`, publiczny odcisk certyfikatu.
   Istniejący katalog wydania nie jest nadpisywany. `android:package` pozwala
   przygotować metadane już zbudowanego APK bez ponownej kompilacji.
3. Zainstaluj podpisane APK na fizycznym telefonie i wykonaj checklistę w
   DEVELOPMENT.md, w tym aktualizację z wcześniejszego podpisanego wydania.
4. Utwórz trwały katalog poza `~/rodzina`, `public/` i katalogiem danych rodziny,
   np. `/home/<user>/rodzina-android`. Tylko APK i latest.json; żadnych keystore,
   haseł, baz, `.env`, logów ani backupów. Ustaw w `.env` API:
   `RODZINA_ANDROID_DOWNLOAD_DIR=/home/<user>/rodzina-android`. Puste oznacza brak
   wydania. Katalog musi być czytelny dla aplikacji Node. Restartuj Passengera.
5. Wgraj APK pod tymczasową nazwą, porównaj SHA-256 z `latest.json`, a po pełnym
   transferze zmień nazwę na docelową. Nigdy nie zastępuj pliku już opublikowanej
   wersji. Dopiero potem wgraj `latest.json.tmp` i atomowo zmień na `latest.json`.
   Nie publikuj metadanych przed APK. Zachowaj wcześniejsze wersje na czas wsparcia;
   cofnięcie metadanych nie proponuje downgrade'u w APK.
6. Sprawdź HTTPS domeny: `/downloads/android/latest.json` publicznie zwraca JSON,
   `Cache-Control: no-store`; APK ma MIME `application/vnd.android.package-archive`,
   `Content-Disposition: attachment`, `nosniff` i cache immutable na rok. Ścieżka
   APK zawiera wersję. Metadata dopuszcza tylko HTTPS tej samej domeny i katalogu
   `/downloads/android/`; service worker nie przechowuje tych zasobów. Konfiguracja
   hostingu/CDN nie może zastępować 404 APK plikiem SPA ani cache'ować latest.json.

Aktualizując serwer dotychczasową paczką ZIP zachowaj katalog wydań. Nie dodano
crona ani stałego procesu. Automatyzacja deployu GitHub Actions należy do kroku 4.7.
CI w tym kroku sprawdza debug Androida, testy JVM i Android Lint, bez klucza release.

## Instalacja i aktualizacja na telefonie

Na stronie logowania lub w „Więcej” wybierz „Pobierz aplikację na Androida”, otwórz
APK z pobranych plików, zezwól przeglądarce na instalowanie z tego źródła i zatwierdź
instalację. To odrębne od instalowania PWA; przy wyborze APK wyłącz powiadomienia
osobno zainstalowanej PWA na tym telefonie, by uniknąć podwójnych przypomnień.

APK sprawdza wersję przy uruchomieniu/wznowieniu/powrocie sieci, maks. raz na 15 min.
Ręcznie: „Więcej > Wersja aplikacji > Sprawdź aktualizacje”. „Aktualizuj” pobiera
plik i weryfikuje SHA-256, potem otwiera instalator Androida. Jeśli wymagana jest
zgoda dla Rodziny, użyj „Zezwól na instalację”, wróć i wybierz „Ponów instalację”.
Użytkownik zatwierdza instalację systemowo. Odmowa lub anulowanie nie kasuje sesji
ani alarmów; można ponowić. Brak sieci, miejsca, uszkodzony plik i błąd serwera
nie blokują normalnej pracy. Po przerwaniu procesu pobierz plik ponownie.

Aktualizacja zachowuje dane pakietu. Receiver `MY_PACKAGE_REPLACED` odtwarza alarmy,
a uruchomiona aplikacja uzgadnia harmonogram. Nie odinstalowuj APK przy zwykłej
aktualizacji. Nie ma cichej instalacji ani automatycznej aktualizacji zamkniętego APK.
SHA-256 chroni integralność pliku, zaufanie do metadanych zapewnia HTTPS; to nie
zastępuje weryfikacji podpisu przez Androida. Źródła:
[podpisywanie](https://developer.android.com/studio/publish/app-signing),
[FileProvider](https://developer.android.com/reference/androidx/core/content/FileProvider).

## Krok 4.7 — ręczna aktualizacja przez GitHub Actions

Workflow **Deploy** aktualizuje istniejącą instalację API/PWA oraz przy każdym
uruchomieniu buduje, podpisuje i publikuje nową wersję APK. Nie trzeba ręcznie
wgrywać pierwszego ani następnych APK. Uruchamia się tylko
przez **Actions → Deploy → Run workflow**, z wyborem `main`. Push i pull request
uruchamiają CI, bez zmiany serwera. Inna gałąź kończy Deploy błędem przed checkoutem.
Wdrażany jest dokładny `github.sha` wybranego uruchomienia; podsumowanie zawiera
commit, SHA-256 ZIP-a, wynik i etap. Równoległe uruchomienia czekają w grupie
`rodzina-production`; nie anulujemy trwającej podmiany. Dodatkowa blokada na serwerze
chroni także przed równoczesnym uruchomieniem skryptu z komputera.

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

### Jednorazowe włączenie podpisywania Androida

W tym samym repozytorium dodaj trzy **Secrets**:

| Sekret                    | Wartość                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| `ANDROID_KEYSTORE_BASE64` | Zawartość **istniejącego** pliku keystore zakodowana jako Base64 |
| `ANDROID_STORE_PASSWORD`  | Hasło tego magazynu                                              |
| `ANDROID_KEY_PASSWORD`    | Hasło klucza prywatnego (może być takie samo jak hasło magazynu) |

Dodaj dwie **Variables**:

| Zmienna                      | Wartość                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| `ANDROID_KEY_ALIAS`          | Alias istniejącego klucza, np. `rodzina`                                              |
| `ANDROID_CERTIFICATE_SHA256` | Publiczny odcisk SHA-256 certyfikatu tego klucza, 64 cyfry hex, z dwukropkami lub bez |

Użyj tego samego klucza co do już zainstalowanego release APK. Nie generuj nowego
klucza. Odcisk znajdziesz w `certificate-sha256.txt` przygotowanego lokalnie wydania
lub w `keytool -list -v -keystore <plik> -alias <alias>`. Nie wklejaj haseł ani
Base64 do czatu, commita lub logu. Dla domyślnej lokalizacji istniejącego klucza
możesz ustawić sekret przez PowerShell i GitHub CLI bez wypisywania jego zawartości:

```powershell
$apkKeyPath = Join-Path $env:USERPROFILE 'rodzina-signing/rodzina-release.jks'
[Convert]::ToBase64String([IO.File]::ReadAllBytes($apkKeyPath)) | gh secret set ANDROID_KEYSTORE_BASE64 --repo WojciechPreficz/rodzina
gh secret set ANDROID_STORE_PASSWORD --repo WojciechPreficz/rodzina
gh secret set ANDROID_KEY_PASSWORD --repo WojciechPreficz/rodzina
```

Dwa ostatnie polecenia pytają o wartość interaktywnie. Alias i publiczny odcisk
ustaw w panelu GitHuba. Zachowaj niezależną kopię klucza i haseł według 4.6.
Brak sekretów, niewłaściwe hasło lub niezgodny odcisk zatrzymuje workflow przed SSH
i zmianami serwera. Klucz jest dekodowany poza checkoutem do prywatnego katalogu
tymczasowego runnera i usuwany w `finally`, także po błędzie. Nie trafia na hosting
ani do artefaktów. Hasła istnieją tylko w środowisku kroku budowania; Gradle działa
bez współdzielonego daemona i configuration cache. Zwykłe CI nadal nie używa sekretów.

Runner odczytuje dostępne wydanie i weryfikuje jego APK. Nowy `versionCode` wynosi
`max(kod z repo + 1, opublikowany kod + 1)`, więc rośnie także przy kolejnym deployu
tego samego commita. Nazwa ma postać `1.0.0-deploy.2`, zgodnie z bazową wersją
z `android/version.properties`. Zmiana numeru dotyczy tylko budowania na runnerze;
skrypt odtwarza plik repozytorium i nie tworzy commitów z numerami wersji.

Po pierwszym deployu katalog APK jest tworzony automatycznie obok katalogu aplikacji,
np. `/home/USER/rodzina-android` dla `DEPLOY_PATH=/home/USER/rodzina`. Po backupie
i podmianie kodu skrypt atomowo dodaje do istniejącego `DEPLOY_ENV_FILE` wyłącznie
`RODZINA_ANDROID_DOWNLOAD_DIR`, jeśli wpisu nie było lub był pusty. Pozostałe
ustawienia pozostają zachowane. Jeśli katalog był już skonfigurowany, używamy go
bez zmiany ścieżki. Musi leżeć poza aplikacją, bazą, backupami i zależnościami,
bez dowiązań. Konto SSH musi móc zapisać katalog nadrzędny aplikacji i `.env`.
Nie ustawiaj innej wartości tej zmiennej w panelu cPanel — konflikt jest błędem
preflightu. Nowe crony, migracje i zależności runtime nie są potrzebne.

Preflight nie zapisuje osobnego logu na serwerze. Błąd przed uruchomieniem backupu
i restartem nie musi pojawić się w logach Passengera ani cronów. W Actions skrypt
raportuje ostatnią rozpoczętą kontrolę: `node-startup` oznacza próbę uruchomienia
Node przez powłokę SSH, `remote-entry` wejście do skryptu, a `preflight-*` konkretny
warunek (np. `preflight-package`, `preflight-env-file`, `preflight-database-path`,
`preflight-backup-path`, `preflight-npm`). `lock` i `staging` dotyczą przygotowania
transakcji po udanej kontroli. Nazwa wskazuje kontrolę, która nie zakończyła się
pomyślnie; nie ujawnia wartości konfiguracji. Dla rozpoznanych błędów SSH pojawia
się też stały opis problemu z kluczem, weryfikacją hosta, DNS lub połączeniem.
Surowe stdout/stderr błędów nie są kopiowane do logu. Nie włączaj `ssh -v` ani
wypisywania `.env`; sprawdź wskazany warunek w prywatnej sesji administratora.

Diagnostyka podmiany również trafia bezpośrednio do GitHub Actions, bez pliku logu
na hostingu. `promotion-check-*` oznacza ponowne sprawdzenie drzew i ścieżki restartu,
`promotion-copy-dependencies` kopiowanie `node_modules`, a `promotion-copy-server`,
`promotion-copy-package`, `promotion-copy-dist`, `promotion-copy-public` i
`promotion-copy-drizzle` wskazują kopiowany element aplikacji. Etapy
`promotion-restart-directory` i `promotion-restart-marker` dotyczą przygotowania
restartu; `restart` oznacza zapis znacznika. Błąd może zawierać bezpieczny kod z
zamkniętej listy, np. `EACCES`/`EPERM` (uprawnienia), `ENOENT` (brak ścieżki),
`ENOSPC`/`EDQUOT` (miejsce/limit) albo `ERR_FS_CP_DIR_TO_NON_DIR` (konflikt typów).
`UNKNOWN` oznacza błąd bez rozpoznanego kodu. Pełne komunikaty, ścieżki plików
i wartości konfiguracji pozostają ukryte. Działająca strona nie potwierdza pełnego
wdrożenia ani braku częściowej podmiany; wymagane są wszystkie kontrole workflow.

Konfiguracja serwera pozostaje dotychczasowa: `NODE_ENV=production`,
`RODZINA_PUBLIC_URL=https://rodzina.preficze.pl`, `RODZINA_WEB_DIR=./public`
(lub bezwzględne `DEPLOY_PATH/public`). Baza i katalog backupu muszą już istnieć,
mieć bezwzględne ścieżki i leżeć poza zarządzanymi plikami aplikacji. Jeśli wcześniej
włączono pobieranie Androida, jego katalog musi istnieć i być poza całym katalogiem
aplikacji, zgodnie z 4.6. Pierwszy katalog tworzy workflow. Zarządzane drzewa `dist`, `public`, `drizzle` nie mogą zawierać
prywatnych plików, APK ani dowiązań. Dowiązanie cPanel `node_modules` jest zachowane.
Poza pierwszym ustawieniem istniejącej zmiennej `RODZINA_ANDROID_DOWNLOAD_DIR`
nie zmieniamy `.env` API, migracji, cronów ani zależności runtime.

### Przebieg aktualizacji

1. Na Linux/Node 24: `npm ci`, lint, format:check, typecheck, testy, build,
   Playwright headless i `release:smoke`. Błąd kończy workflow przed SSH.
   Smoke tworzy i testuje `release.zip`; deploy nie buduje go ponownie.
   Następnie JDK 21/SDK 36 buduje podpisane APK z automatycznym numerem wersji.
   Sprawdzamy tożsamość, podpis i odcisk, wykonujemy testy JVM i Android Lint.
   Frontend Androida trafia do `dist-android`, więc sprawdzony ZIP PWA się nie zmienia.
2. Skrypt sprawdza zawartość ZIP-a, commit checkoutu i SHA-256. Przed zmianami
   pobiera aktualne metadane Androida oraz sprawdza SHA-256 opublikowanego APK,
   jeśli istnieje. Nieprawidłowe lub niedostępne wydanie przerywa deploy.
   Starsza wersja API bez obsługi pobierania Androida może zwracać HTTP 200 z HTML
   zamiast 404. Wyłącznie przed aktualizacją dopuszczamy taką odpowiedź, jeśli jest
   identyczna ze stroną główną i zawiera element aplikacji `root`. Preflight SSH
   musi dodatkowo potwierdzić brak `RODZINA_ANDROID_DOWNLOAD_DIR` w konfiguracji.
   Po aktualizacji wymagamy HTTP 404 przy braku wydania; HTML nadal jest błędem.
   Nie trzeba zmieniać konfiguracji vh.pl ani ręcznie wgrywać endpointu.
3. Preflight przez SSH sprawdza istniejącą instalację i konfigurację. Powstaje
   prywatny staging obok aplikacji oraz `.rodzina-deploy-lock` (dla katalogu
   aplikacji `rodzina`). ZIP trafia przez SCP do stagingu; serwer porównuje SHA-256
   i rozpakowuje paczkę. Błąd transferu nie zmienia plików aplikacji.
   Osobno przesyłamy APK do tego samego prywatnego stagingu; jego suma, rozmiar,
   wersja i zgodność certyfikatu z poprzednią publikacją są sprawdzane przed backupem.
4. Właściwy npm CLI używanej wersji Node instaluje zależności produkcyjne w katalogu
   tymczasowym z `--ignore-scripts` i jawnym `--prefix`, z pominięciem wrappera cPanel.
   Sprawdzamy, czy `node_modules` jest rzeczywistym katalogiem tej paczki, oraz czy
   SQLite, Argon2 i prebuild-install są rozwiązywane z niego, bez użycia produkcyjnych
   zależności. Etap `dependencies-check` powtarza kontrolę przed backupem i podmianą.
   Dla `better-sqlite3` uruchamiamy wyłącznie pobranie gotowego modułu przez
   `prebuild-install`, bez awaryjnego `node-gyp`. Sprawdzamy otwarcie bazy w pamięci
   oraz dostępność Argon2. Brak gotowej binarki przerywa wdrożenie przed podmianą.
   Hosting potrzebuje dostępu do npm i serwera gotowych binariów. Nie buduje API,
   frontendu ani nowych bibliotek runtime ze źródeł.
5. Z dotychczasowego katalogu aplikacji uruchamiany jest istniejący job:
   `DEPLOY_NODE --env-file=DEPLOY_ENV_FILE dist/jobs/backup-db.js`. Używa produkcyjnej
   konfiguracji i rotacji 14 kopii. Błąd backupu przerywa deploy przed podmianą.
   Nie nadpisujemy bazy paczką ani nie cofamy jej automatycznie.
6. W prywatnym katalogu obok aplikacji, np. `rodzina-deploy-history`, zachowujemy
   `<UUID>-previous.tar.gz` (poprzednie `server.cjs`, `package.json`, `dist`, `public`,
   `drizzle`), `<UUID>-release.zip` oraz `<UUID>.json` z commitem i sumą. Historia
   nie zawiera `.env`, bazy ani kluczy. Nie jest dostępna przez HTTP; administrator
   okresowo usuwa starsze paczki po ocenie okresu potrzebnego do odzyskiwania.
7. Kopiowane są przygotowane zależności do docelowego `node_modules`, następnie
   wyłącznie pięć zarządzanych ścieżek. Nie usuwamy szeroko zawartości aplikacji;
   stare assety pozostają dla otwartych kart PWA. Zachowane są `.env`, baza/WAL/SHM,
   logi, backupy, `.htaccess`, konfiguracja cPanel, crony i trwałe pliki Androida.
   Zapis `tmp/restart.txt` restartuje Passengera. Migracje wykonuje aplikacja.
   Przy pierwszej publikacji przed restartem tworzymy trwały katalog APK i atomowo
   ustawiamy jego ścieżkę w `.env`, zachowując pozostałą konfigurację i uprawnienia pliku.
8. Maksymalnie sześć prób (odstęp 5 s, limit żądania 20 s) sprawdza HTTPS:
   health JSON z `ok=true`, `dbOk=true`, HTML strony, 401 `/api/auth/me` bez sesji
   oraz niezmienione metadane i sumę APK. Błąd kończy workflow na czerwono.
   Staging i blokada są sprzątane także po błędzie; historia i backup pozostają.
9. Dopiero po udanych kontrolach serwera kopiujemy nowe APK pod tymczasową nazwą
   w katalogu pobierania i ponownie sprawdzamy SHA-256. Plik z niezmiennym adresem
   zawierającym wersję zostaje zatwierdzony przez rename. Odcisk certyfikatu jest
   zachowany w katalogu do kontroli następnych wydań. Na końcu atomowo podmieniamy
   `latest.json`, zachowując stare APK. Ponownie sprawdzamy przez HTTPS metadane
   i sumę pobranego nowego APK. Podsumowanie zawiera także numer i SHA-256 APK.
   Błąd po publikacji zgłasza nieudany deploy; nie cofa automatycznie API ani bazy.

Podmiana jest sekwencyjna, bez gwarancji zerowej przerwy. Wybieraj czas małego
ruchu. Nie przerywaj joba w trakcie kopiowania. Zwykły cron nadal używa istniejącego
`.env` i harmonogramu. Pierwsze ustawienie katalogu Androida opisano powyżej.
Publikacja nowego APK jest częścią każdego Deploy; aktualizacja na telefonie
nadal wymaga zgody instalatora Androida.

### Awaria i bezpieczne odzyskiwanie

- Etapy `android-checksum`, `android-configuration`, `android-apk` i
  `android-metadata` identyfikują kontrolę transferu, pierwszą konfigurację,
  kopiowanie APK i zatwierdzanie metadanych. Do czasu podmiany `latest.json`
  użytkownicy otrzymują poprzednie wydanie. Jeśli po awarii pozostało nowe APK
  bez metadanych, nie nadpisuj go inną zawartością. Ustaw większy bazowy kod
  w `android/version.properties` i uruchom Deploy ponownie. Stare linki pozostają
  niezmienne. Zmiana klucza podpisującego jest odrzucana.

- Etapy walidacji, transferu, rozpakowania, zależności, backupu i archiwizacji
  kończą się przed podmianą aplikacji. Popraw przyczynę i uruchom ponownie.
- Błąd w etapie `promotion`, `restart` albo kontroli HTTP może oznaczać częściową
  aktualizację. Sprawdź podsumowanie Actions i prywatne logi Passengera/cPanel,
  porównaj health oraz logi cronów. Nie uznawaj samego restartu za udany deploy.
- Ustal UUID ostatniego wdrożenia z historii. Zachowaj dodatkową kopię obecnej
  bazy istniejącym jobem przed odzyskiwaniem. Poprzednia paczka nie zawiera
  `node_modules`; zależności trzeba przygotować ponownie dla jej `package.json`
  w prywatnym katalogu tymczasowym, właściwym npm CLI tej samej wersji Node,
  z jawnym `--prefix` i pominięciem wrappera cPanel, bez kompilacji ze źródeł.
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

Stan 18.10.2026: właściciel potwierdził udane wdrożenie API/PWA, a odczyt
[run 39158518981](https://github.com/WojciechPreficz/rodzina/actions/runs/39158518981)
potwierdził wynik `success`. Ten run używał jeszcze wariantu bez publikacji APK.
Rozszerzenie o nowe APK przy każdym Deploy sprawdzono lokalnie: testy publikacji
i deployu, pełny zestaw Vitest, lint, formatowanie, typecheck, build i smoke paczki
serwera oraz rzeczywisty podpisany build z oddzielnym tymczasowym kluczem testowym.
Klucz testowy i przygotowane nim pliki wydania usunięto; klucz właściciela pozostał
niezmieniony. W repozytorium nie skonfigurowano jeszcze sekretów podpisywania.
Pierwsza publikacja przez nowy workflow wymaga ich ustawienia i ręcznego Deploy
z `main`; trzeba zanotować SHA/URL oraz potwierdzić backup, restart, HTTP, dane
rodziny i pobranie APK. Testu aktualizacji i alarmów na fizycznym telefonie
nie zastępuje build. Nie powtarzamy tworzenia aplikacji, rodziny ani pierwszego
wdrożenia. Pełna lista prób fazy 4 jest w `DEVELOPMENT.md`.
