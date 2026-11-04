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

Parser OCR.1 sprawdza `npm test -- packages/shared/src/ocr.test.ts`.
Syntetyczny zestaw `test-fixtures/ocr/events.json` zawiera tekst, położenie
i oczekiwane częściowe propozycje/ostrzeżenia; nie zawiera danych osobowych
ani prawdziwych zdjęć. Testy obejmują miesiące, formaty liczbowe, lata
przestępne, brak roku/godziny, błędy OCR, alternatywne daty, zapisy, bloki
i kolumny oraz wspólny kontrakt adapterów. Po zmianie shared sprawdź również
typy API i WWW. OCR.2 sprawdzają testy `ocrWeb`, `PhotoEventPreview`
i `http/security-headers`; headless `e2e/calendar-ocr.spec.ts` uruchamia
rzeczywisty worker i polski model w produkcyjnym buildzie przy 390/1280 px.
Plakat kontrolny powstaje syntetycznie w przeglądarce. Próby obejmują wynik,
pusty obraz, planszę ośmiu kart, plakat z dekoracjami, bilet z oddzielonym
tytułem i adresem, błędny format, uszkodzony i za duży plik, anulowanie i awarię
zasobów. Build i release:smoke sprawdzają pakowanie i serwowanie zasobów.
Regresje parsera obejmują wielowierszowe tytuły, ceny i metadane, niepewny OCR
oraz brak fałszywej godziny z uszkodzonej nazwy. Testy adaptera sprawdzają
skalowanie i rozdzielenie dekoracji bez rozbijania zwykłej interpunkcji.
Rzeczywiste zdjęcia właściciela sprawdzamy lokalnie, bez dodawania ich do
repozytorium. Ozdobne czcionki nadal mogą wymagać poprawienia rozpoznanego
tekstu; ocena pewności i podgląd nie zastępują zatwierdzenia użytkownika.
Próby obejmują też wielodniowy zakres z powtórzeniem w godzinach otwarcia,
program koncertu i rok do potwierdzenia, a testy adaptera — dodatkowe przebiegi
kontrastu i scalenie współrzędnych różnych skal. Oryginalny podgląd zachowuje
kolory, nawet gdy silnik korzysta z wariantów kontrastu.

API OCR.3 sprawdza `npm test -- apps/api/src/modules/events packages/shared/src/schemas/events.test.ts`.
Testy obejmują paczki 1–20 pozycji, częściowy sukces, role (także dzieci),
uczestników, konflikty UUID, równoległe żądania i retry, rollback relacji
oraz rejestru, usunięcie wydarzenia, izolację kont/rodzin i migrację istniejącego
kalendarza. Po zmianie shared sprawdź typy API i WWW; migracja wymaga także
builda i `release:smoke`. API jest podłączone do wspólnego interfejsu w OCR.4;
natywna integracja Androida pozostaje w OCR.5.

OCR.4 sprawdzają testy komponentów `PhotoImportReview` i `EventForm` oraz
`photoImportStorage`: zatwierdzanie daty, opcjonalną godzinę i czas trwania oraz wpis bez godziny,
zaznaczanie, częściowy sukces, zachowanie odrzuconych danych, restart/retry
z tym samym UUID, błąd zapisu przed żądaniem, podwójne kliknięcie, utrata sieci,
zmiana konta i spóźniona odpowiedź. Testy magazynu używają IndexedDB i obejmują
transakcje, niezmienność danych, wiele kart oraz czyszczenie konta.
Headless `e2e/calendar-ocr.spec.ts` przy 390/1280 px obejmuje rzeczywisty OCR,
poprawienie formularzem lub zatwierdzenie bez edycji, osobny wybór, zapis
przez API i wyniki; brak godziny pozostaje ostrzeżeniem, a rozpoznana godzina
trafia do wydarzenia. Próby obejmują też
częściowy sukces po utracie odpowiedzi, restart i ręczne retry bez duplikatu,
błąd pamięci oraz ostrzeżenie nawigacji. Sprawdzane są lokalne zasoby,
produkcyjna CSP, brak zewnętrznych żądań, zakres wysyłanych danych, fokus,
klawiatura i szerokość ekranu. Regresja z transportem Androida sprawdza wspólny
formularz i ukrytą akcję WWW; nie zastępuje fizycznego APK.
Build i `release:smoke` sprawdzają paczkę WWW.

Do ręcznego odbioru OCR.4 uruchom `npm run dev`, otwórz Kalendarz →
„Dodaj ze zdjęcia” i wybierz plakat lub zrzut. Przy 390 i 1280 px sprawdź:
pojedynczy termin, kilka terminów, kolumny, brak roku, datę zapisów obok
wydarzenia i nieczytelny obraz. Porównaj zdjęcie i ostrzeżenia, popraw formularz
(lub dodaj brakującą propozycję ręcznie), zatwierdź, zaznacz i zapisz. Sprawdź
wyniki oraz wydarzenia w kalendarzu, fokus, klawiaturę, Wstecz, ponowny wybór
i zmianę konta. Dla utraty odpowiedzi odśwież ekran i ręcznie ponów nieznane
wyniki online; pozycje zapisane nie mogą się powielić. Po błędzie pamięci
przed zapisem żądanie nie może zostać wysłane. Niezapisane szkice i źródło
OCR nie przetrwają zamknięcia ekranu; wysłane operacje i odrzucenia przetrwają.
Po zmianie zależności lub konfiguracji Vite zrestartuj serwer deweloperski.
Ręczny odbiór właściciela na kontrolnych i rzeczywistych zdjęciach przy
390/1280 px oraz regresja wspólnego frontendu w fizycznym APK pozostają do
potwierdzenia. Zależne #75 jest zamknięte, a CI jego commita przeszło;
końcowy odbiór obu platform pozostaje w OCR.6.
Nie deklarujemy gwarancji uruchamiania WWW offline.

OCR.5: testy `ocrNative` sprawdzają kontrakt, limit podglądu, anulowanie
i timeout; `PhotoEventPreview` także wybór/anulowanie/błąd Androida oraz
spóźnioną odpowiedź po zmianie konta. `e2e/calendar-ocr.spec.ts` sprawdza
przy 390/1280 px rzeczywisty OCR WWW oraz symulowany most Androida: odczyt
offline, anulowanie, wspólne poprawianie/zatwierdzanie, zapis online i kalendarz.
Symulacja mostu nie potwierdza działania natywnego OCR. JVM `OcrImagePolicyTest`
sprawdza limity dekodowania, formaty, proporcje, rozmiar OCR/podglądu
i kontrastu, skalowanie obrazu, rozdzielanie odległych słów oraz próg ponownego
odczytu. `ocrNativeMerge` sprawdza wybór
czytelniejszego tytułu, odzyskanie pominiętych linii i zachowanie konfliktu dat.
Regresja parsera obejmuje syntetyczny układ siedmiu listopadowych kartek:
osobne „Sesja zdjęciowa świąteczna” (5.11), „Szkoła do hymnu” (9.11),
wielowierszową audycję i brak odczytanej pierwszej daty bez pożyczania 9.11.
Budowanie debug APK i `testDebugUnitTest lintDebug` opisano poniżej.

Do odbioru właściciela na fizycznym telefonie (#73): po instalacji APK
przed pierwszym OCR wyłącz sieć, wybierz lokalny plakat i sprawdź odczyt bez
pobierania modelu. Sprawdź anulowanie selektora i odczytu, ponowny wybór,
powrót z selektora, zdjęcie z EXIF (obrót i odbicie), duże zdjęcie, plik ponad
20 MB i błędny format, Wstecz, opuszczenie ekranu oraz zmianę konta w trakcie
odczytu. Włącz sieć, popraw i zatwierdź propozycje, zaznacz, zapisz oraz
porównaj wyniki, kalendarz i harmonogram. Sprawdź częściowy sukces, utratę
odpowiedzi, restart APK i ręczne retry bez duplikatów oraz czyszczenie konta.
Właściciel zgłosił błędy odczytu listopadowego plakatu: przypisanie 9.11
pierwszej kartce zamiast 5.11, brak „Szkoły do hymnu” i przekręcone litery.
Po poprawce wymagany ponowny fizyczny odczyt tego zdjęcia, także offline,
porównanie wszystkich siedmiu terminów i tytułów oraz anulowanie odczytu.
Regresje geometrii są syntetyczne; rzeczywiste zdjęcie
`test-fixtures/ocr/november-2026.jpg` sprawdza test headless „seven November”
w `e2e/calendar-ocr.spec.ts` przy 390/1280 px: siedem pełnych tytułów i dat,
w tym sesję 5.11 i „Szkołę do hymnu” 9.11, oraz zatwierdzenie i zapis.
Po podmianie silnika wymagany jest odbiór APK z Tesseract4Android. Pierwsza
kartka ma mieć datę 5.11.2026, a wszystkie siedem tytułów ma odpowiadać zdjęciu,
także offline. Sprawdź również zdjęcia, dla których użytkownik zgłosił gorszy
odczyt w APK niż w WWW. Porównaj tytuły, daty i czas oczekiwania.
Sprawdź anulowanie podczas odczytu fragmentów i ponowny wybór zdjęcia.
Pozostałe próby telefonu nadal wymagają potwierdzenia właściciela.

Duplikaty wydarzeń sprawdzają testy API `modules/events`, kontraktów
`schemas/events`, komponentu `PhotoImportReview` i magazynu `photoImportStorage`.
Headless `e2e/event-duplicates.spec.ts` przy 390/1280 px obejmuje zwykły
formularz WWW i transport Androida, anulowanie, zastąpienie i dodanie kolejnego,
import z częściowymi wynikami oraz utratę odpowiedzi i restart po decyzji.
API sprawdza datę i znormalizowany tytuł, izolację rodzin, uprawnienia dzieci,
zmianę wersji, równoległe importy i rollback zastąpienia wraz z rejestrem.
Ręcznie sprawdź dwukrotne dodanie tego samego tytułu w tej samej dacie,
obie decyzje, kilka istniejących dopasowań i zmianę wpisu z drugiego urządzenia
przy otwartym dialogu. Odbiór fizycznego APK i końcowe CI pozostają do potwierdzenia.

Reguły cykliczności C.1 sprawdzają testy shared/task-recurrence oraz
modules/tasks/recurrence-migrations: końce miesięcy, lata przestępne, tygodnie
ISO, DST, opóźniona synchronizacja, anomalie zegara, granica końca i unikalność
wystąpień. Testy modules/tasks/recurrence sprawdzają C.2: konfigurację,
wykonanie z dwóch urządzeń, retry, historię, pominięcie, zatrzymanie,
cofnięcie i konflikty, anomalie czasu, uprawnienia oraz przypomnienia.
Migracje 0028–0029 wymagają builda i release:smoke. C.3 sprawdzają testy
taskRecurrenceOffline, taskStorage i wspólnego outboxa: trwały czas wykonania,
restart, retry, utrata odpowiedzi/snapshotu, stara kolejka, wersje po edycjach,
cofnięcie, konflikty, wygaśnięcie, dostęp i błędy pamięci. Headless Playwright
task-recurrence-offline sprawdza wykonanie i restart offline przy 390/1280 px
dla WWW i transportu Androida oraz historię z rzeczywistym czasem wykonania.
Test transportu nie zastępuje fizycznego APK. Do odbioru pozostają fizyczny
restart offline i uzgodnienie na dwóch urządzeniach, zatrzymanie/usunięcie
serii na drugim urządzeniu, alarmy pending i po synchronizacji, utrata dostępu
i zmiana konta. C.4 sprawdzają testy TaskRecurrenceEditor, taskRecurrencePreview
oraz API recurrence: formularz obu trybów, błędy, historia, wzorzec checklisty,
nowe UUID i postęp 0/N, retry, atomowy rollback i konflikty wersji. Headless
Playwright task-recurrence-ui sprawdza oba tryby, zakresy edycji, checklisty,
historię, pominięcie i zatrzymanie przy 390/1280 px dla WWW i transportu Androida.
Końcowe CI i poniższy odbiór ręczny pozostają do potwierdzenia.

## Odbiór cykliczności C.4

Uruchom npm run dev, a po zmianie shared uruchom je ponownie. W formularzu
zadania wybierz „Powtarzaj”, początek i godzinę oraz „Utwórz serię”. Przy nowym
zadaniu przycisk najpierw zapisuje rodzica; checklistę dodaj po ponownym otwarciu.
Przy istniejącym zadaniu dołączenie do serii przejmuje jego checklistę.

- [ ] Przy 390 i 1280 px sprawdź oba tryby, interwał 1–1000, tygodniowe dni,
      koniec włącznie, datę i opcjonalną godzinę. Koniec przed początkiem blokuje
      zapis. Sprawdź podgląd oraz 31 stycznia, 29 lutego i zmianę czasu.
- [ ] Dodaj dwa kroki, zaznacz jeden i utwórz serię. Zmień nazwę i kroki tylko
      tego zadania; następca nadal używa wzorca. Następnie wybierz „Użyj bieżącej
      checklisty jako wzorca kolejnych zadań” i „Zapisz to i kolejne”. Wykonaj:
      dokładnie jeden następca ma nową nazwę i checklistę 0/N z nowymi ID.
      Postęp poprzednika pozostaje w ukończonym zadaniu.
- [ ] Sprawdź serię na liście i w „Dziś”, zaległy termin bez stosu kopii,
      pomijane daty rytmu, „Pomiń wystąpienie”, historię i „Zatrzymaj serię”.
      Zatrzymane bieżące zadanie pozostaje jednorazowe. Cofnij wykonanie przed
      edycją następcy, potem powtórz po jego edycji: drugi przypadek daje konflikt.
- [ ] Na dwóch urządzeniach zmień regułę/checklistę i równolegle wykonaj zadanie;
      sprawdź jawny konflikt oraz odświeżenie bez utraty kroków. Zweryfikuj dostęp
      dziecka do udostępnionej listy, prywatne listy, cofnięcie udostępnienia,
      wylogowanie i zmianę konta. Stary wspierany APK ma edytować i kończyć
      wystąpienia bez usuwania serii, wzorca i checklist.
- [ ] W fizycznym APK na dwóch urządzeniach sprawdź wykonanie online, potem
      offline → wykonanie → zamknięcie procesu → otwarcie offline → online.
      Przed synchronizacją brak następcy i jego alarmu; po niej dokładnie jeden
      następca z poprawną datą i checklistą 0/N na obu urządzeniach. Konfiguracja,
      pominięcie, zatrzymanie i pobranie historii offline są zablokowane.
- [ ] Ustaw wspólne względne przypomnienie, odbierz rzeczywisty alarm następcy
      po synchronizacji. Zmień termin, uruchom telefon ponownie i sprawdź nowy
      alarm oraz brak alarmu ukończonego/usuniętego zadania. Potwierdź, że zamknięte
      APK nie pobiera zmian z drugiego urządzenia; trzeba je otworzyć i uzgodnić.
      Sprawdź klawiaturę, fokus, systemowy Wstecz i safe area formularza.

Żadna z powyższych prób ręcznych i fizycznych nie jest potwierdzona przez
testy automatyczne. Bez commita nie ma końcowego CI; deploy pozostaje osobny.

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

## Odbiór podzadań

Właściciel potwierdził 30.10.2026 zakończenie prób S.4 (#63): WWW przy
390/1280 px i wspólny frontend w fizycznym APK, dwa konta/urządzenia,
niezależne odhaczenia i konflikty, restart offline z synchronizacją bez
duplikatów, postęp i licznik rodziców, ukończenie/cofnięcie oraz usuwanie
rodzica i zbiorcze usuwanie ukończonych zadań. Odbiór obejmuje prywatność list,
dostęp dziecka, cofnięcie udostępnienia, wylogowanie, zmianę konta, zgodność
starszego APK oraz klawiaturę, systemowy Wstecz, fokus i komunikaty błędów.
Końcowe CI należy potwierdzić dla commita domykającego S.4; status jest
w [plan.md](plan.md). Integracja checklist kolejnych wystąpień zadań cyklicznych
pozostaje w module cykliczności.

## Pozostały odbiór

Poniższe próby nie mają potwierdzenia wykonania. Dla każdej zapisz commit,
model telefonu, Android, wersje APK przed/po, datę i wynik. Nie zaliczaj
historycznych terminów wstecz; mocki i test transportu nie dowodzą działania
systemowego alarmu. Aktualne CI sprawdzaj dla konkretnego commita.

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
      w tym dodać dwa dania tego samego dnia i zmienić lub usunąć jedno z nich,
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
- [ ] Poprawki list: na WWW 390/1280 px i fizycznym APK odhaczyć i cofnąć
      podzadanie bez otwierania formularza, także offline; rodzic pozostaje
      bez zmian. Sprawdzić zapis i odczyt urodzin bez roku, numer urodzin ze
      znanym rokiem, ikonę tortu i wspólną typografię danych kontaktu.
- [ ] Urodziny kontaktu: na WWW 390/1280 px i fizycznym APK zapisać datę,
      zmienić ją i wyczyścić. Na dwóch kontach potwierdzić alarm w dniu
      urodzin o 09:00 Europe/Warsaw, także offline po zamknięciu APK
      i restarcie telefonu. Kliknięcie otwiera Kontakty. Po synchronizacji
      zmiana/usunięcie daty lub kontaktu usuwa stary alarm, bez duplikatów.
      Starsze wspierane APK zachowuje odczyt kontaktów, zapis bez zmiany daty
      i dotychczasowe alarmy. Wymagane systemowe zgody powiadomień i alarmów.
- [ ] Migracja pięciu magazynów: aktualizacja ze wspieranych źródeł, także
      pominięcie wydań, po zamknięciu starych instancji. Bez sieci dane i zmiany
      zakupów/zadań przetrwają zakończenie procesu; powrót sieci nie dubluje zapisów.
      Sprawdzić przerwanie importu, brak miejsca, odmowę zapisu i stare karty.
- [ ] Stare zmiany (>30 dni), odrzucenia, konflikty, cofnięcie udostępnienia
      i zależności nie gubią operacji. Niezależne zmiany idą dalej.
      Panel odrzuca tylko obejrzany łańcuch, po potwierdzeniu i trwałym zapisie;
      lista wymaga świeżego odczytu przed kolejnym zapisem.
      Blokada alarmów zadania utrzymuje się po restarcie, a ustępuje po uzgodnieniu.
- [ ] Niezależna sesja offline: zaktualizować fizyczne APK z danymi zakupów,
      obiadów i niewysłanymi zmianami zapisanymi przez poprzednią wersję,
      bez czyszczenia pamięci. Bez sieci zakończyć proces i uruchomić ponownie:
      konto, dane i kolejki mają pozostać dostępne. Powtórzyć restart offline
      WWW po aktualizacji. Zmienić konto i sprawdzić, że poprzednia sesja,
      dane oraz spóźnione odpowiedzi nie wracają; sprawdzić też wylogowanie
      offline i 401 po odzyskaniu sieci. Próby właściciela pozostają niepotwierdzone.
- [ ] Wylogowanie, utrata sesji i zmiana konta, również w drugiej karcie,
      usuwają właściwe dane i alarmy; spóźniona odpowiedź ich nie odtwarza
      ani nie usuwa danych nowego konta. Sprawdzić odtworzenie sesji w APK.
- [ ] Pamięć i bateria: pomiar navigator.storage.estimate() oraz liczników
      cache/kolejki przed i po rzeczywistych danych, zachowanie przy granicach
      i brak okresowej pracy pustego nadawcy; próba na fizycznym telefonie.
- [ ] Synchronizacja po powrocie sieci: w fizycznym APK pobrać zadania, zakupy
      i obiady, odłączyć sieć i zapisać 20–30 zmian, w tym wykonanie zadania
      cyklicznego. Przywrócić łączność przy aktywnej aplikacji i sprawdzić
      opróżnienie kolejki, zgodność danych na drugim urządzeniu, brak duplikatów
      oraz pojawienie się następcy po potwierdzeniu wykonania. Zanotować czas
      synchronizacji i zużycie baterii według Androida. Porównać powtarzane
      przebiegi z poprzednim APK na tym samym telefonie i przy zbliżonym zasięgu.
- [ ] Hosting: zaufane proxy, backup/odzyskanie oraz powrót ze starej PWA
      (wyrejestrowanie workera, zachowana sesja, manifest 410), po zleconym deployu.
