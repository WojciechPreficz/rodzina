# Decyzje

## 24.10.2026 — lista i formularz dokumentów, krok 8.3 (#20)

- Zakres według `archive/plan-przyszle-fazy.md`: lista, filtry, formularz,
  edycja i usuwanie; dziecko ma tylko podgląd. Dokumenty są bezpośrednią
  pozycją menu pod `/dokumenty`, zgodnie z bieżącymi zasadami nawigacji.
- Wzorzec wizualny to załączony projekt „Ciepły i przyjazny — Dokumenty”.
  Odczyt MagicPath był niedostępny z powodu limitu API. Na komputerze filtr
  jest bocznym panelem, na telefonie poziomą listą przycisków.
- Nowy dokument i zmiana typu w formularzu podstawiają domyślne przypomnienia
  typu. Edycja innych pól zachowuje konfigurację przypomnień; usunięcie
  wszystkich zapisuje pustą tablicę. `owner` opisujemy jako posiadacza,
  a przy jego braku twórcę. Osobiste przypomnienia pozostają w kroku 8.4.
- Filtr osoby wybiera jej dokumenty przez `holderUserId`, filtr pojazdów
  obejmuje wszystkie trzy typy samochodowe. Pozostałe dokumenty są widoczne
  w filtrze „Wszyscy”. Daty i statusy liczymy w strefie rodziny; dokument
  pozostaje ważny w dniu daty ważności. Zarządzanie wymaga połączenia z siecią.
- Bez migracji, nowych zależności runtime, konfiguracji i crona. Odnowienie,
  plakietka menu i trasa szczegółów z alarmu pozostają w kroku 8.4.
- Minimalną wysokość pól przenosimy z inline `Input.styles` do CSS. Biblioteka
  automatycznej wysokości notatki odrzuca `style.minHeight` w trybie developerskim;
  wysokość notatki określa `minRows`. Test formularza używa rzeczywistego motywu
  i aktywnego autosize, aby sprawdzać także tę integrację.
- Właściciel przeprowadzi ręczne próby dodania każdego typu i próby w APK.
  Na późniejsze polecenie właściciela zapisujemy zmiany w lokalnym commicie
  na `main`, bez pusha. Zweryfikowane lokalnie, oczekuje na CI i odbiór ręczny.
- Weryfikacja lokalna: 29 testów komponentów i logiki, 10 testów Playwright
  headless przy 390 i 1280 px (WWW i transport Androida), lint i formatowanie
  zmienionych plików, typecheck, build WWW/API i debug APK przeszły.
  Przejrzano zrzuty listy i formularza; brak poziomego przepełnienia.
  Test transportu i build nie oznaczają próby na fizycznym telefonie.

## 24.10.2026 — dokumenty dotyczące mieszkania

- Na polecenie właściciela rozszerzamy typy dokumentów o `home_insurance`
  (ubezpieczenie mieszkania) i `rental_agreement` (umowa najmu mieszkania).
- Przyjmujemy domyślne przypomnienia 30 i 7 dni przed końcem ważności,
  analogicznie do ubezpieczenia pojazdu. Próg statusu `expiring` to 30 dni.
- Nowe typy używają istniejącej etykiety, daty ważności i opcjonalnej notatki,
  bez posiadacza ani pojazdu. Nie dodajemy pól adresu ani UI z kroku 8.3.
  Istniejący CRUD, odnowienie i harmonogram APK obsługują je przez wspólny typ.
- Bez migracji, nowych zależności runtime, konfiguracji i crona.

## 22.10.2026 — przypomnienia dokumentów, krok 8.2 (#19)

- Zakres według `archive/plan-przyszle-fazy.md`: API przypomnień, odnowienie
  i harmonogram APK, bez UI z kroków 8.3–8.4 i bez joba Web Push.
- Pominięcie `reminders` przy POST wybiera domyślne offsety typu; pusta tablica
  wyłącza wspólne przypomnienia. PATCH bez tego pola zachowuje ich konfigurację,
  także po zmianie typu. PATCH i odnowienie przeliczają wszystkie terminy,
  również osobiste, bez zmiany ich właścicieli. Zapis dokumentu i przypomnień
  jest jedną transakcją.
- Body dokumentu przyjmuje wspólne `family`, `adults` (domyślne), `owner`.
  Osobiste `user` tworzy wyłącznie `/api/reminders/mine` z `documentId`, zawsze
  dla zalogowanej osoby, także dziecka. Odczyt dokumentów nie ujawnia cudzych
  przypomnień osobistych.
- Nowe APK żąda `includeDocuments=true` obok `includeTasks=true`. Bez tej flagi
  harmonogram nie zawiera dokumentów, aby starsze APK mogło nadal zwalidować
  kontrakt. Payload zawiera bezwzględną datę ważności; offsety używają 09:00
  w strefie rodziny (domyślnie Europe/Warsaw). `documentUrl` wskazuje
  `/dokumenty/:id`; ekran otwierany z alarmu pozostaje w kroku 8.4.
- Migracja 0021 dodaje FK dokumentu z kaskadą usuwania i indeks przypomnień
  dokumentów. Bez nowych zależności runtime, zmiennych środowiskowych ani crona.
- Testy automatyczne adaptera sprawdzają trwały zapis offline oraz zastąpienie
  i anulowanie alarmu po synchronizacji. Nie zastępują odbioru alarmu na
  fizycznym telefonie ani prób po restarcie opisanych w fazie 8.
- Weryfikacja lokalna 22.10.2026: 234 testy zmiany i zależnych modułów,
  lint i formatowanie zmienionych plików, typecheck, build WWW/API,
  `release:smoke` i debug APK przeszły. ADB nie wykrywa podłączonego telefonu;
  odbiór alarmu offline i próby po restarcie nie zostały wykonane.
  Na polecenie właściciela kończymy lokalnym commitem na `main`;
  zweryfikowane lokalnie, oczekuje na CI. Krok nie ma jeszcze pełnego odbioru.

## 22.10.2026 — CRUD dokumentów, krok 8.1 (#18)

- Zakres wynika z `archive/plan-przyszle-fazy.md`, zgodnie z poleceniem właściciela.
  Krok obejmuje typy, statusy, walidację i CRUD; przypomnienia i odnowienie
  pozostają w 8.2, a UI w 8.3–8.4. POST nie przyjmuje jeszcze `reminders`.
- Na polecenie właściciela dodajemy `car_guarantee_inspection` (przegląd
  gwarancyjny samochodu), z pojazdem i domyślnymi offsetami 30 i 7 dni.
- Dokument zachowuje ważność przez cały `expiresOn`; `expired` zaczyna się
  następnego dnia w strefie rodziny. Próg `expiring` jest włączny i liczony
  w dniach kalendarzowych, bez wpływu zmiany czasu.
- Posiadacz i pojazd pozostają opcjonalne. Posiadacz musi należeć do tej
  samej rodziny i dotyczy tylko dowodu lub paszportu; pojazd dotyczy tylko
  trzech typów samochodowych. PATCH waliduje wynik po połączeniu zmian
  z zapisanym dokumentem; przy zmianie typu niepasujące pola trzeba wyczyścić.
  Zapobiega to zachowaniu powiązań niezgodnych z typem.
- Brak nowych zależności runtime, konfiguracji ani crona. Migracja dodaje
  wyłącznie tabelę dokumentów i indeks; integracja FK przypomnień z dokumentami
  należy do 8.2.

## 22.10.2026 — wielodniowe wydarzenia jednorazowe

- Obok „Całodniowe” dodajemy przełącznik „Wielodniowe” wyłącznie dla
  wydarzeń jednorazowych. Pokazuje datę i godzinę końca; dla całodniowych
  wystarcza data ostatniego dnia, wliczana do wydarzenia.
- Wykorzystujemy istniejące `durationMinutes`, bez migracji i nowych pól API.
  Dla wydarzeń z godziną jest to różnica momentów UTC, z uwzględnieniem strefy
  rodziny. Dla całodniowych jednorazowych pełne wielokrotności 1440 oznaczają
  dni kalendarzowe, dzięki czemu zmiana czasu nie przesuwa końca poza północ.
  Dotychczasowe `null` nadal oznacza jeden dzień. Limit pozostaje 525600 minut
  lub 365 dni kalendarzowych. Starsze APK mogą pokazywać całodniowy zakres
  jako jeden dzień; poprawny podgląd i edycja wymagają aktualizacji APK.
- Zapytanie o wystąpienia uwzględnia trwające wydarzenia jednorazowe rozpoczęte
  przed wyświetlanym zakresem. Koniec API pozostaje wyłączny. Przypomnienia
  nadal odnoszą się do początku wydarzenia.

## Wcześniejsze decyzje

[Pełne wcześniejsze wpisy](archive/decisions-historia.md) zachowują treść,
daty i moc obowiązujących decyzji; samo przeniesienie niczego nie uchyla.
Czytaj wpisy dotyczące zmiany, bez rutynowego wczytywania całej historii.
Rozbieżności wskazuje [raport porządkowania](DOKUMENTACJA_RAPORT.md).

- [21.10.2026 — pozostałe ekrany redesignu, krok R.6](archive/decisions-historia.md#21102026--pozostałe-ekrany-redesignu-krok-r6)
- [21.10.2026 — redesign zadań, krok R.5](archive/decisions-historia.md#21102026--redesign-zadań-krok-r5)
- [21.10.2026 — redesign zakupów, krok R.4](archive/decisions-historia.md#21102026--redesign-zakupów-krok-r4)
- [21.10.2026 — porządki w sesjach (#34)](archive/decisions-historia.md#21102026--porządki-w-sesjach-34)
- [21.10.2026 — zbiorcze usuwanie zrobionych zadań](archive/decisions-historia.md#21102026--zbiorcze-usuwanie-zrobionych-zadań)
- [21.10.2026 — podział modułów API](archive/decisions-historia.md#21102026--podział-modułów-api)
- [20.10.2026 — wymagane źródło mutacji API (CSRF)](archive/decisions-historia.md#20102026--wymagane-źródło-mutacji-api-csrf)
- [20.10.2026 — zadania offline (7.6)](archive/decisions-historia.md#20102026--zadania-offline-76)
- [19.10.2026 — wycofanie PWA, kroki 4.8-4.10](archive/decisions-historia.md#19102026--wycofanie-pwa-kroki-48-410)
- [Ręcznie uruchamiany deploy GitHub Actions — krok 4.7 (2026-10-16)](archive/decisions-historia.md#ręcznie-uruchamiany-deploy-github-actions--krok-47-2026-10-16)
- [Numeracja zgodna z kolejnością prac (2026-10-16)](archive/decisions-historia.md#numeracja-zgodna-z-kolejnością-prac-2026-10-16)
- [Android i działające wdrożenie (2026-10-16)](archive/decisions-historia.md#android-i-działające-wdrożenie-2026-10-16)
- [Wcześniejsze wdrożenie (2026-10-16)](archive/decisions-historia.md#wcześniejsze-wdrożenie-2026-10-16)
- [Krok 2.7 (2026-10-12)](archive/decisions-historia.md#krok-27-2026-10-12)
- [Krok 2.5 (2026-10-12)](archive/decisions-historia.md#krok-25-2026-10-12)
- [Krok 4.1 — sesja Androida (2026-10-16, przed implementacją)](archive/decisions-historia.md#krok-41--sesja-androida-2026-10-16-przed-implementacją)
- [Krok 4.2 — kontrakt harmonogramu (2026-10-16)](archive/decisions-historia.md#krok-42--kontrakt-harmonogramu-2026-10-16)
- [Krok 4.3 — trwałe alarmy Androida (2026-10-16)](archive/decisions-historia.md#krok-43--trwałe-alarmy-androida-2026-10-16)
- [Krok 4.4 — synchronizacja harmonogramu (2026-10-17)](archive/decisions-historia.md#krok-44--synchronizacja-harmonogramu-2026-10-17)
- [Krok 4.5 — nawigacja Androida i podgląd alarmu (2026-10-17)](archive/decisions-historia.md#krok-45--nawigacja-androida-i-podgląd-alarmu-2026-10-17)
- [17.10.2026 — krok 4.6: podpisywanie i aktualizacje Androida](archive/decisions-historia.md#17102026--krok-46-podpisywanie-i-aktualizacje-androida)
- [17.10.2026 — diagnostyka lokalnego podpisywania APK](archive/decisions-historia.md#17102026--diagnostyka-lokalnego-podpisywania-apk)
- [18.10.2026 — deploy ze starszego API bez pobierania Androida](archive/decisions-historia.md#18102026--deploy-ze-starszego-api-bez-pobierania-androida)
- [18.10.2026 — izolacja instalacji zależności podczas deployu](archive/decisions-historia.md#18102026--izolacja-instalacji-zależności-podczas-deployu)
- [18.10.2026 — nowe APK przy każdym Deploy](archive/decisions-historia.md#18102026--nowe-apk-przy-każdym-deploy)
- [17.10.2026 — krok 4.7: ręczny deploy istniejącego serwera](archive/decisions-historia.md#17102026--krok-47-ręczny-deploy-istniejącego-serwera)
- [19.10.2026 — stan alarmów po zgłoszeniu z OPPO](archive/decisions-historia.md#19102026--stan-alarmów-po-zgłoszeniu-z-oppo)
- [19.10.2026 — systemowe alarmy kalendarza po próbie APK deploy.3](archive/decisions-historia.md#19102026--systemowe-alarmy-kalendarza-po-próbie-apk-deploy3)
- [19.10.2026 — usunięcie serwerowego Web Push, krok 4.9](archive/decisions-historia.md#19102026--usunięcie-serwerowego-web-push-krok-49)
- [19.10.2026 — usunięcie niestabilnego testu migracji PWA](archive/decisions-historia.md#19102026--usunięcie-niestabilnego-testu-migracji-pwa)
- [19.10.2026 — pionowa nawigacja WWW i menu mobilne](archive/decisions-historia.md#19102026--pionowa-nawigacja-www-i-menu-mobilne)
- [19.10.2026 — API zakupów, krok 5.1](archive/decisions-historia.md#19102026--api-zakupów-krok-51)
- [20.10.2026 — interfejs zakupów (krok 5.2)](archive/decisions-historia.md#20102026--interfejs-zakupów-krok-52)
- [20.10.2026 — trwałe zakupy offline (krok 5.3)](archive/decisions-historia.md#20102026--trwałe-zakupy-offline-krok-53)
- [20.10.2026 — plan podglądu rodziny i kalendarza offline (5.4–5.5)](archive/decisions-historia.md#20102026--plan-podglądu-rodziny-i-kalendarza-offline-5455)
- [20.10.2026 — trwały podgląd rodziny (krok 5.4)](archive/decisions-historia.md#20102026--trwały-podgląd-rodziny-krok-54)
- [20.10.2026 — trwały podgląd kalendarza (krok 5.5)](archive/decisions-historia.md#20102026--trwały-podgląd-kalendarza-krok-55)
- [20.10.2026 — imiona domowników i nazwa rodziny](archive/decisions-historia.md#20102026--imiona-domowników-i-nazwa-rodziny)
- [20.10.2026 — listy zadań: model i widoczność (krok 7.1, #12)](archive/decisions-historia.md#20102026--listy-zadań-model-i-widoczność-krok-71-12)
- [20.10.2026 — CRUD zadań i widok na dziś (krok 7.2, #13)](archive/decisions-historia.md#20102026--crud-zadań-i-widok-na-dziś-krok-72-13)
- [20.10.2026 — przypomnienia zadań (7.3, #14) i usunięcie nagłówka](archive/decisions-historia.md#20102026--przypomnienia-zadań-73-14-i-usunięcie-nagłówka)
- [20.10.2026 — zakładka Zadania (7.4, #15)](archive/decisions-historia.md#20102026--zakładka-zadania-74-15)
- [21.10.2026 — pobieranie zależności Androida](archive/decisions-historia.md#21102026--pobieranie-zależności-androida)
- [21.10.2026 — pełny formularz i szczegóły wydarzenia, krok R.3](archive/decisions-historia.md#21102026--pełny-formularz-i-szczegóły-wydarzenia-krok-r3)
- [21.10.2026 — kalendarz i karty dnia, krok R.2](archive/decisions-historia.md#21102026--kalendarz-i-karty-dnia-krok-r2)
- [21.10.2026 — wspólny motyw redesignu, krok R.1](archive/decisions-historia.md#21102026--wspólny-motyw-redesignu-krok-r1)
- [20.10.2026 — gest przesuwania kalendarza na telefonie](archive/decisions-historia.md#20102026--gest-przesuwania-kalendarza-na-telefonie)
- [21.10.2026 — strona 404 redesignu R.7](archive/decisions-historia.md#21102026--strona-404-redesignu-r7)
- [21.10.2026 — logo launchera Androida](archive/decisions-historia.md#21102026--logo-launchera-androida)
