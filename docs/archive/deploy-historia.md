# Wdrożenia — historia i procedury przejściowe

Przeniesiono 22.10.2026 z docs/DEPLOY.md. Zachowano treść i statusy z chwili zapisu;
przeniesienie nie potwierdza zakończenia faz, CI, prób telefonu ani wdrożenia.
Archiwum czytaj tylko w zakresie potrzebnym do zadania. Bieżące wymagania
i reguły pierwszeństwa określa [plan](../plan.md).

# Wdrożenie i aktualizacje na cPanel vh.pl

**Zadania offline, krok 7.6 (20.10.2026):** migracja
`0018_silent_revanche.sql` dodaje tabelę `task_operations` do trwałego
zapamiętywania odpowiedzi zapisów. Backup obejmuje tę tabelę; nie usuwaj wpisów
podczas zwykłego porządkowania, bo urządzenie może ponowić operację po długiej
przerwie. Usunięcie użytkownika lub listy usuwa jej wpisy przez FK.
Migracja nie zmienia istniejących zadań, wydarzeń, sesji ani przypomnień.
Najpierw aktualizujemy API/WWW, następnie osobno APK. Starsze APK nadal używają
dotychczasowych endpointów. Nowe opcjonalne parametry `operationId`, `actorId`
i `taskId` (przy dodawaniu) wymagają nowego API, aby zapewnić bezpieczne ponawianie.
Przed zwróceniem zapisanej odpowiedzi serwer ponownie kontroluje dostęp do listy.
Brak nowych zmiennych, cronów, zależności runtime i usług w tle.
Dane i kolejka są w localStorage profilu WWW/WebView APK; wylogowanie je usuwa.
Pierwsze pobranie wymaga internetu. APK zawiera frontend, natomiast ponowne
załadowanie zwykłej strony WWW może wymagać sieci. Nie przywracamy PWA.
Samo przygotowanie kroku nie wdraża aktualizacji ani nie publikuje APK.

**Listy zadań, krok 7.1 (20.10.2026):** migracja `0016_task_lists.sql`
dodaje `task_lists`, `task_list_members` i `tasks` wraz z indeksami, bez zmiany
istniejących danych. Wymagany jest standardowy backup przed aktualizacją;
migracja uruchamia się przy starcie API, a backup obejmuje nowe tabele.
Usuwanie domownika usuwa prywatne listy i przekazuje udostępnione listy
pozostałemu członkowi w jednej transakcji. Ten krok dodaje tylko API list;
nie wymaga aktualizacji APK i zachowuje zgodność ze starszym klientem.
Bez nowych zmiennych, zależności runtime, cronów i usług w tle.
Samo przygotowanie tej zmiany nie aktualizuje serwera.

**Podgląd offline, kroki 5.4–5.5 (20.10.2026):** cache rodziny i kalendarza
jest zapisany lokalnie, osobno od kolejki zakupów i harmonogramu alarmów.
Zmiana wymaga aktualizacji WWW oraz osobnego zbudowania i opublikowania APK,
według istniejącej procedury. Nie dodaje migracji, konfiguracji, cronów,
zależności runtime serwera ani zmian kontraktu API. Starsze APK pozostają zgodne.
Po aktualizacji klienta potrzebne jest pierwsze pobranie online; wylogowanie,
zmiana konta i potwierdzona utrata dostępu usuwają podgląd. Brak miejsca na
urządzeniu jest zgłaszany w UI. Kalendarz i Rodzina nie mają kolejki zapisów.
Wyniki i otwarte próby telefonu opisuje DEVELOPMENT. Sam commit nie wdraża wydania.

**Zakupy offline, krok 5.3 (20.10.2026):** wydanie dodaje migrację
`0015_shopping_operations.sql`. Tabela `shopping_operations` przechowuje odpowiedzi
zapisów według użytkownika i identyfikatora operacji; zapis danych i odpowiedzi
jest jedną transakcją. Backup obejmuje również tę tabelę. Nie usuwaj jej wpisów
przy zwykłym porządkowaniu bazy: telefon może ponowić operację po długiej przerwie.
Usunięcie użytkownika usuwa jego wpisy przez FK. Wymagany jest standardowy backup
przed aktualizacją; migracja nie zmienia dotychczasowych zakupów, sesji ani alarmów.

Najpierw zaktualizuj API/WWW, następnie osobno APK według dotychczasowej procedury.
Starsze APK korzystają z dotychczasowych endpointów bez parametrów operacji.
Nowy klient wysyła `operationId` oraz oczekiwane `actorId`; nie instaluj go przed
aktualizacją API, ponieważ stare API nie zapewnia trwałego ponawiania zapisów.
Nowe zależności TanStack są pakowane do frontendu i nie wymagają kompilacji ani
instalacji na hostingu. Brak nowych zmiennych środowiskowych, cronów i usług w tle.

Cache, kontekst użytkownika bez poświadczeń i dziennik zakupów są w localStorage
danego profilu WWW lub WebView APK; wylogowanie usuwa je. Dane nie mają limitu wieku,
który usuwałby niewysłane zakupy. Powrót sieci w aktywnej aplikacji wznawia kolejkę.
APK uruchamia lokalny frontend również offline; zwykła strona wymaga sieci do
pierwszego załadowania swoich plików. Nie przywracamy service workera ani PWA.
Wylogowanie WWW bez sieci zostawia wyłącznie znacznik oczekującego zakończenia
sesji serwerowej; przy następnym uruchomieniu jest ono wykonywane przed `/auth/me`.
Ten krok nie uruchamia deployu ani nie publikuje APK.

**API zakupów, krok 5.1 (19.10.2026):** aktualizacja zawiera migrację
`0014_shopping.sql`, która dodaje `shopping_lists`, `shopping_items`
i `shopping_history`. Migracja uruchamia się przy starcie API; nie zmienia
istniejących sesji, wydarzeń ani przypomnień. Obowiązuje dotychczasowa procedura
aktualizacji z backupem. Nie ma nowych zmiennych środowiskowych, zależności
runtime ani cronów; istniejący backup obejmuje również nowe tabele.
Ten krok udostępnia API, ekran zakupów powstaje w 5.2, a kolejka offline w 5.3.
Weryfikację lokalną opisuje DEVELOPMENT; ten krok nie aktualizował serwera
ani nie publikował APK.

**Stan po kroku 4.10, 19.10.2026:** strona WWW + APK, bez PWA/Web Push.
Aktualizację istniejącej aplikacji opisują sekcja 6, ręczny workflow Deploy
z kroku 4.7 i procedura wycofania PWA na końcu dokumentu. Sekcje 1, 3 i 4
zachowują instrukcję pierwszego uruchomienia; nie powtarzaj jej dla istniejącej rodziny.
Najpierw zatrzymaj stary cron Web Push i wykonaj backup sprzed migracji 0013.
Pozostaje dzienny backup; przejściowego `/sw.js` i blokady manifestu nie wycofujemy.
Wyniki lokalne są w DEVELOPMENT; prób telefonu i wdrożenia tego wydania nie potwierdzono.

**Pierwsze wdrożenie wykonano po fazie 3; aplikacja działa pod https://rodzina.preficze.pl (potwierdzenie właściciela z 16.10.2026).** W planie jest to zapis historyczny z krokami D.1-D.4, bez numeru fazy. Dalsza kolejność to: faza 4 Android, 5 zakupy, 6 obiady, 7 zadania i 8 dokumenty. Funkcje rozwijamy i testujemy lokalnie, a serwer aktualizujemy sprawdzoną paczką release. Nie powtarzamy pierwszego wdrożenia ani zakładania istniejącej rodziny.

Historyczny stan lokalnej weryfikacji z 16.10.2026, zapisany przed potwierdzeniem wdrożenia: `npm ci`, lint, typecheck, release (z buildem)
i `release:smoke` zakończyły się powodzeniem. `npm test`: 375 testów przeszło, 12 nie przeszło
w 6 plikach testów UI kalendarza i przypomnień. Przed kolejną aktualizacją trzeba wyjaśnić te błędy, jeśli nadal występują;
gotowy ZIP i poprawny smoke nie oznaczają zaliczenia pełnej weryfikacji. Później właściciel potwierdził działanie strony; testy push na Androidzie i obserwacja cronów wymagają osobnego potwierdzenia.

## 1. Domena i certyfikat

1. W cPanel utwórz subdomenę, np. `rodzina.<domena>`.
2. Włącz AutoSSL dla subdomeny i sprawdź w przeglądarce ważny certyfikat HTTPS.

## 4. Migracje, restart i weryfikacja

Migracje Drizzle są dołączone w `drizzle/` i wykonywane przy starcie API. Zrestartuj aplikację przez utworzenie/odświeżenie `~/rodzina/tmp/restart.txt`. Sprawdź:

```text
https://rodzina.<domena>/api/health
```

Oczekiwana odpowiedź zawiera `ok: true` oraz `dbOk: true`. Zweryfikuj także stronę główną. Przy pierwszym uruchomieniu załóż rodzinę, utwórz zaproszenie i otwórz je w drugim profilu przeglądarki. Obie osoby powinny być widoczne w Więcej > Rodzina. Sprawdź też dodanie dziecka, logowanie kodem rodziny i PIN-em oraz reset hasła przez wygenerowany link.

### Kalendarz i przypomnienia — zapis historyczny kroku 2.7

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

### Historyczny projekt publikacji z kroku 4.1 — zastąpiony implementacją 4.6-4.7

Poniższy zamknięty zapis zachowuje dawny projekt i stan z 16.10.2026.
Stwierdzenia o braku skryptu release, serwowania APK i utrzymywaniu PWA
nie dotyczą obecnego wydania.

<details>
<summary>Archiwalne sekcje 7.1–7.5</summary>

### 7.1 Stan obecny i konfiguracja od kroku 4.1

Stan na 16.10.2026 według kodu repozytorium: dostępne są `android:sync` i
`android:debug`, aplikacja ma identyfikator `pl.preficze.rodzina`, a Gradle ustawia
`versionCode 1` i `versionName "1.0"`. Nie skonfigurowano podpisywania release.
Przycisk pobierania, metadane wydania i aktualizator na telefonie są zakresem
kroku 4.6 w `plan.md`; poniższe sekcje 7.3–7.5 opisują docelową procedurę,
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

</details>

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

## Wycofanie PWA — procedura wydania 4.8-4.10 (19.10.2026)

Aktualny zakres to zwykła strona WWW i APK. Oznaczone zapisy historyczne
zachowują dawne wymagania PWA; nie są instrukcją wdrożenia obecnego wydania. Przypomnienia w nowym interfejsie
są dostępne tylko w APK; strona nadal pozwala tworzyć i edytować ich definicje.

- Paczka serwera zawiera przejściowy `/sw.js` bez obsługi push i fetch. Nadpisuje
  dotychczasowego workera i usuwa jego rejestrację, subskrypcję oraz wyłącznie
  precache Rodziny. Nie usuwaj tego pliku przy publikacji — jest potrzebny osobom
  powracającym po dłuższej przerwie. Nowy frontend go nie rejestruje.
- `/sw.js` ma `Cache-Control: no-store`. `/manifest.webmanifest` zwraca 410,
  również gdy stary manifest pozostał na dysku po nakładkowym wdrożeniu.
- Migracja przeglądarki zachowuje sesję, localStorage i dane innych cache.
  Użytkownik może ręcznie odinstalować starą ikonę PWA. Sprzątanie rejestracji
  następuje po wizycie online lub aktualizacji workera przez przeglądarkę.
- Stan przejściowy 4.8 wymagał VAPID i crona Web Push. Od 4.9 są usunięte;
  przed podmianą paczki obowiązuje poniższa procedura. Backup pozostaje.
- Weryfikacja wydania: zwykłe logowanie i kalendarz w przeglądarce, strona
  powiadomień z instrukcją APK, brak nowej rejestracji SW i manifestu, migracja
  wcześniejszej rejestracji oraz lokalne alarmy w APK. Build Androida nie zawiera
  przejściowego SW. Wdrożenie produkcyjne i test telefonu potwierdzamy osobno.

### Usunięcie serwerowego Web Push — krok 4.9

Ta procedura dotyczy aktualizacji istniejącej instalacji, także przy ręcznym
uruchomieniu workflow Deploy. Implementacja lokalna nie zmienia produkcji.

1. **Przed podmianą jakichkolwiek plików paczki** usuń lub wyłącz w cPanel wpis
   crona wywołujący `dist/jobs/send-reminders.js` (dotychczas co 5 minut).
   Zatrzymaj również lokalne `dev:cron`, jeżeli działa. Poczekaj, aż aktywne
   procesy wysyłki zakończą pracę; sama edycja crontab ich nie zatrzymuje.
   Pozostaw dzienny cron `backup-db.js` z sekcji 5.
2. Zachowaj poprzedni ZIP, konfigurację `.env` (w tym stare VAPID na potrzeby
   ewentualnego powrotu) i informacje o cronach. Wykonaj backup **przed migracją**,
   jeszcze jobem poprzedniej paczki:

   ```sh
   cd /home/<user>/rodzina
   /home/<user>/nodevenv/rodzina/24/bin/node --env-file=/home/<user>/rodzina-data/.env dist/jobs/backup-db.js
   ```

   Sprawdź sukces i integralność kopii. Zachowaj jej dodatkową kopię poza
   dzienną rotacją, np. `rodzina-before-4.9.db`, z dostępem tylko konta aplikacji.
   Kolejny backup tego samego dnia zastępuje plik dzienny, więc nie może to być
   jedyna kopia sprzed migracji. Przy wdrożeniu ręcznym zatrzymaj Passenger
   na czas podmiany; backup i kopię wykonaj po zakończeniu aktywnych zapisów.

3. Wgraj sprawdzony ZIP i zainstaluj jego zależności produkcyjne według sekcji 6
   lub uruchom ręcznie Deploy. Nie zastępuj danych, `.env`, pobrań APK ani logów.
   Przy **nakładkowym rozpakowaniu** usuń pozostałe stare pliki
   `dist/jobs/send-reminders.js` i `dist/jobs/send-reminders.js.map`. Nie usuwaj
   `backup-db.js`, całego katalogu jobów ani historycznych migracji.
   Workflow wymienia katalog `dist` ze stagingu, więc nie zachowuje tych resztek.
4. Po restarcie migracja `0013_drop_web_push.sql` usuwa wyłącznie
   `push_subscriptions`. Wydarzenia, sesje, definicje przypomnień i ich pola
   `next_fire_at` / `last_sent_at` zostają. Harmonogram APK jest odczytem
   niezależnym od tych historycznych pól wysyłki. Nie modyfikuj dziennika migracji.
   Serwer i backup nie wymagają VAPID; stare dodatkowe zmienne `.env` są ignorowane.
   Można je usunąć z czynnej konfiguracji po zachowaniu kopii do odzyskiwania.
5. Sprawdź health, dotychczasową sesję, kalendarz oraz odczyt
   `/api/reminders/schedule` w starszym wspieranym APK. Uwierzytelnione żądania
   do dawnych `/api/push/*` mają zwracać 404, bez klucza publicznego i wysyłki.
   Uruchom nowy `backup-db.js` bez VAPID i sprawdź log oraz plik kopii. Przejściowy
   `/sw.js`, 410 manifestu i istniejące alarmy Androida pozostają obsługiwane.

**Powrót do poprzedniej wersji:** stare API Web Push wymaga usuniętej tabeli,
więc samo przywrócenie ZIP po migracji 0013 nie wystarcza. Nie cofaj automatycznie
bazy ani nie usuwaj wpisów migracji. Zatrzymaj Passenger, cron backupu i wszystkie
procesy korzystające z bazy; zachowaj osobną kopię aktualnej bazy wraz z jej stanem
WAL oraz `.env`. Oceń utratę zmian od kopii sprzed aktualizacji przed odtworzeniem.
Przywróć poprzedni ZIP i zgodną kopię bazy sprzed 0013 według sekcji 5
(bez starych plików `-wal` / `-shm` przy odtwarzanej bazie), przywróć wymagane
stare VAPID i zależności, następnie uruchom API i sprawdź health oraz dane.
Wznów backup. Cron Web Push można przywrócić wyłącznie po świadomym powrocie do
poprzedniego wydania i sprawdzeniu jego konfiguracji. Usuniętych subskrypcji nie
odtworzy nowa paczka; stara PWA, która już wyrejestrowała workera, sama nie wróci
do powiadomień. Nie obiecujemy odzyskania Web Push przez samo cofnięcie serwera.

### Kontrola po wdrożeniu kroku 4.10

Aktualizację serwera i publikację APK wykonuje właściciel na osobne polecenie.
Lokalna implementacja nie oznacza uruchomienia Deploy ani zmiany produkcji.
Przed pierwszym przejściem ze starej wersji obowiązuje procedura 4.9 powyżej,
także dla workflow: wyłączony cron wysyłki, zakończone procesy i zachowana
kopia sprzed 0013 poza rotacją. Backup dzienny pozostaje bez zmian.

1. Sprawdź `/api/health`, 401 z `/api/auth/me` bez sesji oraz logowanie
   w przeglądarce i poprzednim wspieranym APK. Sprawdź zapis/odczyt kalendarza,
   zaproszenie/reset i odczyt harmonogramu. Nie kasuj kont ani danych rodziny.
2. Sprawdź `/sw.js`: 200, JavaScript, `Cache-Control: no-store`,
   skrypt wycofujący bez obsługi fetch/push. Zachowuj go w kolejnych ZIP,
   również gdy nikt ostatnio nie korzystał z PWA. Nie zastępuj go 404 ani SPA.
   `/manifest.webmanifest` ma zwracać 410 mimo starego pliku na dysku;
   zweryfikuj również reguły cache/proxy hostingu, żeby nie zwracały dawnej kopii.
3. W profilu z dawniej zainstalowaną PWA otwórz ją online, pozwól przeglądarce
   zaktualizować workera, zamknij i otwórz ponownie. Pierwsze wejście może
   jeszcze pokazać dawny interfejs z cache. Sprawdź nową stronę, zachowaną sesję
   i kalendarz, brak rejestracji oraz wyłącznie usunięty precache Rodziny.
   Nie czyść danych witryny, bo ukryłoby to błąd migracji. Ikonę usuwa użytkownik.
4. W czystym profilu sprawdź brak rejestracji SW, manifestu i żądań
   `/api/push/*`. Przy 390 i 1280 px ekran powiadomień ma wyjaśniać wymaganie
   APK i oferować pobieranie, gdy jest opublikowane wydanie.
5. Sprawdź MIME/sumę APK i `latest.json` z `no-store`, numer wydania,
   aktualizację tym samym kluczem i zachowanie sesji/harmonogramu na telefonie.
   Wykonaj próby offline, zamkniętego interfejsu i restartu z DEVELOPMENT.
6. Zapisz commit, SHA-256 ZIP i APK, wersję APK, wynik migracji, czas kontroli
   oraz wynik backupu/logów. Wyniki telefonu zapisuj z modelem i opóźnieniem.
   Brak potwierdzenia pozostaw jako „niewykonane”; historyczne udane wdrożenie
   z 18.10 nie potwierdza wydania po wycofaniu PWA.

Powrót po usunięciu tabeli subskrypcji wymaga zgodnej bazy i paczki według 4.9;
nie przywracamy automatycznie bazy ani Web Push. Nie cofaj numeru APK:
poprawione wydanie podpisz tym samym kluczem z wyższym `versionCode`.
Nie dodano konfiguracji API, migracji, zależności runtime, crona ani procesu w tle
w kroku 4.10; obowiązują istniejące `.env.example`, backup i ochrona danych.
