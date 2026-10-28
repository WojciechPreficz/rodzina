# Architektura aplikacji

## Produkt i platformy

Rodzina organizuje kalendarz, zakupy, zadania, dokumenty i kontakty.
Obiady pozostają planem w [plan.md](plan.md). Rodzina ma wspólne konto
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
  administratora ani nie zmieniamy dzieci w dorosłych i odwrotnie.
- Kontakty: jedna grupa na kontakt, jedna nieusuwalna grupa domyślna „Inne”
  na rodzinę; pozostałe początkowe grupy: Rodzina, Znajomi, Praca.
  Usunięcie grupy przenosi kontakty do domyślnej w transakcji.
  Dorośli edytują, cała rodzina odczytuje; brak integracji z książką telefonu.

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
- trustProxy=true wymaga zaufanego proxy nadpisującego X-Forwarded-*.
  Konfiguracja hostingu wymaga potwierdzenia; patrz DEPLOY.
- Błędny e-mail, hasło lub PIN zwraca 403 `INVALID_CREDENTIALS`, bez sygnału
  utraty sesji. Brak lub wygaśnięcie sesji zwraca 401 `UNAUTHORIZED`
  i uruchamia czyszczenie danych konta.
- Limity logowania: 10 prób/15 minut dla IP–konto, osobno hasło i PIN,
  trwałe w SQLite. Poprawne logowanie usuwa własny licznik.
- Operacje zakupów i zadań zachowują identyfikatory przy ponowieniu.
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
