# Plan — pierwotne metadane i instrukcje testowania

Przeniesiono 22.10.2026 z docs/plan.md. Zachowano treść i statusy z chwili zapisu;
przeniesienie nie potwierdza zakończenia faz, CI, prób telefonu ani wdrożenia.
Archiwum czytaj tylko w zakresie potrzebnym do zadania. Bieżące wymagania
i reguły pierwszeństwa określa [plan](../plan.md).

---

name: Rodzinna aplikacja Android i strona WWW
overview: "Rodzinna aplikacja React + Fastify + SQLite. Docelowo strona WWW i APK, z przypomnieniami offline wyłącznie w APK. Faza 4 obejmuje wycofanie PWA w krokach 4.8-4.10 przed fazą 5. API i strona działają na https://rodzina.preficze.pl (vh.pl)."
todos:

- id: phase0
  content: "Faza 0: monorepo (web/api/shared), AGENTS.md, CI, manifest PWA, paczka release + lokalny smoke test, DEPLOY.md"
  status: pending
- id: phase1
  content: "Faza 1: konto rodziny, zaproszenia, profile dzieci z PIN, sesje"
  status: pending
- id: phase2
  content: "Faza 2: kalendarz - wydarzenia pojedyncze, cykliczne (RRULE + wyjątki), odległe; widoki i filtry"
  status: pending
- id: phase3
  content: "Faza 3: Web Push na Androida (VAPID, subskrypcje, service worker, job cron przypomnień, backup)"
  status: pending
- id: deployment
  content: "Pierwszy deploy wykonany na https://rodzina.preficze.pl; dodatkowe testy operacyjne wymagają osobnego potwierdzenia"
  status: completed
- id: phase4
  content: "Faza 4: Android przez Capacitor, sesja i API, lokalny harmonogram, alarmy offline, podpisane APK i ręcznie uruchamiany deploy GitHub Actions"
  status: pending
- id: step4-8
  content: "Krok 4.8: strona bez PWA i Web Push, wycofanie starego service workera, zachowanie APK"
  status: completed
- id: step4-9
  content: "Krok 4.9: usunięcie backendu Web Push, VAPID, joba i subskrypcji; zachowanie harmonogramu APK i backupu"
  status: completed
- id: step4-10
  content: "Krok 4.10: lokalna regresja strony i APK, dokumentacja oraz procedura wdrożenia bez PWA; próby telefonu i produkcji osobno"
  status: completed
- id: phase5
  content: "Faza 5: współdzielona lista zakupów (z obsługą słabego zasięgu)"
  status: pending
- id: step5-4
  content: "Krok 5.4: trwały podgląd rodziny offline, domownicy i kod rodziny, blokada zmian"
  status: pending
- id: step5-5
  content: "Krok 5.5: kalendarz offline tylko do odczytu, baner i odświeżanie po powrocie sieci"
  status: pending
- id: phase6
  content: "Faza 6: tygodniowy plan obiadów z dodawaniem składników do listy zakupów"
  status: pending
- id: phase7
  content: "Faza 7: listy zadań - osobiste per użytkownik, z możliwością udostępnienia wybranym domownikom"
  status: pending
- id: phase8
  content: "Faza 8: sejf rodzinny (wersja ograniczona) - terminy ważności dokumentów z przypomnieniami"
  status: pending
  isProject: false

---

# Rodzina - aplikacja Android i strona WWW (plan projektu)

Ten dokument jest samowystarczalny i przeznaczony do przekazania agentowi AI lub nowemu kontrybutorowi. W fazie 0 trafia do repo jako `docs/plan.md`. Każda faza ma zakres, kryteria akceptacji i listę rzeczy poza zakresem.

### Testowanie na Androidzie lokalnie (bez serwera)

Dla APK używamy Android SDK/ADB i debug APK z lokalnymi plikami frontendu oraz API osiągalnym przez konfigurację deweloperską. Produkcyjne APK łączy się wyłącznie przez HTTPS z rodzina.preficze.pl. Testy alarmów wykonujemy także poza sesją debugowania, z wyłączoną siecią i po restarcie; wyników przeglądarki nie przenosimy automatycznie na APK. Bieżące polecenia i checklistę zawiera `docs/DEVELOPMENT.md`.

**Zapis historyczny testowania PWA (fazy 0-3):** poniższe instrukcje do następnego nagłówka nie dotyczą aktualnego wydania. PWA i Web Push są wycofane; przekierowanie portów służy dziś tylko testowaniu zwykłej strony.

Service worker, instalacja PWA i push wymagają bezpiecznego kontekstu, czyli HTTPS albo `localhost`. Lokalnie używamy **przekierowania portów w Chrome**:

1. Podłącz telefon przez USB i włącz debugowanie USB.
2. Na komputerze otwórz `chrome://inspect`, wybierz Port forwarding i ustaw `5173 -> localhost:5173` (tryb dev) oraz `3000 -> localhost:3000` (build produkcyjny z `npm start`).
3. Na telefonie otwórz `http://localhost:5173` albo `http://localhost:3000`.

Telefon traktuje tę stronę jak `localhost`, więc da się zainstalować PWA i odebrać push. **Instalację PWA, service worker i push testujemy na buildzie produkcyjnym (`npm run build && npm start`, port 3000)**, bo service worker w trybie dev Vite działa zawodnie. Tryb dev służy do pracy nad UI. Opis trafia do `docs/DEVELOPMENT.md` w fazie 0.

### Testowanie lokalnie na komputerze (bez telefonu)

Aplikację uruchamiamy przez `npm run dev` (5173) albo `npm run build` i `npm start` (3000); oba tryby używają API na 3000, więc nie działają jednocześnie. Logowanie, kalendarz, zaproszenia/reset, pobieranie APK i migrację starej PWA sprawdzamy w Chromium headless przy 390 i 1280 px. Nowa wizyta nie rejestruje SW, nie pobiera manifestu ani nie wywołuje `/api/push/*`. Testy adaptera i atrapy mostka nie zastępują telefonu ani instalatora Androida.

**Zapis historyczny testowania PWA (fazy 0-3):** poniższa tabela i punkty do sekcji 2 opisują poprzednie wydania. Usunięte polecenia Web Push nie obowiązują.

| Tryb        | Komenda i adres                                       | Do czego                                                |
| ----------- | ----------------------------------------------------- | ------------------------------------------------------- |
| Dev         | `npm run dev`, `http://localhost:5173`                | praca nad UI, szybkie przeładowania                     |
| Produkcyjny | `npm run build && npm start`, `http://localhost:3000` | manifest, service worker, instalacja PWA, push, offline |

Oba tryby używają portu API 3000, więc nie uruchamiaj ich jednocześnie.

1. **Podgląd mobilny.** W Chrome otwórz DevTools (F12) i włącz tryb urządzenia (Ctrl+Shift+M, na macOS Cmd+Shift+M), np. Pixel 7. Sprawdza to układ i dotyk, ale nie zastępuje prawdziwego telefonu.
2. **Manifest i service worker.** Na buildzie produkcyjnym (port 3000) w DevTools > Application sprawdź:
   - Manifest: brak błędów, ikony 192/512/maskable;
   - Service Workers: status "activated and running". Przy pracy nad `sw.ts` zaznacz "Update on reload".
3. **Instalacja PWA.** Ikona instalacji w pasku adresu Chrome albo menu > "Zainstaluj Rodzina". Aplikacja otwiera się w osobnym oknie (standalone).
4. **Push (od fazy 3).** Na buildzie produkcyjnym uruchom w drugim terminalu `npm run dev:cron`, wejdź w Więcej > Powiadomienia, kliknij "Włącz powiadomienia", a potem "Wyślij testowe". System musi zezwalać Chrome na powiadomienia (Windows: sprawdź tryb "Nie przeszkadzać" i Focus Assist, macOS: Ustawienia > Powiadomienia > Chrome). Przypomnienie z przyszłą datą sprawdzisz bez czekania: `npm run job:reminders -- --now=<ISO>`.
5. **Offline (faza 5).** DevTools > Network > przełącznik "Offline", potem powrót do "No throttling".
6. **Dwóch domowników naraz.** Ciasteczko `sid` jest wspólne dla wszystkich portów `localhost`, więc drugą osobę zaloguj w oknie incognito albo w drugim profilu Chrome. Tak testujemy też synchronizację (zmiana widoczna w drugim oknie po maksymalnie 20 s).
7. **Testy automatyczne.** `npm test` (Vitest), `npm run test:e2e` (Playwright headless) oraz `npm run release:smoke` (sprawdza paczkę release). Push i instalacja PWA nie są pokryte przez e2e, bo testujemy je ręcznie.

**Ograniczenia:** zachowanie powiadomień (oszczędzanie baterii, kanały powiadomień, tryb Doze) na desktopie różni się od Androida, więc kryteria akceptacji fazy 3 i etapu pierwszego wdrożenia dotyczące push zawsze potwierdzamy na telefonie. Opis trafia do `docs/DEVELOPMENT.md` w fazie 0, razem z sekcją o Androidzie.
