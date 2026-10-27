# Dodawanie modułu do wspólnej obsługi offline

Instrukcja O.7 (#55), 27.10.2026. Działające wzorce to zakupy
(`shoppingStorage.ts`, `shoppingOffline.ts`, `shoppingAdapter.ts`) i zadania
(`taskStorage.ts`, `taskOffline.ts`, `taskAdapter.ts`). Rodzina, kalendarz
i kontakty udostępniają wyłącznie podgląd. Nie dodajemy im kolejki.
Reguły nadrzędne: [kontrakt](OFFLINE_CONTRACT.md) i [plan](OFFLINE_PLAN.md).

## Schemat, konto i budżet

1. Rozszerz `CacheModule` w `apps/web/src/offline/registry.ts` i zarejestruj
   adapter przez `registerAdapter`. Import rejestrujący musi być osiągalny
   przed migracją i czyszczeniem konta. W rejestrze są wszystkie pięć modułów,
   także zakupy ze swoim importerem. Nie wystarczy rejestracja nadawcy.
2. Zdefiniuj walidację Zod cache i payloadu operacji, `schemaVersion`,
   kompletność zakresu oraz czas potwierdzonego pobrania. Waliduj konto
   `familyId:userId`, powiązania obiektów i uprawnienia; nie przechowuj tokenów.
   Nieobsługiwana wersja i uszkodzony dziennik zatrzymują odtwarzanie.
3. Przydziel budżet w kontrakcie. Stosuj `chargedBytes(key, record)` z marginesem,
   uwzględniając długość samego licznika do osiągnięcia stałej wartości.
   `CacheEntry.chargedBytes` oznacza wyłącznie rekord cache; `budget:shopping`
   i `budget:tasks` obejmują także rekordy wspólnego outbox tego modułu.
   Cache bez operacji zakupów ma 4 MiB; chroniona baza z kolejką łącznie 6 MiB.
   Zadania z kolejką mają łącznie 6 MiB. Kolejki nie usuwamy ani nie wycinamy
   jej bazy przy przekroczeniu limitu. Odmawiamy przyjęcia nowej zmiany.
4. Brak zakresu różni się od pustej listy. Projekcja oczekujących operacji
   nie jest potwierdzoną bazą serwera. Wzorzec zadań: `project()` w
   `taskOffline.ts`; wzorzec zakupów: `applyShoppingChange` na osobnej kopii
   cache w `shoppingQueries.ts`. Ponowne odtworzenie nie stosuje zmian dwa razy.

## Przyjęcie zmiany i transport

Zapis wykonuj przez `transact('readwrite', ..., accountToken())`, sprawdzając
`assertContext(tx)` i oczekiwane konto. W jednej transakcji zapisz intencję
`appendOperation`, licznik sekwencji i potrzebną bazę/projekcję. Dopiero po
rozwiązaniu `transact` pokaż sukces UI. Błąd transakcji pozostawia poprzedni
stan i komunikat; sama obecność optymistycznego wiersza nie potwierdza końca
obsługi formularza. Test nawigacji czeka na zwolnienie ochrony formularza.

Intencja zawiera stałe `operationId`, `submittedAt`, `entityId`, `payload`,
`orderingKeys` i opcjonalne `dependsOn`. Zakupy serializują listę kluczem
`shopping:list:<id>`; zadania używają `tasks:list:<listId>:task:<taskId>`.
Rodzic zależności musi już istnieć; rdzeń odrzuca cykle. Nie nadawaj nowego
ID lub czasu przy retry i nie zamieniaj konfliktu w nadpisanie serwera.

Implementuj `SyncAdapter` z `apps/web/src/offline/sync.ts`:

| Metoda                                   | Obowiązek adaptera                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `prepare(operation, signal)`             | Sprawdź sesję i dostęp przed odtworzeniem, także zapisanej odpowiedzi API.                                                |
| `send(operation, signal)`                | Zweryfikuj payload i wywołaj atomowy endpoint z tym samym ID; przekaż sygnał anulowania.                                  |
| `reconcile(tx, operation, response)`     | Zapisz potwierdzony wynik w przekazanej transakcji. Rdzeń usuwa operację i aktualizuje zależności w tej samej transakcji. |
| `invalidateAccess(tx, operation, error)` | Usuń niedozwoloną treść i zależne operacje. Odróżnij usunięty obiekt od cofnięcia dostępu do całej listy.                 |

Podłącz adapter przez `joinSync(accountId, adapter, reload)`. Zakupy i zadania
dołączają do tego samego nadawcy konta. `stop()` odłącza obserwatora;
ostatni obserwator zatrzymuje nadawcę. Nowy moduł nie wywołuje `startSync`
bezpośrednio i nie instaluje drugiego zegara retry, listenerów sesji,
sieci ani aktywacji aplikacji. Pobieranie potwierdzonej bazy modułu może
zachować własne odświeżanie; nie może ono wysyłać operacji z drugiej kolejki.

Rdzeń obsługuje dzierżawę i generację, retry sieci/429/5xx z `Retry-After`,
trwały termin ponowienia, granicę 30 dni i zależności. API zachowuje odpowiedzi
90 dni. 401/zmiana sesji zatrzymuje konto. Adapter rozróżnia znaczenie
403/404/409; odrzucenie i konflikt wymagają reakcji. Prywatna treść znika
z pamięci oraz widoku również wtedy, gdy trwały zapis jej usunięcia zawiedzie.

Nadawca nie odpytuje pustej kolejki okresowo. `appendOperation`, zakończenie
operacji i aktualizacja jej stanu zgłaszają zmianę po zatwierdzeniu transakcji.
Jeśli adapter bezpośrednio usuwa lub modyfikuje wpisy outbox poza tymi metodami,
wywołuje `notifyOutboxChanged(tx, accountId)` z `offline/signals.ts`.
Sygnały lokalne i między kartami budzą tego samego nadawcę; IDB pozostaje źródłem
prawdy. Jeden timer obsługuje termin retry, przejęcie wygasającej dzierżawy
i granicę wieku operacji. Pusta kolejka nie wymaga timera ani dzierżawy.

## Status, sesja i migracja

- Kolejki korzystają z `useOfflineSyncStatus(accountId, module)`:
  `pendingCount`, `reviewCount`, `syncing`, `lastError`, `lastSyncedAt`,
  `sessionConfirmed`, `storageIssue`, `offline`, `migrating`, `hydrating`.
  Czas ostatniej wysłanej operacji nie zastępuje czasu pobrania podglądu.
- Wszystkie podglądy używają `OfflineNotice`: połączenie, ograniczenia modułu,
  ostatnie potwierdzone pobranie lub jawny brak czasu i błąd pamięci.
  Liczby oczekujących zmian i rozstrzyganie konfliktów zachowują kontekst modułu.
  Daty pobrania nie odmładzają się przy samej projekcji ani odczycie z IDB.
- Zarejestruj pamięć modułu w `accountStorage.ts`. Zatrzymaj obserwatora
  i unieważnij generację przed czyszczeniem asynchronicznym. Spóźniona odpowiedź
  nie zapisuje danych starego konta. `storage-changed` nie usuwa nowych danych
  drugiej karty. Globalne czyszczenie obejmuje cache, outbox, metadane konta,
  obszar migracji i dawne klucze wszystkich zarejestrowanych adapterów.
- Dla wspieranych źródeł zachowaj importer: `registerRecordMigration`
  dla pojedynczych rekordów, specjalny importer zakupów dla snapshotu TanStack
  i dziennika. `separateMigration` wyłącza jedynie importer podglądów,
  nie rejestr czyszczenia. Nie usuwaj formatów legacy tylko dlatego, że
  nie służą już bieżącym zapisom.
- Import wymaga zamknięcia starych instancji, potwierdzenia właściciela,
  preflight i weryfikacji transakcyjnego celu. Źródło znika po weryfikacji.
  Przejęcie O.3/O.4 przenosi operacje do outbox atomowo i zachowuje ich ID,
  czas, status i odrzucenia. Nie uruchamiaj starego nadawcy ani podwójnego zapisu.

## Testy adaptera i przyszłe obiady

Wymagane testy: bezpośredni import legacy i pominięcie wydań, awaria przed/po
commit, restart offline, utrata odpowiedzi, retry 429/5xx, korekta zegara,
stare zmiany, konflikt z zależnością i niezależna operacja, dwie karty,
wygaśnięcie dzierżawy, brak miejsca/IDB, cofnięcie dostępu, logout i późny wynik.
Wzorce: `offline/acceptance.test.ts`, `offline/sync.test.ts`,
`shoppingOffline.test.ts`, `taskOffline.test.ts`, `accountStorage.test.ts`
oraz `e2e/shared-outbox.spec.ts` i `e2e/offline-migration.spec.ts`.
Nowy adapter ma przejść te scenariusze razem z zakupami i zadaniami.
Testy headless przy 390/1280 px i przegląd zrzutów uzupełniają fizyczny APK;
testowy transport Androida nie potwierdza restartu urządzenia ani alarmów.

Checklista dla [6.5 (#48)](https://github.com/WojciechPreficz/rodzina/issues/48):

- Przydziel budżet tygodniom, składnikom, lokalnym podpowiedziom i kolejce;
  rozróżnij niepobrany tydzień od pustego oraz zachowaj odczyt dziecka.
- Zapisuj projekcję karty „Dziś na obiad” według daty rodziny.
- Eksport składników to jedna operacja adaptera obiadów we wspólnym outbox:
  kopia składników z chwili zlecenia, konto, lista docelowa i stałe ID.
- Zależność od lokalnej listy zakupów musi być jawna; adapter zakupów uzgadnia
  projekcję bez dodawania drugiego wysyłającego wpisu. Wynik obu modułów
  zatwierdź atomowo. Ponowienie po utracie odpowiedzi nie zwiększa ilości.
- Przed implementacją uzgodnij ponowny ręczny eksport i pozycje już kupione
  zgodnie z fazą 6.2. O.7 nie rozstrzyga tych pytań ani nie tworzy adaptera obiadów.
