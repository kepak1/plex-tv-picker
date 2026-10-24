# Plex TV Picker

A companion page for Plex that makes it easier to browse the Live TV guide and pick what to record:

- movies and shows from the guide (poster, description, airings), in a list or grid view,
- filters: movies/shows, search, genre, channel, day, year, TMDB rating (optional), sorting,
- "hide scheduled" and "hide what I have" toggles (checks your Plex library),
- hide a whole title or a single episode (the "Hidden" page lets you undo it),
- wishlist (a title picked from suggestions, or a free-text phrase); you get an email as soon as it appears in the guide, and every airing/episode is reported only once,
- optional daily email with what is new in the guide,
- sign-in with a Plex account: only users of your server get in, and each one has their own lists, email and language,
- clicking a title or an airing opens it in Plex Web, where you start the recording.

The guide is refreshed every night (`SYNC_CRON`, 3:00 by default); alerts and the daily email go out right after. There is also a "Refresh now" button on the page.

## Running (Docker)

```bash
cp .env.example .env    # fill in PLEX_TOKEN, PLEX_URL and SMTP_*
docker compose up -d --build
```

The page is served at `http://<server-ip>:8080`. Data (SQLite) is stored in `./data`.

If you expose it under a domain through a reverse proxy, set `APP_URL` to that address (it is used for the return from the Plex sign-in and for links in emails).

### Environment variables

| Variable | Description |
| --- | --- |
| `PLEX_TOKEN` | Server owner's token (required). Plex Web → any item → ⋯ → Get Info → View XML → `X-Plex-Token` in the URL. |
| `PLEX_URL` | Address the container uses to reach Plex (required), e.g. `http://192.168.1.10:32400`. |
| `PLEX_PUBLIC_URL` | Plex address opened in the browser on click (defaults to `PLEX_URL`). |
| `PLEX_INSECURE_TLS` | `true` if `PLEX_URL` uses a self-signed certificate. |
| `APP_URL` | Public address of this page. |
| `SYNC_CRON`, `TZ` | Time of the nightly refresh and the time zone. |
| `DEFAULT_LANGUAGE` | Default language (`en` in the example; `pl` if unset). |
| `TMDB_API_KEY` | Optional: TMDB key (v3 key or v4 token). Enables ratings, the rating filter and sorting by rating. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Email delivery. Without `SMTP_HOST`, emails are disabled. |

## Languages

Each `locales/<code>.json` file is one language for the UI and emails. To add a language, copy `locales/en.json` to e.g. `locales/de.json`, translate the values and set `_meta.name` (the name shown in settings) and `_meta.locale` (date formatting, e.g. `de-DE`). After rebuilding the image, the language shows up in settings.

Plural forms use i18next suffixes: `_one`, `_few`, `_many`, `_other` (depending on the language).

Descriptions from the TV guide stay in the language of the guide provider in Plex.

## Development

```bash
npm install
npm run dev        # backend on :8080 (tsx watch) + Vite on :5173
npm run typecheck
npm run build      # dist/web + dist/server
```

Requires Node 22.13+ (uses the built-in `node:sqlite`).

## How it works

- `server/sync.ts` downloads the guide from the Plex EPG provider (`/tv.plex.providers.epg.cloud:*/sections/*/all`): movies together with their airings, shows and their episodes (`type=4`). The same channel listed in several lineups is merged into one. It also downloads the library (movies, episodes) to know what you already have and, when a TMDB key is set, the ratings.
- Guide items are matched to the library by GUID; when that fails, by normalised title and year (movies), or by show title plus season/episode number or episode title.
- Scheduled recordings (`/media/subscriptions`, `/media/subscriptions/scheduled`) are read live with a one-minute cache.
- The Plex link has the form `PLEX_PUBLIC_URL/web/index.html#!/server/<machineId>/details?key=<EPG key>`.
