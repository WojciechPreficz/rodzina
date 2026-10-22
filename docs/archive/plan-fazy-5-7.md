# Plan — zakresy zaimplementowanych faz 5 i 7

Przeniesiono 22.10.2026 z docs/plan.md. Zachowano treść i statusy z chwili zapisu;
przeniesienie nie potwierdza zakończenia faz, CI, prób telefonu ani wdrożenia.
Archiwum czytaj tylko w zakresie potrzebnym do zadania. Bieżące wymagania
i reguły pierwszeństwa określa [plan](../plan.md).

### Faza 5 - lista zakupów

**Cel:** wspólna lista, której używa się w sklepie, także przy słabym zasięgu.

**Rozszerzenie planu, 20.10.2026:** po kroku 5.3 wykonujemy osobno 5.4 i 5.5,
zanim rozpoczniemy fazę 6. Krok 5.3 zachowuje pierwotne kryteria zakupów i otwarte
próby telefonu; rozszerzenie ich nie zalicza. Dla rozszerzonej fazy ostatnim krokiem
w rozumieniu sekcji 1.2 jest 5.5, z regresją zakupów oraz kryteriami 5.4–5.5.
Kroki 5.4 i 5.5 mają implementacje opisane poniżej; pozostają otwarte próby
ręczne i fizycznego telefonu oraz końcowa weryfikacja CI.

**Endpointy:**

- Listy: `GET/POST /api/shopping/lists`, `PATCH/DELETE /api/shopping/lists/:id`. Przy pierwszym wejściu powstaje domyślna lista "Zakupy".
- Pozycje:
  - `GET /api/shopping/lists/:id/items`
  - `POST /api/shopping/lists/:id/items` z `{ name, quantity?, category? }`
  - `PATCH /api/shopping/items/:id` (name, quantity, category, isChecked, position)
  - `DELETE /api/shopping/items/:id`
- `POST /api/shopping/lists/:id/clear-checked`.
- `GET /api/shopping/suggestions?q=` zwraca maksymalnie 8 pozycji z `shopping_history`, posortowanych po `use_count` i `last_used_at`.
- Dodanie pozycji aktualizuje `shopping_history`. Kategoria jest podpowiadana z historii, a jeśli jej tam nie ma, przyjmowana jest wartość `inne`.
- Kategorie to stała lista w `shared`:
  - warzywa i owoce, pieczywo, nabiał, mięso i ryby, mrożonki, suche i sypkie, napoje
  - chemia i higiena, dla dzieci, inne

**UI:**

- Zakładki list.
- Pole szybkiego dodawania na górze z podpowiedziami, z możliwością wpisania "mleko 2l": tekst po ostatniej spacji z cyfrą trafia do ilości.
- Pozycje pogrupowane po kategoriach. Tap odhacza: przekreślenie, przeniesienie na dół i pokazanie "kupił(a): Ania".
- Swipe albo menu: edytuj, usuń.
- Przycisk "Wyczyść kupione" z potwierdzeniem.

**Słaby zasięg:**

- `@tanstack/query-sync-storage-persister` (cache w localStorage) i mutacje z `networkMode: 'offlineFirst'`, wznawiane po powrocie sieci (`resumePausedMutations`).
- Baner "Jesteś offline - zmiany zostaną wysłane po odzyskaniu połączenia".
- Dotyczy tylko edycji modułu zakupów. Lokalny harmonogram przypomnień Androida z fazy 4 jest odrębnym mechanizmem; nie daje pełnej edycji kalendarza, zadań ani dokumentów offline.

**Kroki realizacji:**

#### Krok 5.1 - API zakupów

**Stan 19.10.2026:** zrealizowany i sprawdzony lokalnie. Migracja 0014,
schematy shared i wszystkie endpointy zakupów są gotowe. Przechodzą lint,
format:check, typecheck, 385 testów Vitest (w tym 18 nowych testów zakupów
i migracji), build i `release:smoke`. Wyniki i mapowanie kryteriów są
w DEVELOPMENT, decyzje kontraktu w DECISIONS. UI i kolejka offline pozostają
w krokach 5.2–5.3. Ten krok nie wdraża produkcji ani nie publikuje APK.

- **Zakres:** migracje `shopping_lists`, `shopping_items`, `shopping_history`. Stała lista kategorii w `shared`. Wszystkie endpointy z tej fazy (listy, pozycje, `clear-checked`, `suggestions`). Domyślna lista "Zakupy" przy pierwszym wejściu. Aktualizacja historii przy dodaniu pozycji i podpowiadanie kategorii. Pola `checked_by` i `checked_at`. Uprawnienia dziecka: przegląda, dodaje i odhacza dowolne pozycje, edytuje i usuwa tylko własne, bez "Wyczyść kupione" i zarządzania listami.
- **Gotowe, gdy:** testy API: CRUD, izolacja rodzin, podpowiedzi z historii (maksymalnie 8, sortowanie po `use_count` i `last_used_at`), `clear-checked`, uprawnienia dziecka.

#### Krok 5.2 - UI: lista zakupów

**Stan 20.10.2026:** zaimplementowany lokalnie: ekran zakupów, parser shared,
podpowiedzi, zarządzanie listami i produktami, uprawnienia dziecka oraz mutacje
optymistyczne. Przechodzą standardowe kontrole, 401 testów Vitest, 32 testy
Playwright headless i build debug APK. Wyniki i ograniczenia weryfikacji Androida zapisano
w DEVELOPMENT, decyzje UI w DECISIONS. Trwała kolejka offline pozostaje krokiem
5.3; produkcja i opublikowane APK nie są aktualizowane w ramach tego kroku.

- **Zakres:** zakładka Zakupy z zakładkami list i zarządzaniem listami (dodaj, zmień nazwę, usuń, dla dorosłych). Parser szybkiego dodawania w `shared` ("mleko 2l", "jajka 10 szt"). Podpowiedzi. Pozycje pogrupowane po kategoriach, odhaczanie (przekreślenie, przeniesienie na dół, "kupił(a): Ania"), edycja i usuwanie (swipe albo menu), "Wyczyść kupione" z potwierdzeniem. `refetchInterval` 20 s, `refetchOnWindowFocus` i mutacje optymistyczne.
- **Gotowe, gdy:** test parsera i komponentu dodawania, ukrywanie akcji niedostępnych dla dziecka. Ręcznie: odhaczenie w jednym kontekście przeglądarki jest widoczne w drugim po maksymalnie 20 s.

#### Krok 5.3 - Słaby zasięg i domknięcie fazy

**Stan 20.10.2026:** zaimplementowano trwały cache i dziennik mutacji zakupów,
odtwarzanie konta i kolejki po ponownym uruchomieniu lokalnego frontendu,
wznawianie po powrocie sieci oraz czyszczenie przy wylogowaniu. Migracja 0015
zabezpiecza ponawianie żądań przed podwójnym zapisem. Wyniki i otwarte próby
akceptacyjne są w DEVELOPMENT. Nie potwierdzono jeszcze próby zamknięcia procesu
i synchronizacji na fizycznym telefonie; faza nie jest oznaczona jako zamknięta.

Od etapu Android kryteria offline zakupów obejmują także APK: kolejka i cache są trwałe, przypisane do konta i odtwarzane po zamknięciu procesu. Powrót sieci w aktywnej aplikacji wznawia mutacje, a wylogowanie usuwa dane poprzedniej osoby. Nie zakładamy, że sam `networkMode` zapisuje kolejkę na dysku; wymagane są serializacja, funkcje odtwarzania mutacji i test przerwanego procesu. Bez wymogu wysyłania kolejki przy zamkniętym APK.

- **Zakres:** `@tanstack/query-sync-storage-persister` (cache w localStorage), mutacje z `networkMode: 'offlineFirst'` wznawiane po powrocie sieci (`resumePausedMutations`), baner "Jesteś offline - zmiany zostaną wysłane po odzyskaniu połączenia". Tylko moduł zakupów.
- **Gotowe, gdy:** wszystkie kryteria akceptacji fazy 5, w tym ręcznie w trybie offline (DevTools): odhaczenie 3 pozycji i dodanie 1, a po włączeniu sieci zmiany widać w drugim kontekście. Punkty z sekcji 1.1 i `release:smoke`.

**Kryteria akceptacji:**

- Testy API: CRUD, izolacja rodzin, podpowiedzi z historii, `clear-checked`.
- Test komponentu: parsowanie "mleko 2l" i "jajka 10 szt".
- Manualnie: w trybie offline (DevTools) da się odhaczyć 3 pozycje i dodać 1. Po włączeniu sieci zmiany są widoczne w drugim kontekście przeglądarki.
- Odhaczenie w jednym kontekście jest widoczne w drugim po maksymalnie 20 s.
- Spełnione punkty z sekcji 1.1.

**Poza zakresem:** ceny i budżet, skanowanie kodów, sortowanie według układu sklepu.

#### Krok 5.4 - Rodzina offline i wspólny zapis danych do podglądu

**Stan 20.10.2026:** zaimplementowano trwały zapis domowników i kodu rodziny,
odtwarzanie konta, blokady zmian offline i odświeżanie po powrocie sieci/wznowieniu.
Migracja zachowuje cache i niewysłane zakupy. Wyniki kontroli oraz otwarte próby
fizycznego telefonu są w DEVELOPMENT. Krok pozostaje otwarty do tych prób
i sukcesu CI końcowego commita. Implementację 5.5 opisano osobno poniżej.

**Cel:** po wcześniejszej synchronizacji domownicy i kod rodziny są widoczni
także po uruchomieniu APK bez internetu. Wejście do Rodziny nie wymaga
wcześniejszego otwarcia tej zakładki w bieżącym procesie aplikacji.

- **Zakres danych:** po potwierdzeniu sesji online pobieramy domowników, zapisujemy
  ich identyfikatory, nazwy, kolory i role oraz minimalny kontekst konta, nazwę
  rodziny, strefę czasową i kod dołączenia. Nie utrwalamy adresów e-mail, PIN-ów,
  haseł, tokenów sesji ani linków zaproszeń/resetu. Kod dołączenia jest świadomym
  rozszerzeniem danych lokalnych: obecny snapshot zakupów zapisuje `joinCode: ''`.
  Pokazujemy ostatni zsynchronizowany kod z informacją, że mógł się zmienić.
- **Trwałość i izolacja:** zapis jest wersjonowany i przypisany do pary
  rodzina/użytkownik. Klucze zapytań domowników również uwzględniają tę parę
  (obecne `['family', 'members']` nie wystarcza). Wspólny moduł zapisu/odtwarzania
  współpracuje z `AuthProvider`; migracja zachowuje istniejący cache, sesję
  i dziennik niewysłanych zakupów. Stary snapshot bez kodu/domowników wymaga
  pierwszego połączenia online, bez pokazywania pustego kodu jako poprawnego.
- **UI:** bezpośrednio pod nagłówkiem, przed kartami, widoczny jest żółty baner
  w stylu zakupów: „Jesteś offline — pokazujemy ostatnio zapisane dane. Zmiany
  wymagają połączenia z internetem.” Dodajemy czas ostatniego udanego pobrania.
  Baner pozostaje widoczny także przy braku cache. Wtedy zamiast nieskończonego
  loadera pokazujemy „Brak danych rodziny zapisanych na tym urządzeniu. Połącz
  się z internetem, aby je pobrać.”
- **Akcje:** offline przyciski „Dodaj dziecko”, „Utwórz zaproszenie” i wygenerowania
  nowego kodu pozostają widoczne dla uprawnionych osób, ale są nieaktywne.
  Rodzina jest w całości tylko do odczytu: blokujemy także edycję/usuwanie
  domownika, zmianę PIN-u/roli i generowanie resetu hasła. Wyjaśnienie przy akcjach
  brzmi „Dostępne po połączeniu z internetem”. Uprawnienia nadal decydują
  o widoczności; nie ujawniamy dziecku akcji administratora. Utrata sieci przy
  otwartym formularzu blokuje zapis; nie tworzymy oczekującej mutacji.
- **Sieć i błędy:** wspólne wykrywanie korzysta z istniejącego `onlineManager`
  i błędów transportu, także gdy urządzenie deklaruje połączenie, lecz API jest
  nieosiągalne. Sam status online nie potwierdza udanej synchronizacji. Błędy
  HTTP serwera pokazujemy zgodnie z ich znaczeniem. Powrót sieci/wznowienie APK
  odświeża sesję, domowników i kod, zachowując zapisany widok podczas pobierania.
  Nie nadpisujemy danych pustą wartością po błędzie i nie zapisujemy danych starego
  konta z opóźnionej odpowiedzi.
- **Usuwanie danych:** wylogowanie (również offline), zmiana konta i potwierdzona
  utrata sesji/dostępu usuwają odpowiedni cache w pamięci i na dysku. Brak sieci
  nie oznacza utraty sesji. Niedostępna pamięć, uszkodzony zapis lub brak miejsca
  dają czytelny komunikat; nie deklarujemy zapisania danych, gdy zapis się nie udał.
- **Gotowe, gdy:** testy zapisu i komponentów obejmują zimny start APK z cache,
  brak cache, migrację ze snapshotu zakupów, kod rodziny, wszystkie blokady,
  zmianę konta, wylogowanie offline, 401/403, spóźnione odpowiedzi, błąd pamięci
  i powrót sieci. Regresja potwierdza zachowanie niewysłanych zakupów. Playwright
  headless sprawdza Rodzinę przy 390 i 1280 px, utratę sieci oraz odświeżenie kodu
  zmienionego na drugim urządzeniu. Ręcznie sprawdzamy te widoki i na fizycznym
  telefonie: wcześniejsza synchronizacja, tryb samolotowy, zamknięcie procesu,
  ponowne uruchomienie, widoczni domownicy i kod, nieaktywne akcje, powrót sieci.
  Wyniki zapisujemy w DEVELOPMENT; kontrole i CI według sekcji 1.2.

#### Krok 5.5 - Kalendarz offline tylko do odczytu

**Stan 20.10.2026:** zaimplementowano wersjonowany cache zakresów, szczegółów,
osobistych przypomnień i odległych terminów, pobieranie po potwierdzeniu konta,
lokalne widoki/filtry, blokady wszystkich zapisów oraz odświeżanie po powrocie
sieci. Wyniki i ograniczenia weryfikacji są w DEVELOPMENT. Nie zaliczono prób
fizycznego telefonu ani końcowego CI; krok i faza pozostają otwarte.

**Zależność:** ukończony krok 5.4 zapewnia trwałych domowników, strefę czasową,
izolację kont i wspólny stan połączenia. Nie odtwarzamy kalendarza z harmonogramu
alarmów Androida, bo obejmuje on tylko dane potrzebne przypomnieniom.

- **Zakres cache:** po potwierdzeniu sesji online pobieramy wystąpienia bieżącego
  miesiąca oraz w tle poprzedniego i następnego; uwzględniamy dni sąsiednich
  miesięcy widoczne w siatce. Każde żądanie `/api/occurrences` respektuje limit
  62 dni. Zapisujemy również kolejne zakresy faktycznie otwarte online, odległe
  terminy i pełne szczegóły wydarzeń z pobranych zakresów (unikalne ID), aby
  kliknięcie wydarzenia offline otwierało jego zapisany podgląd bez wcześniejszej
  wizyty w szczegółach. Pobieranie szczegółów ma ograniczoną współbieżność.
- **Granice podglądu:** utrwalamy zakresy dat, potwierdzenie ich kompletności
  i czas ostatniego udanego pobrania osobno od danych. Dzień/tydzień/miesiąc oraz
  filtry domowników działają lokalnie dla zapisanych zakresów, niezależnie od
  dokładnego klucza zapytania Schedule-X. Brak pokrycia pokazuje „Ten zakres nie
  został zapisany offline. Połącz się z internetem, aby go pobrać.”; częściowy
  cache jest oznaczony, a brak cache nigdy nie oznacza „Brak wydarzeń”.
  Prawidłowo pobrany pusty zakres nadal oznacza brak wydarzeń. Zachowujemy
  najwyżej 12 ostatnio używanych zakresów miesięcznych i powiązane szczegóły,
  bez automatycznego kasowania ostatniego podglądu tylko z powodu wieku danych.
- **UI:** baner offline jest u góry zakładki i szczegółów, przed treścią:
  „Jesteś offline — kalendarz jest dostępny tylko do odczytu. Pokazujemy ostatnio
  zapisane dane.” Pokazujemy czas pobrania wyświetlanego zakresu. Zapisane dane
  pozostają widoczne przy nieudanym odświeżeniu; nie blokujemy całego kalendarza
  loaderem zapytania wstrzymanego offline. Brak szczegółów konkretnego wydarzenia
  ma własny komunikat i powrót do kalendarza. Wejście z powiadomienia korzysta
  najpierw z cache wydarzenia; dotychczasowy minimalny `OfflineReminder` pozostaje
  awaryjnym podglądem, gdy pełnych danych nie zapisano.
- **Tylko odczyt:** blokujemy „+”, tworzenie wszystkich rodzajów wydarzeń,
  edycję/usuwanie (także zakresy serii) i dodawanie/usuwanie przypomnień wspólnych
  oraz osobistych. Odczyt zapisanych przypomnień jest dozwolony; osobiste dane
  są przypisane do użytkownika. Blokady obejmują otwarte wcześniej formularze
  i wykonanie mutacji, aby akcja nie została automatycznie wysłana później.
  Istniejące alarmy systemowe działają nadal według zapisanego harmonogramu.
- **Synchronizacja:** powrót sieci/wznowienie APK po weryfikacji sesji odświeża
  aktywny zakres, domowników, odległe terminy i szczegóły; pozostałe zapisane
  zakresy oznaczamy do ponownego pobrania. Zmiany/usunięcia z innego urządzenia
  zastępują stary podgląd po udanym pobraniu. 404 wydarzenia usuwa jego zapisane
  szczegóły i unieważnia zakresy, które je zawierały; 401/403 obsługujemy zgodnie
  z utratą sesji/dostępu, bez awaryjnego pokazywania cofniętych danych.
  Cache odczytu nie planuje ani nie anuluje alarmów; ich aktualizacja pozostaje
  zadaniem istniejącego synchronizatora harmonogramu.
- **Gotowe, gdy:** testy cache i komponentów obejmują odtworzenie po restarcie,
  widoki i filtry, pokrycie częściowe/puste/brakujące, limity cache i żądań,
  szczegóły oraz odległe terminy, serie z wyjątkami, strefę Europe/Warsaw i zmianę
  czasu, wszystkie blokady mutacji, błąd transportu/pamięci, 401/403/404 i zmianę
  konta. Testy Playwright headless przy 390 i 1280 px obejmują przejście
  online → offline → online, obie zakładki i regresję zakupów. Ręczne próby UI
  oraz fizyczny telefon potwierdzają zimny start w trybie samolotowym, nawigację
  Rodzina ↔ Kalendarz ↔ Zakupy, szczegóły i link powiadomienia, blokady zapisów,
  zachowanie alarmu offline oraz odświeżenie zmian/usunięć z drugiego urządzenia.
  Wyniki w DEVELOPMENT, kontrole i końcowe CI według sekcji 1.2; otwartych prób
  kroku 5.3 nie oznaczamy jako zaliczonych. Wymagania sekcji 1.1 nadal obowiązują.

**Wspólne ograniczenia 5.4–5.5:** dostęp offline wymaga wcześniejszego udanego
pobrania i zachowanego zapisu na urządzeniu. Kod i wydarzenia są ostatnim znanym
stanem; urządzenie bez sieci nie wykryje zdalnych zmian ani cofnięcia dostępu.
APK uruchamia lokalny frontend bez internetu. Zwykła strona obsługuje utratę
sieci w otwartej aplikacji; nie przywracamy PWA ani gwarancji zimnego startu WWW.
Nie przewidujemy nowych endpointów, migracji, cronów ani zależności runtime
serwera. Aktualizacja strony i APK odbywa się osobno według istniejącej procedury,
po oddzielnym poleceniu wdrożenia.

**Poza zakresem 5.4–5.5:** tworzenie, edycja i usuwanie wydarzeń offline, kolejka
zmian kalendarza/rodziny, synchronizacja w zamkniętym APK oraz pełna kopia całej
historii i wszystkich przyszłych wydarzeń. Samo dodawanie wydarzeń jednorazowych
offline ma średni do dużego nakład pracy: wymaga trwałego dziennika i lokalnego
podglądu oczekujących zapisów, idempotencji `POST /api/events` (obecnie serwer
nadaje nowe ID przy każdym utworzeniu), weryfikacji uczestników i sesji po powrocie
sieci, obsługi odrzuconych zapisów oraz uzgodnienia alarmów przed synchronizacją
i po niej. Kolejkę zakupów można wykorzystać jako wzorzec, ale nie przenieść
bezpośrednio. Serie, wyjątki i edycja konfliktujących danych dodatkowo zwiększają
zakres. Obecna decyzja to wyłącznie odczyt; zapisy offline wymagają osobnego planu.

---

### Faza 7 - listy zadań

**Cel:** każdy domownik ma własne listy zadań. Wybraną listę może udostępnić konkretnym domownikom, np. wspólną listę "Remont łazienki" dla obojga rodziców.

**Rozszerzenie offline, decyzja właściciela 20.10.2026 (krok 7.6):** zapisane
listy i szczegóły zadań są dostępne offline, również po restarcie APK.
Ten zapis zastępuje wcześniejszy obowiązek potwierdzania online przed każdym
podglądem prywatnych szczegółów, także po otwarciu ogólnego alarmu. Dostęp
odpowiada ostatniej udanej synchronizacji; cofnięcia dostępu telefon offline
nie pozna do połączenia z serwerem. Powiadomienia pozostają ogólne.
Szczegóły zakresu i ograniczeń opisuje krok 7.6 poniżej.

**Zasady widoczności i uprawnień:**

- Każdy użytkownik (także dziecko) dostaje przy pierwszym wejściu domyślną listę "Moje zadania" (`is_default=true`). Tej listy nie można usunąć.
- Listę widzi i edytuje jej **właściciel** oraz domownicy z `task_list_members`. Pozostali, łącznie z adminem, nie widzą jej wcale (API zwraca 404, a lista nie pojawia się w żadnym widoku).
- Udostępnianie, zmianę nazwy i usunięcie listy może wykonać tylko właściciel. Członkowie mogą dodawać, edytować, odhaczać i usuwać zadania oraz opuścić listę.
- Zadanie może mieć `assignee_id`, czyli osobę z grona właściciela i członków listy.
- Udostępnianie odbywa się na poziomie całej listy, nie pojedynczych zadań. Jeśli trzeba podzielić się jednym zadaniem, użytkownik tworzy dla niego wspólną listę.

**Endpointy:**

- `GET /api/tasks/lists` zwraca listy widoczne dla użytkownika (własne i udostępnione), z licznikami otwartych zadań.
- `POST /api/tasks/lists` z `{ name, memberIds? }`, `PATCH /api/tasks/lists/:id` z `{ name?, memberIds? }` (właściciel), `DELETE /api/tasks/lists/:id` (właściciel, nie dotyczy listy domyślnej).
- `POST /api/tasks/lists/:id/leave` (członek).
- `GET /api/tasks/lists/:id/tasks?status=open|done|all`.
- `POST /api/tasks/lists/:id/tasks` z `{ title, notes?, dueDate?, dueTime?, assigneeId?, reminders? }`.
- `PATCH /api/tasks/:id` (title, notes, dueDate, dueTime, assigneeId, isDone, position, reminders), `DELETE /api/tasks/:id`.
- `GET /api/tasks/today` zwraca zadania z terminem na dziś lub przeterminowane ze wszystkich widocznych list.

**Przypomnienia:**

- Zadanie z terminem może mieć przypomnienia z `task_id`, z presetami:
  - "w dniu terminu", czyli offset 0: dla zadania bez godziny to 09:00 tego dnia (reguła z fazy 2), a dla zadania z godziną chwila terminu;
  - "dzień przed";
  - własne.
- Domyślny odbiorca to `audience=owner`, czyli osoba przypisana, a gdy jej brak, właściciel listy (sekcja 2). Dla list udostępnionych można wybrać też "wszyscy na liście". To dodatkowa wartość `audience=list_members`, dopisywana do enuma w tej fazie. Dostępne jest też "tylko ja" przez `/api/reminders/mine` z `taskId`. Wartości `family` i `adults` są dla zadań odrzucane przez walidację (sekcja 2).
- Odhaczenie zadania ustawia `next_fire_at = null` jego przypomnieniom, a odznaczenie przelicza je od nowa (sekcja 2).
- Harmonogram APK dostaje gałąź dla zadań z ogólną treścią bez tytułu, notatki ani nazwy prywatnej listy. Szczegóły wymagają aktualnego dostępu online; payload nie zawiera względnego „dziś” zapisanego na wiele dni.

**UI:**

- Nowa zakładka **Zadania** w dolnej nawigacji: Kalendarz, Zadania, Zakupy, Obiady, Więcej.
- Lista list: najpierw "Moje zadania", potem pozostałe. Przy udostępnionych widać awatary (kolory) członków.
- Widok listy:
  - szybkie dodawanie zadania;
  - zadanie z checkboxem, terminem (czerwony, jeśli przeterminowane) i awatarem przypisanej osoby;
  - sekcja "Zrobione" zwinięta na dole.
- Formularz zadania: tytuł, notatka, termin (data i opcjonalnie godzina), przypisanie, przypomnienia.
- Ustawienia listy (tylko właściciel): nazwa, wybór domowników do udostępnienia, usuń. Dla członka: "Opuść listę".
- Karta "Dziś do zrobienia" na górze kalendarza, obok "Dziś na obiad".

**Kroki realizacji:**

#### Krok 7.1 - Listy zadań: model i widoczność

- **Zakres:** migracje `task_lists`, `task_list_members` i `tasks` (cały model tej fazy). Serwis dostępu `canAccessList` (właściciel albo członek, wszyscy pozostali, łącznie z adminem, dostają 404). `GET/POST /api/tasks/lists`, `PATCH` i `DELETE /api/tasks/lists/:id`, `POST /api/tasks/lists/:id/leave`. Domyślna lista "Moje zadania" tworzona przy pierwszym wejściu każdego użytkownika (także dziecka), nieusuwalna. Rozszerzenie usuwania domownika o regułę list z sekcji 2 (prywatne listy usuwane, udostępnione przechodzą na pierwszego członka z `is_default=false`).
- **Gotowe, gdy:** testy API: 404 dla użytkownika spoza listy (także admina), 403 dla członka przy zmianie udostępnienia i usunięciu, listy domyślnej nie da się usunąć, `leave`, usunięcie domownika (przeniesienie albo usunięcie jego list), izolacja rodzin.

#### Krok 7.2 - Zadania: CRUD i widoki

- **Zakres:** `GET /api/tasks/lists/:id/tasks?status=open|done|all`, `POST /api/tasks/lists/:id/tasks`, `PATCH /api/tasks/:id`, `DELETE /api/tasks/:id`, `GET /api/tasks/today`. `assignee_id` tylko z grona właściciela i członków listy. Odhaczenie ustawia `done_by` i `done_at`. Liczniki otwartych zadań w `GET /api/tasks/lists`. Klucze do `users` z `ON DELETE SET NULL`.
- **Gotowe, gdy:** testy API: CRUD, filtr statusu, `today` (zadania na dziś lub przeterminowane ze wszystkich widocznych list, bez cudzych prywatnych), przypisanie osoby spoza listy daje 400, dostęp tylko przez listę (404 spoza niej), izolacja rodzin.

#### Krok 7.3 - Przypomnienia zadań

**Integracja Androida:** rozszerzamy kontrakt `/api/reminders/schedule` z fazy 4 o zadania, filtrując widoczność i odbiorców na serwerze. Lokalny alarm prywatnego zadania ma ogólną treść, bez danych zadania/listy; szczegóły wymagają aktualnego dostępu online. Odhaczenie, usunięcie, zmiana terminu, przypisania i członkostwa aktualizują/anulują alarmy po synchronizacji. Cofnięcie dostępu na serwerze nie może odwołać alarmu na telefonie offline. Testy obejmują usunięcie dostępu, wylogowanie, synchronizację i brak ujawnienia treści w zapisanym payloadzie; nie deklarujemy natychmiastowej synchronizacji przy zamkniętym APK.

- **Zakres:** dopisanie `list_members` do enuma `audience`. Walidacja per źródło (zadania: `owner`, `list_members`, `user`; `family` i `adults` dają 400). Przypomnienia w body zadania i `/api/reminders/mine` z `taskId`. Ukończone zadania są pomijane w snapshotach; odznaczenie przywraca przyszłe terminy. `resolveRecipients`: osoba przypisana albo właściciel, filtr widoczności, pusta lista bez awaryjnego `adults`. Ogólny payload APK z `taskUrl(listId, taskId)` w shared (trasa powstaje w 7.4). Historyczne `next_fire_at` przeliczamy zgodnie z sekcją 2, ale dostarczanie opiera się na snapshotach, bez joba.
- **Gotowe, gdy:** testy API harmonogramu potwierdzają właściwego odbiorcę, brak wpisów po opuszczeniu listy i dla osób spoza prywatnej listy, odrzucenie `family`/`adults`, usunięcie alarmów po odhaczeniu i ponowne wyliczenie po odznaczeniu. Testy adaptera potwierdzają anulowanie po synchronizacji/wylogowaniu i ogólny payload bez prywatnych treści. (+ `release:smoke`.)

#### Krok 7.4 - UI: zakładka Zadania

- **Zakres:** nowa zakładka w dolnej nawigacji (Kalendarz, Zadania, Zakupy, Obiady, Więcej). Lista list (najpierw "Moje zadania", przy udostępnionych awatary członków), tworzenie nowej listy. Widok listy: szybkie dodawanie, zadanie z checkboxem, terminem (czerwony po terminie) i awatarem osoby przypisanej, sekcja "Zrobione" zwinięta. Formularz zadania (tytuł, notatka, termin z opcjonalną godziną, przypisanie). Trasa `/zadania/:listId?zadanie=:taskId`. Odświeżanie co 20 s. Bez przypomnień i udostępniania (krok 7.5).
- **Gotowe, gdy:** testy komponentów (checkbox, przeterminowanie, zwijanie "Zrobione"). Ręcznie: dodanie, odhaczenie i edycja zadania w "Moje zadania".

#### Krok 7.5 - UI: udostępnianie, przypomnienia, "Dziś do zrobienia" i domknięcie fazy

- **Zakres:** ustawienia listy (właściciel: nazwa, wybór domowników do udostępnienia, usunięcie; członek: "Opuść listę"). Przypomnienia w formularzu zadania przez `ReminderPicker` z fazy 2 z ograniczonym zestawem odbiorców (domyślnie osoba przypisana albo właściciel, "wszyscy na liście" dla list udostępnionych, "tylko ja"). Presety "w dniu terminu", "dzień przed", własne. Karta "Dziś do zrobienia" na górze kalendarza obok "Dziś na obiad".
- **Gotowe, gdy:** wszystkie kryteria akceptacji fazy 7, w tym ręcznie: lista udostępniona drugiemu domownikowi pojawia się u niego po maksymalnie 20 s, a po cofnięciu udostępnienia znika. Punkty z sekcji 1.1 i `release:smoke`.

**Kryteria akceptacji:**

- Testy API:
  - Użytkownik spoza listy dostaje 404 na listę i jej zadania, także admin rodziny.
  - Członek nie może zmienić udostępnienia ani usunąć listy (403).
  - Listy domyślnej nie da się usunąć.
  - Izolacja rodzin.
  - Odhaczenie zadania czyści przypomnienie, a odznaczenie przywraca je z przeliczonym `next_fire_at`.
- Testy harmonogramu APK i adaptera:
  - przypomnienie dla zadania trafia do assignee, a gdy go nie ma, do właściciela;
  - po opuszczeniu listy przez członka jego wpisy, także „tylko ja”, znikają ze snapshotu i są anulowane po synchronizacji;
  - prywatne zadanie nie trafia do osoby spoza listy, także przy pustej liście odbiorców (bez awaryjnego `adults`);
  - payload nie ujawnia treści zadania/listy, wylogowanie usuwa dane i alarmy, a szczegóły wymagają dostępu online.
- Test walidacji: `audience=family` i `audience=adults` dla zadania dają 400.
- Manualnie: lista udostępniona drugiemu domownikowi pojawia się u niego po maksymalnie 20 s, a po cofnięciu udostępnienia znika.
- Spełnione punkty z sekcji 1.1.

#### Krok 7.6 - Zadania offline z trwałą kolejką zmian

- **Zakres:** po potwierdzeniu sesji pobranie wszystkich widocznych list i ich
  pełnych zadań, z zapisem per rodzina i użytkownik. Podgląd i formularz działają
  na zapisanych danych także po zamknięciu procesu APK. Offline można dodawać
  zadania do zapisanych list, edytować tytuł, notatkę i termin, odhaczać,
  ponownie otwierać i usuwać zadania. Karta „Dziś do zrobienia” wynika z lokalnych
  danych, bieżącej daty w strefie rodziny i oczekujących zmian.
- **Kolejka:** trwały dziennik operacji zapisywany przed potwierdzeniem zmiany
  w UI. Każda operacja ma UUID; API zapisuje wynik i zmianę w jednej transakcji,
  aby ponowienie nie dublowało zadania. Powrót sieci, wznowienie i aktywne
  odświeżanie co 20 s uruchamiają synchronizację. Brak wysyłki przy zamkniętym APK.
  Wysyłamy tylko zmienione pola; dla tego samego pola wygrywa ostatni zapis
  przyjęty przez serwer. Usuniętych zadań nie odtwarzamy.
- **Ograniczenia:** tworzenie i ustawienia list, udostępnianie, opuszczanie listy,
  zmiana przypisanej osoby i konfiguracji przypomnień wymagają internetu.
  Ekran i formularz offline wyjaśniają te ograniczenia, a kontrolki są zablokowane.
  Formularz otwarty offline wymaga ponownego otwarcia online, aby pobrać osobiste
  przypomnienia i udostępnić ich konfigurację bez utraty niezapisanych pól.
- **Prywatność:** wylogowanie i zmiana konta usuwają dane i kolejkę. Przed replay
  sprawdzamy sesję i widoczne listy, a API kontroluje dostęp również przed
  zwróceniem zapamiętanej odpowiedzi. Potwierdzona utrata listy usuwa jej cache
  i zatrzymuje zmiany z komunikatem. Błąd transportu zachowuje zapis lokalny.
- **Alarmy:** odhaczenie, usunięcie i zmiana terminu wstrzymują lokalne alarmy
  zadania przez zapis zmienionego harmonogramu APK. Ponowne otwarcie i nowe
  terminy oczekują na pobranie harmonogramu z serwera. Nie tworzymy nowego
  mechanizmu obliczania alarmów offline; payload nadal jest ogólny.
- **Gotowe, gdy:** testy trwałości, restartu, powtórzeń żądań, błędów pamięci,
  utraty dostępu, izolacji kont, spóźnionych odpowiedzi i niezależnych operacji
  wielu kart przechodzą. Próba online → offline → zamknięcie → otwarcie → online
  zachowuje zmiany i synchronizuje je z drugim kontekstem bez duplikatów.
  UI sprawdzone przy 390 i 1280 px, wspólny frontend także w APK; na fizycznym
  telefonie sprawdzono restart offline i anulowanie alarmu po odhaczeniu.
  Wymagane końcowe CI i gotowość do deployu z sekcji 1.1–1.2.

**Poza zakresem:** zadania cykliczne, podzadania, punkty i nagrody, załączniki, udostępnianie pojedynczych zadań, zarządzanie listami i konfiguracją przypomnień offline.

---
