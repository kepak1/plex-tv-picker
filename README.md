# Plex TV Picker

Strona obok Plexa do przeglądania programu Live TV i wybierania rzeczy do nagrania:

- lista filmów i seriali z programu (plakat, opis, emisje), widok listy lub siatki,
- filtry: filmy/seriale, wyszukiwanie, gatunek, kanał, dzień, rok, ocena TMDB (opcjonalnie), sortowanie,
- przełączniki „ukryj zaplanowane” i „ukryj te, które mam” (sprawdza bibliotekę Plexa),
- pomijanie całego tytułu albo pojedynczego odcinka (lista „Pominięte” pozwala to cofnąć),
- lista życzeń (tytuł z podpowiedzi albo luźna fraza); mail od razu po wykryciu w programie, każda emisja/odcinek zgłaszany raz,
- opcjonalny codzienny mail z nowościami w programie,
- logowanie kontem Plex: wchodzą tylko użytkownicy Twojego serwera, każdy ma swoje listy, email i język,
- kliknięcie tytułu lub emisji otwiera ją w Plex Web, gdzie włączasz nagrywanie.

Program odświeża się co noc (`SYNC_CRON`, domyślnie 3:00); zaraz potem wychodzą alerty i codzienny mail. Na stronie jest też przycisk „Odśwież teraz”.

## Uruchomienie (Docker)

```bash
cp .env.example .env    # uzupełnij PLEX_TOKEN i SMTP_*
docker compose up -d --build
```

Strona działa na `http://<ip-serwera>:8080`. Dane (SQLite) są w `./data`.

Jeśli wystawiasz ją pod domeną przez reverse proxy, ustaw `APP_URL` na ten adres (używany przy powrocie z logowania Plex i w linkach w mailach).

### Zmienne środowiskowe

| Zmienna | Opis |
| --- | --- |
| `PLEX_TOKEN` | Token właściciela serwera (wymagany). Plex Web → dowolna pozycja → ⋯ → Uzyskaj informacje → Wyświetl XML → `X-Plex-Token` w adresie. |
| `PLEX_URL` | Adres, pod którym kontener łączy się z Plexem (wymagany), np. `http://192.168.1.10:32400`. |
| `PLEX_PUBLIC_URL` | Adres Plexa otwierany w przeglądarce po kliknięciu (domyślnie `PLEX_URL`). |
| `PLEX_INSECURE_TLS` | `true`, jeśli `PLEX_URL` ma certyfikat self-signed. |
| `APP_URL` | Publiczny adres tej strony. |
| `SYNC_CRON`, `TZ` | Godzina nocnego odświeżania i strefa czasowa. |
| `DEFAULT_LANGUAGE` | Język domyślny (`pl`). |
| `TMDB_API_KEY` | Opcjonalnie: klucz TMDB (v3 lub token v4). Włącza oceny, filtr i sortowanie po ocenie. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Wysyłka maili. Bez `SMTP_HOST` maile są wyłączone. |

## Języki

Każdy plik `locales/<kod>.json` to jeden język interfejsu i maili. Żeby dodać nowy, skopiuj `locales/en.json` jako np. `locales/de.json`, przetłumacz wartości i ustaw `_meta.name` (nazwa w ustawieniach) oraz `_meta.locale` (formatowanie dat, np. `de-DE`). Po przebudowie obrazu język pojawi się w ustawieniach.

Odmiana przez liczby używa przyrostków i18next: `_one`, `_few`, `_many`, `_other` (zależnie od języka).

Opisy z programu TV są w języku dostawcy programu w Plexie.

## Rozwój

```bash
npm install
npm run dev        # backend na :8080 (tsx watch) + Vite na :5173
npm run typecheck
npm run build      # dist/web + dist/server
```

Wymaga Node 22.13+ (używa wbudowanego `node:sqlite`).

## Jak to działa

- `server/sync.ts` pobiera program z dostawcy EPG Plexa (`/tv.plex.providers.epg.cloud:*/sections/*/all`): filmy razem z emisjami, seriale i ich odcinki (`type=4`). Te same kanały z kilku list kanałów są łączone. Pobiera też bibliotekę (filmy, odcinki), żeby wiedzieć, co już masz, a przy ustawionym kluczu TMDB oceny.
- Pozycje z programu dopasowuje do biblioteki po GUID, a gdy to się nie uda, po znormalizowanym tytule i roku (filmy) albo po tytule serialu i numerze sezonu/odcinka bądź tytule odcinka.
- Zaplanowane nagrania (`/media/subscriptions`, `/media/subscriptions/scheduled`) są czytane na żywo z minutowym cache.
- Link do Plexa ma postać `PLEX_PUBLIC_URL/web/index.html#!/server/<machineId>/details?key=<klucz EPG>`.
