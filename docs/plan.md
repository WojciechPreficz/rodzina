# Plan projektu

Zasady pracy i weryfikacji są w [AGENTS.md](../AGENTS.md).
Ten plik zawiera statusy oraz wymagania pozostałych prac; opis działającej
aplikacji jest w [ARCHITECTURE.md](ARCHITECTURE.md).

## Statusy

Stan dokumentacji na 30.10.2026. Brak potwierdzenia CI lub prób ręcznych
nie oznacza ich zaliczenia. Usunięcie historycznych opisów nie zamyka odbioru.

| Zakres                                                        | Stan                                                                            | Pozostałe warunki                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Fazy 0–5 i 7: fundamenty, kalendarz, Android, zakupy, zadania | Zaimplementowane                                                                | Niepotwierdzone próby sprzętowe według DEVELOPMENT                |
| Pierwszy deploy D.1–D.4                                       | Wykonany; działanie potwierdzone 16.10.2026                                     | Nie powtarzać konfiguracji pierwszego wdrożenia                   |
| Faza 6: obiady, kroki 6.1–6.5                                 | API, UI tygodnia, eksport, dzisiejsza karta i offline zaimplementowane lokalnie | Odbiór ręczny, fizyczne APK i końcowe CI do potwierdzenia         |
| Faza 8: dokumenty                                             | Implementacja potwierdzona przez właściciela 25.10.2026                         | Odbiór telefonu i końcowe CI do potwierdzenia                     |
| Faza 9: kontakty, kroki 9.1–9.3                               | Zaimplementowane lokalnie                                                       | Końcowe CI, UI i fizyczne APK do potwierdzenia                    |
| K.1: święta i dni okolicznościowe                             | Zaimplementowane lokalnie                                                       | Końcowe CI i fizyczne APK do potwierdzenia                        |
| Redesign R.1–R.7                                              | Implementacja opisana w historii zmian                                          | R.8: odbiór całości i gotowość aktualizacji do potwierdzenia      |
| Wspólna pamięć urządzenia i synchronizacja O.1–O.7            | Zaimplementowane lokalnie                                                       | Końcowe CI, alarmy, restart i pomiary urządzenia do potwierdzenia |
| Oddzielenie sesji od modułów                                  | Implementacja opisana 28.10.2026                                                | Końcowe CI i fizyczne APK do potwierdzenia                        |
| Optymalizacja odczytów zadań, wydarzeń i harmonogramu         | Implementacja w osobnym commicie 661d2e5                                        | Końcowe CI, pomiary i fizyczny odbiór do potwierdzenia            |
| Reset hasła przez e-mail                                      | Zaimplementowany i zweryfikowany lokalnie                                       | Końcowe CI, rzeczywiste SMTP, UI i fizyczne APK do potwierdzenia  |

Zadania cykliczne C.1–C.2 (#65–#66): zweryfikowane lokalnie, oczekuje na CI.
Offline, UI i odbiór cykliczności należą do kolejnych kroków C.3–C.4.

Usuwanie kont domowników i całej rodziny: zweryfikowane lokalnie, oczekuje na CI.
Próby ręczne i fizyczne APK do potwierdzenia według DEVELOPMENT.md.

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

- **Status:** zaimplementowane lokalnie; końcowe CI i odbiór ręczny oraz fizyczne APK do potwierdzenia. Funkcje online, bez eksportu do zakupów i trwałej kolejki offline.
- **Zakres:** zakładka Obiady z widokiem tygodnia (pon-nd), strzałkami i przyciskiem "dziś". Karta dnia albo "+ Dodaj obiad". Formularz (nazwa z podpowiedziami, które po wyborze uzupełniają składniki, notatka, lista składników), usuwanie, "Skopiuj poprzedni tydzień" z pytaniem o nadpisanie. Dziecko widzi tylko odczyt.
- **Gotowe, gdy:** testy komponentów formularza i podpowiedzi. Ręcznie: zaplanowanie 5 obiadów i skopiowanie tygodnia.

#### Krok 6.4 - UI: dodawanie do listy zakupów i karta "Dziś na obiad"

- **Status:** zweryfikowane lokalnie, oczekuje na CI; odbiór ręczny i fizyczne APK do potwierdzenia.
- **Zakres:** akcja "Dodaj składniki do listy zakupów" (wybór listy i dań, potem podsumowanie), karta "Dziś na obiad" na górze kalendarza.
- **Gotowe, gdy:** ręcznie: 5 zaplanowanych obiadów i eksport do niepustej listy daje poprawnie pogrupowane zakupy ze scalonymi ilościami i podsumowaniem pozycji dodanych oraz uzupełnionych. Karta pokazuje dzisiejszy obiad. Zmiana planu po eksporcie nie zmienia zakupów. UI przy 390 i 1280 px, wspólny frontend APK i kontrole według AGENTS.md. Domknięcie fazy przeniesione do kroku 6.5.

#### Krok 6.5 - Obiady offline z trwałą kolejką zmian i domknięcie fazy

- **Status:** zaimplementowane lokalnie; odbiór ręczny, fizyczne APK i końcowe CI do potwierdzenia.
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

Status: zweryfikowane lokalnie, oczekuje na CI.
Próby rzeczywistej poczty, hostingu i fizycznego APK pozostają do odbioru
według DEVELOPMENT.md. Konfigurację opisuje DEPLOY.md.

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

## Podzadania — checklisty w zadaniach

Jeden poziom kroków dziedziczących dostęp z listy rodzica, również dla dzieci.
Maksymalnie 100 pozycji na zadanie, tytuł do 200 znaków, kolejność i metadane
wykonania. Ukończenie rodzica i kroków są niezależne; usunięcie rodzica usuwa
checklistę. Bez osobnych terminów, przypisań, alarmów i zagnieżdżania.

- **S.1 (#60): zweryfikowane lokalnie, oczekuje na CI.** Model i migracja zachowująca stare zadania,
  kontrakty shared, dedykowane mutacje CRUD i kolejności, UUID klienta,
  idempotencja przez task_operations i ponowna kontrola dostępu przy replay.
  Grupowe odczyty bez N+1, zgodność wcześniejszego APK i wersjonowanie
  konfliktów treści/kolejności z niezależnym odhaczaniem. Odbiór: testy API,
  migracji, uprawnień, limitów, retry i zgodności, release:smoke i końcowe CI.
- **S.2 (#61): zweryfikowane lokalnie, oczekuje na CI.** Trwały zapis offline i synchronizacja w istniejącym
  IndexedDB i wspólnym outboxie, także dla lokalnie utworzonego rodzica.
  CRUD, odhaczanie i kolejność checklist, projekcja postępu, nieznane dane
  starszego cache, konflikty wersji i atomowe potwierdzenie bez utraty pending.
  Bez interfejsu checklisty (S.3) i końcowego odbioru modułu (S.4).
- **S.3 (#62): zweryfikowane lokalnie, oczekuje na CI.** Sekcja „Podzadania” w formularzu zadania:
  dodawanie, edycja, usuwanie, odhaczanie i dostępne przyciski kolejności.
  Postęp na liście i karcie dzisiejszych zadań oraz świadome ukończenie
  rodzica z ostrzeżeniem o niewykonanych lub nieznanych krokach. Istniejący
  magazyn offline i outbox; ochrona formularza, błędy i konflikty.
  Komponenty i headless Playwright 390/1280 px obejmują WWW i transport
  Androida. Odbiór ręczny i fizyczne APK potwierdzone przez właściciela w S.4;
  końcowe CI do potwierdzenia. Bez zakresu S.4.
- **S.4 (#63): zweryfikowane lokalnie, oczekuje na CI.** Właściciel potwierdził
  30.10.2026 zakończenie prób odbioru z #63: WWW 390/1280 px i fizyczne APK,
  dwa konta/urządzenia, konflikty, restart offline i synchronizacja,
  ukończenie i usuwanie rodzica, uprawnienia, wylogowanie i zmiana konta
  oraz zgodność starszego APK. Domknięcie modułu wymaga sukcesu pełnego CI
  dla końcowego commita. Checklisty kolejnych wystąpień
  zadań cyklicznych należą do końcowej integracji modułu cykliczności.

## Zadania cykliczne

- **C.1 (#65): zweryfikowane lokalnie, oczekuje na CI.** Reguły i kontrakty shared, model serii oddzielony
  od wystąpień oraz migracja bez zmiany zadań jednorazowych. Testy kalendarza,
  DST, spóźnień, końca serii, anomalii zegara i ograniczeń bazy; release:smoke.
- **C.2 (#66): zweryfikowane lokalnie, oczekuje na CI.** API konfiguracji online, historia wykonania/pominięcia,
  atomowe zamknięcie i następca, edycja jednego lub kolejnych, zatrzymanie,
  warunkowe cofnięcie oraz względne przypomnienia wspólne. Obecne uprawnienia
  list również dla dzieci, izolacja rodzin i task_operations z kontrolą dostępu
  przed replay. Bez nowego crona ani workera.
- **C.3 (#67): planowane.** Wykonanie pobranych wystąpień offline w istniejącym
  IndexedDB i outboxie. Faktyczny czas wykonania, retry do 30 dni, retencja
  odpowiedzi 90 dni, anomalie do sprawdzenia. Następca dopiero po synchronizacji;
  bez drugiego silnika i bez generowania wystąpień offline.
- **C.4 (#68): planowane.** UI reguł, podgląd terminu, historia i konflikty,
  wzorcowa checklista kopiowana z nowymi UUID i zerowym postępem. Próby WWW
  390/1280 px i fizycznego APK, dwa urządzenia, alarmy i zgodność starszego APK.

Reguła wymaga daty startu, opcjonalnej godziny, strefy Europe/Warsaw,
interwału 1–1000 oraz opcjonalnej końcowej daty (włącznie). Tryby:
stały harmonogram i odstęp po wykonaniu/pominięciu. Jedno aktywne wystąpienie;
zaległe pozostaje do jawnego zamknięcia, bez stosu kopii.

Stały rytm liczymy zawsze od oryginalnej kotwicy. Tygodnie zaczynają się
w poniedziałek; wybrane dni (ISO 1–7) obowiązują w co N-tym tygodniu od
tygodnia startowego, z pominięciem dni przed startem. Bez wyboru dni używamy
dnia startowego. Miesiące/lata obcinają nieistniejący dzień do końca miesiąca,
ale kolejny termin znów używa kotwicy: 31.01 → 28.02 → 31.03;
29.02.2024 → 28.02.2025 → 29.02.2028. Po zamknięciu wybieramy pierwszy
termin ściśle po późniejszym z planowanego terminu i faktycznego zamknięcia.
Przykład: wtorki, termin 03.03.2026, wykonanie 20.03 → 24.03.
W trybie po wykonaniu dodajemy N jednostek kalendarzowych do lokalnej daty
faktycznego zamknięcia, zachowując godzinę reguły; 20.03 + 2 tygodnie → 03.04.
Wybór dni tygodnia dotyczy tylko stałego harmonogramu tygodniowego.

Konwersja przez shared/time.ts zachowuje jego politykę DST: nieistniejąca
godzina przesuwa się o lukę, powtórzona wybiera wcześniejszy moment UTC
(Warszawa: 29.03.2026 02:30 → 01:30Z, 25.10.2026 02:30 → 00:30Z).
Kotwica i godzina reguły pozostają niezmienione. Nie dodajemy stałych
milisekund do terminów. Czas zamknięcia offline zachowujemy jako UTC;
przyszłość ponad 5 minut względem serwera, czas przed utworzeniem wystąpienia
lub wcześniejszy od poprzedniego zamknięcia wymagają sprawdzenia, bez następcy
i bez podmieniania daty na czas synchronizacji. Cofnięcie zegara serwera
również może zatrzymać operację do sprawdzenia. Brak następcy po końcu serii
oznacza wyczerpanie reguły.

C.2 rozszerza odczyty addytywnie o opcjonalne recurrence i capability
taskRecurrenceVersion=1; brak capability oznacza brak obsługi konfiguracji,
brak recurrence oznacza nieznane dane starego cache, null — zadanie jednorazowe.
Stare POST/PATCH bez pola cykliczności nigdy nie zmieniają serii. Konfiguracja
jest osobną wersjonowaną mutacją online (expectedVersion), a podstawowe
odhaczenie starego APK przechodzi przez tę samą transakcję następcy co nowy
klient. Stary klient bez czasu faktycznego używa jawnie czasu odbioru serwera;
nowy przekazuje faktyczny czas oraz wersję serii i wystąpienia. Konflikt cofnięcia
lub zmiany serii jest jawny, nigdy cichym odtworzeniem historii.

Poza zakresem: rotacja dyżurów, punkty, dowolne RRULE, wiele zaległych kopii,
generowanie następców offline, dodatkowe kalendarze, iOS, PWA i Web Push.
Domknięcie modułu wymaga C.4 i końcowego CI; deploy i APK są osobnymi operacjami.

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
