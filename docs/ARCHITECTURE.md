# Architektura aplikacji

## Produkt i platformy

Rodzina organizuje kalendarz, zakupy, zadania, dokumenty i kontakty.
Obiady mają plan tygodnia, eksport do zakupów i dzisiejszą kartę, również z trwałą obsługą offline. Rodzina ma wspólne konto
z wieloma domownikami; listy zadań są prywatne lub udostępniane.
WWW i APK korzystają ze wspólnego React. APK zawiera lokalny frontend
i pobiera zdalne API. Alarmy dostarcza wyłącznie Android; zamknięta aplikacja
nie pobiera zmian w tle. Nie przywracamy PWA ani Web Push.

## Stack i podział kodu

- npm workspaces: apps/web (React 19, Vite, Mantine, Schedule-X,
  TanStack Query), apps/api (Fastify, Drizzle, SQLite), packages/shared
  (wspólne schematy Zod, typy i czas).
- API jest modularnym monolitem: modules/<moduł>/ zawiera routes,
  service, repository i testy. Połączenia z bazą centralizuje db/client.ts.
  better-sqlite3 działa synchronicznie z WAL i busy_timeout=5000.
- Migracje i transakcje, idempotencja, VACUUM INTO i gotowe binaria zależą
  od tego sterownika. Zmiana na klienta asynchronicznego wymaga osobnego
  projektu; sam interfejs adaptera nie zapewnia zgodności.
- Harmonogram i sekrety Androida pozostają w magazynach natywnych.
  Preferencje urządzenia nie są danymi rodziny. Dane konta i spóźnione
  odpowiedzi podlegają cyklowi życia sesji; zmiana konta nie może przywrócić
  danych poprzedniej osoby.
- Produkcja: cPanel vh.pl, Node 24, HTTPS i Phusion Passenger.
  Passenger może usypiać proces: bez stałego workera, WebSocketów,
  Dockera i Redisa. Jedynym cronem jest backup.
- server.cjs ładuje konfigurację i importuje ESM dist/server.js.
  Release zawiera public/ i drizzle/; ścieżki liczymy względem paczki.
  Konfigurację i procedury opisuje [DEPLOY.md](DEPLOY.md).

## Dane, czas i uprawnienia

- Identyfikatory: crypto.randomUUID() jako text. Momenty: integer ms UTC.
  Daty: YYYY-MM-DD; godziny: HH:mm albo null dla całodniowych.
  Strefa rodziny: Europe/Warsaw. Konwersje czasu są w shared/src/time.ts.
- familyId pochodzi wyłącznie z sesji, nigdy z parametrów klienta.
  Repozytoria przyjmują go jako pierwszy argument. Role: admin, member, child.
  Dziecko odczytuje wspólne dane, a uprawnienia zadań zależą też od listy.
- Schematy SQLite są w apps/api/src/db/schema.ts i migracjach, kontrakty JSON
  w packages/shared/src/schemas. Nie utrzymujemy drugiej listy wszystkich kolumn.
- createdBy i inne wskazania historycznej osoby są nullable z ON DELETE SET NULL;
  UI pokazuje „były domownik”. Usunięcie źródła usuwa jego relacje i przypomnienia.
  Usunięcie domownika czyści sesje, członkostwa i jego przypomnienia osobiste.
  Prywatne listy znikają; udostępnione przechodzą na pierwszego członka
  (is_default=false), a bez członków są usuwane.
- Zaproszenia są jednorazowe, ważne 7 dni. Reset tworzony przez administratora
  jest ważny 24 godziny. Hasła/PIN-y: Argon2id; tokeny: hash SHA-256.
  Sesje odnawiają się przy aktywności, ważność 60 dni. Nie usuwamy ostatniego
  administratora pojedynczo; może on usunąć całą rodzinę. Nie zmieniamy dzieci
  w dorosłych i odwrotnie.
- Usuwanie kont działa wyłącznie online na ekranie „Rodzina”. Administrator
  usuwa dowolnego domownika lub całą rodzinę; inny dorosły tylko siebie
  i dowolne dziecko swojej rodziny. Dzieci nie usuwają kont. Własne konto
  administrator usuwa tylko wtedy, gdy pozostanie inny administrator;
  usunięcie siebie nie usuwa automatycznie dzieci. Uprawnienia edycji profilu
  i PIN-u pozostają odrębne.
- DELETE /api/members/:id wymaga JSON { password }, a DELETE /api/family
  dodatkowo confirmationName zgodnego z aktualną nazwą rodziny po usunięciu
  skrajnych spacji. Hasło należy do wykonującego operację. Limit potwierdzeń
  jest wspólny: 10 prób/15 minut na konto, trwale w SQLite; 429 z Retry-After.
  Odpowiedź { ok: true, deleted: true, resetOwnSession } wskazuje czyszczenie
  własnej sesji i alarmów. Błędne hasło daje 403 INVALID_CREDENTIALS, ostatni
  administrator 409 LAST_ADMIN, a brak hasła w starszym APK
  409 ACCOUNT_DELETION_UPDATE_REQUIRED. Pozostałe funkcje starszego APK działają.
- Usuwanie i przygotowanie zależności odbywają się w transakcji immediate,
  z ponownym sprawdzeniem sesji, hasha hasła, ról i ostatniego administratora
  po asynchronicznej weryfikacji hasła. Pojedyncze usunięcie zachowuje wspólne
  treści i dotychczasowe przekazywanie list zadań. Usunięcie rodziny usuwa
  jej dane w aktywnej bazie, najpierw listy zadań i kontakty, następnie rodzinę
  z relacjami, kontami i sesjami; nie przekazuje list usuwanym osobom.
- Interfejs wymaga hasła i potwierdzenia skutków, a dla rodziny wpisania nazwy.
  Nie kolejkuje usuwania i nie ponawia go automatycznie. Nieznany wynik wymaga
  sprawdzenia sesji lub obecności domownika przed kolejną próbą. Hasło nie jest
  utrwalane w magazynach ani historii mutacji. Usunięcie siebie lub rodziny
  uruchamia istniejące wylogowanie i czyszczenie danych, niewysłanych zmian
  oraz alarmów, także w innych kartach. Inne urządzenia wykrywają usunięcie
  przy kontakcie z API; offline mogą do tego czasu zachować dane i alarmy.
- Kontakty: jedna grupa na kontakt, jedna nieusuwalna grupa domyślna „Inne”
  na rodzinę; pozostałe początkowe grupy: Rodzina, Znajomi, Praca.
  Usunięcie grupy przenosi kontakty do domyślnej w transakcji.
  Dorośli edytują, cała rodzina odczytuje; brak integracji z książką telefonu.
- Obiady: jeden `dinner` na datę i rodzinę, składniki zachowują kolejność.
  `GET /api/meals?weekStart=YYYY-MM-DD` wymaga poniedziałku i zwraca siedem
  `days` z datą i tablicą `meals`, również dla pustych dni. Dorośli wykonują
  `PUT` (upsert) i `DELETE /api/meals/:date/dinner`; dziecko tylko odczytuje.
  PUT zastępuje składniki i notatkę, zachowując ID i autora istniejącego obiadu.
  `POST /api/meals/copy-week` kopiuje dni źródła atomowo: `overwrite=false`
  pomija zajęte dni, `true` zastępuje ich zawartość. Pozostałe dni docelowe
  pozostają bez zmian; kopiowanie na ten sam tydzień jest odrzucane.
  `GET /api/meals/suggestions?q=` zwraca do 20 różnych tytułów z aktualnie
  zapisanych obiadów rodziny wraz ze składnikami ostatnio zapisanego wariantu.
  Wyszukiwanie i grupowanie ignorują wielkość liter i różnice białych znaków.
  Zakładka `/obiady` pokazuje siedem dni od poniedziałku, nawigację tygodni
  i powrót do bieżącego tygodnia według strefy rodziny. Dorośli dodają,
  edytują i usuwają obiady; formularz pozwala wybrać wcześniejsze danie
  z jego składnikami, zmienić notatkę i składniki. Kopiowanie poprzedniego
  tygodnia wymaga potwierdzenia z opcjonalnym nadpisaniem zajętych dni.
  Dziecko widzi wyłącznie odczyt. Pobrane tygodnie i podpowiedzi są zapisywane
  w istniejącym IndexedDB dla rodziny i użytkownika. Dorośli mogą przeglądać,
  edytować i usuwać obiady offline oraz kopiować znany tydzień do znanego
  tygodnia. Niepobrany tydzień nie oznacza pustego planu i blokuje zapis.
  Niezapisany formularz ma ochronę przed przypadkowym zamknięciem.
  `POST /api/meals/to-shopping-list?operationId=<UUID>` przyjmuje `weekStart`,
  `listId`, opcjonalne `mealIds` (1–7 ID z tego tygodnia) i `confirmRepeat`
  (domyślnie false). Brak filtra wybiera cały tydzień; nieznane ID daje 404,
  powtórzone ID nie zwielokrotnia składników. Eksport jest tylko dla dorosłych.
  W jednej transakcji scala składniki po nazwie (NFKC, białe znaki, wielkość
  liter) z niekupionymi pozycjami listy. Ilości łączy tekstowo przez `+`,
  pomijając brakujące wartości, bez konwersji jednostek. Kupione pozycje
  pozostają bez zmian; nowa potrzeba tworzy osobną niekupioną pozycję.
  Nowe pozycje korzystają z historii kategorii zakupów i aktualizują historię.
  Odpowiedź `{ ok: true, added, updated }` liczy pozycje dodane i uzupełnione.
  Rejestr `meal_shopping_exports` wykrywa wcześniejszy eksport obiadu na daną
  listę, także po edycji obiadu. Ponowienie ręczne wymaga `confirmRepeat=true`;
  w przeciwnym razie 409 `MEAL_EXPORT_CONFIRMATION_REQUIRED` wyjaśnia ponowne
  dodanie ilości. Odrzucana jest cała operacja, także przy mieszanym wyborze.
  Rejestr nie synchronizuje zmian: edycja/usunięcie obiadu nie zmienia zakupów,
  a zmiany zakupów nie wpływają na plan. Usunięcie obiadu lub listy usuwa wpis
  rejestru; nowy obiad ma nową tożsamość.
  Wymagany `operationId` korzysta z istniejącej tabeli `shopping_operations`:
  ponowienie zachowuje odpowiedź bez zwiększenia ilości, także po zmianie planu;
  zmiana danych pod tym samym ID daje 409. Po ostrzeżeniu można potwierdzić
  pod tym samym ID, ponieważ odrzucona operacja nie zapisuje odpowiedzi.
  Rola i dostęp do listy są sprawdzane również przed odtworzeniem odpowiedzi.
  UI eksportu pozwala wybrać zapisaną listę i dania ze składnikami, pokazuje
  podsumowanie pozycji dodanych i uzupełnionych oraz link do docelowej listy.
  Ostrzeżenie o ponownym eksporcie wymaga osobnego zaznaczenia potwierdzenia.
  Po wysłaniu wybór jest zablokowany; ponowienie po błędzie zachowuje ID i treść
  żądania. Eksport jest pojedynczą operacją istniejącego wspólnego outboxa,
  z kopią składników (`snapshot`) i docelowych identyfikatorów pozycji (`targets`).
  Edycja obiadu po zleceniu nie zmienia kopii. Lokalna projekcja zakupów
  uwzględnia eksport w kolejności operacji; adapter zakupów go nie wysyła.
  Serwer zwraca również aktualne pozycje i mapowanie identyfikatorów po scaleniu.
  Jedna transakcja IndexedDB aktualizuje bazę zakupów, potwierdzenie eksportu
  i identyfikatory późniejszych zmian, zachowując ich treść. Eksport czeka
  na utworzenie lokalnej listy oraz wcześniejsze zmiany obiadów i zakupów.
  Docelowa lista i jej zawartość muszą być wcześniej zapisane; nowa lokalna
  lista ma znaną pustą bazę. Odczyty zakupów zachowują dotychczasowego właściciela
  odświeżania i są wstrzymywane na czas synchronizacji obiadów.
  Karta „Dziś na obiad” na górze kalendarza pokazuje nazwę i notatkę obiadu
  według strefy rodziny, niezależnie od oglądanej daty kalendarza. Współdzieli
  odczyt tygodnia z zakładką Obiady; zapis, usunięcie lub kopiowanie odświeża
  kartę. Uwzględnia cache i oczekujące zmiany; brak zapisanej zawartości nie
  oznacza braku obiadu. Baner tygodnia pokazuje tryb offline, czas pobrania,
  stan kolejki i zmiany wymagające reakcji.
  Mutacje z kolejki trafiają do `POST /api/meals/offline?operationId=<UUID>&actorId=<UUID>`.
  Operacja `write` zawiera tydzień i zamrożone zapisy dni (`date`, `id`,
  `expectedId`, `data`, a `data=null` oznacza usunięcie). Kopiowanie jest jedną
  atomową operacją. Niezgodność tożsamości daje konflikt zamiast odtworzenia
  usuniętego obiadu. Istniejące endpointy online zachowują kontrakty.
  Idempotencja obiadów używa istniejącej tabeli `shopping_operations`, bez
  nowej migracji; rola jest sprawdzana również przed odtworzeniem odpowiedzi.
  Moduł jest zarejestrowany w cyklu życia magazynów konta i wspólnym nadawcy,
  bez osobnego silnika ani odpytywania pustej kolejki. Powrót sieci i wznowienie
  aplikacji uruchamiają synchronizację. WWW obsługuje otwarte okno bez sieci,
  APK również restart lokalnego frontendu. Zamknięte APK nie synchronizuje.
  Cache obiadów ma budżet 4 MiB, z kolejką do 6 MiB; najstarsze tygodnie bez
  oczekujących zmian mogą być usuwane. Bazy oczekujących zmian są przypięte;
  brak miejsca przerywa zapis zamiast potwierdzać pozorny sukces.
  Konflikty i zmiany starsze niż 30 dni pozostają do sprawdzenia. Ponowny
  eksport można potwierdzić; odrzucenie zmiany i jej zależności wymaga osobnej
  decyzji użytkownika. Wylogowanie i zmiana konta czyszczą również obiady,
  a spóźnione odpowiedzi nie przywracają danych poprzedniej osoby.

## API i bezpieczeństwo

- /api, dane wejściowe walidowane schematami Zod przez wspólny parser HTTP
  przed przekazaniem do serwisów. Reguły biznesowe pozostają w serwisach.
  Jeden globalny handler zwraca błędy { error: { code, message } } z komunikatem
  po polsku, zachowuje statusy błędów HTTP klienta (w tym 413 i 415), a szczegóły
  nieoczekiwanych błędów zapisuje tylko w logach. Błąd walidacji odpowiedzi
  oznacza 500, nie błąd danych klienta.
  Publiczne trasy są jawnie określone w konfiguracji auth.
- Mutacje wymagają application/json i zgodnego źródła: Origin, a wyłącznie
  przy jego braku Referer. Porównujemy z hostem żądania. Proxy Vite zachowuje
  changeOrigin=false. Cookie sid: HttpOnly, SameSite=Lax, Secure w produkcji.
- RODZINA_TRUSTED_PROXIES wskazuje zaufane IP/CIDR pośredników. Pusta lista
  ignoruje X-Forwarded-For; zaufanie do całego łańcucha nie jest domyślne.
  Konfiguracja hostingu wymaga potwierdzenia; patrz DEPLOY.
- Błędny e-mail, hasło lub PIN zwraca 403 `INVALID_CREDENTIALS`, bez sygnału
  utraty sesji. Brak lub wygaśnięcie sesji zwraca 401 `UNAUTHORIZED`
  i uruchamia czyszczenie danych konta.
- Limity logowania: 10 prób/15 minut dla IP–konto, osobno hasło i PIN,
  trwałe w SQLite. Poprawne logowanie usuwa własny licznik.
- GET /api/auth/password-recovery udostępnia wyłącznie dostępność funkcji.
  Formularz /nie-pamietam-hasla wysyła POST /api/auth/forgot-password.
  Domyślnie wysyłka jest wyłączona (503 bez sprawdzania konta). Po włączeniu
  poprawne żądania dają jednakowe 202 dla znanych i nieznanych adresów,
  kont bez hasła i dzieci oraz błędów SMTP. Nie potwierdza to dostarczenia maila.
- Link e-mail ma losowy token 256 bitów, hash w password_resets i ważność
  30 minut. Link administratora zachowuje 24 godziny. Zamówienie kolejnego linku
  i samo otwarcie strony nie unieważniają wcześniejszych linków ani sesji.
  SMTP wymusza TLS/STARTTLS z weryfikacją certyfikatu; wysyłka ma 4 s limitu,
  a jednakowa minimalna odpowiedź 4,5 s ogranicza różnice czasowe. Błąd lub timeout
  unieważnia tylko nowy token. Wysyłka działa w żądaniu, bez kolejki i crona.
- Reset ma osobne klucze w auth_rate_limits: hash IP i znormalizowanego adresu,
  10 prób/15 minut/IP i 3/godzinę/adres; wspólna transakcja immediate rezerwuje
  limity przed wysyłką. Obejmują nieistniejące konta, przetrwają restart,
  a odpowiedź 429 ma Retry-After. Wygasłe liczniki są czyszczone przy żądaniu.
- POST /api/auth/reset-password atomowo wykorzystuje token, zapisuje hasło,
  unieważnia pozostałe linki i wszystkie sesje resetowanej osoby. Dwa różne
  tokeny nie pozwalają na dwa równoległe sukcesy. Odpowiedź zachowuje ok: true
  i dodaje resetOwnSession; cookie kończymy tylko dla resetowanego konta.
  Wspólny frontend uruchamia jego istniejące wylogowanie, czyszcząc dane i alarmy.
  Inne urządzenia wykrywają utratę sesji przy kontakcie z API; telefon offline
  nie dostaje natychmiastowego sygnału. Strona resetu i API mają no-store oraz
  no-referrer; treść linku nie trafia do cache modułów ani logów aplikacji.
  Utworzenie sesji hasłem sprawdza w transakcji aktualność zweryfikowanego
  hasha, aby rozpoczęte wcześniej logowanie nie przywróciło sesji starym hasłem.
- Operacje zakupów, zadań i obiadów zachowują identyfikatory przy ponowieniu.
  Automatyczne retry trwa do 30 dni; odpowiedzi idempotentne są przechowywane
  90 dni. Uprawnienia sprawdzamy także przy odtwarzaniu odpowiedzi.

## Przypomnienia

Jedna tabela reminders i GET /api/reminders/schedule dla APK. Źródłem jest
dokładnie jedno wydarzenie, zadanie albo dokument. Serwer wyznacza odbiorców
i terminy; Android zapisuje alarmy systemowe. Historyczne next_fire_at
i last_sent_at nie sterują dostarczaniem APK.

| Odbiorca     | Znaczenie                                                                                  | Źródła                |
| ------------ | ------------------------------------------------------------------------------------------ | --------------------- |
| participants | Uczestnicy, a bez nich twórca                                                              | Wydarzenia            |
| family       | Wszyscy domownicy                                                                          | Wydarzenia, dokumenty |
| adults       | Admin i member                                                                             | Wydarzenia, dokumenty |
| owner        | Twórca wydarzenia; przypisany zadania lub właściciel listy; posiadacz dokumentu lub twórca | Wszystkie             |
| list_members | Właściciel i członkowie listy                                                              | Zadania               |
| user         | Wyłącznie wskazana osoba („tylko ja”)                                                      | Wszystkie             |

Odbiorca musi widzieć źródło. Pusta lista daje awaryjnie adults, z wyjątkiem
zadań: dla nich brak odbiorców oznacza brak alarmu. Prywatne zadania mają
ogólną treść powiadomienia i autoryzację online przy otwarciu. Cofnięcie
dostępu dociera do telefonu dopiero po udanej synchronizacji.

Wspólne przypomnienia edytuje osoba uprawniona do źródła. Osobiste są
zapisywane osobno wyłącznie dla siebie; edycja źródła nie usuwa cudzych.
Offsety dni/tygodni/miesięcy liczymy kalendarzowo w strefie rodziny;
bez godziny bazą jest 09:00. Offset podąża za terminem, absolute nie.
Minione absolute staje się nieaktywne. Zmiany terminu, ukończenia zadania,
odnowienia dokumentu i serii przeliczają przypomnienia.

## Interfejs

Kierunek „Ciepły i przyjazny”: kremowe tło, szałwiowe akcenty, jasne karty,
delikatne obramowania, szeryfowe tytuły; istniejący motyw Mantine jest źródłem
tokenów. Referencja: [MagicPath](https://www.magicpath.ai/files/463387065032278016).
Nie kopiujemy atrap funkcji ani dodatkowego systemu UI.

Od 768 px menu po lewej ma 240 px. Węższa WWW i APK mają hamburger po prawej
i panel z prawej. Kolejność: Kalendarz, Zadania, Zakupy, Obiady, Rodzina,
Kontakty, Dokumenty, Powiadomienia, Wersja aplikacji; konto i wylogowanie na dole.
Tytuł pozostaje w treści. Stare adresy /wiecej zachowują zgodność.
Wymagane: fokus, etykiety, klawiatura, cele 44×44 px, kontrast 4,5:1
(duży tekst 3:1), safe area i systemowy Wstecz. Kolor nie jest jedynym
oznaczeniem stanu, a banery nie zasłaniają treści ani menu.
