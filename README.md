# RecPick

[![CI](https://github.com/kepak1/recpick/actions/workflows/ci.yml/badge.svg)](https://github.com/kepak1/recpick/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/kepak1/recpick?include_prereleases&sort=semver)](https://github.com/kepak1/recpick/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Support me on Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/kepak1)

A self-hosted companion page that makes picking what to record with **Plex Live TV & DVR** much easier. *Works with Plex.*

Plex's *Live TV → Browse* shows the same titles you already skipped over and over, gives you little room to filter, and hides the description behind a click. RecPick shows the whole guide as a poster list with the description visible, lets you hide what you are not interested in, and emails you when something from your wishlist shows up in the guide. One click takes you to the item in Plex, where you press **Record**.

![Guide in grid view](docs/screenshots/guide-grid.png)

## Features

- **The whole guide in one list**: movies and shows with posters, full descriptions, genres and every airing (channel, time, season/episode). List or grid view, works on phones.
- **Filters**: movies/shows, title search, genre, channel, country (with TMDB), today/tomorrow/3/7 days, year, TMDB rating (optional). Sort by next airing, newest in guide, title, year or rating, in either direction.
- **Hide scheduled** and **hide what I already have** (checks your Plex library, episode by episode for shows).
- **Hide forever**: a whole movie/show or a single episode. Everything hidden can be searched, restored or cleared on the *Hidden* page.
- **Auto-hide rules**: hide everything that matches a set of conditions (type, genres, channels, countries, years, TMDB rating below a threshold), e.g. "horror movies" or "everything on a shopping channel". Rules with channels hide only the airings on those channels. Create them from scratch or from the current filters; each one can be switched off and shows how many titles it hides. Rules also apply to emails.
- **Recommendations** from your Plex watch history: an *Only recommended* filter and an optional section with the 20 best picks in the daily email. With TMDB they combine "similar to what you watched" with your favourite genres and countries; without it, only genres are used.
- **Wishlist with email alerts**: pick a title from suggestions (the guide and Plex's catalogue) or add a free-text phrase. You get an email as soon as it appears in the guide; each airing or episode is reported once. For shows, only episodes you don't have and haven't scheduled are reported.
- **Optional daily email** with everything new in the guide and/or your recommendations.
- **Open in Plex**: every title and airing links straight to its Plex Web page with the *Record* button.
- **Search Google** button for every title.
- **Tools**: a separate tab for library helpers. The first one finds **duplicate recordings**: episodes and movies stored more than once (several versions of one item or separate items), with each copy's length, size, quality, date added and file path, a warning for copies that look cut short, and a link to Plex to remove the extras. Groups that aren't real duplicates can be marked as such. The second one finds **short recordings**: episodes much shorter than the typical recording of their season or show (or than TMDB's episode runtime for shows with only 1-2 recordings) and, with TMDB, movies shorter than their TMDB runtime. The threshold (default 80%) is set per user in *Settings*.
- **Sign in with Plex**: only users of your Plex server get in, and each user has their own hidden list, wishlist, email and language.
- **Translations**: English and Polish; adding a language is one JSON file.

| Show with its airings | Wishlist suggestions | Phone |
| --- | --- | --- |
| ![Show with airings](docs/screenshots/guide-list-airings.png) | ![Wishlist](docs/screenshots/wishlist.png) | ![Phone](docs/screenshots/mobile.png) |

## Requirements

- Plex Media Server with **Live TV & DVR** set up (a tuner and the Plex guide; this needs Plex Pass).
- Docker (images are published for `linux/amd64` and `linux/arm64`).
- The Plex token of the server owner.
- An SMTP account if you want emails (e.g. Gmail with an app password).

## Quick start (Docker Compose)

```bash
mkdir recpick && cd recpick
curl -O https://raw.githubusercontent.com/kepak1/recpick/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/kepak1/recpick/main/.env.example
# edit .env: at least PLEX_TOKEN and PLEX_URL, plus SMTP_* for emails
docker compose up -d
```

Open `http://<server-ip>:8080` and sign in with your Plex account. The first guide download starts automatically and takes a minute or two; after that the guide is refreshed every night (`SYNC_CRON`, 03:00 by default) and alerts plus the daily email go out right after. There is also a **Refresh now** button.

To update: `docker compose pull && docker compose up -d`.

### Versions

RecPick is in **alpha** (`0.1.0-alpha`); see the [changelog](CHANGELOG.md) and [releases](https://github.com/kepak1/recpick/releases). The running version is shown at the bottom of every page.

Docker image tags:

- `latest`: the newest code on `main`
- `0.1.0-alpha` (and so on): a specific release; pin this in `docker-compose.yml` if you prefer to update deliberately

If you put it behind a reverse proxy under its own domain, set `APP_URL` to that address (it is used for the return from the Plex sign-in and for links in emails).

### Getting your Plex token

In Plex Web open any item → **⋯** → **Get Info** → **View XML**. The address of the page that opens ends with `X-Plex-Token=…`; that value is your token. See also [Plex's guide](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/).

The token stays on your server: the app uses it to read the guide, your library and your recording schedule. It never records anything by itself.

### Configuration

| Variable | Description |
| --- | --- |
| `PLEX_TOKEN` | Server owner's token (required). |
| `PLEX_URL` | Address the container uses to reach Plex (required), e.g. `http://192.168.1.10:32400`. |
| `PLEX_PUBLIC_URL` | Plex address opened in your browser when you click a title (defaults to `PLEX_URL`). |
| `PLEX_INSECURE_TLS` | `true` if `PLEX_URL` uses a self-signed certificate. |
| `APP_URL` | Public address of RecPick, if it differs from the address you open it with. |
| `SYNC_CRON` | When to refresh the guide (cron syntax, default `0 3 * * *`). |
| `TZ` | Time zone for the refresh and email times, e.g. `Europe/London` (default `UTC`). |
| `DEFAULT_LANGUAGE` | Language for new users and emails, `en` or `pl` (default `en`). Each user can change it. |
| `TMDB_API_KEY` | Optional [TMDB](https://www.themoviedb.org/settings/api) key (v3 key or v4 token). Enables ratings, countries, their filters and rule conditions, sorting by rating and better recommendations. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Email delivery. Without `SMTP_HOST` emails are turned off. Use `SMTP_SECURE=true` for port 465. |
| `PUID`, `PGID` | User and group the app runs as inside the container (default `1000`). The data folder is made writable for them on start. |

Data (a single SQLite file) lives in `./data`.

## Languages

Each `locales/<code>.json` file is one language for the interface and the emails. To add one, copy `locales/en.json` to e.g. `locales/de.json`, translate the values and set `_meta.name` (shown in settings) and `_meta.locale` (date format, e.g. `de-DE`). Plural forms use the i18next suffixes `_one`, `_few`, `_many`, `_other`. Pull requests with new languages are very welcome.

Descriptions in the guide stay in the language of your Plex guide provider.

## Building from source

```bash
git clone https://github.com/kepak1/recpick.git
cd recpick
cp .env.example .env   # fill it in
```

Then either replace `image:` with `build: .` in `docker-compose.yml` and run `docker compose up -d --build`, or run it with Node.js 22.13+:

```bash
npm install
npm run dev        # backend on :8080 (auto-reload) + Vite dev server on :5173
npm run typecheck
npm run build && npm start
```

Stack: Node.js + Fastify + SQLite (`node:sqlite`) on the backend, React + Vite + i18next on the frontend.

## How it works

- Every night the app downloads the guide from your server's Plex EPG provider (`/tv.plex.providers.epg.cloud:*/sections/*/all`): movies with their airings, shows and all upcoming episodes. The same channel listed in several lineups is merged. It also reads your library to know what you already have and, if a TMDB key is set, fetches ratings, countries and genres.
- Guide items are matched to your library by Plex GUID; when that fails, by normalised title and year (movies), or by show title plus season/episode number or episode title.
- Your recording rules and scheduled recordings are read live from Plex (cached for a minute), so *Hide scheduled* is always current.
- Recommendations read the server's watch history (`/status/sessions/history/all`) for each signed-in user, then score every guide title: TMDB's recommendations for each watched title, plus a genre and country profile (rarer genres count more, recent viewing counts more). Titles you watched, have or hid are left out. They are recalculated after every refresh.
- Duplicate recordings are found in the library data read during every refresh (or with *Refresh* on the tool page): episodes with the same show, season and episode number (or the same episode title, or air date, when there are no numbers), and movies with the same title and year. RecPick never deletes anything; copies are removed in Plex.
- Short recordings use the same library data. Episodes are compared with the median length of their season (with at least 5 recordings) or show (at least 3); other episodes and movies with TMDB runtimes, which are cached and rechecked every 90 days like other TMDB data. Movies use the TMDB id Plex has matched; those without one are skipped.
- Links open `PLEX_PUBLIC_URL/web/index.html#!/server/<machineId>/provider/<EPG provider>/details?key=<item>`, the same page you get from Plex's own guide.

## Privacy

RecPick runs entirely on your server and has no telemetry. Besides your Plex server it only talks to plex.tv (sign-in and title suggestions), Plex's image and metadata servers, TMDB (only with a key) and your SMTP server.

## Limitations

- Tested with the Plex cloud guide (`tv.plex.providers.epg.cloud`). XMLTV guides are not supported yet.
- The *Sports* section of the guide is skipped.
- RecPick only reads from Plex. Recording is started in Plex itself (the app does not create recording rules), and duplicate copies are removed in Plex too.

## Support

If RecPick saves you time, you can buy me a coffee on [Ko-fi](https://ko-fi.com/kepak1). ☕ Bug reports and ideas are welcome in [Issues](https://github.com/kepak1/recpick/issues).

## License

[MIT](LICENSE)

## Disclaimer

RecPick is an independent project and is not affiliated with, sponsored or endorsed by Plex, Inc. Plex is a trademark of Plex, Inc.
