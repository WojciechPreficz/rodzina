# Praca lokalna i odbiór

## Uruchomienie

Node.js 22 lub 24 i npm; CI oraz hosting używają 24.
Wykonaj npm ci, skopiuj apps/api/.env.example do apps/api/.env
i uruchom npm run dev. WWW: http://localhost:5173, API: port 3000.
Po zmianie shared uruchom dev ponownie. Lokalny wariant produkcyjny:
npm run build, npm run db:migrate i npm start, razem na porcie 3000.
Nie uruchamiaj obu trybów jednocześnie. RODZINA_PUBLIC_URL wskazuje
używany interfejs (5173 albo 3000). Backup po buildzie: npm run job:backup.

Przed npm ci zatrzymaj API i testy watch: Windows blokuje załadowane moduły
natywne (EPERM przy Argon2). Nie usuwaj lockfile ani bazy; zamknij proces
tej aplikacji w jego terminalu i ponów instalację.

## Testy

Zakres obowiązkowych kontroli określa [AGENTS.md](../AGENTS.md).
Komendy: npm run lint, npm run format:check, npm run typecheck, npm test,
npm run build, npm run test:e2e, npm run release:smoke.
Pełny zestaw wykonuje CI, a lokalnie dobieramy kontrole do zmiany.

Playwright działa wyłącznie headless przy 390 i 1280 px, z tymczasową bazą
na porcie 3417. Instalacja przeglądarki: npx playwright install chromium.
Testy nie używają lokalnej bazy rodziny. Dane migracji w test-fixtures/offline
są współdzielone przez Vitest i Playwright; nie są dokumentacją.
Raporty i zrzuty zapisujemy w ignorowanych katalogach coverage i test-results.

## Android lokalnie

JDK 21, SDK 36, Gradle Wrapper 8.14.3, platform-tools/ADB i debugowanie USB.
Skrypty wykrywają .android-tools; poza tym ustaw JAVA_HOME, ANDROID_HOME
i opcjonalnie GRADLE_USER_HOME. Konfiguracja w .env.android.example
nie jest wczytywana automatycznie.

```powershell
$env:RODZINA_ANDROID_API_ORIGIN = 'http://localhost:3000'
npm run android:debug
adb reverse tcp:3000 tcp:3000
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Uruchom lokalne API przez npm run dev:api lub produkcyjny wariant powyżej.
Debug dopuszcza HTTP tylko dla localhost; release wymaga HTTPS.
Przed buildem produkcyjnym usuń RODZINA_ANDROID_API_ORIGIN z terminala.
android:sync buduje shared i frontend do apps/web/dist-android oraz wykonuje
Capacitor sync; android:debug dodaje build APK. Build WWW pozostaje osobny.

W katalogu android uruchom ./gradlew.bat testDebugUnitTest lintDebug
(Linux/macOS: ./gradlew testDebugUnitTest lintDebug).
connectedDebugAndroidTest wymaga urządzenia lub emulatora; nie zastępuje
odbioru alarmów. Debug nie aktualizuje release podpisanego innym kluczem.
Podpisywanie i publikację opisuje [DEPLOY.md](DEPLOY.md).

## Pozostały odbiór

Poniższe próby nie mają potwierdzenia wykonania. Dla każdej zapisz commit,
model telefonu, Android, wersje APK przed/po, datę i wynik. Nie zaliczaj
historycznych terminów wstecz; mocki i test transportu nie dowodzą działania
systemowego alarmu. Aktualne CI sprawdzaj dla konkretnego commita.

- [ ] Podzadania S.1–S.2: potwierdzić na fizycznym wspieranym APK odczyt
      i edycję rodzica po migracji API, bez utraty checklisty utworzonej przez
      API. Warstwa offline jest sprawdzana testami store/adaptera i outboxa;
      nie oznacza to próby fizycznego telefonu. Po dodaniu UI w S.3 sprawdzić
      dwa urządzenia, restart APK offline, migrację starego cache z oczekującymi
      zmianami, utratę odpowiedzi, konflikty i cofnięcie dostępu. Próby UI
      390/1280 px i wspólnego frontendu APK pozostają do odbioru w S.3–S.4.
- [ ] Usuwanie kont: UI przy 390/1280 px i fizyczne APK, klawiatura, fokus
      i systemowy Wstecz. Administrator usuwa domownika lub rodzinę; inny dorosły
      siebie i dowolne dziecko, dziecko nikogo. Ostatni administrator musi
      przekazać rolę albo usunąć rodzinę. Sprawdzić błędne hasło, limit, nazwę
      rodziny, anulowanie, offline i utratę odpowiedzi ze sprawdzeniem wyniku.
      Usunięcie dziecka nie wylogowuje dorosłego; pojedyncze usunięcie zachowuje
      wspólne treści i przekazuje listy. Usunięcie siebie/rodziny czyści lokalne
      dane, kolejki i alarmy, również w drugiej karcie. Telefon offline traci
      dostęp i czyści alarmy po kontakcie z API. Potwierdzić komunikat aktualizacji
      przy usuwaniu bez hasła ze starszego APK i końcowe CI.
- [ ] Reset hasła: rzeczywista skrzynka SMTP według DEPLOY, odbiór i Spam,
      SPF/DKIM/DMARC oraz brak tokenów w logach hostingu. Nadawca nie jest
      skonfigurowany automatycznie; domyślnie funkcja pozostaje wyłączona.
- [ ] Reset na fizycznym APK: zamówienie linku, otwarcie z poczty przy zamkniętej
      i uruchomionej aplikacji, a także bez APK (WWW). Po zmianie hasła stare
      hasło nie działa, nowe działa, własne dane i alarmy są czyszczone.
      Reset innej osoby nie wylogowuje bieżącego konta. Drugie urządzenie online
      traci sesję przy kontakcie z API; offline dopiero po powrocie sieci.
- [ ] Reset: odbiór formularzy przy 390/1280 px i w APK, błędny/wygasły/użyty
      link, ponowne zamówienie linku, brak sieci, limit i wyłączona funkcja.
      Potwierdzić zaufane proxy i odporność limitu IP na własny X-Forwarded-For.

- [ ] UI przy 390 i 1280 px oraz wspólny frontend APK: kalendarz, zadania,
      zakupy, rodzina, dokumenty, kontakty, powiadomienia, aktualizator i 404.
      Klawiatura, fokus, kontrast, safe area, duży tekst, formularze i błędy.
- [ ] Kontakty: wyszukiwanie, grupy, formularz i szczegóły; dorośli edytują,
      dziecko tylko odczytuje. Domyślnej grupy nie usuwamy, usunięcie innej
      przenosi kontakty. Izolacja rodzin i cofnięcie dostępu.
- [ ] Obiady (6.3): ręcznie zaplanować pięć obiadów i skopiować tydzień,
      sprawdzić pomijanie oraz nadpisanie zajętych dni, podpowiedzi składników,
      edycję, usuwanie i odczyt dziecka. Odbiór przy 390/1280 px i w fizycznym
      APK, w tym klawiatura, fokus oraz systemowy Wstecz. Test transportu Androida
      w Playwright nie zastępuje próby telefonu.
- [ ] Obiady (6.4): wyeksportować pięć dań do niepustej listy, sprawdzić
      scalanie nazw i ilości, podsumowanie dodanych/uzupełnionych pozycji oraz
      pozostawienie kupionych pozycji bez zmian. Sprawdzić wybór części dań,
      ostrzeżenie i potwierdzenie ponownego eksportu, ponowienie po błędzie
      oraz brak zmian zakupów po edycji/usunięciu obiadu. Karta „Dziś na obiad”
      pokazuje dzisiejszy plan według strefy rodziny, także po zmianie daty
      kalendarza; dziecko ma podgląd bez eksportu. Odbiór przy 390/1280 px
      i w fizycznym APK, w tym systemowy Wstecz i utrata sieci w oknie eksportu.
- [ ] Obiady (6.5): na fizycznym APK pobrać tygodnie i niepustą listę zakupów,
      odłączyć sieć, dodać/zmienić/usunąć obiad, skopiować zapisany tydzień
      i wyeksportować składniki. Zmienić obiad po eksporcie, zamknąć proces
      aplikacji i uruchomić bez internetu. Sprawdzić zachowanie zmian,
      podpowiedzi, dzisiejszą kartę, projekcję zakupów i niepobrany tydzień.
      Po powrocie sieci porównać z drugim urządzeniem: bez utraty zmian
      i podwojenia ilości, także po utracie odpowiedzi. Sprawdzić ponowny
      eksport, konflikty po usunięciu obiadu/listy na drugim urządzeniu,
      wylogowanie i zmianę konta. Odbiór UI 390/1280 px oraz fizycznego APK
      pozostaje wymagany; testy headless z transportem Androida nie potwierdzają
      restartu procesu, klawiatury ani systemowego Wstecz na telefonie.
- [ ] Dokumenty: wszystkie typy i filtry, szczegóły po nazwie, plakietka
      niezależna od filtra. „Odnowiono” zmienia termin i offsety; minione
      absolute pozostaje nieaktywne. Osobiste przypomnienia są prywatne;
      dziecko zarządza własnymi, bez edycji dokumentu.
- [ ] K.1: wszystkie widoki kalendarza, przełączniki i podglądy warstw,
      zachowanie preferencji po ponownym uruchomieniu APK i bez sieci,
      bez zależności od błędu API wydarzeń.
- [ ] Aktualizacja między dwoma podpisanymi wydaniami bez czyszczenia danych:
      pobranie, anulowanie instalatora, ponowienie, większy numer wersji,
      zachowana sesja i dane; dotychczasowy klucz i pl.preficze.rodzina.
- [ ] App Links zaproszenia i resetu: zamknięte/otwarte APK oraz brak APK,
      prawidłowy powrót i systemowy Wstecz; weryfikacja domeny na telefonie.
- [ ] Alarm wydarzenia co najmniej 10 minut w przyszłości: po synchronizacji
      wyłącz sieć, zamknij interfejs i zablokuj ekran. Odbiór bez otwierania
      APK, opóźnienie najwyżej 60 s. Powtórz po restarcie i pierwszym
      odblokowaniu, także po zmianie strefy telefonu. Zapisz czas lokalny/UTC,
      faktyczny odbiór i wynik kliknięcia. Zgłoszenie OPPO deploy.3 nadal
      wymaga potwierdzenia na aktualnej wersji.
- [ ] Alarm dokumentu: termin za 31 dni i offset 30 dni, następnego dnia
      09:00 Europe/Warsaw. Odbiór po zamknięciu APK i po restarcie; kliknięcie
      otwiera zapisany podgląd. Zdalne odnowienie/usunięcie po sync anuluje
      lub zastępuje stary alarm. Wydarzenia: zmiana/anulowanie i podział serii
      nie pozostawiają duplikatów. Wymagane zgody powiadomień i alarmów.
- [ ] Migracja pięciu magazynów: aktualizacja ze wspieranych źródeł, także
      pominięcie wydań, po zamknięciu starych instancji. Bez sieci dane i zmiany
      zakupów/zadań przetrwają zakończenie procesu; powrót sieci nie dubluje zapisów.
      Sprawdzić przerwanie importu, brak miejsca, odmowę zapisu i stare karty.
- [ ] Stare zmiany (>30 dni), odrzucenia, konflikty, cofnięcie udostępnienia
      i zależności nie gubią operacji. Niezależne zmiany idą dalej.
      Panel odrzuca tylko obejrzany łańcuch, po potwierdzeniu i trwałym zapisie;
      lista wymaga świeżego odczytu przed kolejnym zapisem.
      Blokada alarmów zadania utrzymuje się po restarcie, a ustępuje po uzgodnieniu.
- [ ] Wylogowanie, utrata sesji i zmiana konta, również w drugiej karcie,
      usuwają właściwe dane i alarmy; spóźniona odpowiedź ich nie odtwarza
      ani nie usuwa danych nowego konta. Sprawdzić odtworzenie sesji w APK.
- [ ] Pamięć i bateria: pomiar navigator.storage.estimate() oraz liczników
      cache/kolejki przed i po rzeczywistych danych, zachowanie przy granicach
      i brak okresowej pracy pustego nadawcy; próba na fizycznym telefonie.
- [ ] Hosting: zaufane proxy, backup/odzyskanie oraz powrót ze starej PWA
      (wyrejestrowanie workera, zachowana sesja, manifest 410), po zleconym deployu.
