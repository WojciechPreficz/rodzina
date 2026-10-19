# Decyzje

## 19.10.2026 — wycofanie PWA, kroki 4.8-4.10

- Na polecenie właściciela pozostają strona WWW i APK. Alarmy offline Androida
  są kluczowe; nie utrzymujemy alternatywnej instalacji PWA ani Web Push.
  Nowa sekcja PLAN ma pierwszeństwo przed wcześniejszymi decyzjami o PWA.
- Krok 4.8 obejmuje kompletną zmianę frontendu i migrację starych rejestracji.
  Samo usunięcie pliku SW pozostawiłoby stare instalacje bez ścieżki aktualizacji.
  Dlatego `/sw.js` nadal dostarcza mały skrypt wyrejestrowujący, bez fetch/push,
  z `no-store`. Nie rejestrujemy go przy nowych wizytach ani nie pakujemy do APK.
  Frontend sprząta tylko root `/sw.js` i cache `workbox-precache-*` z sufiksem
  własnego scope. Sesje, localStorage i cache o innych nazwach pozostają.
- Deploy nakładkowy zachowuje stare pliki, dlatego historyczny manifest blokujemy
  odpowiedzią 410 w API przed serwowaniem statycznym. `/sw.js` zostaje nadpisany
  skryptem wycofującym. Ikony zachowujemy dla istniejących powiadomień i skrótów.
- Usunięcie backendu Web Push, VAPID, joba/crona i tabeli subskrypcji należy do 4.9.
  Krok 4.10 domyka dokumentację, regresję i procedurę produkcyjną. W każdym kroku
  zachowujemy dane przypomnień, odbiorców, `/api/reminders/schedule` i alarmy APK.
  Wycofanie PWA nie potwierdza naprawy ani działania alarmów fizycznego telefonu.
- Wycofanie rejestracji i subskrypcji wymaga wizyty online lub aktualizacji SW
  przez przeglądarkę. Nie usuwamy zdalnie starej ikony PWA z urządzenia.
  Dokumentacja mechanizmu: [Chrome — wycofywanie service workera](https://developer.chrome.com/docs/workbox/remove-buggy-service-workers).

## Ręcznie uruchamiany deploy GitHub Actions — krok 4.7 (2026-10-16)

- Na prośbę właściciela dodajemy krok 4.7 po dystrybucji APK z kroku 4.6 i przenosimy do niego domknięcie fazy 4.
- Wzorzec stanowią `.github/workflows/deploy.yml` i `scripts/deploy.sh` lokalnego repozytorium `portfel`: transfer SSH, zachowanie plików serwera, restart Passengera i sprawdzenie działania po wdrożeniu. Implementację dostosujemy do paczki Node `release.zip` oraz skryptów `.mjs` projektu `rodzina`.
- W odróżnieniu od `portfel` deploy ma wyłącznie wyzwalacz `workflow_dispatch` i działa dla `main`. Push nadal uruchamia CI; produkcja zmienia się dopiero po ręcznym „Run workflow”. Powód: właściciel chce sam wybierać moment wdrożenia sprawdzonych zmian.
- Workflow wdraża API/PWA. Podpisywanie i publikacja APK pozostają osobną procedurą kroku 4.6; deploy zachowuje katalog wydań i metadane Androida. Nie powtarzamy pierwszego wdrożenia ani automatycznie nie cofamy bazy po migracjach.

## Numeracja zgodna z kolejnością prac (2026-10-16)

- Na prośbę właściciela fazy i ich kroki otrzymują numery zgodne z kolejnością realizacji:
  Android 4 (dawniej 9), zakupy 5 (dawniej 4), obiady 6 (dawniej 5), zadania 7 (dawniej 6),
  dokumenty 8 (dawniej 7). Fazy 0-3 zachowują numery.
- Wykonany pierwszy deploy jest osobnym zapisem historycznym po fazie 3, z krokami D.1-D.4
  zamiast dawnej numeracji 8.1-8.4. Aktualna faza 8 dotyczy wyłącznie dokumentów.
- Zaktualizowano kolejność sekcji, listę zadań i odwołania w planie, `AGENTS.md` i `DEPLOY.md`.
  Starsze wpisy poniżej zachowują historyczną numerację; obowiązuje nowsza decyzja i aktualny plan.
  Zmiana numerów nie zmienia zakresu kroków ani statusu ich testów.

## Android i działające wdrożenie (2026-10-16)

- Właściciel potwierdził wykonanie deployu na https://rodzina.preficze.pl. Faza 8 pozostaje
  zapisem wykonanej procedury; samo potwierdzenie działania strony nie zalicza testów push,
  odtwarzania kopii ani obserwacji cronów po dobie. Kolejne wdrożenia to aktualizacje według `DEPLOY.md`.
- Rezygnujemy z planowanej fazy wydania open source. Numer 9 przejmuje etap Android przez
  Capacitor, wykonywany po wdrożeniu i przed fazami 4-7. Pozostałe numery nie zmieniają się.
  Historyczne odnośniki do kroków 9.x wydania OSS nie są aktualnymi zadaniami.
- APK wykorzysta wspólny interfejs React, lokalne pliki aplikacji i systemowe alarmy;
  API, baza rodziny i backupy pozostają na vh.pl. PWA pozostaje dostępna z Web Push.
  Rezygnacja z publikacji nie zmienia automatycznie istniejących deklaracji licencji MIT.
- Przypomnienia offline opierają się na harmonogramie wcześniej pobranym przez konkretny
  telefon. Zmiany i cofnięcie uprawnień na innym urządzeniu wymagają synchronizacji.
  Dla prywatnych zadań lokalne powiadomienia mają ogólną treść bez danych zadania;
  szczegóły wymagają aktualnego sprawdzenia dostępu online. Nie obiecujemy natychmiastowego
  unieważnienia alarmu na telefonie bez internetu. Własne wylogowanie usuwa lokalne alarmy i cache.
- Faza 9 obejmuje tylko kalendarz i jego przypomnienia. Fazy 6 i 7 rozbudują ten sam
  mechanizm o zadania i dokumenty; nie implementujemy tych modułów wcześniej.

## Wcześniejsze wdrożenie (2026-10-16)

- Na prośbę właściciela zmieniono kolejność na: fazy 0-3, faza 8, fazy 4-7,
  opcjonalnie faza 9. Numeracja pozostaje bez zmian, aby zachować odnośniki do kroków.
  Pierwszy deploy obejmuje konta rodziny, kalendarz i push; pozostałe moduły nie blokują
  wdrożenia. Testy i kryteria akceptacji nadal obowiązują.
- Instalacja `npm ci` na Windows wymaga zatrzymania API i watcherów tego projektu.
  Potwierdzono blokadę modułu `argon2.win32-x64-msvc.node` przez lokalny proces API;
  po zatrzymaniu procesów instalacja zakończyła się poprawnie. Instrukcja rozwiązania
  błędu `EPERM` znajduje się w `DEPLOY.md`.

## Krok 2.7 (2026-10-12)

- Wspólny `ReminderPicker` przyjmuje listę dozwolonych odbiorców i domyślnego odbiorcę.
  Formularz wydarzenia obsługuje wspólne, a „Tylko ja” jest w sekcji „Moje przypomnienia”
  szczegółów dla każdego domownika. Przy tworzeniu wydarzenia formularz wskazuje tę ścieżkę:
  osobiste przypomnienie wymaga już istniejącego ID. Osobny zapis unika częściowego sukcesu
  tworzenia wydarzenia i duplikacji przy ponowieniu po błędzie przypomnienia.
- Formularz wysyła `reminders` tylko po zmianie ich konfiguracji; usunięcie wszystkich wysyła
  `[]`. „Tylko to” nie edytuje konfiguracji przypomnień serii. Osobiste zapisują się natychmiast
  przez `/api/reminders/mine`, z odświeżaniem co 20 s i po powrocie do karty.
- Daty absolutne są przeliczane wyłącznie przez `localDateTimeToUtc` w `shared` dla strefy rodziny.
  Oznaczenie „nieaktualne” dotyczy absolutnego przypomnienia z `nextFireAt = null` lub datą
  w przeszłości; wygasły offset nie jest mylony z nieaktualną datą absolutną.
- Na prośbę właściciela testy i `release:smoke` pominięto. Weryfikację ręczną i pozostałe
  kryteria fazy 2 opisano w `DEVELOPMENT.md`; nie uznajemy ich za potwierdzone samą implementacją.

## Krok 2.5 (2026-10-12)

- Kalendarz działa pod `/kalendarz` oraz pod dotychczasowym `/`. Schedule-X używa Temporal z polyfillem, a adapter otrzymuje gotowe momenty UTC z API i wyświetla je w strefie rodziny. Zależności są przeglądarkowe i nie wymagają kompilacji nowych modułów runtime na serwerze.
- Wydarzenie z kilkoma uczestnikami pojawia się raz. Jego kolor pochodzi od pierwszego uczestnika pasującego do filtra (bez filtra: pierwszego uczestnika); szczegóły i legenda pokazują wszystkich domowników oraz ich kolory. Wydarzenie bez uczestników ma neutralny kalendarz rodzinny i jest widoczne przy pustym filtrze.
- Krok 2.5 tworzy wyłącznie wydarzenia jednorazowe. Edycja istniejącego wydarzenia zachowuje rodzaj, regułę powtarzania i precyzję; dla serii dotyczy całości i pokazuje stosowną informację. Formularz nie wysyła pola `reminders`, więc zapis zachowuje obecne przypomnienia. Kreator i wybór zakresu pozostają w kroku 2.6.
- Zgodnie z poleceniem właściciela testy automatyczne, weryfikacja w przeglądarce i `release:smoke` nie są uruchamiane w tym czacie. Dodano testy do późniejszego uruchomienia; wykonujemy jedynie sprawdzenie typów, lint, formatowanie i build.

Decyzje projektowe, których `docs/PLAN.md` nie rozstrzyga:

| Data       | Decyzja                                                                                                                                                                                                                                                                                                                                                                                                                               | Powód                                                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-08 | Ikony PWA będą prostymi, własnymi grafikami PNG generowanymi lokalnie.                                                                                                                                                                                                                                                                                                                                                                | Plan określa wymagane rozmiary i wariant maskable, ale nie dostarcza projektu graficznego.                                                                                                                                  |
| 2026-10-08 | Przechowujemy w repo wyłącznie startową migrację `job_runs`; migracje tworzy Drizzle Kit.                                                                                                                                                                                                                                                                                                                                             | Faza 0 potrzebuje tabeli technicznej, a domenowe tabele należą do późniejszych faz.                                                                                                                                         |
| 2026-10-09 | Od kroku 1.5 dane serwera pobiera TanStack Query (`QueryClientProvider` w `main.tsx`, domyślne opcje w `queryClient.ts`). Sesja (`useMe`) zostaje w kontekście z kroku 1.4.                                                                                                                                                                                                                                                           | Zgodnie ze stackiem z PLAN.md; przeniesienie sesji do TanStack Query wymaga przebudowy testów auth i nie należy do kroku 1.5.                                                                                               |
| 2026-10-09 | Wylogowanie czyści cache TanStack Query (`queryClient.clear()`).                                                                                                                                                                                                                                                                                                                                                                      | Po zalogowaniu innej osoby w tej samej przeglądarce nie mogą być widoczne dane poprzedniej sesji.                                                                                                                           |
| 2026-10-09 | W UI zmiana roli dotyczy tylko dorosłych (administrator ↔ dorosły), bez zamiany w dziecko.                                                                                                                                                                                                                                                                                                                                            | Konto zamienione w dziecko nie ma PIN-u, więc nie dałoby się na nie zalogować.                                                                                                                                              |
| 2026-10-09 | Administrator nie może usunąć samego siebie z ekranu Rodzina.                                                                                                                                                                                                                                                                                                                                                                         | Chroni przed przypadkowym wylogowaniem; regułę ostatniego admina i tak egzekwuje API.                                                                                                                                       |
| 2026-10-09 | Potwierdzenia usunięcia domownika i rotacji kodu używają `window.confirm`.                                                                                                                                                                                                                                                                                                                                                            | Nie wymaga dodatkowej zależności (`@mantine/modals`) w MVP.                                                                                                                                                                 |
| 2026-10-09 | API odrzuca zmianę między kontem dziecka a kontem dorosłego; dozwolone są zmiany administrator ↔ dorosły.                                                                                                                                                                                                                                                                                                                             | Ujednolica API z UI i nie tworzy kont bez danych logowania.                                                                                                                                                                 |
| 2026-10-09 | Rejestracja zapisuje rodzinę i administratora w jednej transakcji. Zaproszenia i reset hasła są zużywane warunkowo w transakcji po hashowaniu, z ponownym sprawdzeniem terminu ważności.                                                                                                                                                                                                                                              | Chroni przed równoległym wykorzystaniem jednorazowego tokenu i pozostawieniem pustej rodziny przy konflikcie e-maila.                                                                                                       |
| 2026-10-09 | Aktywność odnawia jednocześnie termin sesji w bazie i cookie `sid` na 60 dni. Limit logowania dopuszcza 10 prób, blokuje jedenastą; błędny PIN nie zeruje licznika.                                                                                                                                                                                                                                                                   | Zapewnia zgodność z zasadami sesji i logowania z fazy 1.                                                                                                                                                                    |
| 2026-10-09 | Ekran zaproszenia wymaga wylogowania z obecnego konta przed utworzeniem nowego domownika.                                                                                                                                                                                                                                                                                                                                             | Chroni przed niezamierzoną zmianą aktywnego konta i rodziny.                                                                                                                                                                |
| 2026-10-09 | Testy e2e używają osobnej tymczasowej bazy i portu 3417, Chromium headless oraz szerokości 390 i 1280 px.                                                                                                                                                                                                                                                                                                                             | Nie zmieniają danych rodziny w lokalnej bazie; sprawdzają oba wymagane układy.                                                                                                                                              |
| 2026-10-11 | Krok 2.1 używa minimalnych typów czasu w `shared`, bez schematów API i bazy. Źródłem przypomnienia jest wydarzenie z wyjątkami albo ogólny termin `{ date, time?, completed? }`.                                                                                                                                                                                                                                                      | Pozwala później mapować terminy zadań i dokumentów bez zmiany funkcji obliczającej przypomnienia.                                                                                                                           |
| 2026-10-11 | Zakres `expandOccurrences` obejmuje obie daty graniczne i filtruje po dacie rozpoczęcia po zastosowaniu wyjątków. `occurrenceDate` zawsze wskazuje datę pierwotną. Całodniowe wystąpienie kończy się o następnej lokalnej północy.                                                                                                                                                                                                    | Przesunięte wystąpienia zachowują identyfikator, także gdy trafiają do zakresu spoza niego; dzień zmiany czasu może mieć 23 lub 25 godzin.                                                                                  |
| 2026-10-11 | `computeNextFireAt` zwraca wyłącznie moment późniejszy niż `nowUtc`. Pomija anulowane wystąpienia i sprawdza przesunięte wyjątki także poza zakresem zwykłej serii. Brak przyszłego terminu daje `null`.                                                                                                                                                                                                                              | Zapobiega ponownemu wybraniu wysłanego przypomnienia i nie ogranicza odległych terminów stałym horyzontem wyszukiwania.                                                                                                     |
| 2026-10-11 | `rrule`, `date-fns` i `@date-fns/tz` są zależnościami `@rodzina/shared`; nie wymagają kompilacji natywnej ani nowych zmiennych środowiskowych lub cronów.                                                                                                                                                                                                                                                                             | Logika czasu jest współdzielona przez API i web; zależności mogą być dołączane do ich pakietów przez bundler.                                                                                                               |
| 2026-10-11 | W typie czasu wyjątku pominięte `overrideStartTime` dziedziczy godzinę serii, a jawne `null` oznacza wystąpienie całodniowe.                                                                                                                                                                                                                                                                                                          | Rozróżnia brak zmiany godziny od usunięcia godziny; późniejszy serwis API będzie mapował dane do tego kontraktu.                                                                                                            |
| 2026-10-11 | W kroku 2.2 API używa camelCase, `participantIds` przy zapisie i `participants` (id, imię, kolor) przy odczycie. `PATCH` scala podane pola z zapisanym wydarzeniem, waliduje całość i zastępuje uczestników tylko wtedy, gdy podano ich nowe identyfikatory. Pominięty `scope` oznacza `all`; inne zakresy i `occurrenceDate` są odrzucane do kroku 2.4.                                                                              | Zapewnia spójny kontrakt częściowej edycji i nie uruchamia funkcji późniejszych kroków.                                                                                                                                     |
| 2026-10-11 | Zakres wystąpień liczymy włącznie z obiema datami (62 dni to różnica 61 dni). `userId` filtruje wyłącznie uczestników, a obcy lub nieistniejący identyfikator daje pustą listę. Odległy termin miesięczny pozostaje na liście nadchodzących przez cały miesiąc; termin dzienny pozostaje do końca lokalnego dnia.                                                                                                                     | Wydarzenia bez uczestników są widoczne w widoku całej rodziny. Nie znamy dokładnego dnia terminu miesięcznego, więc nie usuwamy go z listy pierwszego dnia miesiąca.                                                        |
| 2026-10-11 | Reguły powtarzania API obejmują częstotliwości dzienne, tygodniowe, miesięczne i roczne oraz filtry dat; bez `DTSTART`, `TZID` i filtrów godzin. `COUNT` i `UNTIL` są rozłączne. Wydarzenie z godziną wymaga dodatniego czasu trwania; całodniowe ma oba pola null. Limity: tytuł 200, opis 10000, miejsce 500 znaków, RRULE 2000 znaków, do 100 różnych uczestników, czas trwania do 365 dni.                                        | Wystąpienie identyfikuje jedna lokalna data; zakres jest zgodny z kreatorem planowanym w kroku 2.6. Limity chronią API przed nadmiernymi danymi, a walidacja zapobiega niespójnym wydarzeniom.                              |
| 2026-10-11 | Uzupełniono `0009_snapshot.json` o stan istniejących migracji auth przed wygenerowaniem `0010_events.sql`. Poprzednie migracje SQL pozostają bez zmian. API importuje istniejący pakiet `@rodzina/shared`; brak nowych bibliotek zewnętrznych, konfiguracji i cronów.                                                                                                                                                                 | Brak snapshotu auth powodował ponowne generowanie już istniejących tabel. Metadane umożliwiają prawidłowe generowanie kolejnych migracji bez zmiany istniejących baz.                                                       |
| 2026-10-11 | API dołącza `@rodzina/shared` i biblioteki czasu do builda przez `noExternal` w `tsup.config.ts`. Paczka release pomija wewnętrzny pakiet w zależnościach npm. `dev:api` buduje shared przed uruchomieniem API.                                                                                                                                                                                                                       | Paczka ma działać bez workspace i bez instalowania prywatnego pakietu z rejestru; start dev po świeżym `npm ci` nie wymaga osobnego builda.                                                                                 |
| 2026-10-12 | W kroku 2.3 body wydarzenia przyjmuje tylko przypomnienia wspólne; brak `reminders` zachowuje je, a `[]` je usuwa. Odczyt wydarzenia zwraca tylko wspólne przypomnienia, osobiste dostępne są przez `/api/reminders/mine`. POST osobistego przypomnienia zwraca 200 zgodnie z kryterium kroku; usunięcie cudzego daje 404.                                                                                                            | Chroni ustawienia osobiste i utrzymuje osobną ścieżkę zapisu dla osób bez prawa edycji wydarzenia.                                                                                                                          |
| 2026-10-12 | Tworzenie i edycja wydarzenia oraz zapis/przeliczenie wszystkich jego przypomnień odbywają się w jednej transakcji. Domyślny odbiorca wspólny to `participants`. Offset: 0–10000 jednostek, do 100 wspólnych przypomnień na zapis.                                                                                                                                                                                                    | Zapewnia spójność terminu i przypomnień, obsługuje preset w chwili rozpoczęcia i ogranicza rozmiar żądania.                                                                                                                 |
| 2026-10-12 | Migracja przypomnień zawiera nullable `task_id` i `document_id`, bez FK do nieistniejących tabel. API przyjmuje wyłącznie `eventId` i odrzuca pozostałe źródła; CHECK bazy wymaga dokładnie jednego źródła oraz `user_id` wyłącznie dla `audience=user`. FK przyszłych źródeł zostaną dodane w odpowiednich fazach.                                                                                                                   | Wykonuje zakres kroku 2.3 bez tworzenia tabel z kolejnych faz; zapewnia kaskady wydarzenia i odbiorcy osobistego oraz SET NULL dla autora.                                                                                  |
| 2026-10-12 | Krok 2.4: wyjątek `this` zapisuje pełny stan tytułu i terminu wystąpienia; obsługuje tylko pola istniejące w `event_exceptions`. Edycja anulowanego wystąpienia je przywraca.                                                                                                                                                                                                                                                         | Pozwala odróżnić wystąpienie całodniowe od dziedziczenia godziny bez zmiany schematu bazy; inne pola dotyczą całej serii.                                                                                                   |
| 2026-10-12 | Podział `following` zwraca nowy identyfikator serii i zachowuje autora wydarzenia. Kopiuje wspólne przypomnienia i przenosi osobiste, zachowując ich ID, autora, odbiorcę i historię wysyłki. COUNT nowej serii obejmuje tylko pozostałe wystąpienia. Przyszłe wyjątki są przenoszone przy zachowaniu daty i wzorca; zmiana daty lub wzorca je resetuje. Stara seria przy podziale od pierwszego wystąpienia pozostaje bez wystąpień. | Chroni przeszłość i prawa dziecka do własnych wydarzeń, nie duplikuje osobistych przypomnień oraz nie wydłuża serii kończącej się po określonej liczbie wystąpień.                                                          |
| 2026-10-12 | Krok 2.6: kreator obsługuje częstotliwości dzienne, tygodniowe (wybrane dni), miesięczne i roczne, odstęp oraz rozłączne COUNT/UNTIL. UNTIL oznacza koniec wybranego lokalnego dnia (floating T235959). Reguły spoza możliwości kreatora są zachowywane, bez automatycznego uproszczenia.                                                                                                                                             | Zapewnia round-trip ustawień i nie zmienia znaczenia istniejących reguł przy edycji innych pól.                                                                                                                             |
| 2026-10-12 | Wybór zakresu poprzedza formularz. „Tylko to” edytuje pola wyjątku z aktualnym terminem; „To i następne” pokazuje pozostały COUNT i pomija rrule w PATCH, jeśli wzorzec nie zmieniono. Szczegóły serii bez parametru data wskazują pierwsze rzeczywiste wystąpienie.                                                                                                                                                                  | Chroni przeszłość oraz istniejące przyszłe wyjątki i nie wydłuża serii przez ponowne wysłanie pełnego COUNT. Początek serii może wypadać poza wybranymi dniami tygodnia.                                                    |
| 2026-10-12 | Odliczanie terminu miesięcznego liczy pełne lata i miesiące między miesiącami; dla bieżącego miesiąca pokazuje „w tym miesiącu”. Lista odległych respektuje ten sam filtr uczestników co kalendarz.                                                                                                                                                                                                                                   | Nie sugeruje dokładnego dnia nieznanego terminu i zapewnia spójność filtrowania.                                                                                                                                            |
| 2026-10-16 | Po utworzeniu wydarzenia formularz zamyka się, a użytkownik pozostaje na bieżącym widoku kalendarza z zachowaniem daty i filtrów.                                                                                                                                                                                                                                                                                                     | Zgodnie z prośbą użytkownika pozwala dodawać kolejne wydarzenia bez przechodzenia do szczegółów.                                                                                                                            |
| 2026-10-16 | Odległy termin z precyzją dnia ma domyślnie puste, opcjonalne pole godziny. Bez godziny zapisujemy startTime i durationMinutes jako null; po podaniu godziny pokazujemy czas trwania.                                                                                                                                                                                                                                                 | Użytkownik może znać datę odległego terminu bez dokładnej godziny.                                                                                                                                                          |
| 2026-10-16 | Krok 3.1: czyste funkcje resolveRecipients i buildReminderPayload w module przypomnień API przyjmują wydarzenie oraz aktualny skład rodziny. Odbiorcy są identyfikowani po ID, filtrowani po rodzinie i deduplikowani; pusta lista kieruje do aktualnych dorosłych.                                                                                                                                                                   | Wydarzenia są widoczne dla całej rodziny; aktualny skład usuwa z wysyłki byłych domowników i osoby z innych rodzin. Brak dorosłych oznacza pustą listę.                                                                     |
| 2026-10-16 | Krok 3.1: payload zawiera polski title z terminem i imionami uczestników, body z miejscem, tag wydarzenia i pierwotnej daty oraz url z eventUrl. Jawne occurrenceDate, nowUtc i strefa rodziny. Wyjątki zmieniają treść, zachowując datę linku. Miesiące pokazujemy dla precyzji miesięcznej albo tej samej liczby dnia; inne przyszłe daty w dniach.                                                                                 | Kontrakt dla późniejszej wysyłki i service workera. Jawny czas umożliwia deterministyczne testy, a data lokalna zapewnia poprawność przy zmianie czasu.                                                                     |
| 2026-10-16 | Krok 3.2: rezerwujemy wszystkie należne przypomnienia w jednej transakcji BEGIN IMMEDIATE, ustawiając last_sent_at i kolejny termin względem czasu joba. Wysyłka odbywa się po commit; błędy dostawcy nie cofają rezerwacji i nie wywołują ponowień.                                                                                                                                                                                  | Realizuje ochronę przed podwójnymi próbami równoległego crona. Awaria po rezerwacji może pominąć powiadomienie; brak gwarancji dostarczenia.                                                                                |
| 2026-10-16 | Krok 3.2: computeNextEventReminder w shared udostępnia datę pierwotnego wystąpienia i informację o braku godziny, korzystając z tej samej logiki co computeNextFireAt. Absolutne przypomnienie serii wskazuje najbliższe aktywne wystąpienie od remind_at, a po końcu serii pierwsze aktywne.                                                                                                                                         | Pozwala zachować tożsamość przesuniętego wystąpienia w linku. Absolutne przypomnienie nie przechowuje identyfikatora wystąpienia; plan nie definiuje tego powiązania. Tolerancja 12 h dotyczy tylko offsetów od bazy 09:00. |
| 2026-10-16 | Krok 3.2: VAPID jest wymagany dla serwera i jobów. Walidujemy format surowych kluczy i zgodność pary P-256; generator korzysta z ECDH Node zamiast wycinania fragmentów DER. Testy i smoke generują własne klucze. web-push jest zależnością JavaScript paczki release bez nowej kompilacji natywnej.                                                                                                                                 | Poprzednie wycinanie końca PKCS8 nie gwarantowało prawidłowego klucza prywatnego. Brak domyślnych sekretów w konfiguracji.                                                                                                  |
| 2026-10-16 | Krok 3.2: dev:cron uruchamia osobny proces joba od razu, a następnie minutę po poprzednim zakończeniu; używa źródeł TypeScript przez tsx i ponownie wczytuje .env.                                                                                                                                                                                                                                                                    | Unika nakładania się lokalnych wysyłek i nie wymaga builda API. Produkcja korzysta wyłącznie z crona cPanel.                                                                                                                |
| 2026-10-16 | Krok 3.3: subskrypcja przyjmuje JSON z PushSubscription.toJSON() (endpoint, keys i opcjonalne expirationTime). Upsert aktualizuje tylko subskrypcję tej samej osoby; cudzy endpoint daje 409. DELETE jest idempotentny i filtruje po zalogowanej osobie.                                                                                                                                                                              | Zapobiega przejęciu urządzenia innego domownika, także w innej rodzinie. Po zmianie konta należy usunąć poprzednią subskrypcję i utworzyć nową w przeglądarce.                                                              |
| 2026-10-16 | Krok 3.3: POST /api/push/test korzysta z wstrzykiwanego PushSender, wysyła na wszystkie urządzenia zalogowanej osoby i zwraca sent, failed, removed; 404/410 usuwa urządzenie, pozostałe błędy nie przerywają wysyłki. Sukces aktualizuje last_success_at.                                                                                                                                                                            | Pozwala sprawdzić wynik częściowej wysyłki bez ujawniania błędów dostawcy i kluczy.                                                                                                                                         |
| 2026-10-16 | Krok 3.3: service worker przyjmuje wyłącznie adresy aplikacji z tej samej origin; niepoprawny URL i pusty push kierują do /kalendarz. Kliknięcie najpierw wybiera okno z docelowym adresem, potem inne okno aplikacji (nawigacja i fokus), a przy braku otwiera nowe. Ikona i badge korzystają z istniejącego icon-192.png.                                                                                                           | Zachowuje datę wystąpienia w deep linku, obsługuje testowy tekst DevTools i nie kieruje powiadomień na zewnętrzne strony.                                                                                                   |
| 2026-10-16 | Krok 3.4: status powiadomień dotyczy bieżącego urządzenia i zalogowanej osoby. POST /api/push/status przyjmuje opcjonalny endpoint i zwraca wyłącznie subscribed oraz hasReminders. Baner uwzględnia tylko przypomnienia z next_fire_at innym niż null, dla których resolveRecipients wskazuje tę osobę, również wspólne i awaryjne dla dorosłych.                                                                                    | Istniejące API nie pozwalało sprawdzić rejestracji urządzenia ani odbiorców przypomnień dla całego kalendarza. Endpoint w body nie trafia do adresu żądania; odpowiedź nie ujawnia kluczy, adresów ani cudzych danych.      |
| 2026-10-16 | Krok 3.4: zgoda jest żądana bezpośrednio po kliknięciu; odczyt statusu co 20 s i po powrocie do okna nigdy nie subskrybuje. Subskrypcja przeglądarki jest ponownie zapisywana po kliknięciu, jeżeli API jej nie zna; nieudany zapis nowej subskrypcji wycofuje ją przez unsubscribe. Istniejąca cudza subskrypcja zachowuje ochronę 409 z kroku 3.3.                                                                                  | Zapewnia świadomą zgodę, wykrywa wygasłe wpisy po teście i pozwala ponowić zapis po awarii sieci bez przejmowania urządzenia innego konta.                                                                                  |
| 2026-10-16 | Krok 3.5: kopia dzienna używa daty Europe/Warsaw; ponowienie zastępuje ją przez rename po VACUUM INTO do unikalnego pliku tymczasowego. Rotacja po sukcesie zachowuje 14 najnowszych nazw rodzina-YYYY-MM-DD.db i pomija katalogi oraz inne pliki. Domyślny katalog to ./apps/api/data/backups; produkcja używa ścieżki bezwzględnej.                                                                                                 | Zapewnia samodzielny snapshot WAL, zachowanie poprzedniej kopii przy błędzie i przewidywalną retencję bez nowych zależności.                                                                                                |
| 2026-10-16 | Krok 3.5: usunięto job i skrypt heartbeat, pozostawiając historyczną tabelę job_runs i migracje. Build API czyści dist, aby stary job nie trafiał do release.zip.                                                                                                                                                                                                                                                                     | Usunięcie joba nie wymaga zmiany istniejących baz; czysty build usuwa nieaktualne pliki wynikowe.                                                                                                                           |

## Krok 4.1 — sesja Androida (2026-10-16, przed implementacją)

- APK korzysta z lokalnych plików React oraz dedykowanego pluginu natywnego `RodzinaApi`. Plugin przyjmuje wyłącznie wewnętrzne ścieżki `/api/`, łączy się z jednym skonfigurowanym originem i nie śledzi przekierowań. Produkcja dopuszcza wyłącznie `https://rodzina.preficze.pl`; debug może korzystać z `http://localhost:3000` przez `adb reverse`.
- Transport natywny wysyła istniejące cookie `sid` i dla mutacji nagłówek Origin równy originowi API. Nie dodajemy CORS ani wyjątku od serwerowej ochrony CSRF. Natywny klient nie podlega polityce cookies WebView; przeglądarka nadal używa fetch i cookie HttpOnly/SameSite=Lax.
- `sid` nigdy nie trafia do JavaScript ani localStorage. Android przechowuje go z terminem ważności w prywatnych SharedPreferences zaszyfrowanych AES-GCM kluczem Android Keystore; backup aplikacji jest wyłączony. Każde Set-Cookie odnawia zapis zgodnie z istniejącymi 60 dniami serwera. Błąd odczytu magazynu zamyka sesję zamiast udostępniać niesprawdzone dane.
- Żądania natywne są szeregowane. Wylogowanie najpierw próbuje unieważnić sesję na serwerze, a zawsze usuwa lokalne poświadczenia, także offline. Logowanie na inne konto najpierw usuwa poprzednią sesję i cache; 401 usuwa lokalną sesję, błąd sieci jej nie usuwa. Cache danych pozostaje wyłącznie w pamięci, bez zapisu kalendarza offline.
- Capacitor 8 (Node >=22), Android SDK 36 i JDK 21; wersje Gradle/AGP pochodzą z szablonu zainstalowanego Capacitor. Build Androida ma osobny katalog `dist-android`, bez manifestu PWA, service workera i Web Push. Alarmy i ich magazyn należą do kolejnych kroków.

Uzupełnienie po kontroli kodu Capacitor: jego plugin cookies rejestruje globalny
CookieHandler współdzielący magazyn WebView. Dlatego transport używa OkHttp 4.12.0
z jawnym `CookieJar.NO_COOKIES`, bez przekierowań i automatycznych ponowień mutacji.
Ta zależność jest wyłącznie w Gradle Androida; nie trafia do runtime serwera.
Odpowiedź 403 przy edycji oznacza brak prawa do tej operacji i nie usuwa całej sesji.
Potwierdzone 401 usuwa sesję natywną i cache React Query. Odrzucenie sesji na
starcie nie blokuje załadowania lokalnego interfejsu logowania.

Identyfikator aplikacji to `pl.preficze.rodzina` (domena właściciela), nazwa Rodzina.
Pozostaje stały przy aktualizacjach; zarządzanie wersjami i podpisem release należy
do kroku 4.6.

## Krok 4.2 — kontrakt harmonogramu (2026-10-16)

- GET /api/reminders/schedule korzysta z istniejącej sesji i zwraca pełny snapshot
  w przedziale (generatedAt, validUntil], gdzie validUntil = generatedAt + 90 × 24 h.
  Okno dotyczy czasu alarmu, więc obejmuje też offsety wydarzeń poza tym oknem.
  Odczyt jest transakcją SQLite, bez modyfikacji rezerwacji crona; odpowiedź ma Cache-Control: no-store.
- Wpis ma key, reminderId, sourceType=event, sourceId, occurrenceDate, fireAt,
  title, body i url. Klucz to event:<sourceId>:<reminderId>:<pierwotna data>.
  Nie zawiera czasu alarmu ani treści, dzięki czemu przesunięcie wyjątku i edycja
  godziny aktualizują ten sam alarm. Wymiana przypomnienia lub podział serii
  tworzą nowe klucze; pełny snapshot pozwoli anulować poprzednie w kroku 4.3.
- Treść lokalna podaje datę DD.MM.RRRR i opcjonalną godzinę rodziny, a przy
  precyzji miesiąca MM.RRRR. Nie zawiera względnych określeń czasu.
  Absolutne przypomnienie serii wskazuje wystąpienie według istniejącej reguły
  joba (najbliższe od remindAt, awaryjnie pierwsze aktywne).
- Rozwinięcie okna pozostaje w shared i korzysta z istniejących funkcji RRULE,
  wyjątków i offsetów. Uwzględnia wszystkie wystąpienia, także dwa przesunięte
  na jeden termin. Nie stosujemy limitu 62 dni widoku kalendarza ani cichego
  obcięcia snapshotu. Zadania i dokumenty pozostają poza zakresem.

## Krok 4.3 — trwałe alarmy Androida (2026-10-16)

- Używamy `@capacitor/local-notifications` 8.3.1. Plugin zapisuje konkretne alarmy
  w prywatnych SharedPreferences i odtwarza je natywnie po BOOT_COMPLETED. Odbiornik
  aplikacji wywołuje tę samą obsługę po odblokowaniu użytkownika, zmianie czasu/strefy
  i aktualizacji APK. Po restarcie trzeba przynajmniej raz odblokować telefon;
  nie udostępniamy danych kalendarza przed odblokowaniem. Alarm nie wymaga JS ani sieci.
- Snapshot i mapowanie dodatnich 32-bitowych ID zapisujemy przez RodzinaAlarms,
  osobno dla aktywnego konta `familyId:userId`, bez localStorage. Kolizje rozwiązuje
  liniowe szukanie wolnego ID z zawijaniem. Zapis celu poprzedza planowanie, więc
  przerwana operacja jest ponawialna. Porównujemy identyfikatory i treść z getPending;
  samo powodzenie schedule nie wystarcza. Nie ma publicznego API Androida, które
  niezależnie wylicza wszystkie zarejestrowane alarmy aplikacji; wynik opiera się
  na magazynie pluginu i wyniku wywołań AlarmManager, a test telefonu jest obowiązkowy.
- W Doze alarmy z allowWhileIdle podlegają ograniczeniu częstotliwości. Łączymy
  terminy oddalone od pierwszego o mniej niż 9 minut w jeden alarm o najwcześniejszej
  godzinie, z pełną listą treści i danych źródłowych. Pojedynczy alarm zachowuje swój
  termin UTC; kolejne w grupie mogą pojawić się wcześniej o mniej niż 9 minut.
- Limit aplikacji to 400 grup systemowych (zapas wobec limitów niektórych urządzeń).
  Po obcięciu lub awarii pokazujemy liczbę potwierdzonych grup i zakres tylko do
  pierwszej brakującej. Snapshot pozostaje pełny, aby ponowienie nie gubiło wpisów.
  Zgody na powiadomienia, kanał i dokładne alarmy sprawdzamy przed i po zapisie.
- SessionStore usuwa alarmy, widoczne powiadomienia i obydwa magazyny przy logowaniu
  na inne konto, wylogowaniu oraz 401; 403 harmonogramu czyści tylko alarmy i snapshot.
  Rewizja magazynu odrzuca spóźnione zapisy poprzedniej sesji. Błąd sieci nie usuwa danych.
- Prosty ekran w Więcej > Powiadomienia ma ręczne zgody, pobranie i ponowienie z dysku.
  Automatyczna synchronizacja to krok 4.4, nawigacja po kliknięciu i podgląd offline
  to 4.5. Nie implementujemy ich tutaj. Brak nowych zmiennych, migracji lub cronów;
  plugin Androida nie dodaje zależności runtime do serwera. Capacitor includePlugins
  jawnie wskazuje plugin z workspace web, ponieważ CLI pracuje z katalogu głównego.

Źródła sprawdzone podczas implementacji:
[Capacitor Local Notifications](https://capacitorjs.com/docs/apis/local-notifications),
[AlarmManager i ograniczenia Androida](https://developer.android.com/develop/background-work/services/alarms),
oraz kod wersji 8.3.1 zainstalowanej w node_modules.

## Krok 4.4 — synchronizacja harmonogramu (2026-10-17)

- Dodajemy `@capacitor/app` 8.1.2 i `@capacitor/network` 8.0.1 do workspace web
  oraz jawnej listy pluginów Androida. `appStateChange` i `networkStatusChange`
  przekazujemy do focusManager/onlineManager TanStack Query. Jeden obserwator
  przypisany do konta w AuthProvider pobiera harmonogram także poza ekranem
  powiadomień; odpytywanie co 20 s działa tylko w aktywnej aplikacji.
  Po wznowieniu odświeżamy również pozostałe aktywne zapytania.
- Zapis/usunięcie wydarzenia i osobistego przypomnienia unieważnia generację
  synchronizacji, anuluje poprzednie zapytanie Query i żąda nowego snapshotu.
  Scheduler nadal serializuje operacje. Sprawdzamy AbortSignal także po
  asynchronicznym odczycie zgód, przed rozpoczęciem pobrania dla konta.
  Starszy snapshot oraz wynik poprzedniego konta nie zastępują bieżących danych.
- Ostatnią udaną synchronizację zapisujemy w istniejącym prywatnym magazynie
  dopiero po pobraniu i potwierdzeniu całego harmonogramu wraz ze zgodami.
  Ponowienie samego planowania z dysku nie zmienia tej daty. Po błędzie sieci
  ekran odczytuje poprzedni zapis oraz rzeczywistą liczbę alarmów z magazynu
  pluginu; pokazuje błąd i datę wcześniejszego sukcesu, bez nowego komunikatu sukcesu.
- Baner APK opiera się na stanie lokalnego harmonogramu i zgodach, bez Web Push.
  PWA zachowuje dotychczasowy ekran, subskrypcje i test wysyłki.
- Wyłączamy domyślną obsługę przycisku Wstecz nowego pluginu App, aby jego dodanie
  nie zmieniało nawigacji przed krokiem 4.5. Nie dodajemy FCM ani pracy w tle.
  Zamknięte APK nie pobiera zmian; istniejące alarmy pozostają aktywne do
  synchronizacji, wylogowania lub utraty dostępu potwierdzonej przez API.
- Brak nowych zmiennych środowiskowych, migracji, cronów i zależności runtime
  serwera. Wydania APK i paczka API/PWA nadal są oddzielne.

API zweryfikowano w zainstalowanym kodzie pluginów oraz dokumentacji:
[Capacitor App](https://capacitorjs.com/docs/apis/app),
[Capacitor Network](https://capacitorjs.com/docs/apis/network).

## Krok 4.5 — nawigacja Androida i podgląd alarmu (2026-10-17)

- Android App Links obejmują wyłącznie HTTPS `rodzina.preficze.pl/zaproszenie/…`
  oraz `/reset-hasla/…`. Nasłuch `appUrlOpen` i `getLaunchUrl` przekazują
  zweryfikowaną ścieżkę do React Router. Zdarzenie otrzymane podczas startu
  ma pierwszeństwo przed starszym wynikiem `getLaunchUrl`.
- Lokalne alarmy otwierają istniejący adres wydarzenia z datą wystąpienia.
  Nie ufamy treści przekazanej przez intent: podgląd pochodzi z magazynu
  harmonogramu aplikacji, dostępnego dopiero po sprawdzeniu lokalnej sesji
  przez Android Keystore. Wylogowanie, zmiana konta i potwierdzone 401 nadal
  czyszczą magazyn. Nie wprowadzamy sesji ani pełnego kalendarza w localStorage.
- Przy zimnym starcie offline nie odtwarzamy uprawnień użytkownika z cache.
  Udostępniamy wyłącznie zapisany podgląd z ostrzeżeniem i możliwością ponowienia
  odczytu online. Po odpowiedzi 403/404 pokazujemy błąd dostępu/brak wydarzenia,
  bez zastępowania tej odpowiedzi starym podglądem.
- `/.well-known/assetlinks.json` jest publicznym endpointem Fastify. Nowa zmienna
  `RODZINA_ANDROID_SHA256_CERT_FINGERPRINTS` przyjmuje odciski certyfikatów APK,
  bez kluczy prywatnych. Pusta konfiguracja zwraca `[]`: nie deklarujemy
  zweryfikowanego powiązania z nieznanym certyfikatem. Produkcyjne skojarzenie
  wymaga osobnej aktualizacji serwera z faktycznym odciskiem podpisującego APK.
- Systemowe Wstecz najpierw kończy edycję pola, potem zamyka modal przez Escape,
  a następnie cofa historię React Router. Na ekranie głównym minimalizuje APK.
  Formularz wydarzenia pyta o odrzucenie zmian także przy zamknięciu modala
  i zmianie trasy. Android stosuje natywne insets pasków systemu/wycięcia/IME;
  nie naliczamy ich ponownie w CSS. Kopiowanie i udostępnianie w APK korzystają
  z własnego małego adaptera Androida, bez dodatkowych zależności serwera.

# 17.10.2026 — krok 4.6: podpisywanie i aktualizacje Androida

- Wersja APK pochodzi z `android/version.properties`; `versionCode` rośnie przy każdym
  wydaniu, `versionName` ma postać `major.minor.patch` z opcjonalnym sufiksem.
- Release podpisujemy lokalnym JKS poza repo, z hasłami w zmiennych procesu. CI buduje
  wyłącznie debug. Klucz produkcyjny tworzy właściciel i zachowuje zaszyfrowaną kopię;
  testowy klucz nie staje się automatycznie kluczem produkcyjnym.
- Publiczne pliki obsługuje Fastify z `RODZINA_ANDROID_DOWNLOAD_DIR`, oddzielnego
  trwałego katalogu. Bez zmiennej/wydania zwracamy 404 JSON, nigdy SPA. Brak nowego
  crona, migracji, zależności runtime ani zmian kontraktu sesji/harmonogramu.
- APK i metadane odczytuje osobny plugin OkHttp bez cookies, przekierowań i cache;
  HTTPS wyłącznie domeny produkcyjnej. Pobranie jest aktywną operacją, z limitem
  200 MiB, kontrolą miejsca, SHA-256 i zgodności nazwy pakietu/wersji.
  `FileProvider` udostępnia tylko katalog cache `updates/`. Instalator Androida
  sprawdza podpis i wymaga potwierdzenia. Powrót z instalatora nie oznacza sukcesu.
- Automatyczne sprawdzanie wersji ma limit jednej próby na 15 minut przy starcie,
  wznowieniu lub odzyskaniu sieci. Ręczne ponowienie omija limit. Błąd nie ingeruje
  w sesję ani alarmy. Po zabiciu procesu pobieranie trzeba ponowić; nie dodajemy
  aktualizacji w tle ani cichej instalacji.
- Przegląd ochrony: publiczne wydania bez danych rodziny, `allowBackup=false`, brak
  sekretów w ZIP/APK, ograniczenie FileProvider, brak URL/tokenów w logu requestów,
  no-store dla API i metadanych, CSP, nosniff, Referrer-Policy i ochrona osadzania.
  Inline style pozostają dozwolone dla Mantine/Schedule-X; skrypty tylko z domeny.

# 17.10.2026 — diagnostyka lokalnego podpisywania APK

- Po zgłoszeniu błędu Gradle przy działającym `keytool -list` dodano kontrolę JDK
  otwarcia magazynu, aliasu i odzyskania klucza przed budowaniem. Nie zakładamy,
  że sukces interaktywnego odczytu potwierdza hasła ze zmiennych procesu.
- Interaktywny launcher odczytuje hasła przez `Console.readPassword` tego samego
  JDK co keytool i przekazuje je jedynie w środowisku procesu budowania. Nie
  zapisuje plików haseł, nie podaje ich w argumentach polecenia ani logach.
- Release używa procesu Gradle bez współdzielonego daemona i bez configuration
  cache. To ograniczenie przechowywania sekretów, nie potwierdzona diagnoza
  wcześniejszego błędu właściciela. Klucz właściciela nie został zmieniony.

# 18.10.2026 — deploy ze starszego API bez pobierania Androida

- Run Actions `39152336060` zatrzymał się przed SSH na kontroli Androida: produkcja
  zwracała HTML SPA z HTTP 200 pod adresem metadanych. Przed aktualizacją dopuszczamy
  wyłącznie HTML identyczny ze stroną główną z elementem `root`, przy potwierdzonym
  przez preflight SSH braku konfiguracji katalogu APK. Nie ignorujemy błędnego JSON,
  błędów sieci ani nieprawidłowego opublikowanego wydania. Po aktualizacji brak APK
  musi zwracać 404; HTML nie zalicza kontroli. Nie zmieniamy konfiguracji hostingu.

# 18.10.2026 — izolacja instalacji zależności podczas deployu

- Run `39156883732` przeszedł build i wszystkie testy, ale zakończył się błędem
  `promotion-copy-dependencies`, `ENOENT`. Odczyt wrappera npm na vh.pl potwierdził,
  że `npm install` wymusza `--prefix` katalogu produkcyjnego nodevenv i zmienia
  dowiązania produkcji, mimo wskazania innego katalogu roboczego. Poprzednia próba
  mogła zmienić zależności produkcji przed backupem; sam brak podmiany kodu nie
  oznacza braku zmian w zależnościach.
- Zdalny helper ustala rzeczywisty Node przez `process.execPath`, rozwiązuje jego
  sąsiedni npm do CLI JavaScript i wywołuje go bez wrappera cPanel, z jawnym
  `--prefix` katalogu tymczasowego i pustym `NODE_PATH`. Nie hardkodujemy ścieżki
  `/opt/alt`, nie zmieniamy środowiska produkcji ani konfiguracji hostingu.
- Przed pobraniem binarki sprawdzamy lokalne położenie zależności. Brak katalogu
  `node_modules`, dowiązanie zamiast katalogu albo rozwiązywanie modułów spoza
  przygotowanej paczki przerywa wdrożenie przed backupem i kopiowaniem.
- Katalog roboczy zwany stagingiem znajduje się na tym samym serwerze produkcyjnym;
  nie jest dodatkowym środowiskiem. Testy lokalne obejmują izolowaną instalację,
  brak katalogu i dowiązanie do produkcyjnych zależności. Potwierdzenie poprawki
  na produkcji wymaga kolejnego ręcznego uruchomienia workflow przez właściciela.

# 18.10.2026 — nowe APK przy każdym Deploy

- Na wyraźne polecenie właściciela rozszerzamy krok 4.7: każde ręczne uruchomienie
  Deploy z main buduje, podpisuje i publikuje APK razem z aktualizacją API/PWA.
  Zastępuje to wcześniejszą granicę „workflow tylko zachowuje APK”. Nie wymaga
  ręcznego pierwszego uploadu; konfiguracja klucza w Actions pozostaje jednorazowa.
- Korzystamy z istniejącego keystore i dwóch haseł zapisanych jako sekrety Actions,
  aliasu i zatwierdzonego publicznego odcisku certyfikatu jako zmiennych. Nie zmieniamy
  klucza właściciela. Tymczasowy magazyn jest poza checkoutem i jest sprzątany także
  po błędzie. Certyfikat sprawdzamy przed SSH i względem poprzedniej publikacji.
- Kod wersji to max(kod bazowy z repo + 1, kod opublikowany + 1); wersja widoczna
  ma przyrostek deploy z kodem. Numer jest ustawiany wyłącznie podczas budowania
  na runnerze. Grupa rodzina-production serializuje odczyt wersji, build i publikację.
- Sprawdzony ZIP PWA pozostaje niezmieniony; build Androida ma osobny dist-android.
  APK przesyłamy do prywatnego stagingu i weryfikujemy przed backupem/podmianą kodu.
  Po udanych kontrolach API kopiujemy APK do trwałego katalogu i dopiero wtedy
  atomowo zatwierdzamy latest.json. Poprzednie APK pozostają pod niezmiennymi URL.
- Przy pierwszym wydaniu tworzymy katalog obok aplikacji i atomowo ustawiamy
  istniejącą zmienną RODZINA_ANDROID_DOWNLOAD_DIR w .env, jeśli brakowała/była pusta.
  Zachowujemy pozostałą konfigurację i uprawnienia, nie dodajemy cronów, migracji
  ani zależności runtime. Istniejąca ścieżka jest zachowana i walidowana.
- Automatyzacja nie zastępuje fizycznego testu aktualizacji i alarmów. Hasła klucza
  nie są znane agentowi; pierwsze produkcyjne wykonanie wymaga ich konfiguracji
  w Actions przez właściciela. Nie deklarujemy publikacji ani testu telefonu bez
  ich wykonania. Instalację aktualizacji nadal zatwierdza użytkownik Androida.

# 17.10.2026 — krok 4.7: ręczny deploy istniejącego serwera

- Wzorzec przeczytano z lokalnego repozytorium `../portfel`: workflow deploy.yml
  i scripts/deploy.sh. Zachowujemy SSH z weryfikacją hosta, ochronę plików serwera,
  restart Passengera i sprawdzenia HTTP. Rodzina używa wyłącznie workflow_dispatch,
  Node 24 i wieloplatformowego launchera `.mjs`, bez automatycznego deployu po pushu.
- Zdalny helper `.mjs` trafia przez stdin SSH do Node hostingu; nie staje się
  endpointem ani częścią publicznej paczki. ZIP jest walidowany lokalnie,
  zamrożony przed transferem i porównywany SHA-256 na serwerze. Workflow zapisuje
  SHA checkoutu i sumę ZIP-a w podsumowaniu; nie odbudowuje sprawdzonej paczki.
- Zależności przygotowujemy w stagingu z wyłączonymi skryptami npm. Istniejący
  better-sqlite3 pobiera wyłącznie gotową binarkę przez prebuild-install;
  brak binarki jest błędem, bez kompilacji node-gyp na hostingu. Nie dodajemy
  zależności runtime, migracji ani cronów.
- Kopiujemy wyłącznie zarządzane drzewa i przygotowane zależności, zachowując
  symlink node_modules cPanel oraz stare assety. Podmiana nie jest atomowa;
  dokumentujemy możliwą przerwę i ręczne odzyskiwanie. Osobna blokada serwera
  chroni przed równoczesnym lokalnym uruchomieniem poza Actions.
- Dotychczasowy job robi backup przed podmianą. Poprzednie pliki aplikacji oraz
  nowy ZIP są zachowane w prywatnej historii obok aplikacji. Nie cofamy bazy
  automatycznie. Przywrócenie kodu wymaga oceny migracji i odtworzenia zależności.
- Opublikowany Android jest kontrolowany przed i po aktualizacji (metadane i SHA-256
  pobranego APK). Workflow nie publikuje APK, nie zmienia klucza i nie aktualizuje
  telefonu. Brak kontrolowanej próby na vh.pl i testów sprzętowych nie jest
  traktowany jako pełne zaliczenie kryteriów fazy.

## 19.10.2026 — stan alarmów po zgłoszeniu z OPPO

- Właściciel zgłosił na OPPO Reno 5Z, Android 13, APK `1.0.0-deploy.2` brak
  przypomnienia offline po usunięciu aplikacji z listy ostatnich. Obie zgody były
  dozwolone, ekran pokazywał `1 z 1`, ale także niepełne zabezpieczenie i baner.
  Powiadomienie pojawiło się po otwarciu aplikacji i połączeniu z internetem.
  To obserwacja użytkownika, bez logów systemowego alarmu i bez potwierdzenia,
  czy spóźnione powiadomienie pochodziło z APK, czy z osobnej PWA.
- Kod Androida pluginu `@capacitor/local-notifications` 8.3.1 potwierdza,
  że `getPending()` zwraca również zachowane rekordy wcześniejszych powiadomień.
  Zastępujemy ten odczyt `getAll({ state: 'SCHEDULED' })` przy uzgadnianiu,
  sprawdzaniu i anulowaniu przyszłych alarmów. Stare powiadomienia nie mogą
  powodować fałszywego ostrzeżenia przy `0 z 0` ani `1 z 1`. Regresja odtwarza
  oba przypadki przed poprawką; nie zmieniamy algorytmu czasu ani transportu API.
- Stan zawiera konkretne przyczyny niepełnego zabezpieczenia, najbliższy zapisany
  termin oraz błąd planowania zamiast samej flagi. Baner podaje przyczynę,
  a przyznane zgody mają potwierdzenie na nieaktywnych przyciskach.
- Natywny mostek odczytuje `ActivityManager.isBackgroundRestricted()` i producenta
  urządzenia. Zgłoszone ograniczenie tła wyklucza komunikat pełnego zabezpieczenia,
  także przy zgodach i wszystkich zapisanych wpisach. Przycisk otwiera standardowe
  ustawienia własnej aplikacji; nie zmienia ustawień bez użytkownika i nie dodaje
  uprawnień. Brak zgłoszonej blokady nie wyklucza dodatkowych ograniczeń OPPO.
- OPPO dla ColorOS 12–13 wskazuje automatyczne uruchamianie w Ustawienia →
  Aplikacje → Automatyczne uruchamianie. To trop diagnostyczny, a nie potwierdzona
  przyczyna zgłoszenia: [instrukcja producenta](https://support.oppo.com/co/answer/?aid=neu119).
  Znaczenie systemowego ograniczenia opisuje [Android ActivityManager](<https://developer.android.com/reference/android/app/ActivityManager#isBackgroundRestricted()>).
- Licznik nadal potwierdza wpisy w magazynie pluginu, nie rzeczywiste dostarczenie
  przez system. Poprawienie statusu nie zalicza testu offline. Wymagany jest nowy
  test na telefonie po publikacji i instalacji poprawionego APK. Brak nowych
  zmiennych API, migracji, cronów, uprawnień i zależności runtime serwera.

## 19.10.2026 — systemowe alarmy kalendarza po próbie APK deploy.3

- Właściciel potwierdził włączone automatyczne uruchamianie OPPO i ponowił próbę
  na APK `1.0.0-deploy.3`: powiadomienie pojawiło się po otwarciu aplikacji także
  bez internetu. To wyklucza konieczność sieci dla zaobserwowanego opóźnionego
  wyświetlenia, ale nie dowodzi konkretnej przyczyny blokady systemowej.
- Zmieniamy rejestrację świadomie ustawionych, dokładnych przypomnień kalendarza
  na `AlarmManager.setAlarmClock`. Zachowujemy ten sam `PendingIntent` odbiornika
  pluginu i treść powiadomienia. Rejestracja zastępuje wcześniejszy alarm tego
  samego identyfikatora; anulowanie pluginem usuwa także nowy alarm. Nie dodajemy
  procesu w tle, FCM ani timerów JavaScript. Android może pokazywać ikonę budzika
  i najbliższy termin — to jawny skutek funkcji przypomnień, opisany w UI.
- Trwałe potwierdzenie rejestracji zawiera tylko ID i SHA-256 fingerprintu, bez nowej kopii
  treści wydarzenia. Zgodność zapisu pluginu nie wystarcza do sukcesu: wymagamy
  także udanej rejestracji natywnej. Błąd pozostawia brakujący alarm w statusie,
  a ponowienie odtwarza brakujący token i rejestruje alarm ponownie. Ten zapis
  nadal nie jest potwierdzeniem dostarczenia przez system.
- Rodzina samodzielnie odtwarza przyszłe alarmy po restarcie/odblokowaniu,
  aktualizacji APK, zmianie czasu i przyznaniu zgody na dokładne alarmy. Zastępuje
  odbiornik odtwarzania pluginu, żeby równoległy odbiornik nie zmieniał ponownie
  trybu planowania. Start natywnej aktywności uzgadnia zapis bez żądania do API.
  Wylogowanie usuwa potwierdzenia razem z alarmami i danymi konta.
- Dokumentacja Androida określa `setAlarmClock` jako mechanizm dla jawnych,
  wrażliwych na czas alarmów użytkownika, z wybudzeniem z Doze i wymaganiem
  obecnej już zgody `SCHEDULE_EXACT_ALARM`:
  [AlarmManager](<https://developer.android.com/reference/android/app/AlarmManager#setAlarmClock(android.app.AlarmManager.AlarmClockInfo,%20android.app.PendingIntent)>).
  Nie deklarujemy obejścia wymuszonego zatrzymania ani wszystkich blokad OPPO.
  Wybór mechanizmu jest poprawką implementacji, a nie potwierdzoną diagnozą
  opóźnienia na fizycznym urządzeniu. Wymagany pozostaje test nowego APK.
