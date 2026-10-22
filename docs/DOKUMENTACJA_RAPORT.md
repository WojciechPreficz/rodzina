# Porządkowanie dokumentacji — 22.10.2026

Zmiana dotyczy dokumentacji i listy plików formatowanych w `package.json`.
Zgodnie z doprecyzowaniem właściciela bieżącym zakresem pozostaje pełna
faza 6 „Plan obiadów”, która nie została zaimplementowana. Zakupy i zadania
przeniesiono do archiwum, bez zaliczania brakujących prób odbiorczych.

## Rozmiary przed i po

Pomiar względem commita `a7acb09`: bajty UTF-8 przy końcach linii LF;
liczba linii pomija puste linie na końcu pliku.

| Dokument       | Przed (B)   | Po (B)     | Linie przed → po         |
| -------------- | ----------- | ---------- | ------------------------ |
| plan.md        | 153 829     | 19 486     | 1385 → 155               |
| DEPLOY.md      | 69 383      | 45 130     | 989 → 643                |
| DEVELOPMENT.md | 189 435     | 7 681      | 2231 → 139               |
| DECISIONS.md   | 113 164     | 7 815      | 1155 → 74                |
| **Razem**      | **525 811** | **80 112** | **mniej o 84,8% bajtów** |

Tabela porównuje te same cztery dokumenty główne. Konwencje i model danych
przeniesiono do [ARCHITECTURE.md](ARCHITECTURE.md), a historię do
[archiwum](archive/README.md). Zachowano całą treść, więc łączny rozmiar `docs/`
nie musi maleć. Archiwizacja nie zmienia mocy obowiązujących decyzji.

## Zakres zmian

- Poprawiono nazwę `docs/PLAN.md` na `docs/plan.md` w AGENTS i pozostałych
  odwołaniach do tego pliku; nazwy `REDESIGN_PLAN.md` i `RESET_HASLA_PLAN.md`
  zachowano.
- Sekcje 1, 1.1 i 1.2 oraz pełna faza 6 pozostają w [planie](plan.md).
  Dawne sekcje 2–5 są w ARCHITECTURE, czytanym według zależności zmiany.
- [DEPLOY.md](DEPLOY.md) zachowuje aktualizację, konfigurację, crony,
  podpisywanie i publikację APK oraz odzyskiwanie. Procedury pierwszego
  wdrożenia i przejścia ze starego Web Push są podlinkowane w archiwum.
- [DEVELOPMENT.md](DEVELOPMENT.md) zachowuje uruchamianie, testowanie,
  budowanie APK i zaległe próby telefonu. Historia wyników jest w archiwum.
- AGENTS wskazuje lekturę archiwum tylko w razie potrzeby. Skrypty `format`
  i `format:check` obejmują główne dokumenty oraz `docs/archive/*.md`.

## Rozbieżności zachowane bez własnego rozstrzygnięcia

1. **Statusy faz.** [Pierwotne metadane](archive/plan-metadane-i-testy.md)
   mają `pending` dla faz opisanych jako zaimplementowane w
   [historii realizacji](archive/development-historia.md). Właściciel wskazał
   brak implementacji obiadów i implementację zakupów/zadań; według tego
   doprecyzowania wybrano fazę 6 do głównego planu. Nie zmieniono historycznych
   statusów ani nie zaliczono brakujących prób.
2. **Kontrole lokalne.** „Kontrole wydania” w DEVELOPMENT oraz sekcja 2 DEPLOY
   wyliczają pełny lokalny zestaw komend, podczas gdy sekcja 1.2 planu
   rozdziela lokalne kontrole zależne od zmiany i pełne CI. Plan zawiera już
   regułę pierwszeństwa; zachowano także starsze listy.
3. **Kalendarz offline.** Końcowe zdanie „Prób po kroku 4.10” w DEVELOPMENT
   mówi, że pełnego kalendarza offline nie ma. Opis 5.5 w
   [archiwum faz 5 i 7](archive/plan-fazy-5-7.md) oraz historia implementacji
   opisują trwały podgląd kalendarza offline. Zachowano oba zapisy.
4. **Źródło mutacji API.** „Konwencje API” w ARCHITECTURE wymagają `Origin`.
   Decyzja „20.10.2026 — wymagane źródło mutacji API (CSRF)” w
   [historii decyzji](archive/decisions-historia.md) dopuszcza również `Referer`
   wyłącznie przy braku `Origin`. Nie zmieniono tych opisów.
5. **Skrypty release.** „Skrypty root” w ARCHITECTURE opisują `release`
   jako samo `build-release.mjs`, a `release:smoke` jako samo `smoke-release.mjs`.
   DEPLOY mówi, że `release` wykonuje również build, co odpowiada istniejącemu
   `package.json`. Nie zmieniono opisów ani działania tych komend.

Zachowano także wcześniejsze zapisy z już określonym pierwszeństwem:
dolna nawigacja ustępuje sekcji 1 planu, wymagania PWA/Web Push ustępują
krokom 4.8–4.10, a szczegóły zadań wyłącznie online ustępują rozszerzeniu 7.6.
Przeniesienie nie jest nową decyzją w tych sprawach.

## Weryfikacja

Audyt przeniesień porównuje 24 bloki ze wszystkich czterech dokumentów
sprzed zmiany z miejscami docelowymi. Obejmuje wszystkie 5765 pierwotnych
linii wraz z końcowymi pustymi liniami. Dopuszcza wyłącznie formatowanie,
poprawę nazwy pliku planu i odwołań wynikających z przeniesienia.
Źródła porównano z HEAD; potwierdzono zachowanie wszystkich bloków.
Sprawdzono względne linki, wielkość liter ścieżek i kotwice nagłówków.
Przejrzano treść i diff; `git diff --check` oraz `npm run format:check`
przechodzą. Wyniki lokalnego audytu i mapa przeniesień są w ignorowanym
katalogu `.android-tools/docs-*.json`.

Testów aplikacji ani buildu nie uruchamiano dla tej zmiany dokumentacyjnej.
Stan przed commitem i pushem: **zweryfikowane lokalnie, oczekuje na CI**.
