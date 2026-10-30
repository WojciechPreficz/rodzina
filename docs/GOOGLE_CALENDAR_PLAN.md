# Google Calendar przez iCal — plan implementacji wariantu 1B

Status: plan do realizacji; kroki G.1–G.5 nie są zaimplementowane ani odebrane.

Zasady pracy i weryfikacji określa [AGENTS.md](../AGENTS.md).
Każdy krok realizujemy osobno, w jednym czacie i commicie.

## Cel i ustalony zakres

Dorosły podłącza kalendarz Google przez tajny adres iCal. Rodzina regularnie
pobiera wydarzenia i pokazuje je wszystkim domownikom we wspólnym kalendarzu WWW i APK.

- Synchronizacja jednokierunkowa: Google → Rodzina. Edycja wydarzeń pozostaje w Google.
- Automatyczne odświeżanie co 30 minut oraz ręczne „Odśwież teraz”.
- Ruchome okno: od początku dnia sprzed trzech miesięcy do końca dnia za dwanaście miesięcy, według strefy rodziny.
- Pobieramy wydarzenia przecinające to okno, również rozpoczęte wcześniej.
- Każdy domownik może ustawić osobiste przypomnienie dla konkretnego wystąpienia. Nie importujemy alarmów Google.
- Połączeniem zarządza autor lub administrator. Usunięcie autora usuwa jego połączenia, zaimportowane wydarzenia i powiązane przypomnienia.
- Poza zakresem: OAuth, zapis do Google, import plików, inni dostawcy, prywatne kalendarze, przypomnienia dla całej serii, PWA i Web Push.

Google opisuje udostępnienie kalendarza przez tajny adres iCal w swojej
[instrukcji integracji](https://support.google.com/calendar/answer/37648?co=GENIE.Platform%3DDesktop&hl=en).

## Zachowanie i rozwiązanie techniczne

### Podłączanie i zarządzanie

W ustawieniach kalendarza dodajemy sekcję „Kalendarze z Google”.

- Formularz: nazwa i tajny adres iCal, instrukcja jego uzyskania oraz wymagane potwierdzenie udostępnienia wydarzeń całej rodzinie.
- Zapis tworzy połączenie i wykonuje pierwszą próbę pobrania. Nieudane pobranie pozostawia widoczny stan błędu umożliwiający ponowienie lub poprawienie linku.
- Lista pokazuje nazwę, autora, zakres dat, ostatnią udaną aktualizację i stan synchronizacji.
- Autor i administrator mogą zmienić nazwę, zastąpić link, odświeżyć i odłączyć kalendarz.
- Zastąpienie linku dopuszczamy wyłącznie dla tego samego kalendarza Google; inny kalendarz wymaga nowego połączenia.
- Odłączenie wymaga potwierdzenia usunięcia importowanych wydarzeń i osobistych przypomnień wszystkich domowników. Oryginały w Google pozostają.
- Maksymalnie pięć połączeń na rodzinę. Ten sam kalendarz Google nie może być podłączony do rodziny dwukrotnie.

### Dane i interpretacja iCal

Dodajemy tabele połączeń oraz mapowania zewnętrznych wystąpień na istniejące
wydarzenia aplikacji. Połączenie przechowuje właściciela, zaszyfrowany URL, stan
synchronizacji, ostatni poprawny snapshot i walidatory HTTP.

- Parser: `ical.js`, z obsługą stref `VTIMEZONE` i dołączonej bazy stref dla identyfikatorów IANA. Bez pobierania definicji stref z sieci podczas importu. [Dokumentacja biblioteki](https://github.com/kewisch/ical.js/wiki/Common-Use-Cases)
- Obsługujemy wydarzenia pojedyncze, całodniowe, wielodniowe, `RRULE`, `RDATE`, `EXDATE`, przesunięcia i anulowania wystąpień.
- Serie rozwijamy na serwerze do pojedynczych wydarzeń w zadanym oknie. Nie przepisujemy ich do ograniczonego edytora reguł Rodziny.
- Tożsamość wystąpienia: połączenie + `UID` + oryginalny `RECURRENCE-ID`; dla wydarzenia pojedynczego — połączenie + `UID`. Przesunięcie terminu zachowuje lokalne ID.
- Zachowujemy tytuł, opis i miejsce; brak tytułu daje „Wydarzenie bez nazwy”. Treści traktujemy jako zwykły tekst, bez wykonywania HTML.
- Dla wydarzeń godzinowych zachowujemy dokładne momenty UTC. Całodniowe zachowują daty i wyłączną datę końca. Czas bez strefy interpretujemy według strefy kalendarza, a przy jej braku — rodziny.
- Dodajemy wewnętrzne dane czasu importu używane przez odczyty, szczegóły i harmonogram przypomnień, aby uniknąć utraty informacji przy zmianach czasu.
- Nieobsługiwana konstrukcja wpływająca na terminy, nierozpoznana strefa albo błąd struktury zatrzymują aktualizację całego połączenia z czytelnym błędem. Nie pomijamy po cichu wydarzeń.

### Synchronizacja i bezpieczeństwo

- Nowy, kończący działanie job cron korzysta z tego samego serwisu co ręczne odświeżanie. Bez stałego workera.
- Pełne pobranie i przetworzenie odbywa się przed transakcją zapisu. W transakcji dodajemy, aktualizujemy i usuwamy wystąpienia oraz powiązane przypomnienia.
- Zniknięcie wpisu z poprawnego snapshotu oznacza usunięcie lokalnej kopii. Wyjście poza ruchome okno również usuwa kopię i przypomnienia.
- Timeout, błąd HTTP, parsera lub przekroczenie limitu zachowują poprzednie dane. Poprawny pusty kalendarz jest poprawnym wynikiem i usuwa wcześniejszy import.
- Obsługujemy `ETag`, `Last-Modified` i `304`. Także przy `304` przeliczamy okno z ostatniego snapshotu.
- Blokada połączenia w SQLite zabezpiecza cron i żądania ręczne przed równoległą synchronizacją. Wersja połączenia chroni przed zapisem spóźnionego wyniku po zmianie linku lub odłączeniu.
- Ręczne pobranie najwyżej raz na minutę dla połączenia; `429` z `Retry-After`. Automatyczne próby nie częściej niż co 30 minut.
- Akceptujemy wyłącznie prywatne adresy Google: HTTPS, host `calendar.google.com`, ścieżkę kalendarza iCal, bez własnego portu, danych logowania i przekierowań.
- URL szyfrujemy AES-256-GCM kluczem z konfiguracji serwera. API nigdy go nie zwraca; logi nie zawierają URL ani treści kalendarza.
- Limity: 10 MiB rozpakowanej odpowiedzi, 10 000 wystąpień w oknie na połączenie, 30 sekund całej próby. Przetwarzanie parsera w przerywalnym wątku chroni proces API.
- Dane osoby organizującej i uczestników Google nie tworzą kont ani uczestników Rodziny.

### Kalendarz, offline i alarmy

- Wydarzenia mają oznaczenie „Google · nazwa kalendarza” i widoczny stan tylko do odczytu.
- API blokuje ich edycję, usunięcie i wspólne przypomnienia, również ze starszego APK.
- Osobiste przypomnienia wykorzystują obecne endpointy i harmonogram Androida. Dotyczą wyłącznie wybranego wystąpienia.
- Przesunięcie zachowuje przypomnienie: offset podąża za terminem, przypomnienie o konkretnej godzinie zachowuje dotychczasową zasadę `absolute`.
- Usunięcie wystąpienia usuwa przypomnienia; telefon aktualizuje alarmy przy następnej synchronizacji z API.
- Pobrane wydarzenia i szczegóły korzystają z istniejącego cache konta. Zarządzanie połączeniami i zapis przypomnień wymagają internetu.
- Widok pokazuje zakres importu i czas ostatniej aktualizacji. Nie sugeruje kompletności kalendarza poza oknem.
- Cron aktualizuje serwer. Zamknięte APK nie pobiera tych zmian w tle — zachowujemy obecne zasady aplikacji.

## API i kroki realizacji

Nowe endpointy pod `/api/calendar-subscriptions`:

- `GET /` — lista połączeń rodziny, bez sekretów, ze stanem i uprawnieniami.
- `POST /` — `{ name, url, shareWithFamily: true }`.
- `PATCH /:id` — zmiana nazwy lub zastąpienie linku.
- `POST /:id/refresh` — odświeżenie i podsumowanie wyniku.
- `DELETE /:id` — odłączenie wraz z importowanymi danymi.

Kontrakty Zod i błędy zgodne z projektem. Istniejące odpowiedzi wydarzeń
i wystąpień rozszerzamy o opcjonalne metadane źródła i uprawnień; brak metadanych
oznacza dotychczasowe wydarzenie lokalne. Zachowujemy dotychczasowe endpointy
i format harmonogramu APK.

Realizacja jako jedna nowa faza **G**, po jednym kroku na czat i commit:

1. **G.1 — dane i parser:** migracje, tożsamość wystąpień, czas, rozwijanie serii, testy na lokalnych fixture’ach ICS.
2. **G.2 — integracja serwera:** bezpieczne pobieranie, szyfrowanie, synchronizacja, API zarządzania, autoryzacja, blokady i sprzątanie po usunięciu konta.
3. **G.3 — kalendarz i przypomnienia:** integracja odczytów i szczegółów, ochrona importu przed mutacjami, osobiste alarmy oraz zgodność wspólnych kontraktów.
4. **G.4 — interfejs WWW/APK:** formularze, potwierdzenia, stany błędów, oznaczenia wydarzeń, cache i próby UI.
5. **G.5 — job i odbiór:** pakowanie crona, konfiguracja hostingu, release smoke, dokumentacja i odbiór całej fazy.

## Weryfikacja i gotowość

- Testy parsera: serie, wyjątki, przesunięcia, anulowania, DST, różne strefy, wydarzenia całodniowe i wielodniowe, granice okna oraz limity.
- Testy synchronizacji: ponowienie bez duplikatów, stabilne ID, usunięcia, pusty feed, `304` i przesunięcie okna, awarie bez utraty danych, konkurencja crona z API.
- Testy uprawnień: izolacja rodzin, autor/admin, dziecko, blokada mutacji importu, prywatność przypomnień i sekretów, usunięcie autora i rodziny.
- Testy alarmów: przesunięcie terminu, offset i `absolute`, anulowanie, odłączenie oraz aktualizacja harmonogramu na drugim urządzeniu.
- Testy komponentów i Playwright headless przy 390 i 1280 px; sprawdzenie cache po wylogowaniu, zmianie konta i restarcie APK offline.
- Ręcznie: rzeczywisty testowy kalendarz Google → dodanie, zmiana i usunięcie → odświeżenie w Rodzinie; osobiste alarmy na fizycznym telefonie i wspólny frontend APK.

Dodać `RODZINA_GOOGLE_ICAL_ENABLED=false` i `RODZINA_CALENDAR_ENCRYPTION_KEY`
do konfiguracji przykładowej oraz opisać przechowanie klucza razem z procedurą
odtwarzania backupu. Wyłączenie funkcji zatrzymuje pobieranie i zarządzanie
połączeniami, zachowując zapisane wydarzenia.

W [DEPLOY.md](DEPLOY.md) umieścić gotową linię crona co 30 minut, według
istniejących ścieżek Node i prywatnego `.env`. Dodać job do paczki release
i `release:smoke`, bez zewnętrznych połączeń w CI. Migracje wykonywać jawnie po backupie.

Podczas wdrażania kolejnych kroków aktualizować statusy i wymagania
w [plan.md](plan.md), aktualne zachowanie w [ARCHITECTURE.md](ARCHITECTURE.md),
próby w [DEVELOPMENT.md](DEVELOPMENT.md), a istotną decyzję o iCal i materializacji
wystąpień w [DECISIONS.md](DECISIONS.md). Ten dokument zawiera uzgodniony plan
funkcjonalności; nie jest raportem z jej implementacji ani potwierdzeniem odbioru.

Każdy krok wymaga właściwych kontroli lokalnych i końcowego CI według AGENTS.md.
Cała faza jest gotowa po odbiorze rzeczywistego feedu i fizycznego APK. Deploy
i publikacja podpisanego APK pozostają osobnymi czynnościami na polecenie właściciela.
