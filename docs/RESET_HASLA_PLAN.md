# Plan: reset hasła przez e-mail

Data: 20.10.2026. Status: plan do realizacji; funkcja nie jest jeszcze wdrożona.

## 1. Cel i zakres

Osoba, która zapomniała hasła, odzyskuje dostęp samodzielnie: na ekranie logowania
podaje adres e-mail przypisany do konta, otrzymuje jednorazowy link i ustawia nowe
hasło. Dotyczy to kont dorosłych, w tym jedynego administratora rodziny, na stronie
WWW i w APK. Konta dzieci z PIN-em pozostają poza tym mechanizmem.

Zadanie realizujemy jako jeden dodatkowy krok dotyczący kont, od początku do końca.
Nie zmienia ono numeracji ani stanu wykonania faz w [planie projektu](plan.md).
Obowiązują sekcje 1, 1.1 i 1.2 tego planu, w tym rozdzielenie lokalnych kontroli,
końcowego CI i wdrożenia. Poniższe ustalenia są propozycją dla implementacji;
ostateczne decyzje zapisujemy wtedy w `docs/DECISIONS.md`.

## 2. Co już istnieje

- Tabela `password_resets`: użytkownik, hash tokenu, data wygaśnięcia i wykorzystania.
- `POST /api/members/:id/password-reset-link`: administrator tworzy jednorazowy
  link ważny 24 godziny i przekazuje go wybranemu domownikowi.
- `POST /api/auth/reset-password`: sprawdza token i zmienia hasło. Wykorzystanie
  tokenu oraz zapis hasła są objęte transakcją.
- Ekran `/reset-hasla/:token` z nowym hasłem i jego potwierdzeniem.
- Obsługa linków HTTPS `/reset-hasla/:token` w nawigacji Androida.
- `RODZINA_PUBLIC_URL`, używane do budowania adresu linku.

Nie ma publicznego formularza zamówienia linku ani konfiguracji i obsługi SMTP.
Obecny reset nie unieważnia wszystkich sesji ani pozostałych tokenów użytkownika.

## 3. Przebieg dla użytkownika

1. Na ekranie logowania dostępna jest akcja „Nie pamiętam hasła”.
2. Otwiera formularz `/nie-pamietam-hasla` z polem „E-mail”, przyciskiem
   „Wyślij link do zmiany hasła” i powrotem do logowania.
3. Formularz sprawdza poprawność adresu i na czas żądania blokuje kolejne wysłanie.
4. Po przyjęciu żądania pokazuje: „Jeśli istnieje konto z tym adresem e-mail,
   otrzymasz wiadomość z linkiem do zmiany hasła. Sprawdź też folder Spam.”
5. Wiadomość po polsku zawiera nazwę aplikacji, link, termin ważności oraz informację,
   że można ją zignorować, jeśli odbiorca nie prosił o zmianę hasła.
6. Link otwiera istniejący ekran ustawienia hasła na stronie lub w APK, jeżeli system
   kieruje zweryfikowane linki do aplikacji. Strona działa również bez instalacji APK.
7. Po zapisaniu nowego hasła użytkownik widzi potwierdzenie i przechodzi do logowania.
   Nie logujemy go automatycznie. Stare hasło i dotychczasowe sesje tracą ważność.

Widoki rozróżniają błąd walidacji, brak sieci, ograniczenie liczby prób oraz
niedostępność usługi. Reset wymaga internetu; nie zapisujemy żądania do kolejki
offline. Wygasły, użyty lub nieprawidłowy link daje czytelny komunikat oraz akcję
zamówienia nowego linku. Samo otwarcie linku, także przez skaner poczty, nie zużywa tokenu.

## 4. API, tokeny i sesje

### Zamówienie wiadomości

- Dodać publiczny `POST /api/auth/forgot-password` z JSON `{ "email": "..." }`,
  walidacją Zod i normalizacją adresu zgodną z rejestracją i logowaniem.
- Uwzględnić endpoint na liście publicznych tras, zachowując zabezpieczenia mutacji
  JSON i obsługę transportu WWW oraz APK.
- Dla poprawnego żądania zwracać `202` i `{ "ok": true }` niezależnie od istnienia konta.
  Token i link nigdy nie trafiają do odpowiedzi tego endpointu.
- Wysyłać mail tylko do zapisanego adresu konta z aktywnym hasłem. Nazwa rodziny,
  kod dołączenia ani rola administratora nie są wymagane.
- Generować losowy token istniejącym mechanizmem kryptograficznym; zapisywać tylko
  jego hash. Identyfikatory rekordów tworzyć przez `crypto.randomUUID()`.
- Dla nowych linków e-mail przyjąć ważność 30 minut, liczoną przez serwer.
  Dotychczasowy endpoint administratora zachowuje kontrakt i ważność 24 godzin.
- Samo zamówienie kolejnego linku nie zmienia hasła, nie wylogowuje użytkownika
  i nie unieważnia wcześniejszych niewykorzystanych linków. Zapobiega to blokowaniu
  odzyskiwania konta przez osobę znającą cudzy adres. Obowiązują limity wysyłki.
- Link budować wyłącznie z zaufanego `RODZINA_PUBLIC_URL`; produkcja wymaga HTTPS.
  Nie korzystać w tym celu z nagłówka `Host` ani adresu przekazanego w żądaniu.

### Zapis nowego hasła

- Zachować istniejący kontrakt `POST /api/auth/reset-password` i wymagania hasła,
  aby starsze wspierane APK oraz linki administratora nadal działały.
- Po ponownym sprawdzeniu ważności tokenu w jednej transakcji: wykorzystać token,
  zapisać hash nowego hasła, unieważnić wszystkie pozostałe tokeny tej osoby
  i usunąć jej dotychczasowe sesje. Reset innej osoby nie kończy sesji administratora.
- Zapewnić, że równoległe użycie tego samego tokenu lub dwóch różnych tokenów
  tego konta nie pozwala wykonać dwóch skutecznych resetów.
- Jeżeli przeglądarka lub APK ma aktywną sesję resetowanego konta, po sukcesie
  zakończyć lokalną sesję oraz wyczyścić jej cache i lokalne alarmy istniejącym
  mechanizmem wylogowania. Nie kończyć lokalnej sesji innego konta.
- Inne urządzenia wykrywają unieważnienie przy następnym kontakcie z API;
  nie deklarować natychmiastowego usunięcia danych ani alarmów na telefonie offline.

## 5. Wysyłka poczty i zabezpieczenia

- Dodać osobny moduł wysyłki z możliwością podmiany w testach. Klient SMTP ma działać
  na Node 22 i 24, bez kompilacji nowych zależności na hostingu.
- Wysyłkę wykonywać w ramach żądania, z krótkim limitem czasu połączenia i wysłania,
  bez stałego procesu, zadania w pamięci ani wymogu nowego crona.
- Dodać konfigurację `RODZINA_SMTP_HOST`, `RODZINA_SMTP_PORT`, `RODZINA_SMTP_SECURE`,
  `RODZINA_SMTP_USER`, `RODZINA_SMTP_PASSWORD` i `RODZINA_MAIL_FROM`, a także jawne
  włączenie funkcji przez `RODZINA_PASSWORD_RESET_EMAIL_ENABLED` (domyślnie `false`).
  Udokumentować znaczenie TLS/STARTTLS oraz walidować kompletność konfiguracji
  przy włączonej funkcji. Nie wyłączać weryfikacji certyfikatów.
- Przy wyłączonej funkcji logowanie działa jak dotychczas, akcja odzyskiwania jest
  niedostępna, a endpoint zwraca ogólny błąd niedostępności bez sprawdzania konta.
  Sposób przekazania dostępności do wspólnego frontendu ustalić podczas implementacji.
- Przy błędzie SMTP lub niejednoznacznym wyniku wysyłki unieważnić nowy token.
  Zachować tę samą odpowiedź publiczną co dla nieznanego adresu, aby awaria wysyłki
  nie ujawniała istnienia konta. Szczegóły błędu zapisać wyłącznie w logu operatora.
  Potwierdzenie formularza nie jest gwarancją dostarczenia wiadomości.
- Ograniczyć żądania niezależnie według IP i znormalizowanego adresu, także dla
  nieistniejących kont. Propozycja: 10 prób na 15 minut dla IP i 3 na godzinę
  dla adresu. Odpowiedź `429` ma standardowy kształt błędu i `Retry-After`.
- Limity utrwalać w SQLite, aby restart lub wiele procesów Passenger ich nie
  zerowały. Klucz adresu przechowywać jako hash, nie surowy e-mail. Jeśli wymaga to
  nowej tabeli, dodać migrację Drizzle; wygasłe wpisy czyścić przy żądaniach.
  Zweryfikować zaufanie do proxy, aby nagłówek klienta nie pozwalał omijać limitu IP.
- Ograniczyć różnice czasu odpowiedzi dla istniejącego i nieistniejącego konta;
  przetestować zachowanie również przy opóźnieniach i błędach SMTP.
- Nie logować haseł, tokenów, pełnych linków ani danych uwierzytelniających SMTP.
  Sprawdzić też logi HTTP aplikacji i hostingu, ponieważ token jest częścią adresu.
  Ekran resetu nie przekazuje linku w nagłówku Referer do innych stron i nie zapisuje
  go w cache offline ani analityce. Odpowiedzi związane z resetem mają `no-store`.
- Mail zawiera wersję tekstową i HTML, bez zewnętrznych elementów śledzących.

## 6. Pliki przewidziane do zmiany przy implementacji

| Obszar              | Przewidywane pliki                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| API i sesje         | `apps/api/src/app.ts`, ewentualnie wydzielony moduł resetu w `apps/api/src/modules/`                                                   |
| SMTP i konfiguracja | nowy moduł wysyłki w `apps/api/src/`, `apps/api/src/config.ts`, `apps/api/.env.example`                                                |
| Limity i migracja   | `apps/api/src/db/schema.ts`, migracja i metadane w `apps/api/drizzle/`                                                                 |
| Ekrany i nawigacja  | `apps/web/src/components/AuthPages.tsx`, `apps/web/src/components/JoinPages.tsx`, `apps/web/src/router.tsx`, `apps/web/src/i18n/pl.ts` |
| Sesja lokalna       | `apps/web/src/auth.tsx` i powiązane moduły tylko w zakresie resetu oraz istniejącego czyszczenia danych                                |
| Kontrakty           | `packages/shared/src/`, jeśli nowy kontrakt będzie współdzielony                                                                       |
| Zależności i paczka | `apps/api/package.json`, `package-lock.json`, ewentualnie `scripts/build-release.mjs`                                                  |
| Testy               | testy API, konfiguracji, SMTP, komponentów, sesji i nawigacji Androida; scenariusz Playwright w `e2e/`                                 |
| Dokumentacja        | `docs/DEPLOY.md`, `docs/DEVELOPMENT.md`, `docs/DECISIONS.md`                                                                           |

To lista orientacyjna; dokładne pliki należy wskazać po przeglądzie aktualnego stanu
repozytorium przed implementacją. Istniejące niezacommitowane zmiany wymagają zachowania.

## 7. Kolejność realizacji jednego kroku

1. Potwierdzić skrzynkę nadawczą, parametry SMTP i sposób bezpiecznego przekazania
   sekretów. Bez tych danych można wykonać kod i testy z atrapą poczty; rzeczywista
   dostarczalność oraz test produkcyjny pozostają wtedy niepotwierdzone.
2. Ustalić szczegóły limitów, sygnalizowania dostępności funkcji i obsługi logów;
   zapisać decyzje oraz przygotować potrzebną migrację.
3. Dodać konfigurację, moduł pocztowy, limity i endpoint zamawiania linku.
4. Rozszerzyć transakcję resetu o pozostałe tokeny i sesje oraz obsługę lokalnego
   zakończenia sesji. Zachować zgodność z linkami administratora i starszym APK.
5. Dodać formularz odzyskiwania, komunikaty oraz przejścia do istniejącego resetu.
6. Wykonać testy, próby UI i APK, uzupełnić dokumentację konfiguracji i wyników.
7. Zweryfikować końcowy commit w istniejącym CI. Aktualizację serwera i podpisane
   APK wdrożyć osobno, dopiero na polecenie właściciela.

## 8. Testy i kryteria odbioru

- Testy API obejmują poprawny i nieznany adres, normalizację, niepoprawny JSON,
  konto bez hasła, oba limity, ich działanie po restarcie, wyłączoną funkcję,
  błędną konfigurację, timeout i błąd SMTP. Publiczne odpowiedzi nie ujawniają konta.
- Testy poczty z atrapą sprawdzają odbiorcę, treść, link z konfiguracji, termin
  ważności i brak tokenu w odpowiedzi API; testowa wysyłka nie trafia do prawdziwych osób.
- Testy resetu sprawdzają wygaśnięcie, ponowne i równoległe użycie tokenów, stare
  oraz nowe hasło, unieważnienie wszystkich sesji i tokenów tylko właściwej osoby.
  Obejmują również istniejący reset przez administratora.
- Testy komponentów obejmują walidację, stan wysyłki, komunikaty, brak sieci,
  zamówienie nowego linku i zakończenie lokalnej sesji właściwego konta.
- Playwright wyłącznie headless: pełny przebieg z kontrolowaną skrzynką testową
  przy 390 i 1280 px, bez zakładania dostępności zewnętrznego SMTP w CI.
- Ręczny przegląd obu szerokości potwierdza czytelność formularzy i obsługę błędów.
  Na fizycznym Androidzie: zamówienie linku z APK, otwarcie z poczty przy zamkniętej
  i uruchomionej aplikacji, zmiana hasła, ponowne logowanie i obsługa utraty sesji.
- Rzeczywista próba SMTP potwierdza odbiór maila na wskazanej skrzynce testowej,
  poprawny link HTTPS oraz konfigurację nadawcy na hostingu. Konfigurację domeny
  nadawczej, w tym SPF/DKIM/DMARC, sprawdzić z ustawieniami dostawcy poczty.
- Lokalnie: testy zmienionej funkcji i zależności, lint i format zmienionych plików,
  `npm run typecheck`, build potrzebny do prób UI/APK oraz `release:smoke`
  ze względu na zmianę konfiguracji, zależności runtime i migrację.
- Końcowe CI zgodnie z sekcją 1.2 `docs/plan.md`, bez powtarzania całego CI lokalnie.
  Raport podaje commit, link do CI i faktycznie wykonane próby. Do czasu sukcesu CI:
  „zweryfikowane lokalnie, oczekuje na CI”. Brakujących prób nie oznaczamy jako zaliczonych.

Krok jest gotowy po spełnieniu powyższych kryteriów, uzupełnieniu dokumentacji
i sukcesie wymaganych zadań CI dla końcowego commita. Sam plan ani test z atrapą
SMTP nie potwierdzają działania poczty na produkcji. Po osobno zleconym wdrożeniu
wykonać kontrolowany test odzyskania dostępu istniejącego konta testowego.

## 9. Poza zakresem

- Weryfikacja e-maila przy rejestracji i zmiana adresu przypisanego do konta.
- Odzyskiwanie kont dzieci przez e-mail, zmiany PIN-ów, 2FA i logowanie przez Google.
- Wysyłanie zaproszeń lub przypomnień pocztą, newsletter i panel administracyjny poczty.
- Kolejka wiadomości, automatyczne ponawianie wysyłki, nowy cron i stały worker.
- Przywracanie PWA, Web Push oraz zmiany funkcjonalne innych modułów aplikacji.
