# Rodzina — bieżący plan projektu

Zasady pracy są w sekcjach 1, 1.1 i 1.2 poniżej. Konwencje, ograniczenia
hostingu i model danych (dawne sekcje 2–5) są w [ARCHITECTURE.md](ARCHITECTURE.md).
Pełne zakresy wcześniejszych etapów i ich statusy zachowuje
[archiwum planu](archive/README.md). Przeniesienie nie oznacza ich akceptacji.

## 1. Kontekst dla agenta

- **Produkt.** Aplikacja do zarządzania życiem rodzinnym. Rodzina ma jedno konto, a w nim wielu domowników.
- **Widoczność.** Wydarzenia, zakupy, obiady i dokumenty widzi cała rodzina. Wyjątkiem są listy zadań (faza 7): widzi je właściciel i domownicy, którym je udostępnił.
- **Platformy docelowe: aplikacja Android (APK przez Capacitor) i zwykła strona WWW** ze wspólnym interfejsem React. Przypomnienia, w tym alarmy offline, są funkcją APK. Strona pozwala zarządzać danymi i pobrać APK. APK zawiera lokalny frontend, a nie tylko stronę ładowaną ze zdalnego adresu. Decyzja właściciela z 19.10.2026 wycofuje PWA i Web Push w krokach 4.8-4.10 przed fazą 5.
- **Pierwszeństwo aktualnego zakresu:** opisy PWA, Web Push i ich kryteriów w fazach 0-4 oraz historycznego deployu dokumentują wcześniejszy projekt. Od kroku 4.8 obowiązuje sekcja „Wycofanie PWA” poniżej. Dla przyszłych faz 7-8 testujemy odbiorców i harmonogram APK zamiast usuniętej wysyłki Web Push i `job --now`; zachowujemy zasady prywatności, dat i uprawnień. Nie przywracamy PWA w kolejnych fazach.
- **Hosting docelowy.** Współdzielony hosting cPanel w vh.pl, aplikacja pod subdomeną istniejącej domeny właściciela, przez HTTPS. Właściciel ma już na tym hostingu aplikację wdrożoną tą samą metodą (zip, aplikacja w cPanel, Phusion Passenger, SQLite w katalogu danych). Wzorzec deployu: [portfel/DEPLOY.md](https://github.com/WojciechPreficz/portfel/blob/main/DEPLOY.md). Wzorujemy się tylko na sposobie wdrożenia, nie na stacku.
- **Kolejność: fazy 0-3 → pierwszy deploy (wykonany) → faza 4 (Android) → faza 5 (zakupy) → faza 6 (obiady) → faza 7 (zadania) → faza 8 (dokumenty).** Właściciel potwierdził 16.10.2026 działanie aplikacji pod https://rodzina.preficze.pl. Nie powtarzamy pierwszego deployu. Numeracja odpowiada kolejności prac; wykonane wdrożenie ma osobny zapis historyczny i kroki D.1-D.4. Dawny etap wydania open source usunięto. Funkcje rozwijamy i sprawdzamy lokalnie w zakresie zmiany, pełną weryfikację końcową wykonuje CI według sekcji 1.2, a sprawdzone aktualizacje serwera wdrażamy według `docs/DEPLOY.md`. Samo działanie strony nie zalicza niepotwierdzonych testów ani kryteriów wcześniejszych faz.
- **Język.** UI wyłącznie po polsku. Kod, nazwy, komentarze i commity po angielsku. README i dokumentacja w `docs/` po polsku.
- **Nawigacja (decyzja właściciela 19.10.2026):** strona WWW od 768 px ma stałe pionowe menu po lewej (240 px). Węższa strona i APK mają hamburger w prawym górnym rogu oraz panel wysuwany z prawej z pozycjami jedna pod drugą. Wspólna kolejność: Kalendarz, Zakupy, Obiady, Rodzina, Powiadomienia, Wersja aplikacji; dane konta i wylogowanie są na dole menu. Nie ma dolnego paska ani pozycji „Więcej”; dotychczasowe adresy `/wiecej`, `/wiecej/rodzina` i `/wiecej/powiadomienia` pozostają zgodne. Ten zapis zastępuje wcześniejsze wymagania dolnej nawigacji i „Więcej” także w opisach przyszłych faz. Zadania i Dokumenty dodajemy dopiero w odpowiednich fazach jako bezpośrednie pozycje menu; przyszłą plakietkę dokumentów umieszczamy przy Dokumentach.
- **Podgląd offline (decyzja właściciela 20.10.2026):** po zakupach dodajemy kroki 5.4 (Rodzina) i 5.5 (Kalendarz), przed fazą 6. Oba ekrany pokazują zapisane dane oraz baner offline; kalendarz pozostaje tylko do odczytu, a rodzina zachowuje listę domowników i ostatni znany kod dołączenia. Nie dodajemy kolejki zmian tych modułów. Szczegóły i granice cache opisano przy [krokach 5.4–5.5](archive/plan-fazy-5-7.md); ten zapis rozszerza wcześniejsze ograniczenie podglądu offline do zakupów i harmonogramu APK.
- **Zasada pracy.** Agent realizuje **jeden krok jednej fazy naraz** (fazy 1-8 są podzielone na kroki, sekcja 1.2; faza 0 jest realizowana w całości). Fazę kończy dopiero wtedy, gdy wszystkie kroki są gotowe, wszystkie kryteria akceptacji są spełnione oraz pełne CI dla końcowego commita przechodzi zgodnie z sekcją 1.2. Każdą decyzję, której plan nie rozstrzyga, zapisuje w `docs/DECISIONS.md` (data, decyzja, powód).
- **Zakres lektury.** Przed pracą czytamy aktualny kontekst i zasady z sekcji 1, 1.1 i 1.2 oraz opis bieżącej fazy i kroku. Decyzje, konwencje, model danych z sekcji 2-5 w [ARCHITECTURE.md](ARCHITECTURE.md) i pozostałe dokumenty doczytujemy w zakresie zmiany i jej zależności. Nie ma obowiązku czytania całego planu w każdym czacie ani ponownego wczytywania niezmienionych treści już przeczytanych. Zapisy historyczne i przyszłe fazy służą jako odniesienie, gdy są potrzebne.

**Układ ekranów (decyzja właściciela 20.10.2026):** nie wyświetlamy górnego paska z powtórzoną nazwą zakładki. Tytuł pozostaje w treści ekranu. Na telefonie i w APK zachowujemy hamburger w prawym górnym rogu, a na szerokiej stronie pionowe menu po lewej.

### 1.1 Gotowość do deployu w każdej fazie (Definition of Done)

Każda faza, która to dotyczy, musi:

- dopisać nowe zmienne środowiskowe do `apps/api/.env.example` (z komentarzem) i do sekcji konfiguracji w `docs/DEPLOY.md`;
- dopisać nowe zadania okresowe do sekcji crona w `docs/DEPLOY.md`, z gotową linią do wklejenia w cPanel;
- commitować wygenerowane migracje Drizzle, bo serwer uruchamia je przy starcie;
- zapewnić, że nowe zależności runtime nie wymagają kompilacji na serwerze. Jeśli wymagają, trzeba to oznaczyć w `DECISIONS.md` i dodać jako external w `build-release.mjs`;
- przejść `npm run release:smoke` w CI dla końcowego commita, a lokalnie w przypadkach z sekcji 1.2: zip jest rozpakowywany do katalogu tymczasowego, instalowane są zależności produkcyjne, startuje `server.cjs` z testowym `.env`, a skrypt sprawdza `/api/health` i serwowanie `index.html`;
- nie zakładać niczego, czego nie ma na cPanel: brak stałego procesu w tle, brak WebSocketów, brak Dockera, brak Redisa.

Od fazy 4 zmiany wspólnego frontendu sprawdzamy także w APK. Paczka `release.zip` aktualizuje serwer i stronę WWW; APK jest budowane i podpisywane osobno. Ręczny workflow Deploy publikuje oba artefakty, a użytkownik zatwierdza aktualizację na telefonie. Zależności Androida wymagają lokalnego SDK/JDK/Gradle, nie kompilacji na vh.pl. Backend zachowuje zgodność z poprzednią wspieraną wersją APK. Sekrety podpisywania nie trafiają do repo ani do paczki serwerowej. Kryteria alarmów offline i testy na telefonie opisuje faza 4; `release:smoke` nadal sprawdza wyłącznie paczkę serwera. Przejściowy `/sw.js` pozostaje dostępny z `no-store` dla dawnych instalacji, a `/manifest.webmanifest` zwraca 410 także po deployu nakładkowym.

### 1.2 Kroki w obrębie fazy

Fazy 1-8 są podzielone na **kroki** (np. 1.1, 1.2, 2.1). Opis kroków jest w każdej fazie w sekcji "Kroki realizacji". Zasady:

- Agent realizuje **jeden krok naraz**: jeden krok to jeden czat i jeden commit (Conventional Commits, np. `feat(api): ...`). Kroki wykonujemy w podanej kolejności.
- Krok jest gotowy, gdy spełnione są warunki "Gotowe, gdy" z jego opisu, wymagane kontrole lokalne i próby ręczne oraz wszystkie wymagane zadania CI zakończyły się sukcesem dla końcowego commita. Pełne kryteria akceptacji fazy i punkty z sekcji 1.1 obowiązują w **ostatnim kroku fazy**. Przesłanie gałęzi do GitHub może poprzedzać pełną weryfikację; nie oznacza zakończenia kroku ani zgody na wdrożenie.
- Krok nie zostawia aplikacji w stanie połowicznym: endpointy i ekrany z kroku działają od początku do końca, a nieużywany kod "na zapas" nie powstaje. Każdy krok dodaje tylko te tabele, których sam używa, a migracje commituje razem z krokiem.
- Kroki API i logiki mają testy automatyczne, a kroki UI testy komponentów oraz krótką weryfikację ręczną opisaną w kroku. Każdy krok UI sprawdzamy w dwóch szerokościach: telefon (ok. 390 px) i desktop w Chrome. Układ nie może się rozjeżdżać na szerokim ekranie.
- Jeśli krok wymaga czegoś z późniejszego kroku (np. tabeli, której jeszcze nie ma), to błąd podziału. Agent zatrzymuje się, opisuje problem w `docs/DECISIONS.md` i pyta, zamiast implementować fragment kolejnego kroku.

#### Podział kontroli lokalnych i CI (decyzja właściciela, 20.10.2026)

| Etap                             | Wymagany zakres                                                                                                                                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Podczas implementacji            | Testy zmienianej funkcji i modułów zależnych od zmiany; przy zmianie kontraktu shared także jego użytkowników w API i web.                                                                                            |
| Przed wysłaniem zmian kodu       | Lint i formatowanie zmienionych plików, `npm run typecheck` oraz odpowiednie testy. Build i testy przeglądarkowe lokalnie, gdy są potrzebne do sprawdzenia zmiany lub próby ręcznej.                                  |
| Zmiany wyłącznie dokumentacyjne  | Lokalny przegląd treści, diffu i formatowania zmienionych dokumentów; bez testów i buildu aplikacji. Istniejący workflow CI nadal działa według swojej konfiguracji.                                                  |
| Końcowa weryfikacja automatyczna | Istniejący `.github/workflows/ci.yml`: `npm ci`, lint, format:check, typecheck, pełny Vitest, build, Playwright headless i `release:smoke` na Node 22 i 24; osobny job Androida: debug APK, testy JVM i Android Lint. |
| Zakończenie kroku lub fazy       | Sukces wszystkich wymaganych zadań CI dla końcowego commita oraz spełnione odpowiednie kryteria funkcjonalne i próby ręczne. W ostatnim kroku także kryteria całej fazy i sekcji 1.1.                                 |

- **Pierwszeństwo podziału:** ta sekcja zastępuje wcześniejszy ogólny obowiązek pełnej weryfikacji lokalnej. Listy komend i sformułowania „pełne/standardowe kontrole przechodzą” w opisach kroków oznaczają końcową weryfikację w CI, bez obowiązku powielania całego zestawu lokalnie. Wymagania funkcjonalne i sprzętowe pozostają obowiązujące; historycznych wyników testów nie zmieniamy.
- **Kontrole zależne od zmiany:** lokalny `release:smoke` wykonujemy, gdy krok wyraźnie wymaga lokalnej próby paczki albo zmiana dotyczy pakowania/deployu, migracji, konfiguracji startowej, jobów lub zależności runtime. Samo wymienienie `release:smoke` w warunkach zakończenia kroku lub fazy oznacza wymóg jego sukcesu w CI. Nie uruchamiamy go rutynowo dla każdego kroku UI. W CI smoke nadal działa przy każdym przebiegu zgodnie z aktualnym workflow.
- **UI i Android:** lokalnie sprawdzamy zmienione widoki przy 390 i 1280 px oraz wspólny frontend także w APK. Lokalne buildy i kontrole natywne dobieramy do zmiany; pełny build debug, testy JVM i Android Lint są bramką w CI. Wskazane próby fizycznego telefonu, alarmów offline, restartu i instalatora nadal wymagają rzeczywistego wykonania; CI, mocki i przeglądarka ich nie zastępują. Nie powtarzamy wszystkich prób telefonu przy każdej drobnej zmianie, tylko te wymagane zakresem kroku i możliwą regresją.
- **Wynik dla konkretnej wersji:** raport końcowy podaje skrót commita, link i wynik CI oraz zwięzły wynik kontroli lokalnych i prób ręcznych. Sukces wcześniejszego commita nie zalicza zmienionej wersji. Przed commitem/pushem, przy oczekującym lub niedostępnym CI raportujemy „zweryfikowane lokalnie, oczekuje na CI”; brakujących prób ręcznych nie oznaczamy jako zaliczonych. W razie błędu poprawiamy zmianę, sprawdzamy lokalnie przyczynę i wymagamy sukcesu CI dla poprawionej wersji. Polecenie właściciela, by nie commitować lub nie wysyłać zmian, ma pierwszeństwo; stan oczekiwania raportujemy jawnie.
- **Logi i ponowienia:** pełne logi zapisujemy do plików poza repozytorium lub w ignorowanym katalogu roboczym. Agent odczytuje podsumowania i potrzebne fragmenty błędów. Statusy zadań CI sprawdza zbiorczo, bez częstego odpytywania. Udanych kontroli lokalnych nie powtarzamy bez zmiany, która może wpłynąć na wynik; zmiana samej dokumentacji nie unieważnia wcześniejszych testów kodu, ale końcowe CI nadal musi dotyczyć końcowego commita.
- **Granica wdrożenia:** podział nie zmienia `.github/workflows/ci.yml` ani `.github/workflows/deploy.yml`. Deploy pozostaje ręczny i wykonuje własne wymagane kontrole oraz buduje podpisane APK zgodnie z krokiem 4.7. Nie pomijamy tych kontroli na podstawie samego wcześniejszego sukcesu CI.

### Szablon polecenia dla agenta

```text
Przeczytaj AGENTS.md oraz docs/plan.md (aktualny kontekst i zasady z sekcji 1, 1.1 i 1.2 oraz opis Fazy N i kroku N.K; pozostałe sekcje według zależności zmiany).
Zrealizuj wyłącznie Fazę N, krok N.K.
Nie implementuj niczego z innych kroków, z sekcji "Poza zakresem" ani z kolejnych faz.
Implementację i kontrole dotyczące zmiany wykonuj lokalnie; pełną weryfikację końcową powierz istniejącemu CI według sekcji 1.2. Zachowaj wymagane próby UI i fizycznego Androida. Pierwszy deploy na https://rodzina.preficze.pl jest wykonany. Aktualizacje serwera wykonuj według docs/DEPLOY.md na polecenie właściciela; APK buduj i testuj według etapu Android.
Zanim zaczniesz, wypisz listę plików, które utworzysz/zmienisz.
Na koniec pokaż, jak spełniłeś warunki "Gotowe, gdy" tego kroku, wyniki kontroli lokalnych i prób ręcznych oraz link i wynik CI dla końcowego commita. Jeśli zgodnie z poleceniem nie ma commita/pusha lub CI nie zakończyło się sukcesem, zaznacz oczekiwanie na CI i nie oznaczaj kroku jako gotowego.
W ostatnim kroku fazy pokaż też każde kryterium akceptacji fazy
oraz punkty "Gotowość do deployu" z sekcji 1.1.
```

Dla fazy 0 (bez kroków) polecenie brzmi: "Zrealizuj wyłącznie Fazę 0", a na końcu agent pokazuje wszystkie kryteria akceptacji.

## Bieżący zakres i statusy

**Faza 6 — plan obiadów pozostaje do implementacji** (potwierdzenie właściciela
22.10.2026). Jej pełny zakres jest poniżej. Opisy zaimplementowanych zakupów
i zadań są w [archiwum faz 5 i 7](archive/plan-fazy-5-7.md).
Przeniesienie nie zalicza brakujących prób odbiorczych ani CI.
Pierwotne metadane statusów zachowano w archiwum.
Bieżące dodatkowe plany: [redesign R.1–R.8](REDESIGN_PLAN.md)
i [reset hasła przez e-mail](RESET_HASLA_PLAN.md). Ich statusów nie zmieniono.

## 6. Fazy

### Faza 6 - plan obiadów

**Cel:** rodzina planuje obiady na tydzień i jednym kliknięciem przenosi składniki do listy zakupów.

**Endpointy:**

- `GET /api/meals?weekStart=YYYY-MM-DD` (poniedziałek) zwraca 7 dni z posiłkami i składnikami.
- `PUT /api/meals/:date/:slot` z `{ title, notes?, ingredients: [{ name, quantity? }] }` (upsert), `DELETE /api/meals/:date/:slot`.
- `POST /api/meals/copy-week` z `{ fromWeekStart, toWeekStart, overwrite: boolean }`.
- `POST /api/meals/to-shopping-list` z `{ weekStart, listId, mealIds? }`. Dodaje składniki, scalając duplikaty po znormalizowanej nazwie (ilości są łączone tekstowo, np. "500 g + 1 kg"), i zwraca liczbę dodanych pozycji.
- `GET /api/meals/suggestions?q=` zwraca wcześniejsze tytuły obiadów razem z ostatnio użytymi składnikami (do szybkiego powtórzenia dania).

**UI:**

- Widok tygodnia (pon-nd) ze strzałkami poprzedni/następny tydzień i przyciskiem "dziś".
- Każdy dzień to karta z obiadem albo "+ Dodaj obiad".
- Formularz: nazwa dania z podpowiedziami (wybór podpowiedzi uzupełnia składniki), notatka, lista składników.
- Akcje tygodnia: "Skopiuj poprzedni tydzień", "Dodaj składniki do listy zakupów" (wybór listy i dań, potem podsumowanie).
- Karta "Dziś na obiad" na górze kalendarza (lekki dashboard).

**Kroki realizacji:**

#### Krok 6.1 - API planu obiadów

- **Zakres:** migracje `meals` i `meal_ingredients`. `GET /api/meals?weekStart=` (poniedziałek, 7 dni z posiłkami i składnikami), `PUT` i `DELETE /api/meals/:date/:slot`, `POST /api/meals/copy-week`, `GET /api/meals/suggestions`. Uprawnienia: dziecko ma tylko odczyt.
- **Gotowe, gdy:** testy API: upsert, copy-week z `overwrite` i bez, podpowiedzi z ostatnio użytymi składnikami, walidacja `weekStart` (tylko poniedziałek), 403 dla dziecka na zapisie, izolacja rodzin.

#### Krok 6.2 - API: składniki do listy zakupów

- **Zakres:** `POST /api/meals/to-shopping-list` z `{ weekStart, listId, mealIds? }`. Funkcja `mergeQuantities` w `shared` (normalizacja nazwy, łączenie ilości tekstowo, np. "500 g + 1 kg"). Wykorzystuje serwis zakupów z fazy 5 (także historię). Zwraca liczbę dodanych pozycji. Decyzję, czy scalać także z pozycjami już obecnymi na liście, agent zapisuje w `DECISIONS.md`.
- **Gotowe, gdy:** testy jednostkowe `mergeQuantities` i testy API (scalanie duplikatów, filtr `mealIds`, lista innej rodziny daje 404, izolacja rodzin).

#### Krok 6.3 - UI: tydzień obiadów

- **Zakres:** zakładka Obiady z widokiem tygodnia (pon-nd), strzałkami i przyciskiem "dziś". Karta dnia albo "+ Dodaj obiad". Formularz (nazwa z podpowiedziami, które po wyborze uzupełniają składniki, notatka, lista składników), usuwanie, "Skopiuj poprzedni tydzień" z pytaniem o nadpisanie. Dziecko widzi tylko odczyt.
- **Gotowe, gdy:** testy komponentów formularza i podpowiedzi. Ręcznie: zaplanowanie 5 obiadów i skopiowanie tygodnia.

#### Krok 6.4 - UI: dodawanie do listy zakupów, karta "Dziś na obiad" i domknięcie fazy

- **Zakres:** akcja "Dodaj składniki do listy zakupów" (wybór listy i dań, potem podsumowanie), karta "Dziś na obiad" na górze kalendarza.
- **Gotowe, gdy:** wszystkie kryteria akceptacji fazy 6, w tym ręcznie: 5 zaplanowanych obiadów i przeniesienie składników daje poprawnie pogrupowaną listę zakupów. Punkty z sekcji 1.1 i `release:smoke`.

**Kryteria akceptacji:**

- Testy API: upsert, copy-week z i bez overwrite, to-shopping-list ze scalaniem duplikatów oraz izolacja rodzin.
- Manualnie: zaplanowanie 5 obiadów i przeniesienie składników daje poprawnie pogrupowaną listę zakupów.
- Spełnione punkty z sekcji 1.1.

**Poza zakresem:** książka przepisów, wartości odżywcze, inne posiłki niż obiad. Kolumna `slot` jest już na to przygotowana.

---

## Dalsze zakresy

- Faza 8: sejf rodzinny i terminy ważności dokumentów —
  [pełny zakres](archive/plan-przyszle-fazy.md).
- Rozszerzenia po fazach podstawowych (m.in. iCal, przepisy, iOS) —
  [roadmapa](archive/plan-przyszle-fazy.md).

## Wycofanie PWA — odwołanie do zachowanych zasad

Pełny zapis kroków 4.8–4.10 jest w
[archiwum faz 0–4](archive/plan-fazy-0-4.md). Nadal obowiązuje wskazane
w sekcji 1 pierwszeństwo strony WWW + APK i wycofania PWA/Web Push.
Historia pierwszego wdrożenia D.1–D.4 jest w tym samym pliku; nie powtarzamy go.
