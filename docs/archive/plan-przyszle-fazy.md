# Plan — pełny zakres fazy 8 i propozycje roadmapy

Przeniesiono 22.10.2026 z docs/plan.md. Zachowano treść i statusy z chwili zapisu;
przeniesienie nie potwierdza zakończenia faz, CI, prób telefonu ani wdrożenia.
Archiwum czytaj tylko w zakresie potrzebnym do zadania. Bieżące wymagania
i reguły pierwszeństwa określa [plan](../plan.md).

**Aktualizacja 25.10.2026:** faza 8 jest zaimplementowana — potwierdzenie właściciela.
Poniższy zakres pozostaje historycznym zapisem wymagań. Nie oznacza to zaliczenia
końcowego CI ani niepotwierdzonych prób ręcznych; ich zapisy w DECISIONS.md
i checklista odbioru w [DEVELOPMENT.md](../DEVELOPMENT.md#odbiór-dokumentów--krok-84)
pozostają bez zmian. Kontakty wydzielono do planowanej
[fazy 9](../plan.md#faza-9---kontakty); nie należą do implementacji fazy 8.

### Faza 8 - sejf rodzinny: terminy ważności dokumentów

**Cel:** rodzina wpisuje terminy ważności ważnych dokumentów i dostaje przypomnienia z wyprzedzeniem. To wersja ograniczona sejfu: przechowujemy **tylko daty ważności**, bez skanów i bez numerów dokumentów.

**Typy dokumentów** (stała lista w `shared`, z domyślnymi przypomnieniami typu `offset` z `offset_unit=day`, które podążają za datą ważności po "Odnowiono"):

- `id_card` (dowód osobisty): 90 i 30 dni przed
- `passport` (paszport): 120 i 30 dni przed (wyrobienie trwa dłużej)
- `car_insurance` (OC/AC pojazdu): 30 i 7 dni przed
- `car_inspection` (przegląd techniczny): 30 i 7 dni przed
- `car_guarantee_inspection` (przegląd gwarancyjny samochodu): 30 i 7 dni przed (rozszerzenie właściciela 22.10.2026)
- `home_insurance` (ubezpieczenie mieszkania): 30 i 7 dni przed (rozszerzenie właściciela 24.10.2026)
- `rental_agreement` (umowa najmu mieszkania): 30 i 7 dni przed (rozszerzenie właściciela 24.10.2026)
- `other` (inny): 30 dni przed

**Zasady:**

- Dokument ma:
  - typ;
  - etykietę, np. "Paszport Zosi" albo "OC Skoda";
  - posiadacza (`holder_user_id`, dla dowodu i paszportu);
  - pojazd (`vehicle_label`, dla OC oraz przeglądu technicznego i gwarancyjnego);
  - datę ważności;
  - opcjonalną notatkę.
- W UI pokazujemy ostrzeżenie: "Nie wpisuj numerów dokumentów". Pole numeru nie istnieje.
- Widoczność: cała rodzina. Dziecko ma tylko odczyt.
- Przypomnienia korzystają ze wspólnej tabeli (`document_id`). Domyślnie `audience=adults`. Można też wybrać `owner`, czyli posiadacza (gdy go brak, twórcę), albo "tylko ja" przez `/api/reminders/mine` z `documentId`. Czas wysyłki to 09:00 lokalnie, przez `computeNextFireAt` z fazy 2.
- Akcja **"Odnowiono"**: użytkownik podaje nową datę ważności. Przypomnienia `offset` przeliczają się od nowej daty, a `absolute` z przeszłości oznaczane są jako nieaktualne (sekcja 2).
- Statusy liczone w `shared`: `valid`, `expiring` i `expired`. Próg `expiring` liczymy dla każdego typu osobno: to najwcześniejsze z domyślnych przypomnień danego typu (paszport 120 dni, dowód 90, pozostałe typy 30 dni). Status zmienia kolor dokładnie wtedy, gdy przychodzi pierwsze przypomnienie.

**Endpointy:**

- `GET /api/documents` (posortowane po `expires_on`, ze statusem).
- `POST /api/documents` z `{ type, label, holderUserId?, vehicleLabel?, expiresOn, notes?, reminders? }`. Gdy nie podano `reminders`, ustawiane są domyślne dla typu.
- `PATCH /api/documents/:id`, `DELETE /api/documents/:id`.
- `POST /api/documents/:id/renew` z `{ expiresOn }`.

**UI:**

- Więcej > **Dokumenty**:
  - lista z kolorowym statusem (zielony, pomarańczowy, czerwony) i tekstem "ważny do 12.05.2028 (za 1 rok i 7 mies.)";
  - filtr: osoby, pojazdy, mieszkanie (ubezpieczenie mieszkania i umowa najmu), wszystkie.
- Formularz z wyborem typu, który dopasowuje pola (posiadacz albo pojazd) i podstawia domyślne przypomnienia z możliwością edycji.
- Plakietka na pozycji "Więcej" w nawigacji, gdy jakiś dokument jest w stanie `expiring` albo `expired`.
- Payload harmonogramu APK dla dokumentów zawiera bezwzględną datę ważności, np. „OC Skoda — ważne do 15.11.2026”, bez względnego „za 30 dni” zapisanego z wyprzedzeniem.

**Kroki realizacji:**

#### Krok 8.1 - Typy, statusy i CRUD dokumentów

- **Zakres:** w `shared` stała lista typów z domyślnymi przypomnieniami, `getDocumentStatus` (`valid`, `expiring`, `expired`, próg `expiring` osobno dla każdego typu) i schematy zod. Migracja `documents` (`holder_user_id` z `ON DELETE SET NULL`, bez pola numeru dokumentu). `GET /api/documents` (sortowanie po `expires_on`, ze statusem), `POST`, `PATCH`, `DELETE`. Uprawnienia: dziecko ma tylko odczyt. W tym kroku `POST` jeszcze nie ustawia przypomnień.
- **Gotowe, gdy:** testy statusów na granicy progu `expiring` dla każdego typu i w dniu wygaśnięcia, testy CRUD, 403 dla dziecka na zapisie, izolacja rodzin.

#### Krok 8.2 - Przypomnienia dokumentów i odnowienie

**Integracja Androida:** rozszerzamy `/api/reminders/schedule` o dokumenty z odbiorcami, offsetami i godziną 09:00 Europe/Warsaw według shared. „Odnowiono”, zmiana daty i usunięcie aktualizują lokalne alarmy po synchronizacji. Testy obejmują domyślne przypomnienia, odnowienie i odebranie wcześniej zapisanego alarmu offline na APK. Czas w testach API wstrzykujemy do obliczeń; nie przywracamy joba ani flagi `--now`.

- **Zakres:** domyślne przypomnienia przy `POST`, gdy nie podano `reminders`. Przypomnienia w body dokumentu i `/api/reminders/mine` z `documentId`. Walidacja `audience` (`family`, `adults`, `owner`, `user`; domyślnie `adults`). `POST /api/documents/:id/renew` przelicza terminy i `next_fire_at`. `resolveRecipients`: `owner` to posiadacz albo twórca, reguły awaryjne z sekcji 2. Payload APK z bezwzględną datą ważności i `documentUrl` w shared. Alarm dla daty bez godziny o 09:00 lokalnie.
- **Gotowe, gdy:** testy domyślnych przypomnień per typ, odnowienia (`offset` podąża, przeszłe `absolute` nieaktywne), odbiorców i izolacji rodzin w `/api/reminders/schedule` przechodzą. Snapshot zawiera terminy UTC odpowiadające 09:00 Europe/Warsaw także przez zmianę czasu; adapter po synchronizacji zmienia/anuluje alarmy. (+ `release:smoke`.)

#### Krok 8.3 - UI: lista i formularz dokumentów

- **Zakres:** Więcej > Dokumenty: lista z kolorowym statusem i tekstem "ważny do 12.05.2028 (za 1 rok i 7 mies.)", filtr (osoby, pojazdy, mieszkanie, wszystkie). Kategoria „Mieszkanie” obejmuje ubezpieczenie mieszkania i umowę najmu (rozszerzenie właściciela 24.10.2026). Formularz z wyborem typu, który dopasowuje pola (posiadacz albo pojazd), ostrzeżeniem "Nie wpisuj numerów dokumentów" i domyślnymi przypomnieniami do edycji przez `ReminderPicker`. Edycja i usuwanie. Dziecko widzi tylko odczyt.
- **Gotowe, gdy:** testy komponentów (dopasowanie pól do typu, ukrycie edycji dla dziecka, kolory statusów). Ręcznie: dodanie dokumentu każdego typu.

#### Krok 8.4 - UI: odnowienie, plakietka i domknięcie fazy

- **Zakres:** akcja "Odnowiono" (nowa data ważności). Plakietka na "Więcej", gdy dokument jest `expiring` lub `expired`. Trasa szczegółów z alarmu APK i sekcja "Moje przypomnienia" ("tylko ja").
- **Gotowe, gdy:** wszystkie kryteria fazy 8, w tym ręcznie na fizycznym Androidzie: dokument ważny za 31 dni z przypomnieniem 30 dni przed, zsynchronizowany online, generuje zapisany alarm o 09:00 Europe/Warsaw następnego dnia bez sieci i z zamkniętym interfejsem. Osobna próba po restarcie i pierwszym odblokowaniu, zapis rzeczywistych godzin/opóźnień i otwarcie właściwego dokumentu. Punkty z sekcji 1.1 i `release:smoke`.

**Kryteria akceptacji:**

- Testy:
  - domyślne przypomnienia per typ;
  - `renew` przelicza `next_fire_at`;
  - statusy na granicy progu `expiring` dla każdego typu i w dniu wygaśnięcia;
  - dziecko dostaje 403 na zapisie;
  - izolacja rodzin.
- Manualnie na fizycznym Androidzie: dokument ważny za 31 dni, przypomnienie 30 dni przed, zapis online i alarm następnego dnia o 09:00 Europe/Warsaw offline przy zamkniętym interfejsie; drugi test po restarcie i odblokowaniu. Zapisz faktyczne daty, godziny i opóźnienia. Test sztucznego czasu w API nie zastępuje tych prób; nie ma joba Web Push.
- Spełnione punkty z sekcji 1.1.

**Poza zakresem:** skany i zdjęcia dokumentów, numery dokumentów, karta zdrowia, kontakty (obecnie osobna, planowana faza 9 w `docs/plan.md`).

---

---

## 7. Roadmapa po fazach podstawowych i etapie Android (propozycje na podstawie konkurencji)

Konkurencja: Cozi, FamilyWall, TimeTree, OurHome, Skylight, Picniic, Maple. Kolejność według stosunku wartości do kosztu:

1. **Subskrypcja iCal**: prywatny URL `.ics` (token per użytkownik) do dodania w Google Calendar.
2. **Urodziny i rocznice**: wydarzenia roczne z domyślnym przypomnieniem tydzień wcześniej.
3. **"Kto zawozi / kto odbiera"** przy wydarzeniach i komentarze (TimeTree).
4. **Rozszerzenie sejfu rodzinnego** (Picniic): karta zdrowia domownika (lekarze, alergie, szczepienia, historia badań, powiązana z wydarzeniami odległymi). Ważne kontakty (przedszkole, szkoła, opiekunka) wydzielono do osobnej, planowanej fazy 9 w `docs/plan.md`.
5. **Obowiązki domowe z punktami i nagrodami** dla dzieci (OurHome, Skylight). Może bazować na listach zadań z fazy 7 i dodawać zadania cykliczne.
6. **Książka przepisów** powiązana z planem obiadów (Cozi).
7. **Tryb tablicy na tablet w kuchni** (Skylight, Hearth): pełnoekranowy widok "dziś".
8. **Powiadomienia o zmianach** dokonanych przez innych domowników, z ustawieniami per użytkownik.
   Dla APK oznacza to osobny etap natywnego push FCM: rejestrację tokenów per urządzenie, konfigurację Firebase i wysyłkę z backendu oraz odświeżanie harmonogramu przy zamkniętym interfejsie. Potrzebna jest natywna obsługa wiadomości i trwała praca synchronizacyjna; sam callback JavaScript pluginu nie wystarcza po zakończeniu procesu. Należy też zaplanować ponowienia i deduplikację, bez obietnicy natychmiastowego dostarczenia w Doze lub bez internetu. Nie jest to część fazy 4.
9. **Wydatki/budżet domowy** (FamilyWall).
10. **Wsparcie iOS**: osobny etap natywnej aplikacji, dystrybucji i lokalnych powiadomień; bez przywracania PWA/Web Push.
