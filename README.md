# Rodzina

Rodzinna aplikacja Android i strona WWW do wspólnego organizowania codziennych spraw.

Przypomnienia offline są funkcją APK. Strona pozwala zarządzać danymi i pobrać
aplikację Android. Nowe wizyty nie instalują PWA ani nie rejestrują Web Push.
Przejściowy `/sw.js` wycofuje wcześniejsze instalacje przy powrocie online,
zachowując sesję i dane użytkownika. Starą ikonę PWA można usunąć ręcznie.

## Lokalny start

Wymagane: Node.js 22 lub 24 oraz npm.

1. Zainstaluj zależności: `npm ci`.
2. Skopiuj `apps/api/.env.example` do `apps/api/.env`.
3. Uruchom `npm run dev` i otwórz `http://localhost:5173`.

`npm run build` i `npm start` uruchamiają lokalny wariant produkcyjny na porcie 3000.
Ustaw wtedy `RODZINA_PUBLIC_URL=http://localhost:3000` w lokalnym `.env`.
Serwer i backup nie wymagają VAPID; jedynym zadaniem crona jest backup SQLite.

## Android i przypomnienia

Na stronie logowania i w „Więcej” wybierz „Pobierz aplikację na Androida”.
Otwórz APK, zezwól na instalację z tego źródła i zatwierdź ją w Androidzie.
W APK nowsze wydanie można sprawdzić przez „Więcej > Wersja aplikacji”.
Aktualizacja wymaga tego samego klucza podpisującego i zachowuje dane aplikacji.

APK zawiera lokalny frontend. Po synchronizacji może wyświetlać zapisane alarmy
bez internetu, do terminu zabezpieczenia widocznego w „Powiadomieniach”.
Zmiany z innych urządzeń docierają po kolejnej synchronizacji; zamknięte APK
nie pobiera ich w tle. Nie ma pełnej edycji kalendarza offline.
Próby alarmów i instalatora na fizycznym telefonie wymagają osobnego potwierdzenia.

Build testowy: `npm run android:debug` (JDK 21 i Android SDK 36).
Podpisywanie, instalacja i testy są opisane w [DEVELOPMENT](docs/DEVELOPMENT.md)
i [DEPLOY](docs/DEPLOY.md); klucz podpisujący przechowujemy poza repo.

## Weryfikacja i aktualizacja serwera

```sh
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run release:smoke
npm run android:debug
```

Playwright działa wyłącznie headless przy 390 i 1280 px. Testy JVM i Android Lint
uruchamiaj po buildzie: `./gradlew testDebugUnitTest lintDebug` w `android/`
(Windows: `./gradlew.bat testDebugUnitTest lintDebug`).

Istniejąca aplikacja działa pod [rodzina.preficze.pl](https://rodzina.preficze.pl).
Aktualizację uruchamia właściciel przez ręczny workflow Deploy z `main` według
[DEPLOY](docs/DEPLOY.md). ZIP serwera i podpisane APK są osobnymi artefaktami;
Deploy publikuje oba, a instalację aktualizacji na telefonie zatwierdza użytkownik.
Przejście ze starego wydania wymaga zatrzymania crona Web Push przed podmianą
paczki oraz zachowania przejściowego `/sw.js` i odpowiedzi 410 manifestu.
