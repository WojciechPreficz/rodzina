# Plan wdrożenia redesignu „Ciepły i przyjazny”

Data: 21.10.2026. Status: plan do realizacji; zapisanie dokumentu nie oznacza wdrożenia redesignu.

## 1. Cel i zasady realizacji

Wspólny frontend strony WWW i APK otrzymuje wygląd kierunku „Ciepły i przyjazny”:
kremowe tło, szałwiowe akcenty, jasne karty, delikatne obramowania i szeryfowe
tytuły. Zachowujemy działające funkcje, dane, uprawnienia i obsługę offline.
Nie wdrażamy kierunków minimalistycznego ani kolorowego i nowoczesnego.

To osobny ciąg kroków R.1–R.8 dotyczących prezentacji istniejącej aplikacji.
Nie zmienia numeracji ani statusów faz w [planie projektu](plan.md).
Obowiązują jego sekcje 1, 1.1 i 1.2 oraz AGENTS.md: jeden krok na czat i commit,
kontrole lokalne w zakresie zmiany, końcowe CI i wymagane próby Androida.
Nie realizujemy przy tej okazji niewdrożonych funkcji kolejnych faz.

Przed każdym krokiem sprawdzić aktualny kod i zmiany w katalogu roboczym.
Na dzień opracowania planu istnieją niezacommitowane zmiany m.in. uwierzytelniania
i rodziny; nie nadpisywać ich ani nie włączać do commita redesignu.
Opis stanu kodu poniżej nie jest potwierdzeniem akceptacji wcześniejszych faz.

## 2. Źródła projektu i sposób ich użycia

Źródło: [projekt MagicPath](https://www.magicpath.ai/files/463387065032278016).
Nazwa pliku nadal zawiera „trzy kierunki redesignu”, ale aktualny podgląd
kalendarza pokazuje już tylko „Ciepły i przyjazny”.

| Obszar                                    | Komponent MagicPath  | Rewizja referencyjna |
| ----------------------------------------- | -------------------- | -------------------- |
| Kalendarz WWW i telefonu                  | `463387072267452416` | `463604648243240960` |
| Zadania i Zakupy, wybór listy i zawartość | `463388652152692736` | `463391177069174784` |
| Dodawanie wydarzenia i strona 404         | `463520743301451776` | `463522197215002624` |

Rewizje wyznaczają punkt odniesienia. Przed implementacją otworzyć właściwy
komponent, obejrzeć wszystkie jego zakładki i stany, odczytać kod oraz porównać
widoki 390 i 1280 px. Późniejsze zmiany projektu wymagają jawnego wskazania nowej
rewizji w tym dokumencie. Logo widoczne jako osobny obraz na canvasie nie jest
automatycznie zatwierdzonym zamiennikiem znaku użytego w ekranach.

Przenosimy wygląd i układ ekranów, bez ramek przeglądarki/telefonu, przełączników
„Komputer/Telefon”, przycisku symulowania offline, przykładowych osób i dat,
napisów o prototypie ani zewnętrznych linków do podglądów MagicPath.
Nie kopiujemy atrap zapisu i danych w `useState`. Akcje korzystają z obecnych
hooków, API, walidacji i kolejek. Nie dodajemy Tailwinda ani drugiego systemu UI;
źródła MagicPath służą jako specyfikacja dla React i Mantine.

### Granice makiet i rozstrzygnięcia

- Projekt pokazuje szczegółowo kalendarz, zakupy, zadania, nowy formularz i 404.
  Logowanie, rodzina, powiadomienia i wersja aplikacji otrzymują ten sam motyw
  i komponenty, bez wymyślania nowych funkcji. Obiady pozostają obecnym ekranem
  zastępczym, dopóki osobna faza nie dostarczy modułu; Dokumentów nie dodajemy.
- Formularz projektujemy jako pełny widok treści: dwie kolumny na komputerze,
  jedna na telefonie. Obecnie dodawanie otwiera modal. W R.3 zmieniamy kontener
  dodawania na widok w obrębie kalendarza, zachowując istniejące linki do wydarzeń.
  Nie wprowadzamy nowego publicznego adresu tylko na podstawie napisu w makiecie.
- Na desktopie listy i szczegóły są obok siebie; na telefonie najpierw wybór listy,
  potem zawartość z powrotem. To rzeczywista nawigacja aplikacji, bez zmniejszania
  całego ekranu przez `transform: scale()` i bez sztywnych wysokości z prototypu.
- Zachowujemy Schedule-X i jego obsługę dat, zakresów oraz gestów. Dostosowujemy
  wygląd i dostępne rozszerzenia biblioteki; nie zastępujemy go statyczną siatką.
- Nie kopiujemy uproszczeń biznesowych makiet: kategorii zakupów nie definiujemy
  ponownie, kolorów domowników nie przypisujemy na sztywno, a lista odbiorców
  przypomnień wynika z kontraktu danego modułu i uprawnień.

## 3. Stan wyjściowy i mapa plików

| Obszar              | Istniejące miejsce implementacji                                                                                                                                                   | Docelowa zmiana                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Motyw               | `apps/web/src/main.tsx`                                                                                                                                                            | Wydzielenie konfiguracji Mantine i wspólnych tokenów                    |
| Nawigacja i Android | `apps/web/src/components/AppShell.tsx`, `apps/web/src/native.css`                                                                                                                  | Jasne menu, znak aplikacji, aktywna pozycja, spójne odstępy i safe area |
| Kalendarz           | `apps/web/src/features/calendar/CalendarPage.tsx`, `calendar.css`, `DistantEvents.tsx`                                                                                             | Nagłówek, filtry, karta kalendarza i odległych terminów                 |
| Formularze wydarzeń | `EventForm.tsx`, `RecurrenceFields.tsx`, `EventDetailsPage.tsx`, `MyReminders.tsx` w katalogu kalendarza                                                                           | Karty sekcji, responsywny układ, szczegóły w tym samym stylu            |
| Przypomnienia       | `apps/web/src/components/ReminderPicker.tsx`                                                                                                                                       | Wspólny wygląd bez zmiany semantyki                                     |
| Zakupy              | `apps/web/src/features/shopping/ShoppingPage.tsx`, `QuickAdd.tsx`                                                                                                                  | Katalog list, szczegóły, grupy i akcje                                  |
| Zadania             | `apps/web/src/features/tasks/TasksPage.tsx`, `TaskForm.tsx`, `TaskListSettings.tsx`, `TodayTasks.tsx`                                                                              | Listy, wiersze, formularze i karta dnia                                 |
| Pozostałe ekrany    | `components/AuthLayout.tsx`, `AuthPages.tsx`, `JoinPages.tsx`, `WelcomePage.tsx`, `MorePage.tsx`, `EmptyPage.tsx`; `features/family`, `features/notifications`, `features/updates` | Spójność komponentów i stanów                                           |
| Routing             | `apps/web/src/router.tsx`, `nativeNavigation.ts`                                                                                                                                   | Obsługa 404 i zachowanie dotychczasowej nawigacji                       |
| Teksty              | `apps/web/src/i18n/pl.ts`                                                                                                                                                          | Polskie etykiety i komunikaty                                           |

Ścieżki względne w wierszach modułów odnoszą się do wskazanego katalogu.
Przed edycją zweryfikować rzeczywistą nazwę pliku nawigacji natywnej
(`nativeNavigation` jest importowany w aplikacji); nie tworzyć drugiej implementacji.
Obecnie router zawiera zakupy i zadania, a Obiady są ekranem zastępczym.
Istnieją już cache rodziny/kalendarza i kolejki zakupów/zadań; nie budujemy ich ponownie.

## 4. Wspólne reguły wizualne

Poniższe kolory pochodzą z referencji kalendarza. W R.1 porównać je z pozostałymi
makietami i zapisać jedną, wspólną konfigurację dla całej aplikacji.

| Token            | Wartość wyjściowa | Zastosowanie                             |
| ---------------- | ----------------- | ---------------------------------------- |
| Tło              | `#f6f3eb`         | Tło aplikacji                            |
| Powierzchnia     | `#fffefa`         | Karty, formularze, menu                  |
| Tekst            | `#2f4035`         | Treść i nagłówki                         |
| Tekst pomocniczy | `#7b857b`         | Punkt wyjścia, wymaga kontroli kontrastu |
| Obramowanie      | `#e6e7de`         | Podziały i granice kart                  |
| Akcent           | `#426655`         | Główne akcje i zaznaczenie               |
| Tło akcentu      | `#e7eee5`         | Aktywne menu i karty wyróżnione          |
| Ciepły akcent    | `#e0b07b`         | Drobne elementy dekoracyjne              |

- Tekst i kontrolki: obecny font systemowy lub lokalny font bezszeryfowy;
  nagłówki stron: Georgia z rezerwowym `serif`. Nie uzależniać APK od Google Fonts.
  Bazowy tekst około 14–16 px, główne tytuły około 36–43 px na desktopie
  i 30–36 px na telefonie. Rozmiary dostosować do realnej treści i skalowania tekstu.
- Odstępy w skali 4/8/12/16/24/32 px; karty około 16–20 px promienia,
  kontrolki około 10–12 px, filtry domowników jako zaokrąglone przyciski.
  Delikatny cień nie zastępuje czytelnej granicy kontrolki.
- WWW od 768 px: menu 240 px po lewej. Węższa strona i APK: hamburger po prawej,
  panel z prawej; APK zachowuje ten model także na szerokim urządzeniu.
  Bez górnego paska z powtórzoną nazwą zakładki, tytuł w treści.
- Kolejność obecnego menu: Kalendarz, Zadania, Zakupy, Obiady, Rodzina,
  Powiadomienia, Wersja aplikacji. Konto i wylogowanie na dole.
- Widoczny fokus, etykiety pól i ikon, obsługa klawiatury, cel dotykowy co najmniej
  44 × 44 px. Kontrast tekstu zwykłego co najmniej 4,5:1, dużego 3:1;
  konieczne korekty kolorów zapisać. Kolor nie jest jedynym oznaczeniem stanu.
- Banery błędu, offline, utraty dostępu i aktualizacji APK pozostają widoczne.
  Uwzględnić safe area, klawiaturę ekranową, systemowy Wstecz i powiększenie tekstu.
  Baner ani przycisk dodawania nie może zasłaniać treści i hamburgera.

## 5. Kroki implementacji

Każdy krok kończy się działającym ekranem z prawdziwymi danymi. Nie tworzymy
nieużywanych komponentów „na zapas”. W każdym kroku UI obowiązują próby
390 i 1280 px oraz sprawdzenie zmienionego frontendu w APK.

### R.1 — Motyw i wspólny szkielet aplikacji

**Zakres:** wydzielić `apps/web/src/theme.ts` i wspólne style; skonfigurować kolory,
typografię i komponenty Mantine. Dostosować `AppShell`, menu, konto, hamburger
i panel. Wprowadzić wspólny nagłówek strony użyty od razu w kalendarzu.
Zachować ochronę niezapisanych zmian i działanie wylogowania.

**Gotowe, gdy:** wszystkie istniejące trasy otwierają się, menu ma właściwy aktywny
stan, działa przy 767/768 px i w APK, a modale/selektory renderowane w portalach
korzystają z motywu. Treść nie nachodzi na hamburger ani paski systemowe.
Istniejące testy `AppShell.test.tsx`, `e2e/app-navigation.spec.ts`
i odpowiednie scenariusze `e2e/android-navigation.spec.ts` przechodzą.

### R.2 — Kalendarz i karty dnia

**Zależność:** R.1.

**Zakres:** nagłówek z miesiącem, dodawanie wydarzenia, filtry domowników,
karta „Dziś do zrobienia” z `TodayTasks`, odległe terminy, wygląd Schedule-X.
Dopasować desktopowy miesiąc oraz mobilny tydzień/agendę, zachowując pozostałe
obecne widoki, zmianę zakresu i gesty. Używać rzeczywistej strefy rodziny i dat.

**Gotowe, gdy:** filtry i nawigacja dat zmieniają rzeczywiste wyniki, kliknięcie
wydarzenia otwiera obecne szczegóły, a karta zadań respektuje prywatność.
Offline zachowuje ostatnie dane i blokuje zapisy; brak pokrycia cache nie udaje
pustego kalendarza. Przechodzą powiązane testy kalendarza/`TodayTasks`
oraz `e2e/calendar.spec.ts`, `calendar-swipe.spec.ts`, `calendar-offline.spec.ts`.

### R.3 — Tworzenie, edycja i szczegóły wydarzenia

**Zależność:** R.2.

**Zakres:** pełny widok dodawania zgodny z makietą, trzy rodzaje wydarzeń,
sekcje szczegółów, terminu, uczestników i przypomnień. Dwie kolumny na komputerze,
jedna na telefonie; na telefonie wybór rodzaju w selektorze. Współdzielić
`EventForm`, `RecurrenceFields` i `ReminderPicker` z edycją, dopasować szczegóły
i przypomnienia osobiste. Powrót/Anuluj wraca do kalendarza i chroni brudny formularz.

**Gotowe, gdy:** działają zapis i walidacja wszystkich rodzajów, całodniowe,
precyzja miesiąca, zakończenia serii i dotychczasowe zakresy edycji/usuwania.
Zapis nie kasuje cudzych przypomnień osobistych. Zmiana na offline blokuje także
wcześniej otwarty formularz; nie kolejkujemy mutacji kalendarza. Sukces pokazujemy
dopiero po udanym API. Sprawdzić odpowiednie testy `EventForm`, szczegółów,
`MyReminders`, `ReminderPicker` i scenariusze wydarzeń w Playwright.
W APK sprawdzić klawiaturę, Wstecz, link z alarmu i powrót do kalendarza.

### R.4 — Zakupy: katalog list i zawartość

**Zależność:** R.1–R.3.

**Zakres:** na desktopie wybór listy obok zawartości; na telefonie katalog,
wejście do listy i powrót z przywróceniem przewinięcia oraz fokusu.
Szybkie dodawanie, grupy kategorii, kupione, edycja i akcje listy zgodne z makietą.
Wspólny element katalogu wydzielić tylko w zakresie faktycznie użytym tutaj.

**Gotowe, gdy:** działają wszystkie dotychczasowe operacje i uprawnienia dzieci,
grupowanie korzysta z `SHOPPING_CATEGORIES`, a stan kupienia wskazuje właściwą osobę.
Mobilny Wstecz wraca najpierw do katalogu. Zachowana jest kolejka offline,
ponawianie i komunikaty błędów synchronizacji; brak lokalnych danych ma osobny stan.
Sprawdzić testy zakupów, `QuickAdd` i `e2e/shopping.spec.ts`, także utratę sieci
w otwartej liście i po powrocie do katalogu.

### R.5 — Zadania: listy, szczegóły i ustawienia

**Zależność:** R.4; wykorzystać sprawdzony układ katalogu i szczegółów.

**Zakres:** „Moje zadania”, listy udostępnione z awatarami, szybkie dodawanie,
termin/przeterminowanie, przypisanie, sekcja „Zrobione”, formularz i ustawienia.
Zachować `/zadania/:listId?zadanie=:taskId`; bezpośredni link otwiera właściwą
listę i zadanie także bez wcześniejszego przejścia przez katalog.

**Gotowe, gdy:** wygląd odpowiada referencji, a właściciel, członek listy,
osoba bez dostępu i dziecko zachowują obecne uprawnienia. Działają udostępnianie,
przypomnienia, ukończenie/ponowne otwarcie, czyszczenie zrobionych i błędy kolejki.
Nie pokazujemy prywatnej treści osobie bez dostępu ani w alarmie systemowym.
Sprawdzić testy zadań, `e2e/tasks.spec.ts`, `tasks-sharing.spec.ts`,
`tasks-offline.spec.ts` oraz mobilny powrót i wejście z alarmu w APK.

### R.6 — Pozostałe istniejące ekrany

**Zależność:** R.5.

**Zakres:** dostosować logowanie, rejestrację, wejście dziecka, zaproszenie,
reset hasła, powitanie, rodzinę, powiadomienia i wersję aplikacji do wspólnego
motywu i układu kart. Ekran Obiadów otrzymuje wyłącznie wspólny wygląd.
Nie zmieniać rozpoczętych niezależnie prac dotyczących kont.

**Gotowe, gdy:** nie ma pozostałości starego stylu w aktywnych ekranach,
formularze mają czytelne błędy i loading, a prawa administratora/dorosłego/dziecka
pozostają zgodne z API. Rodzina offline pozostaje tylko do odczytu.
WWW i APK pokazują właściwe informacje o przypomnieniach i aktualizacjach;
nie pojawiają się przyciski instalacji PWA ani zgody Web Push.
Sprawdzić odpowiednie testy komponentów i `e2e/auth.spec.ts`, `family-offline.spec.ts`,
`notifications.spec.ts`, `android-updates.spec.ts`.

### R.7 — Strona 404

**Zależność:** R.6.

**Zakres:** dodać `NotFoundPage.tsx`, lokalną ilustrację domu zgodną z referencją
i trasę przechwytującą nieznany adres. Ilustracja może być SVG z kodu makiety;
nie wymaga generowania nowego obrazu. Link „Wróć do kalendarza” jest wewnętrzny.
Zalogowany użytkownik zachowuje szkielet aplikacji; niezalogowany otrzymuje
publiczny układ z powrotem przez istniejącą ochronę kalendarza do logowania.

**Gotowe, gdy:** nieznany adres pokazuje 404 przy wejściu i odświeżeniu WWW oraz
w APK. Wygaśnięty token, brak dostępu i usunięte wydarzenie nadal mają własne
komunikaty. Trasa wildcard nie przechwytuje poprawnych linków zaproszeń,
resetu hasła i alarmów. Dodać testy routingu/komponentu i krótki test headless
404 dla obu szerokości, w tym nawigacji niezalogowanego użytkownika.

### R.8 — Odbiór całości i przygotowanie aktualizacji

**Zależność:** R.1–R.7.

**Zakres:** porównać każdy ekran z referencją, usunąć zbędne style,
sprawdzić dostępność i regresje na granicach modułów. Poprawki tylko w zakresie
redesignu. Wyniki wraz z brakującymi próbami zapisać w `docs/DEVELOPMENT.md`;
rozstrzygnięcia implementacyjne w `docs/DECISIONS.md`.

**Gotowe, gdy:** spełnione są kryteria sekcji 6, wymagane CI dla końcowego commita
jest zielone, a próby fizycznego Androida mają faktyczne wyniki. Nie zaliczać
przy tej okazji zaległych prób faz funkcjonalnych bez ich wykonania.
Strona jest gotowa do aktualizacji sprawdzoną paczką release, APK do osobnej
kompilacji i podpisania. Wdrożenie następuje na osobne polecenie według
`docs/DEPLOY.md`; ten krok nie uruchamia produkcyjnego deployu.

## 6. Weryfikacja i kryteria odbioru

### Kontrole podczas implementacji

- Testy zmienianych komponentów i powiązanych modułów; zachować istniejące testy
  uprawnień/offline. Nowe testy obejmują istotne zmiany zachowania i nawigacji,
  bez kopiowania struktury JSX jako testu.
- Lint i formatowanie zmienionych plików oraz `npm run typecheck` przed wysłaniem
  kodu. Playwright wyłącznie headless, według wskazanych scenariuszy;
  projekty `desktop` i `phone` już mają 1280 × 800 oraz 390 × 844.
- Przykładowo: `npm test -- apps/web/src/features/calendar` oraz
  `npm run test:e2e -- e2e/calendar.spec.ts`. Dobierać zakres do kroku.
- Build lokalny potrzebny do prób produkcyjnego UI/APK, kontrole natywne według
  ryzyka zmiany. Pełny zestaw zapewnia istniejące CI na Node 24,
  z Playwright, `release:smoke` i osobnym jobem Androida.
- Nie uruchamiać rutynowo lokalnego `release:smoke` dla samych stylów.
  Wykonać go, jeżeli zmieni się pakowanie, konfiguracja lub zależności runtime.

### Lista odbioru końcowego

- [ ] Porównano kalendarz, wszystkie rodzaje formularza, zakupy, zadania i 404
      z przypiętymi rewizjami przy 390 i 1280 px; zapisano zrzuty i wyjaśniono odstępstwa.
- [ ] Nie ma poziomego przewijania całej strony, obciętych formularzy ani nakładania
      przycisków. Sprawdzono także 767/768 px, długie nazwy, dużo list i powiększony tekst.
- [ ] Stany ładowania, pusty wynik, brak cache, błąd, brak dostępu, utrata sesji,
      oczekująca synchronizacja i zablokowany zapis mają czytelny wygląd.
- [ ] Działa nawigacja klawiaturą, fokus po zamknięciu dialogu/powrocie do katalogu,
      etykiety, kontrast i komunikaty niezależne od koloru.
- [ ] W APK na fizycznym telefonie sprawdzono menu, systemowy Wstecz, klawiaturę,
      przewijanie formularza, safe area i wejście do wydarzenia/zadania z powiadomienia.
- [ ] Zimny start APK offline pokazuje zapisane dane; zakupy i zadania zachowują
      kolejki, rodzina i kalendarz blokują zapisy. Powrót sieci odświeża dane.
- [ ] Kontrolny alarm na fizycznym telefonie działa offline z zamkniętym interfejsem;
      raport zawiera rzeczywistą datę i wynik. Dodatkowe testy restartu wykonać,
      jeśli zmieniono obsługę natywną/harmonogram lub nadal wymaga ich zaległy krok.
- [ ] Nie zmieniono API, migracji, znaczenia dat, uprawnień, odbiorców alarmów,
      trwałego cache ani danych produkcyjnych; ewentualna konieczność takiej zmiany
      otrzymała osobny zakres zamiast ukrytej realizacji w redesignie.
- [ ] CI dla końcowego commita zakończyło wszystkie wymagane zadania sukcesem.
      Raport podaje commit, link CI, kontrole lokalne i faktyczne próby sprzętowe.

Przed commitem/pushem albo przy oczekującym CI stosować status
„zweryfikowane lokalnie, oczekuje na CI”, jeżeli kontrole lokalne wykonano.
Brakujących prób nie oznaczać jako zaliczonych. Sam plan wymaga przeglądu
treści, diffu i formatowania, bez testów ani buildu aplikacji.

## 7. Polecenie do rozpoczęcia implementacji

```text
Przeczytaj AGENTS.md, sekcje 1, 1.1 i 1.2 docs/plan.md oraz docs/REDESIGN_PLAN.md.
Zrealizuj wyłącznie krok R.1 planu redesignu „Ciepły i przyjazny”.
Przed zmianami sprawdź aktualne komponenty i rewizje MagicPath wskazane w planie.
Wypisz pliki do zmiany. Zachowaj istniejące niezacommitowane zmiany innych prac.
Nie realizuj następnych kroków, nowych funkcji faz ani produkcyjnego deployu.
Sprawdź UI przy 390 i 1280 px i zmieniony frontend w APK; brakujących prób nie zaliczaj.
Na końcu opisz spełnienie kryteriów kroku, kontrole lokalne.
```
