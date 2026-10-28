# Plan projektu

Zasady pracy i weryfikacji są w [AGENTS.md](../AGENTS.md).
Ten plik zawiera statusy oraz wymagania pozostałych prac; opis działającej
aplikacji jest w [ARCHITECTURE.md](ARCHITECTURE.md).

## Statusy

Stan dokumentacji na 28.10.2026. Brak potwierdzenia CI lub prób ręcznych
nie oznacza ich zaliczenia. Usunięcie historycznych opisów nie zamyka odbioru.

| Zakres                                                        | Stan                                                    | Pozostałe warunki                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------- |
| Fazy 0–5 i 7: fundamenty, kalendarz, Android, zakupy, zadania | Zaimplementowane                                        | Niepotwierdzone próby sprzętowe według DEVELOPMENT                |
| Pierwszy deploy D.1–D.4                                       | Wykonany; działanie potwierdzone 16.10.2026             | Nie powtarzać konfiguracji pierwszego wdrożenia                   |
| Faza 6: obiady, kroki 6.1–6.2                                 | API zaimplementowane lokalnie                           | Końcowe CI; kroki 6.3–6.5 do implementacji                        |
| Faza 8: dokumenty                                             | Implementacja potwierdzona przez właściciela 25.10.2026 | Odbiór telefonu i końcowe CI do potwierdzenia                     |
| Faza 9: kontakty, kroki 9.1–9.3                               | Zaimplementowane lokalnie                               | Końcowe CI, UI i fizyczne APK do potwierdzenia                    |
| K.1: święta i dni okolicznościowe                             | Zaimplementowane lokalnie                               | Końcowe CI i fizyczne APK do potwierdzenia                        |
| Redesign R.1–R.7                                              | Implementacja opisana w historii zmian                  | R.8: odbiór całości i gotowość aktualizacji do potwierdzenia      |
| Wspólna pamięć urządzenia i synchronizacja O.1–O.7            | Zaimplementowane lokalnie                               | Końcowe CI, alarmy, restart i pomiary urządzenia do potwierdzenia |
| Oddzielenie sesji od modułów                                  | Implementacja opisana 28.10.2026                        | Końcowe CI i fizyczne APK do potwierdzenia                        |
| Optymalizacja odczytów zadań, wydarzeń i harmonogramu         | Implementacja w osobnym commicie 661d2e5                | Końcowe CI, pomiary i fizyczny odbiór do potwierdzenia            |
| Reset hasła przez e-mail                                      | Zaplanowany, niezaimplementowany                        | Osobny krok poniżej                                               |

Próby wymagające potwierdzenia zbiera [DEVELOPMENT.md](DEVELOPMENT.md#pozostały-odbiór).
Wdrożenie jest osobną czynnością na polecenie właściciela.

## Faza 6 — plan obiadów

**Cel:** rodzina planuje obiady na tydzień i jednym kliknięciem przenosi składniki do listy zakupów.

**Endpointy:**

- `GET /api/meals?weekStart=YYYY-MM-DD` (poniedziałek) zwraca 7 dni z posiłkami i składnikami.
- `PUT /api/meals/:date/:slot` z `{ title, notes?, ingredients: [{ name, quantity? }] }` (upsert), `DELETE /api/meals/:date/:slot`.
- `POST /api/meals/copy-week` z `{ fromWeekStart, toWeekStart, overwrite: boolean }`.
- `POST /api/meals/to-shopping-list` z `{ weekStart, listId, mealIds? }`. Scala składniki po znormalizowanej nazwie zarówno między wybranymi daniami, jak i z pozycjami już obecnymi na docelowej liście zakupów. Ilości łączymy tekstowo, np. "500 g + 1 kg". Podsumowanie rozróżnia pozycje dodane i uzupełnione.
- `GET /api/meals/suggestions?q=` zwraca wcześniejsze tytuły obiadów razem z ostatnio użytymi składnikami (do szybkiego powtórzenia dania).

**UI:**

- Widok tygodnia (pon-nd) ze strzałkami poprzedni/następny tydzień i przyciskiem "dziś".
- Każdy dzień to karta z obiadem albo "+ Dodaj obiad".
- Formularz: nazwa dania z podpowiedziami (wybór podpowiedzi uzupełnia składniki), notatka, lista składników.
- Akcje tygodnia: "Skopiuj poprzedni tydzień", "Dodaj składniki do listy zakupów" (wybór listy i dań, potem podsumowanie).
- Karta "Dziś na obiad" na górze kalendarza (lekki dashboard).

**Przenoszenie składników — ustalenia właściciela 26.10.2026:**

- Eksport jest jednorazowym dodaniem składników, bez stałego powiązania obiadu
  z zakupami. Późniejsza edycja lub usunięcie obiadu nie zmienia listy zakupów;
  zmiany zakupów nie zmieniają planu obiadów.
- Ponowienie wysyłki tej samej operacji, np. po utracie odpowiedzi lub restarcie
  APK, nie może ponownie zwiększyć ilości. To zabezpieczenie techniczne jest
  niezależne od decyzji o ponownym ręcznym eksporcie tych samych dań.
- **Uzgodnione z właścicielem 28.10.2026:** ponowny ręczny eksport tego samego
  dania na tę samą listę wymaga ostrzeżenia i potwierdzenia z informacją
  o ponownym dodaniu ilości. Pozycje kupione pozostają bez zmian; nowa potrzeba
  tworzy osobną niekupioną pozycję (lub uzupełnia istniejącą niekupioną).

**Offline — rozszerzenie zakresu 26.10.2026:**

- Podobnie jak w zakupach i zadaniach, zapisane tygodnie, składniki i lokalne
  podpowiedzi są dostępne bez internetu. Dorośli mogą dodawać, edytować i usuwać
  obiady oraz kopiować zapisany tydzień do tygodnia o znanej zawartości. Dziecko
  ma tylko odczyt. Niepobrany tydzień nie jest traktowany jak pusty; UI wyjaśnia
  brak danych i blokuje operacje wymagające nieznanej zawartości.
- Trwały cache i dziennik zmian są przypisane do rodziny i użytkownika,
  odtwarzane po restarcie APK. Zmiana jest potwierdzana w UI dopiero po trwałym
  zapisie; błąd pamięci nie może oznaczać pozornego sukcesu. Karta „Dziś na obiad”
  uwzględnia zapisane dane i oczekujące zmiany, z datą w strefie rodziny.
- Offline można zlecić eksport zapisanych składników do zapisanej listy zakupów,
  także dla lokalnie dodanych lub zmienionych obiadów. Operacja zachowuje kopię
  wybranych składników z chwili zlecenia, listę docelową i identyfikator operacji.
  Późniejsza edycja obiadu nie zmienia oczekującego eksportu. Lokalna lista
  zakupów pokazuje oczekującą zmianę; po synchronizacji uzgadniamy ją z wynikiem
  serwera bez podwójnego dodania. Eksport nie może trafić jednocześnie do dwóch
  niezależnie wysyłających kolejek. API sprawdza uprawnienia i scala z aktualnymi
  zakupami atomowo; nie nadpisuje całej listy nieaktualnym snapshotem.
- Powrót sieci i wznowienie aktywnej aplikacji uruchamiają synchronizację.
  Kolejność zachowuje zależności operacji; retry używa tego samego identyfikatora.
  Stosujemy istniejące zasady idempotencji zakupów i zadań, limit automatycznego
  ponawiania 30 dni i retencję odpowiedzi 90 dni. Starsze zmiany wymagają
  sprawdzenia, bez automatycznego nadawania im nowej daty lub identyfikatora.
- Wylogowanie, zmiana konta i utrata sesji stosują istniejące zasady czyszczenia
  magazynów konta. Spóźnione odpowiedzi nie przywracają danych poprzedniej osoby.
  Przed wysłaniem API ponownie sprawdza rolę i dostęp do rodziny oraz listy.
  Utrata dostępu i konflikty mają widoczny stan wymagający reakcji; nie wolno
  po cichu odtwarzać usuniętych danych ani gubić oczekujących zmian.
- Baner wyjaśnia tryb offline, wiek danych i stan kolejki. WWW obsługuje utratę
  sieci w otwartym interfejsie, APK także ponowny start bez internetu po
  wcześniejszym pobraniu danych. Bez PWA i bez gwarancji synchronizacji przy
  zamkniętym APK. Nie dokładamy w tej fazie przebudowy magazynów innych modułów.

**Kroki realizacji:**

#### Krok 6.1 - API planu obiadów

- **Status:** zweryfikowane lokalnie, oczekuje na CI. API online, bez UI i kolejki offline.
- **Zakres:** migracje `meals` i `meal_ingredients`. `GET /api/meals?weekStart=` (poniedziałek, 7 dni z posiłkami i składnikami), `PUT` i `DELETE /api/meals/:date/:slot`, `POST /api/meals/copy-week`, `GET /api/meals/suggestions`. Uprawnienia: dziecko ma tylko odczyt.
- **Gotowe, gdy:** testy API: upsert, copy-week z `overwrite` i bez, podpowiedzi z ostatnio użytymi składnikami, walidacja `weekStart` (tylko poniedziałek), 403 dla dziecka na zapisie, izolacja rodzin.

#### Krok 6.2 - API: składniki do listy zakupów

- **Status:** zweryfikowane lokalnie, oczekuje na CI.
- **Zakres:** `POST /api/meals/to-shopping-list?operationId=<UUID>` z `{ weekStart, listId, mealIds?, confirmRepeat? }`. Funkcje `normalizeShoppingName` i `mergeQuantities` w `shared` (normalizacja nazwy, łączenie ilości tekstowo, np. "500 g + 1 kg"). Wykorzystuje serwis zakupów z fazy 5 (także historię). Scala z niekupionymi pozycjami docelowej listy i zwraca liczby pozycji dodanych oraz uzupełnionych. Kupione pozostają bez zmian. Ponowny ręczny eksport wymaga potwierdzenia ponownego dodania ilości; techniczne ponowienie tego samego ID nie podwaja zakupów. Rejestr wcześniejszych eksportów nie synchronizuje późniejszych zmian. UI ostrzeżenia i potwierdzenia należy do 6.4.
- **Gotowe, gdy:** testy jednostkowe `mergeQuantities` i testy API (scalanie między daniami i z istniejącą listą, uzgodniona obsługa pozycji kupionych i ponownego eksportu, filtr `mealIds`, lista innej rodziny daje 404, zapis dziecka daje 403, izolacja rodzin). Zmiana lub usunięcie obiadu po eksporcie nie zmienia zakupów.

#### Krok 6.3 - UI: tydzień obiadów

- **Zakres:** zakładka Obiady z widokiem tygodnia (pon-nd), strzałkami i przyciskiem "dziś". Karta dnia albo "+ Dodaj obiad". Formularz (nazwa z podpowiedziami, które po wyborze uzupełniają składniki, notatka, lista składników), usuwanie, "Skopiuj poprzedni tydzień" z pytaniem o nadpisanie. Dziecko widzi tylko odczyt.
- **Gotowe, gdy:** testy komponentów formularza i podpowiedzi. Ręcznie: zaplanowanie 5 obiadów i skopiowanie tygodnia.

#### Krok 6.4 - UI: dodawanie do listy zakupów i karta "Dziś na obiad"

- **Zakres:** akcja "Dodaj składniki do listy zakupów" (wybór listy i dań, potem podsumowanie), karta "Dziś na obiad" na górze kalendarza.
- **Gotowe, gdy:** ręcznie: 5 zaplanowanych obiadów i eksport do niepustej listy daje poprawnie pogrupowane zakupy ze scalonymi ilościami i podsumowaniem pozycji dodanych oraz uzupełnionych. Karta pokazuje dzisiejszy obiad. Zmiana planu po eksporcie nie zmienia zakupów. UI przy 390 i 1280 px, wspólny frontend APK i kontrole według AGENTS.md. Domknięcie fazy przeniesione do kroku 6.5.

#### Krok 6.5 - Obiady offline z trwałą kolejką zmian i domknięcie fazy

- **Zakres:** pełny opis offline powyżej: trwały podgląd i edycja planu,
  kopiowanie zapisanych tygodni, eksport kopii składników do zapisanej listy,
  lokalna projekcja zakupów i karty „Dziś na obiad”, synchronizacja i ochrona
  danych konta. W tym kroku rozszerzamy kontrakty mutacji o obsługę trwałych
  identyfikatorów i atomowej idempotencji oraz eksportu kopii składników;
  zachowujemy działanie klientów online z wcześniejszych kroków. Korzystamy
  z istniejących mechanizmów magazynów i synchronizacji, bez implementowania
  ich przebudowy w ramach fazy 6. Ten krok dodaje obsługę obiadów
  i eksport przez istniejącą wspólną kolejkę, bez drugiego silnika synchronizacji.
- **Gotowe, gdy:** testy obejmują odczyt, dodanie, edycję, usunięcie, kopiowanie
  i eksport offline, niepobrany tydzień, podpowiedzi i dzisiejszą kartę, utratę
  odpowiedzi, retry bez ponownego zwiększenia ilości, wiele kart, zależności
  z kolejką zakupów, konflikty, błąd zapisu, starsze zmiany, utratę dostępu,
  wylogowanie i zmianę konta. Playwright wyłącznie headless przy 390 i 1280 px.
  Ręcznie oraz w fizycznym APK: online → offline → zmiana obiadów i eksport →
  zamknięcie → otwarcie offline → online; zmiany przetrwały restart, zgadzają
  się z drugim urządzeniem i nie podwajają ilości. Spełnione wszystkie kryteria
  fazy, zasady AGENTS.md i końcowe CI; brakujących prób nie oznaczamy jako zaliczonych.

**Kryteria akceptacji:**

- Testy API: upsert, copy-week z i bez overwrite, eksport ze scalaniem między daniami i z istniejącą listą, role oraz izolacja rodzin. Retry tej samej operacji nie zwiększa ponownie ilości.
- Manualnie: zaplanowanie 5 obiadów i przeniesienie składników daje poprawnie pogrupowaną listę zakupów, także gdy lista zawiera już te produkty. Późniejsze zmiany planu i zakupów nie synchronizują się ze sobą.
- Podgląd, edycja, kopiowanie i eksport offline działają w opisanym zakresie, także po restarcie APK. Synchronizacja zachowuje zmiany bez duplikatów; sprawdzone są błędy zapisu, prywatność kont i wymagane próby fizycznego telefonu.
- Spełnione punkty z wymagań gotowości do deployu z AGENTS.md.

**Poza zakresem:** książka przepisów, wartości odżywcze, inne posiłki niż obiad. Kolumna `slot` jest już na to przygotowana.

## Reset hasła przez e-mail

Jeden osobny krok dla dorosłych, również jedynego administratora, na WWW i w APK.
Obecny reset linkiem administratora zachowuje kontrakt i ważność 24 godzin.

- Formularz „Nie pamiętam hasła” pod adresem /nie-pamietam-hasla wywołuje
  POST /api/auth/forgot-password. Poprawne żądanie zwraca 202 i { ok: true }
  z jednakowym komunikatem dla znanego i nieznanego adresu.
- Link prowadzi do istniejącego /reset-hasla/:token, powstaje wyłącznie
  z RODZINA_PUBLIC_URL i jest ważny 30 minut. Przechowujemy hash tokenu.
  Samo zamówienie lub otwarcie linku nie zmienia hasła, nie kończy sesji
  ani nie unieważnia wcześniejszych linków.
- Zapis hasła atomowo wykorzystuje token, zmienia hash hasła, unieważnia
  pozostałe tokeny i wszystkie sesje tej osoby. Równoległe resety nie mogą
  zakończyć się dwoma sukcesami. Lokalnie czyścimy sesję i alarmy tylko
  resetowanego konta; inne urządzenia wykrywają zmianę przy kontakcie z API.
- SMTP działa w żądaniu z krótkim timeoutem, bez kolejki i nowego crona.
  Konfiguracja: RODZINA_SMTP_HOST, RODZINA_SMTP_PORT, RODZINA_SMTP_SECURE,
  RODZINA_SMTP_USER, RODZINA_SMTP_PASSWORD, RODZINA_MAIL_FROM oraz
  RODZINA_PASSWORD_RESET_EMAIL_ENABLED=false domyślnie. Włączenie wymaga
  kompletnej konfiguracji TLS/STARTTLS i weryfikacji certyfikatów.
- Przy wyłączonej funkcji akcja jest niedostępna, a endpoint zwraca ogólny
  błąd bez sprawdzania konta. Przy błędzie lub niepewnej wysyłce SMTP nowy
  token jest unieważniany; odpowiedź nie ujawnia istnienia konta.
- Trwałe limity w SQLite według IP i hasha znormalizowanego adresu obejmują
  też nieistniejące konta. Propozycja: 10 prób/15 minut/IP i 3/godzinę/adres;
  429 z Retry-After. Wygasłe wpisy czyścimy przy żądaniach. Zweryfikować proxy
  i różnice czasu odpowiedzi, również przy awarii SMTP.
- Nie logować tokenów, linków, haseł ani sekretów SMTP. Reset ma no-store,
  nie przekazuje tokenu przez Referer, analitykę ani cache. Mail tekstowy
  i HTML bez śledzenia. Potwierdzenie formularza nie gwarantuje dostarczenia.
- Gotowe, gdy: testy tokenów, transakcji, równoległości, sesji, limitów,
  błędów SMTP i izolacji kont; UI 390/1280 px; fizyczne APK i App Links;
  rzeczywista dostawa na skrzynkę testową oraz kontrola SPF/DKIM/DMARC.
  Uzupełnić konfigurację, migracje i release:smoke; wymagane końcowe CI.
- Poza zakresem: konta dzieci, weryfikacja i zmiana e-maila, 2FA, Google,
  wysyłka zaproszeń i przypomnień, newsletter oraz worker pocztowy.

## Pozostałe warunki i pomysły

- R.8: sprawdzić wszystkie istniejące ekrany przy 390 i 1280 px oraz w APK,
  klawiaturę, fokus, kontrast, safe area i stany błędów. Potwierdzić aktualizację
  z zachowaniem danych; publikacja wymaga osobnego polecenia.
- Odbiór optymalizacji odczytów z commita 661d2e5: zbiorczy snapshot dostępnych list i zadań, grupowe
  odczyty relacji wydarzeń/przypomnień z porcjowaniem SQL i jeden właściciel
  odświeżania. Zachować stare kontrakty APK, kontrolę uprawnień przed zapisem
  i odtworzeniem odpowiedzi idempotentnej oraz kompletność cache.
  Porównać liczbę HTTP/SQL, czas i rozmiar odpowiedzi dla tych samych danych
  (np. 1, 10, 30 list), WWW i fizycznego APK. Sprawdzić prywatne listy,
  cofnięcie udostępnienia, izolację rodzin i przypomnienia osobiste.
  Natywny transport pozostaje szeregowy; zmiany współbieżności wymagają
  osobnego uzasadnienia pomiarami.
- Dalsze pomysły, bez zatwierdzonego zakresu: iCal, przepisy i iOS.
