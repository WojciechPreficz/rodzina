# Praca lokalna — strona WWW i APK

Zakres kontroli lokalnych i CI określa [plan, sekcja 1.2](plan.md).
Zachowane poniżej instrukcje nie oznaczają zaliczenia niewykonanych prób.
Historia kroków, wyniki testów, diagnostyka i otwarte próby są w
[archiwum pracy lokalnej](archive/development-historia.md).
[Raport](DOKUMENTACJA_RAPORT.md) wskazuje sprzeczne zapisy bez zmiany ich treści.

## Uruchomienie i konfiguracja

Wymagane: Node.js 22 lub 24 i npm. Wykonaj `npm ci`, skopiuj
`apps/api/.env.example` do `apps/api/.env` i uruchom `npm run dev`.
Strona jest pod `http://localhost:5173`, API pod 3000. Wariant produkcyjny:
`npm run build` i `npm start`, razem na 3000. Nie uruchamiaj obu trybów naraz.
`RODZINA_PUBLIC_URL` musi wskazywać port używanego interfejsu, żeby linki
zaproszeń/resetu prowadziły do tej samej aplikacji. Po zmianie shared uruchom dev ponownie.

Nie potrzeba VAPID. Nie ma `dev:cron`, `job:reminders` ani `vapid:generate`.
Backup po buildzie: `npm run job:backup`. Domyślny katalog i 14 kopii opisuje
`apps/api/.env.example`. Nie używaj lokalnej bazy jako danych produkcyjnych.

## Odbiór przeterminowanych zmian zadań — punkt 2 przeglądu architektury

Implementacja zweryfikowana lokalnie: 79 testów Vitest, 4 scenariusze Playwright
headless (390 i 1280 px, WWW i symulowany transport Androida), lint, formatowanie,
typecheck i build. Właściciel zlecił commit i push po implementacji.
Końcowe CI oraz ręczny odbiór desktopu i fizycznego APK pozostają do potwierdzenia.

Dziennik zachowuje identyfikator, datę i dane operacji. Wpisy starsze niż 30 dni
otrzymują trwały stan `needs-review` z przyczyną; późniejsze zmiany tego samego
zadania są wstrzymane zależnością. Starszy format dziennika nadal działa.
Zmiany wymagające sprawdzenia nie są nakładane na dane serwera. Pozostałe
zadania synchronizują się, a błąd kolejki nie zatrzymuje pobrania potwierdzonych danych.

Próba desktopowa (Chrome, lokalne konto testowe, `npm run dev`):

1. Otwórz `http://localhost:5173`, zaloguj się i wejdź w wybraną listę Zadań.
   Dodaj dwa zadania: „Stare” i „Świeże”. Poczekaj na wysłanie zmian.
2. W DevTools → Network zaznacz **Offline**. Edytuj tytuł „Stare” na
   „Stary lokalny tytuł” i zapisz. Następnie zaznacz to zadanie jako zrobione.
3. W konsoli DevTools wykonaj poniższy kod. Zmienia on datę najstarszej
   oczekującej operacji na 31 dni wstecz, wyłącznie w lokalnym magazynie testowej strony.
   Nie zmieniaj czasu systemowego i nie wykonuj próby na danych produkcyjnych.

   ```js
   const entries = Object.keys(localStorage)
     .filter((key) => key.startsWith('rodzina:tasks:v1:operation:'))
     .map((key) => ({ key, op: JSON.parse(localStorage.getItem(key)) }))
     .sort((a, b) => a.op.submittedAt - b.op.submittedAt);
   if (!entries.length) throw new Error('Najpierw zapisz zmianę offline.');
   const oldest = entries[0];
   oldest.op.submittedAt = Date.now() - 31 * 86400000;
   localStorage.setItem(oldest.key, JSON.stringify(oldest.op));
   window.dispatchEvent(new StorageEvent('storage', { key: oldest.key }));
   ```

4. Tytuł zadania wraca do potwierdzonego „Stare”; dwa lokalne zapisy trafiają
   do „Zmian wymagających sprawdzenia”. Kliknij „Sprawdź zmiany”: widać dane,
   daty oraz przyczynę przeterminowania i zależności. Edytuj osobne zadanie „Świeże”.
5. Wyłącz **Offline**. Świeża zmiana trafia na serwer, stare dwie pozostają
   do sprawdzenia. Otwórz drugą kartę z tą samą listą: widzi ten sam łańcuch.
   Odśwież pierwszą kartę — łańcuch nadal jest dostępny, bez zmiany identyfikatorów.
6. Kliknij „Odrzuć łańcuch”, a potem „Zamknij”: nic nie jest usunięte.
   Otwórz panel ponownie i potwierdź odrzucenie. Znikają oba lokalne zapisy,
   także w drugiej karcie; potwierdzone zadanie pozostaje. Odrzucenie działa
   również offline, ale nowe zapisy na tej liście wymagają najpierw udanego odczytu online.
7. Po odświeżeniu online wprowadź potrzebną zmianę zwykłym formularzem i zapisz.
   Jest to nowa, świadoma operacja; panel nie ma automatycznego ponawiania starej.
8. Powtórz przy szerokościach 1280 i 390 px. Sprawdź brak poziomego przewijania,
   czytelność szczegółów oraz obsługę panelu klawiaturą (Tab, Enter, Escape).
   Wylogowanie usuwa dziennik, decyzje odrzucenia i dostęp do podglądu.

Odrzucenie zapisuje jeden atomowy znacznik całego obejrzanego łańcucha w tym samym
magazynie konta. Sprzątanie oryginalnych wpisów nie jest warunkiem jego skuteczności;
znacznik zapobiega ich odtworzeniu po restarcie lub w drugiej karcie. Błąd zapisu
znacznika pozostawia łańcuch i pokazuje komunikat. Nowe lub zmienione dane w panelu
wymagają ponownego obejrzenia przed odrzuceniem.

- [ ] Desktop 1280 i 390 px: powyższa próba ręczna.
- [ ] Fizyczne APK: podgląd i odrzucenie łańcucha, powrót sieci i zmiana konta.
- [ ] Fizyczne APK: przeterminowana zmiana terminu lub usunięcie nadal wstrzymują
      alarm po zamknięciu aplikacji i ponownym uruchomieniu offline. Niezależny alarm
      pozostaje aktywny. Po rozstrzygnięciu i synchronizacji harmonogram jest odświeżony.
- [ ] CI dla przyszłego końcowego commita. Test transportu Androida i mocki alarmów
      nie zastępują odbioru fizycznego APK.

## Odbiór Kontaktów online — krok 9.2

Zmiany są lokalnie na `main`; commit pozostaje bez pusha zgodnie z poleceniem
właściciela. Krok oczekuje na końcowe CI oraz poniższe próby ręczne;
test transportu Androida w Playwright nie zalicza fizycznego APK.

- [ ] Przy 390 i 1280 px otwórz Kontakty przez menu. „Dodaj grupę” jest
      w nagłówku, a „Dodaj kontakt” na całą szerokość karty. Nie ma pola
      szybkiego dodawania samej nazwy ani przycisku pod listą grup.
- [ ] Dodaj grupę oraz kontakt przez pełny formularz: nazwa, opis relacji,
      numer z separatorami i długi adres z polskimi znakami w kilku wierszach.
      Zapisz również kontakt z samą nazwą, bez opcjonalnych danych.
- [ ] Edytuj kontakt, zmień jego grupę, zmień nazwę grupy. Sprawdź wyszukiwanie
      bez polskich znaków i separatorów telefonu, sortowanie oraz liczniki.
- [ ] Usuń grupę po potwierdzeniu: kontakty pozostają w grupie domyślnej.
      Grupa domyślna może zmienić nazwę, ale nie ma opcji usunięcia.
      Usuń pojedynczy kontakt z osobnym potwierdzeniem.
- [ ] Sprawdź klawiaturę (Tab, Enter, Escape), widoczny fokus oraz brak
      poziomego przepełnienia strony. Na telefonie multiselect zastępuje listę
      grup: wybierz kilka, wyszukaj grupę i wyczyść wybór. Pusty wybór pokazuje
      wszystkie kontakty; liczniki grup nie zależą od wyszukiwania kontaktów.
      Sprawdź długą nazwę grupy oraz dopasowanie wysokości pola z etykietami.
- [ ] Zmień formularz i odrzuć porzucenie zmian przy Anuluj, Escape oraz Wstecz.
      Zapisanie formularza nie wyświetla pytania o porzucenie. Dziecko widzi
      szczegóły, bez akcji dodawania, edycji i usuwania.
- [ ] W otwartym widoku odłącz internet: mutacje są niedostępne. Bez wcześniej
      pobranych danych w pamięci pojawia się komunikat o potrzebie połączenia.
      Krok 9.3 dodaje trwały podgląd opisany poniżej, bez kolejki zmian.
- [ ] W debug APK z lokalnym frontendem powtórz dodanie grupy i kontaktu,
      edycję, wyszukiwanie, usunięcie grupy oraz ochronę formularza i Wstecz.
      Numer powinien otwierać systemową aplikację telefonu bez automatycznego
      połączenia; kliknięcie numeru nie otwiera szczegółów kontaktu.

Uruchomienie WWW: `npm run dev`, następnie `/kontakty`. Migracja 0023 API
musi być zastosowana według instrukcji migracji projektu. Do testów APK
użyj lokalnego API i poleceń z sekcji „Narzędzia i komendy” poniżej;
build z domyślną konfiguracją API wskazuje produkcję, której ten krok nie wdraża.
Bez nowej konfiguracji, zależności runtime ani crona.

## Odbiór Kontaktów offline — krok 9.3

Implementacja lokalna; końcowe CI oraz próby fizycznego APK pozostają do
potwierdzenia. Headless Playwright sprawdza WWW i atrapę transportu Androida
przy 390 i 1280 px. Atrapa nie zalicza restartu prawdziwego APK ani obsługi
systemowej aplikacji telefonu.

Weryfikacja lokalna 26.10.2026: Vitest Kontaktów, magazynów konta i sesji,
typecheck, lint i formatowanie przeszły; build WWW/API oraz debug APK udane.
Playwright: 10 zaliczonych scenariuszy, dwa pominięcia testów mobilnych na
desktopie. Przejrzano zrzuty offline przy obu szerokościach. Brak podłączonego
telefonu w ADB; poniższe próby ręczne pozostają otwarte. Właściciel zlecił
commit i push; status: **zweryfikowane lokalnie, oczekuje na CI**.

- [ ] Pobierz Kontakty online, dodaj grupę i kontakt, edytuj oraz usuń grupę.
      Po każdej mutacji snapshot obejmuje pełną listę grup i kontaktów.
- [ ] Przy 390 i 1280 px odłącz sieć w otwartym widoku. Sprawdź czas pobrania
      i ostrzeżenie o nieaktualności, liczniki, wybór grup, wyszukiwanie po
      polskich znakach, adresie i telefonie oraz szczegóły. Mutacje są wyłączone.
- [ ] W fizycznym APK zamknij aplikację po pobraniu danych i uruchom ją ponownie
      bez Wi-Fi i transmisji danych. Powtórz wyszukiwanie i wybór grup; sprawdź
      polskie znaki, długi wielowierszowy adres i brak poziomego przepełnienia.
- [ ] W fizycznym APK wybierz numer: otwiera systemową aplikację telefonu,
      bez automatycznego połączenia i bez otwierania szczegółów kontaktu.
- [ ] Bez wcześniejszego pobrania sprawdź komunikat o braku zapisanych kontaktów.
      Uszkodzony magazyn oraz odmowa zapisu mają widoczne komunikaty. Błąd API
      i niekompletna odpowiedź nie zastępują poprawnego snapshotu.
- [ ] Zmień kontakt na drugim urządzeniu i odzyskaj sieć na pierwszym: cały
      snapshot odświeża się, a mutacje stają się dostępne po potwierdzeniu sesji.
- [ ] Sprawdź wylogowanie offline, utratę sesji i przełączenie konta: kontakty
      poprzedniej osoby znikają. Druga karta odbiera zmianę snapshotu tego samego
      konta; zmiana konta lub wylogowanie w innej karcie odcina poprzednią sesję
      bez usuwania nowych danych tej karty.

Nie dodano migracji, zależności runtime, konfiguracji ani crona; backend i kontrakt
API są zgodne z poprzednią wersją APK. Paczkę serwera sprawdza istniejący
`release:smoke` w CI. WWW obsługuje utratę sieci w otwartym interfejsie, APK
również ponowny start bez sieci; nie ma PWA ani pobierania przy zamkniętym APK.

## Kontrole wydania

```sh
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run release:smoke
npm run android:debug
```

Pierwsza konfiguracja Playwright: `npx playwright install chromium`.
Testy działają wyłącznie headless (390 i 1280 px), z tymczasową bazą na porcie 3417. Port musi być wolny; `apps/api/.env` i dane lokalnej rodziny nie są używane.
Regresja obejmuje logowanie dorosłego i dziecka, sesję, kalendarz/deep link,
zaproszenie/reset, stronę pobierania APK z wydaniem i bez niego oraz aktualizator.
Atrapa mostka sprawdza UI i synchronizację, a nie działanie systemu Androida.

Android wymaga JDK 21, SDK 36 i Gradle Wrapper 8.14.3. Skrypty wykrywają lokalne
narzędzia w `.android-tools`; w innym środowisku ustaw `JAVA_HOME`,
`ANDROID_HOME` i opcjonalnie `GRADLE_USER_HOME`. Po buildzie, w katalogu `android/`:

```powershell
./gradlew.bat testDebugUnitTest lintDebug
```

Linux/macOS: `./gradlew testDebugUnitTest lintDebug`. Testy JVM i Android Lint
nie wymagają telefonu; `connectedDebugAndroidTest` wymaga urządzenia/emulatora
i nie zastępuje prób odbioru alarmu na fizycznym telefonie.
Wynik debug: `android/app/build/outputs/apk/debug/app-debug.apk`, lokalny
frontend w `assets/public/index.html`, bez manifestu PWA, Workbox i `sw.js`.
Podpisywanie release, backup klucza i metadane opisuje DEPLOY.
Debug nie aktualizuje instalacji podpisanej kluczem release.

## Powrót ze starej PWA

Build strony zawiera przejściowy `/sw.js`: przejmuje dawną rejestrację,
anuluje subskrypcję, usuwa wyłącznie precache Workbox Rodziny i wyrejestrowuje się.
Nie ma obsługi fetch ani push. Nowy frontend również sprząta stare rejestracje;
nowa wizyta nie rejestruje workera. Sesja, localStorage i inne cache pozostają.
Manifest zwraca 410 także wtedy, gdy stary plik pozostał na dysku.
Nie usuwamy przejściowego SW w kolejnych wydaniach: użytkownik może wrócić
po dłuższej przerwie. Starą ikonę PWA usuwa ręcznie; nie czyść danych witryny.

Test `e2e/retire-pwa.spec.ts` instaluje stary SW w odrębnym kontekście,
zapisuje stary interfejs w cache, zamyka kartę i otwiera ją ponownie.
Najpierw dowodzi wyświetlenia starego interfejsu, potem jawnie wywołuje cykl
aktualizacji SW bez uruchamiania nowego Reacta. Po przejęciu i ponownym wejściu
sprawdza nową stronę, sesję, kalendarz, brak rejestracji i zachowane inne dane.
To lokalny odpowiednik aktualizacji serwera; nie jest próbą wdrożonej domeny.

## Próby po kroku 4.10 — fizyczny telefon i produkcja

Właściciel potwierdził 19.10.2026, że wykona próby telefonu po kroku 4.10.
Nie wykonano ich w ramach lokalnej regresji i nie uznajemy ich za zaliczone.
Użyj dwóch podpisanych wydań, tego samego pakietu i klucza, bez czyszczenia danych.

1. Zapisz model, wersję Androida, wersje APK przed/po aktualizacji i datę próby.
   Sprawdź logowanie dorosłego i dziecka, zapis kalendarza oraz zachowanie sesji
   po zakończeniu procesu. Sprawdź link zaproszenia/resetu w APK i bez APK.
2. Pobierz podpisane APK ze strony, a potem zaktualizuj starsze wydanie z APK.
   Sprawdź wykrycie, zgodę na instalację, anulowanie, ponowienie i zatwierdzenie,
   nowy numer wersji, zachowaną sesję i wcześniej zapisany harmonogram.
3. Udziel zgód na powiadomienia i dokładne alarmy. Dodaj alarm co najmniej
   10 minut w przyszłości, zsynchronizuj online i zapisz termin UTC/lokalny,
   liczbę alarmów oraz zakres zabezpieczenia offline. Wyłącz Wi-Fi i transmisję
   komórkową, zamknij interfejs przez ostatnie aplikacje i zablokuj ekran.
   Nie otwieraj APK przed oceną wyniku. Zapisz faktyczny odbiór i opóźnienie
   (dla pojedynczego alarmu wymagane ≤60 s).
4. Powtórz z nowym terminem po restarcie nadal offline i pierwszym odblokowaniu,
   bez otwierania APK. Powiadomienie ma otworzyć właściwe wystąpienie i zapisany
   podgląd; aktualne dane wymagają sieci. Sprawdź również zmianę strefy telefonu.
5. Wróć online. Z drugiego urządzenia zmień/anuluj wystąpienie i podziel serię;
   po synchronizacji nie może być starych ani podwójnych alarmów. Sprawdź
   wylogowanie offline i zmianę konta, które czyszczą alarmy oraz dane poprzedniej osoby.
   Zamknięte APK nie synchronizuje zdalnych zmian w tle.
6. Po zleconym wdrożeniu wykonaj kontrolę ze starej PWA zgodnie z DEPLOY:
   powrót online, aktualizacja workera, zamknięcie/ponowne otwarcie, sesja,
   kalendarz, brak starego precache i manifest 410. Zapisz commit wdrożenia.

Historyczny scenariusz z 18.10.2026 o 15:00 pozostaje niepotwierdzony.
Nowej próbie przypisz rzeczywistą datę; nie zaliczaj wstecz starego terminu.
Zgłoszenie OPPO dla `1.0.0-deploy.3` pozostaje otwarte do potwierdzenia
odbioru na aktualnym mechanizmie alarmów. Rejestracja systemowa, mocki i JVM
nie dowodzą wyświetlenia na telefonie. Wymuszone zatrzymanie, wyłączenie telefonu,
brak zgód i ograniczenia producenta ograniczają alarmy; pełnego kalendarza offline nie ma.

## Lokalne budowanie i uruchamianie APK

### Odbiór dokumentów — krok 8.4

Próby właściciela pozostają **do wykonania**. Testy automatyczne i build APK
nie potwierdzają odbioru alarmu na fizycznym telefonie.

1. Na WWW przy 390 i 1280 px oraz w APK sprawdź dokument każdego typu,
   statusy i filtry. Otwórz szczegóły przez nazwę dokumentu. Plakietka przy
   „Dokumentach” liczy wszystkie wygasające i wygasłe dokumenty, niezależnie od filtra.
2. Użyj „Odnowiono”, podaj nową datę. Sprawdź listę, szczegóły, plakietkę,
   przeliczone offsety i nieaktywne minione przypomnienia z konkretną datą.
   Dodaj i usuń „Moje przypomnienia”; drugie konto nie może ich widzieć ani usuwać.
   Dziecko nie edytuje dokumentów, ale zarządza własnymi przypomnieniami.
3. Na fizycznym Androidzie dodaj dokument z terminem za 31 dni i przypomnieniem
   30 dni przed. Udziel zgód, zsynchronizuj online. Sprawdź termin następnego
   dnia o 09:00 Europe/Warsaw i zapisz odpowiadający mu czas UTC.
4. Odłącz sieć, zamknij interfejs i zablokuj ekran. Bez wcześniejszego otwierania
   APK sprawdź alarm o 09:00. Kliknięcie ma otworzyć podgląd właściwego dokumentu
   z zapisaną datą ważności i ostrzeżeniem o nieaktualności; online aktualne szczegóły.
   Powtórz z kolejnym alarmem po restarcie i pierwszym odblokowaniu, nadal offline.
5. Zapisz model telefonu, Android, wersję APK, datę synchronizacji, planowany
   i rzeczywisty odbiór, opóźnienie oraz wynik kliknięcia dla obu prób.
   Z drugiego urządzenia odnów/usuń dokument; po synchronizacji APK sprawdź,
   że stary alarm jest zastąpiony/anulowany. Wylogowanie usuwa dostęp do podglądu.

Nie używamy joba Web Push ani `--now`. Rzeczywisty czas telefonu jest wymagany
do odbioru fazy; wstrzyknięty czas w testach API sprawdza tylko obliczenia.

### Odbiór pamięci offline — O.2 (#50)

Implementacja obejmuje tylko rodzinę/sesję i kalendarz. Zakupy, zadania
i kontakty nadal korzystają ze swoich magazynów. Baza `rodzina-offline`
ma wersję 1; podglądy znajdują się w `cache`, a postęp importu w `migration`.
WWW i APK mają oddzielną pamięć urządzenia.

1. Uruchom `npm run dev`, zaloguj się i poczekaj na pobranie rodziny
   i kalendarza. Sprawdź domowników, kod dołączenia, miesiąc oraz szczegóły
   wydarzenia i własne przypomnienia. Powtórz przy 390 i 1280 px.
2. Przy aktualizacji ze starego magazynu WWW zamknij wszystkie okna aplikacji
   i procesy przeglądarki. Uruchom nową stronę bez przywracania starych kart.
   Dopiero wtedy użyj „Potwierdzam zamknięcie starych kart — przenieś dane”.
   Nie otwieraj starszej wersji podczas importu. Brak odpowiedzi starej karty
   nie potwierdza jej zamknięcia. APK aktualizuj po zatrzymaniu starego procesu;
   przy istniejących danych również potwierdź przeniesienie w aplikacji.
3. Po imporcie sprawdź w DevTools → Application → IndexedDB dane rodziny
   i kalendarza. Klucze localStorage `rodzina:offline-data:v1`
   i `rodzina:calendar:v1` mają zniknąć. Magazyny zakupów, zadań i kontaktów
   mają pozostać. Nie usuwaj ręcznie danych urządzenia z niewysłanymi zmianami.
4. W otwartej stronie włącz Offline w DevTools. Rodzina pokazuje domowników
   i ostatni kod; kalendarz zapisane zakresy i szczegóły. Oba podglądy są tylko
   do odczytu. Niepobrany zakres nie jest przedstawiany jako pusty.
   Przywróć sieć i sprawdź nowe dane zmienione na drugim urządzeniu.
5. W fizycznym APK pobierz dane online, przejdź w tryb samolotowy, zamknij
   proces i uruchom ponownie. Sprawdź rodzinę, kod, kalendarz i szczegóły,
   także po aktualizacji ze starszego APK. Zapisz model telefonu, Android,
   wersję APK i wynik. Ta próba pozostaje **do wykonania**; transport Androida
   symulowany przez Playwright i build debug nie zastępują telefonu.
6. Wyloguj się offline i sprawdź brak podglądu po ponownym uruchomieniu.
   Przy zmianie konta w drugiej karcie pierwsza ma ukryć dane bez usuwania
   nowej sesji. Błąd usuwania pozostawia `offline-clear-pending:1`, który
   blokuje odtworzenie do skutecznego czyszczenia.
7. Na testowym profilu sprawdź odmowę IndexedDB i brak miejsca: komunikat
   ma wyjaśnić problem, a aplikacja nie tworzy zastępczego zapisu localStorage.
   Import przerwany przed weryfikacją zachowuje źródło; po ponowieniu kończy
   zapis lub sprzątanie. Nie wracaj do starego APK po nowych zapisach IDB.

Automatyczne scenariusze: `apps/web/src/offline/database.test.ts`, testy
rodziny/kalendarza/auth i `e2e/offline-migration.spec.ts`. Playwright działa
headless w obu szerokościach. Końcowe CI oraz powyższe próby fizycznego APK
są wymagane do zamknięcia kroku.

### Odbiór pamięci zakupów — O.3 (#51)

Zakupy korzystają z rekordu `shopping` w `cache` bazy `rodzina-offline` v1.
Rekord zawiera bazę Query, `operations`, `nextSequence` i sesję offline.
Dziennik pozostaje obsługiwany przez TanStack; wspólny outbox powstanie w O.5.
Starszy opis O.2 powyżej dokumentuje zakres tamtego kroku.

1. Uruchom `npm run dev`. Na WWW przy **390 i 1280 px** sprawdź dodawanie
   produktu z ilością, odhaczanie, edycję, usuwanie, czyszczenie kupionych oraz
   tworzenie i zmianę nazwy listy. Dziecko zachowuje dotychczasowe uprawnienia.
2. W otwartym interfejsie wyłącz internet. Dodaj listę i kilka produktów,
   odhacz produkt i popraw ilość. Formularz zamyka się po trwałym zapisie,
   a następna akcja nie czeka na sieć. Otwórz drugą zgodną kartę przed
   odłączeniem i wykonaj różne zmiany w obu: żadna nie może nadpisać dziennika
   drugiej. Po powrocie sieci wszystkie zmiany docierają dokładnie raz.
3. W **fizycznym APK z tymi zmianami** pobierz listy online. Włącz tryb
   samolotowy, wykonaj powyższe zmiany, zamknij proces aplikacji i uruchom
   ponownie nadal offline. Lista, ilości, odhaczenia i nowa lista pozostają.
   Przywróć sieć: sprawdź wynik także na innym urządzeniu, bez duplikatów.
   Zapisz model telefonu, Android, wersję APK i wynik. Build debug i symulacja
   transportu w Playwright nie zaliczają tej próby.
4. Przy aktualizacji ze starego localStorage zastosuj procedurę zamknięcia
   instancji z O.2 i potwierdź przeniesienie. Dotyczy także pominięcia O.2.
   Sprawdź lokalnie utworzone listy/produkty i kolejność zmian. W DevTools
   klucze `rodzina:shopping:v1` i `rodzina:shopping:v1:operation:*` znikają
   po weryfikacji; zadania i kontakty zachowują swoje magazyny. Przerwany
   import ma się wznowić bez utraty lub powielenia intencji. Nie czyść pamięci
   urządzenia z niewysłanymi zmianami i nie wracaj do starego APK po zapisach IDB.
5. Na testowym profilu odmów dostępu do IDB albo zasymuluj brak miejsca.
   Sprawdź polski komunikat; niezapisany produkt nie pojawia się jako przyjęty,
   a tekst formularza pozostaje. Nie powstaje zastępczy dziennik localStorage.
   Uszkodzony lub sprzeczny dziennik blokuje import i zachowuje źródło;
   niejednoznaczne/stare operacje pozostają do sprawdzenia bez automatycznej wysyłki.
6. Wyloguj się z niewysłanymi zmianami i uruchom ponownie: stare dane znikają.
   Zmień konto w drugiej karcie podczas wysyłki: pierwsza ukrywa podgląd,
   późna odpowiedź nie przywraca poprzedniego konta ani nie usuwa nowego.

Automatycznie sprawdzamy importer, awarie transakcji, restart, stałe ID,
sekwencje, dwa klienty, budżet i granicę konta w testach `shoppingStorage`
i `shoppingOffline`; integracje auth/rodziny i istniejące testy zakupów.
Playwright headless obejmuje oba rozmiary, odtwarzanie, dwie karty i błąd
miejsca. Ręczny przegląd telefonu, migracja rzeczywistego APK i końcowe CI
pozostają **do potwierdzenia**. Nie ma zmian konfiguracji serwera ani crona.

### Odbiór pamięci zadań i kontaktów — O.4 (#52)

Wspólna baza `rodzina-offline` v1 zawiera teraz wszystkie pięć magazynów konta.
Rekord `tasks` przechowuje potwierdzony snapshot, operacje i odrzucenia;
`contacts` pełną ostatnią kopię i czas pobrania. Synchronizator zadań pozostaje
obecny; wspólny outbox powstanie w O.5/O.6. Kontakty nadal są tylko do odczytu
bez internetu. Starsze checklisty opisują stan przy realizacji O.2/O.3.

1. WWW przy **390 i 1280 px**: pobierz prywatne i udostępnione listy zadań
   oraz kontakty. Wyłącz internet w otwartym interfejsie. Dodaj, zmień, odhacz
   i usuń zadania; wyszukaj kontakt i otwórz szczegóły. Niepobrana lista nie
   jest pusta; zapis czeka na pobranie jej bazy. Zmiany widoku potwierdzają
   trwały zapis operacji, a nie tylko zmianę RAM.
2. Zaktualizuj starszą wersję po zamknięciu jej instancji według O.2. Sprawdź
   także pominięcie wydań O.2 i O.3, operacje bez statusu, review i wpisy
   odrzuceń wymagające odświeżenia. Po weryfikacji znikają klucze
   `rodzina:tasks:v1`, `rodzina:tasks:v1:operation:*`,
   `rodzina:tasks:v1:discard:*` i `rodzina:contacts:v1`. Przerwanie importu
   lub sprzątania wznawia proces bez powielenia zmian. Uszkodzony dziennik
   zatrzymuje import bez kasowania źródła.
3. W dwóch zgodnych kartach wykonaj niezależne zmiany. Po odświeżeniu widoku
   i odzyskaniu sieci obie intencje pozostają. Cofnij udostępnienie lub usuń
   listę na drugim koncie: prywatna treść i jej kolejka znikają przed wysyłką.
4. Zasymuluj brak miejsca lub odmowę IDB. Zadanie nie jest przyjęte po błędzie
   transakcji. Kontakty pokazują ostrzeżenie i zachowują poprzednią poprawną
   kopię trwałą. Nie powstaje drugi dziennik w localStorage. Wylogowanie,
   utrata sesji i zmiana konta czyszczą wszystkie rekordy i kopie migracji;
   późna odpowiedź poprzedniej osoby ich nie odtwarza.
5. **Fizyczny APK — do wykonania:** pobierz oba moduły online, zmień termin
   zadania albo usuń zadanie offline i sprawdź wstrzymanie jego alarmu.
   W trybie samolotowym zamknij proces i uruchom APK ponownie: zadania,
   kolejka, blokady alarmów oraz kontakty z czasem pobrania pozostają.
   Przywróć sieć i sprawdź uzgodnienie oraz alarmy. Powtórz dla operacji
   wymagającej sprawdzenia. Zapisz model telefonu, Android, wersję APK i wynik.
   Build i transport Androida w Playwright nie zastępują tej próby.

Testy automatyczne: `taskStorage`, `taskOffline`, `contactsOffline`,
`offlineFixtures`, testy sesji/czyszczenia i alarmów oraz scenariusze Playwright
zadań, review, kontaktów i aktualizacji pamięci. Wynik końcowego CI i odbiór
fizycznego APK są wymagane do zamknięcia O.4. Nie wdrażamy serwera ani APK
w ramach tej zmiany; rollback po zapisach wymaga wersji rozumiejącej IDB.

### Odbiór wspólnego outbox zakupów — O.5 (#53)

Zakupy zapisują operacje w `outbox` bazy `rodzina-offline` v2. Snapshot
`shopping` zawiera bazę, a Query jest cache widoku. Zadania pozostają przy
synchronizatorze O.4. Aktualizacja zachowuje dotychczasowy import localStorage;
przejęcie O.3 jest atomowe, bez drugiego nadawcy i zmiany ID/czasów.
Starsze klienty wersji 1 są zamykane przez `versionchange` i nie mogą ponownie
otworzyć bazy. Zamknij starsze karty przed aktualizacją; nie obchodź blokady
usuwaniem danych. Rollback wymaga klienta obsługującego IDB v2 i outbox.

1. WWW **390 i 1280 px**: dodaj listę i produkty, odhacz kilka pozycji offline,
   zamknij i odtwórz frontend z tego samego magazynu. Po powrocie sieci sprawdź
   brak duplikatów oraz odświeżenie w sesji drugiego domownika. Przejrzyj
   katalog, produkt, formularz i komunikaty. Transport natywny sprawdzamy
   również przez testową integrację Playwright.
2. Dwie karty tego samego konta: zapisz zmiany równolegle, zamknij nadawcę
   podczas żądania, poczekaj na przejęcie dzierżawy (do 15 s). Operacje
   zachowują ID i kolejność zasobu. Późna odpowiedź starego nadawcy nie zapisuje
   cache; serwer rozpoznaje ponowienie po niezmiennym ID.
3. Zasymuluj 429/5xx i restart: termin retry oraz licznik pozostają.
   Konflikt blokuje daną listę i jej zależności, lecz nie niezależną listę.
   Po ponad 30 dniach zmiana wymaga sprawdzenia także po cofnięciu zegara.
   Przycisk odrzucenia wymaga potwierdzenia i usuwa zależny łańcuch.
4. Odmów zapisu IDB lub zasymuluj brak miejsca: formularz nie zgłasza
   sukcesu, nie powstaje operacja widoczna tylko w RAM. Wyloguj się podczas
   żądania i zmień konto w drugiej karcie: poprzednie dane nie wracają.
5. **Fizyczny APK — do wykonania:** pobierz zakupy, zapisz kilka operacji
   w trybie samolotowym, zakończ proces i uruchom ponownie. Sprawdź bazę,
   kolejkę i statusy, przywróć sieć i sprawdź brak duplikatów. Powtórz po
   przerwaniu wysyłki i po zmianie konta. Zapisz model telefonu, Android,
   wersję APK i wyniki. Build debug i testowy transport nie zaliczają tej próby.

Testy automatyczne: `outbox`, `sync`, `shoppingStorage`, `shoppingOffline`,
`ShoppingPage`, importery, granica sesji oraz Playwright zakupów. Końcowe CI
i odbiór fizycznego APK pozostają do potwierdzenia; nie zamykamy #53 wyłącznie
na podstawie kontroli lokalnych. Bez deployu i publikacji APK w tym kroku.

Weryfikacja lokalna 26.10.2026: **180 testów Vitest i 12 scenariuszy
Playwright headless** (390/1280 px) zakończonych sukcesem, w tym utrata
odpowiedzi po zapisie serwera, restart z tym samym ID i trwały konflikt.
Lint i formatowanie zmienionych plików, typecheck, build WWW, debug APK
i `release:smoke` przeszły. Fizycznego telefonu nie sprawdzono;
wynik końcowego CI pozostaje do potwierdzenia po publikacji commita.

### Odbiór wspólnego outbox zadań — O.6 (#54)

Zadania i zakupy korzystają z jednego nadawcy konta oraz bazy urządzenia v3.
Snapshot zadań zachowuje bazę i odrzucenia, a operacje znajdują się tylko
w `outbox`. Aktualizacja O.4 zachowuje ID, czasy, statusy i zależności;
pominięcie wydań pośrednich korzysta z dotychczasowego importera localStorage.
Starsze karty muszą być zamknięte; rollback wymaga klienta v3 z oboma adapterami.

1. WWW **390 i 1280 px** oraz testowy transport Androida: zmień zadania
   i zakupy offline, przeładuj frontend, przywróć sieć. Konflikt zadania
   pozostawia jego łańcuch do sprawdzenia, a niezależne zadania i zakupy
   dochodzą do API bez duplikatów. Przejrzyj wygląd listy, formularza oraz
   panelu zmian z właściwą przyczyną: wiek, zależność, konflikt lub odrzucenie.
2. Przerwij przejęcie O.4 i ponów start. Nie powstaje drugi dziennik.
   Utrata odpowiedzi i restart zachowują ID, czas, licznik i termin retry.
   Zmiana zegara nie wznawia raz utrwalonego przeglądu. Dwie karty korzystają
   z dzierżawy konta; stara odpowiedź nie może zapisać danych po przejęciu.
3. Cofnij udostępnienie podczas edycji i wysyłki: prywatna treść oraz wszystkie
   zależne intencje znikają z widoku i bazy. Pozostaje ogólny komunikat.
   Usuniętego zadania nie odtwarzamy; trwałe odrzucenie zachowujemy do reakcji.
   Odrzucenie całego łańcucha wymaga potwierdzenia, a nowy zapis odświeżenia listy.
4. Odmowa IDB/pełna pamięć nie daje sukcesu akcji. Wylogowanie i zmiana konta
   odcinają nadawcę oraz spóźnione odpowiedzi, czyszcząc cache, outbox i migracje.
5. **Fizyczny APK — do wykonania:** pobierz zadania z alarmami, zmień termin,
   ukończenie i usunięcie offline. Sprawdź trwałe wstrzymanie alarmów po
   zakończeniu procesu, ponownym otwarciu APK i restarcie telefonu. Przywróć
   sieć i sprawdź przywrócenie alarmów dopiero po właściwym uzgodnieniu.
   Powtórz dla konfliktu, odrzucenia i cofniętego udostępnienia oraz wspólnych
   zmian zakupów. Zapisz model, Android, wersję APK i wyniki. Transport testowy,
   testy harmonogramu i build debug nie zastępują prób sprzętowych.

Testy automatyczne: rdzeń offline, `taskStorage`, `taskOffline`, `TasksPage`,
zakupy, sesja i harmonogram alarmów oraz Playwright `shared-outbox`,
`tasks-offline`, `task-review`, `tasks-sharing` i zakupów. Końcowe CI oraz
fizyczny APK pozostają do potwierdzenia. Bez deployu i publikacji APK.

Weryfikacja lokalna O.6 (26.10.2026): testy rdzenia, zadań, zakupów,
sesji/czyszczenia konta i harmonogramu alarmów; Playwright headless przy
390/1280 px, w tym wspólny outbox, offline/restart frontendu, review,
udostępnianie i transport Androida. Przejrzano zrzuty list, formularzy
i panelu konfliktu w obu szerokościach. Lint, formatowanie, typecheck,
build WWW, debug APK i `release:smoke` przeszły. Brak podłączonego telefonu:
odbiór fizyczny alarmów oraz restartu urządzenia pozostaje niewykonany.
Na polecenie właściciela kończymy na commicie i pushu; właściciel sprawdzi CI.
Status: **zweryfikowane lokalnie, oczekuje na CI i próby fizycznego APK**.

### Narzędzia Androida

APK zawiera lokalny frontend. Potrzebne są Node.js 22 lub 24, JDK 21, SDK 36
i platform-tools/ADB, a na telefonie debugowanie USB. Ustaw `JAVA_HOME`
i `ANDROID_HOME`, jeżeli nie korzystasz z narzędzi wykrywanych w `.android-tools`.

```powershell
$env:RODZINA_ANDROID_API_ORIGIN = 'http://localhost:3000'
npm run android:debug
adb reverse tcp:3000 tcp:3000
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Uruchom lokalne API przez `npm run dev:api` albo `npm start` po buildzie.
Testy wykonuj na lokalnej bazie, bez zakładania kont testowych na produkcji.
Debug dopuszcza HTTP tylko dla localhost; release wymaga
`https://rodzina.preficze.pl`. Przed budowaniem przeciwko produkcji usuń
`RODZINA_ANDROID_API_ORIGIN` z terminala i ponów build.
`.env.android.example` opisuje konfigurację; nie jest automatycznie wczytywany.

`npm run android:sync` buduje shared i frontend do `apps/web/dist-android`
i wykonuje Capacitor sync. `npm run android:debug` dodatkowo buduje APK.
Nie nadpisuje to buildu WWW w `apps/web/dist`.
Test magazynu na urządzeniu: w `android/` uruchom
`./gradlew.bat connectedDebugAndroidTest` (Linux/macOS: `./gradlew connectedDebugAndroidTest`).
Nie zastępuje to prób zamknięcia procesu ani odbioru alarmów na telefonie.

Podpisywanie, zachowanie tego samego klucza, wersjonowanie, konfigurację
i publikację opisuje [DEPLOY.md](DEPLOY.md). Diagnostyka haseł i pierwotne
checklisty są w [archiwum](archive/development-historia.md).
