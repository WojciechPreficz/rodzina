# Istotne decyzje

Zapisujemy wyłącznie decyzję, powód i konsekwencje. Aktualne zachowanie opisuje
[ARCHITECTURE.md](ARCHITECTURE.md), a status prac [plan.md](plan.md).
Historia implementacji i wyniki poszczególnych przebiegów pozostają w Git i CI.

| Data       | Decyzja i powód                                                                                                | Konsekwencje                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 28.10.2026 | Pięć krótkich dokumentów; usunięcie dokumentów offline, raportu i archiwum na polecenie właściciela            | Zasady pracy wyłącznie w AGENTS, statusy w planie; dane testowe poza docs. Nie zalicza to zaległych prób ani CI. |
| 28.10.2026 | Sesja ma niezależny kontekst i jawny koordynator cyklu życia konta, aby nie zależała od modułów funkcjonalnych | Moduły rejestrują usługi; odtworzenie i czyszczenie zachowują izolację kont.                                     |
| 27.10.2026 | Nadawca zmian reaguje na zdarzenia zamiast odpytywać pustą kolejkę co 500 ms                                   | Jeden timer retry i dzierżawa między kartami; odbiór baterii na urządzeniu pozostaje wymagany.                   |
| 26.10.2026 | Zachowujemy rzeczywistą zależność od synchronicznego better-sqlite3                                            | Migracja sterownika wymaga osobnego projektu transakcji, migracji, backupu i pakowania.                          |
| 26.10.2026 | Zależności release wyprowadzamy z lockfile monorepo bez ponownego rozwiązywania wersji                         | Commitujemy manifest i lockfile w scripts/release; instalacja na serwerze używa gotowych binariów.               |
| 26.10.2026 | Limity logowania są trwałe w SQLite                                                                            | Restart i wiele procesów nie zerują limitu; wymagana prawidłowa konfiguracja proxy.                              |
| 26.10.2026 | CI używa Node 24, zgodnie z hostingiem                                                                         | Pełnej weryfikacji nie powtarzamy rutynowo lokalnie.                                                             |
| 26.10.2026 | Kalendarz ma lokalnie generowane warstwy świąt i okazji                                                        | Daty 2025–2099, dwie niezależne preferencje; aktualizacja reguł wymaga nowego WWW i APK.                         |
| 25.10.2026 | Wspólna idempotencja mutacji: retry do 30 dni, retencja odpowiedzi 90 dni                                      | Ponowienie zachowuje ID i datę; starsza zmiana wymaga świadomego sprawdzenia.                                    |
| 25.10.2026 | Kontakty są wspólne dla rodziny, grupy nie usuwają kontaktów                                                   | Dorośli edytują, dzieci odczytują; brak integracji z książką telefonu.                                           |
| 24.10.2026 | Dokument może dotyczyć mieszkania, bez wskazania domownika                                                     | Przypomnienia i statusy wynikają z terminu; odnowienie przelicza offsety.                                        |
| 21.10.2026 | Wspólny frontend zachowuje Mantine i Schedule-X podczas redesignu                                              | Makiety określają wygląd, a istniejące API i reguły domenowe zachowanie.                                         |
| 20.10.2026 | Kontrole lokalne zależą od zmiany, pełny zestaw wykonuje CI                                                    | Próby fizycznego telefonu i UI nadal wymagają rzeczywistego odbioru.                                             |
| 20.10.2026 | Mutacje sprawdzają Origin, a przy jego braku Referer                                                           | Zgodność z hostem żądania; Vite nie podmienia Origin przez changeOrigin.                                         |
| 19.10.2026 | WWW i APK zastępują PWA/Web Push                                                                               | Przypomnienia dostarcza Android; zachowujemy przejściowy sw.js i manifest 410.                                   |
| 19.10.2026 | Menu boczne na desktopie, hamburger i panel z prawej na telefonie                                              | Brak dolnego paska i pozycji „Więcej”; stare adresy nadal działają.                                              |
| 16.10.2026 | Pierwszy deploy jest wykonany; aktualizacje przez ręczny workflow Deploy                                       | Push uruchamia CI; wdrożenie i instalacja APK wymagają osobnych działań.                                         |
