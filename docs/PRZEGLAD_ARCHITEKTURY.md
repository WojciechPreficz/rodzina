# Przegląd architektury i propozycje usprawnień

Data: 26.10.2026. Stan kodu podczas przeglądu: `0a9b7d9`.

**Status: propozycje do zaplanowania; niezaimplementowane.** Dokument opisuje dwa
pozostałe problemy z przeglądu. Opis zachowuje kontekst kodu `0a9b7d9`;
aktualne decyzje i wyniki wykonanych zmian są w [DECISIONS.md](DECISIONS.md).
Dokument nie zmienia zakresów i statusów faz w [planie](plan.md), nie zatwierdza decyzji architektonicznych
ani wdrożenia. Każdą przyszłą zmianę należy realizować jako osobny, wskazany krok.
Decyzje wykraczające poza obecne ustalenia należy wtedy zapisać w [DECISIONS.md](DECISIONS.md).

Podstawowy układ pozostaje odpowiedni: modularny monolit Fastify, SQLite, kontrakty
Zod w `packages/shared` i wspólny frontend React dla WWW oraz APK. Propozycje zachowują
ograniczenia cPanel i Passengera: bez stałego procesu w tle, Redisa, WebSocketów i PWA.

## Kolejność i zakres

Kolejność poniżej odpowiada przeglądowi i proponowanej kolejności prac.
Numeracja pozostałych punktów jest zachowana. Punkt 4 opisuje ryzyko wydajności
wymagające pomiarów, a punkt 5 koszt utrzymania.

| Punkt | Problem                                              | Oczekiwany rezultat                                    |
| ----- | ---------------------------------------------------- | ------------------------------------------------------ |
| 4     | Synchronizacja pobiera całe zbiory wieloma żądaniami | Mniej żądań HTTP i zapytań SQL, potwierdzone pomiarami |
| 5     | Sesja jest związana z modułami funkcjonalnymi        | Osobne zarządzanie sesją i koordynowanie modułów       |

## 4. Synchronizacja pobiera całe zbiory wieloma żądaniami

### Stan i skutki

[taskQueries.ts](../apps/web/src/features/tasks/taskQueries.ts) uruchamia synchronizację
co 20 sekund. `TaskPrefetch` jest montowany globalnie przez `AuthProvider`, a widoki
zadań również używają tego hooka. Store współdzieli trwającą synchronizację, ale każde
użycie hooka zakłada własne subskrypcje i interwał.

Bez zapisów w kolejce jeden przebieg store wykonuje odczyt sesji, list oraz osobny odczyt
wszystkich zadań dla każdej listy. Jest to `2 + L` żądań dla `L` list, niezależnie od
odświeżania sesji w samym providerze. Androidowy
[RodzinaApiPlugin](../android/app/src/main/java/pl/preficze/rodzina/RodzinaApiPlugin.java)
wykonuje żądania w jednym executorze, z limitem 20 sekund na wywołanie HTTP.

W [repozytorium wydarzeń](../apps/api/src/modules/events/repository.ts) odczyt listy
wykonuje kolejne zapytania o uczestników, przypomnienia i wyjątki dla każdego wydarzenia.
Generowanie harmonogramu korzysta z tego odczytu i dodatkowo pobiera przypomnienia osobiste.
To ryzyko rosnącego kosztu, a nie wynik wykonanego testu obciążeniowego.

### Proponowana implementacja

1. Zmierzyć bazową liczbę żądań, czas synchronizacji, rozmiar odpowiedzi i liczbę zapytań
   SQL na stałym zestawie danych, np. 1, 10 i 30 list oraz rosnącej liczbie wydarzeń.
   Osobno uwzględnić WWW, APK, wznowienie aplikacji i wolną odpowiedź API.
2. Dodać zbiorczy odczyt zadań, np. `GET /api/tasks/snapshot`, zwracający wyłącznie dostępne
   listy i ich zadania z jednego spójnego odczytu bazy. Kontrakt opisać w shared,
   a starych endpointów nie usuwać ze względu na wspierane starsze APK.
3. Sprawdzenie tożsamości przed ponawianiem operacji zachować. Zbiorczy snapshot może
   zastąpić pobranie list oraz ich zawartości, ale nie może omijać kontroli uprawnień
   przed zapisem ani przy zwracaniu zapisanej odpowiedzi idempotentnej mutacji.
4. Dla wydarzeń pobierać relacje grupowo, według identyfikatorów należących do rodziny,
   i składać je w pamięci. Uwzględnić ograniczenie liczby parametrów SQL przez porcjowanie.
   Podobnie ograniczyć odczyty przypomnień przy generowaniu harmonogramu.
5. Oddzielić subskrybowanie danych od uruchamiania synchronizacji. Pozostawić jednego
   właściciela interwału na konto, wspólne wywołanie w toku i ponawianie po odzyskaniu sieci.
   Szczegółowe wydzielenie koordynatora opisuje punkt 5.
6. Najpierw zachować szeregowość natywnego transportu. Ewentualna współbieżność wymaga
   osobnego projektu kolejności logowania, zapisu cookie i wylogowania. Dalsze zmiany,
   takie jak synchronizacja przyrostowa, wynikają dopiero z pomiarów po optymalizacji.

**Pliki:** moduły tasks, events i reminders w API, kontrakt snapshotu w shared,
`taskOffline.ts`, `taskQueries.ts` oraz powiązane testy. Natywny transport jest miejscem
pomiaru; jego przebudowa nie jest warunkiem pierwszej optymalizacji.

### Weryfikacja i kryteria odbioru

- Liczba żądań do pobrania snapshotu nie rośnie z liczbą list. Liczba zapytań do relacji
  wydarzeń rośnie co najwyżej z liczbą porcji, zamiast osobno dla każdego wydarzenia.
- Pomiary przed i po są wykonane na tych samych danych; raport zawiera również rozmiary
  odpowiedzi. Sam spadek liczby żądań nie dowodzi krótszego czasu synchronizacji.
- Testy obejmują prywatne listy, cofnięcie udostępnienia, izolację rodzin i przypomnienia
  osobiste. Błąd lub częściowa odpowiedź nie zastępują kompletnego cache.
- Próby WWW i fizycznego APK potwierdzają wznowienie, utratę sieci i zmianę konta.
  Starsze wspierane APK nadal korzysta z dotychczasowych kontraktów.

## 5. Zarządzanie sesją jest związane z modułami funkcjonalnymi

### Stan i skutki

[auth.tsx](../apps/web/src/auth.tsx) obsługuje sesję, odtworzenie danych rodziny,
persystencję zakupów, aktywację magazynów offline, prefetching oraz synchronizację alarmów.
Dodawanie modułu wymaga zmian w centralnej obsłudze sesji. Istnieje również zależność
w obu kierunkach: `auth.tsx` importuje `TaskPrefetch`, a `taskQueries.ts` importuje `useMe`
z `auth.tsx`. Taki układ komplikuje testy i ocenę kolejności inicjalizacji.

[accountStorage.ts](../apps/web/src/accountStorage.ts) zawiera już rejestr magazynów
z kolejnością czyszczenia. To przydatna podstawa; nie trzeba zastępować wszystkich
magazynów jednym nowym mechanizmem persystencji.

### Proponowana implementacja

1. Wydzielić kontekst, typ stanu sesji i hook odczytu do niezależnego modułu, np.
   `sessionContext.ts`. Moduły funkcjonalne mają importować ten kontrakt, bez importowania
   komponentu providera ani koordynatora.
2. Ograniczyć provider do stanu tożsamości i operacji sesji. Odtwarzanie cache oraz
   przejścia konta kierować przez jawny koordynator, np. `accountLifecycle.ts`.
   Rozszerzyć istniejący rejestr wyłącznie o rzeczywiście potrzebne operacje.
3. Rejestrację adapterów magazynów wykonać jawnie w miejscu składania aplikacji.
   Adaptery zachowują obecne formaty danych, walidację i zabezpieczenia generacji;
   koordynator ustala kolejność, zamiast znać szczegóły każdego magazynu.
4. Przenieść `TaskPrefetch`, `CalendarPrefetch` i `ScheduleSync` do osobnego komponentu
   uruchamianego wewnątrz providera sesji. Zapewnić jedną rejestrację synchronizacji
   na konto oraz pełne usunięcie interwałów i listenerów przy zmianie konta i odmontowaniu.
5. Zachować jawne rozróżnienie wylogowania, utraty sesji, zmiany konta i zdarzenia storage
   z innej karty. To ostatnie nie może usuwać świeżo zapisanych danych drugiej karty.
   Zachować też wcześniejsze unieważnianie generacji magazynów i alarmów oraz zatrzymanie
   persystencji przed czyszczeniem zapytań.

**Pliki:** `apps/web/src/auth.tsx`, `accountStorage.ts`, miejsce składania aplikacji
w `router.tsx` lub `main.tsx`, proponowane moduły kontekstu i koordynatora, importy hooka
sesji w modułach oraz testy przejść konta i synchronizacji.

### Weryfikacja i kryteria odbioru

- Kontekst sesji nie importuje modułów funkcjonalnych. Provider nie importuje ich magazynów
  ani komponentów synchronizacji; jawne składanie zależności następuje wyżej.
- Testy regresyjne obejmują start offline, wylogowanie offline, zmianę konta, utratę sesji,
  komunikację kart oraz opóźnione odpowiedzi i zapisy poprzedniego konta.
- Po ponownym montowaniu oraz zmianie konta nie pozostają nadmiarowe interwały i listenery.
  Testy uwzględniają cykl montowania w React Strict Mode.
- Refaktoryzacja zachowuje formaty cache i kontrakty API. Próby WWW oraz fizycznego APK
  potwierdzają odtworzenie danych i czyszczenie alarmów przy wylogowaniu.

## Zasady odbioru przyszłych zmian i stan weryfikacji przeglądu

Każdy punkt wymaga osobnego zakresu wykonawczego i odbioru zgodnie z sekcją 1.2
[planu](plan.md). Zmiany kodu wymagają odpowiednich testów, lint i formatowania zmienionych
plików oraz typecheck. Zmiany pakowania, migracji i jobów wymagają lokalnego
`release:smoke`. Pełną weryfikację automatyczną dla końcowego commita wykonuje istniejące CI.
Zmiany wspólnego UI wymagają prób przy 390 i 1280 px oraz odpowiednich prób fizycznego APK.

Podczas przeglądu stanu `0a9b7d9` przeszło 69 testów w sześciu plikach: regresje auth,
idempotencja, odbiorcy przypomnień, rejestr magazynów konta, zadania offline i kontakty offline.
Próby w sandboxie napotkały błąd `ENOENT` plików tymczasowych Vitest; ponowienie poza
sandboxem zakończyło się sukcesem. Wynik dotyczy istniejącego kodu i nie potwierdza
działania proponowanych rozwiązań. Nie wykonano pełnego CI, pomiarów obciążenia ani prób
fizycznego APK w ramach tego przeglądu.

Dokument zawiera wyłącznie pozostałe propozycje. Nie zmienia statusów istniejących
faz ani ich odbiorów.
