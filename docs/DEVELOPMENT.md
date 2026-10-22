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
