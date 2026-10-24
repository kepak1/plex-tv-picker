# Changelog

All notable changes to RecPick are listed here. Versions follow [Semantic Versioning](https://semver.org/); `0.x` and `-alpha` releases may still change behaviour between versions.

## [0.1.0-alpha] - 2026-10-24

First public alpha. Tested on a single setup (Plex cloud guide, Poland).

### Added
- Whole Plex Live TV guide as a poster list or grid, with descriptions, genres and every airing.
- Filters: movies/shows, title search, genre, channel, day range, year, TMDB rating; several sort options.
- "Hide scheduled" and "Hide what I have" (library matching per movie and per episode).
- Hide a title or a single episode; searchable *Hidden* page with restore and clear.
- Wishlist (titles from suggestions or free-text phrases) with email alerts, plus an optional daily digest.
- Links to the item's Plex Web page with the Record button; "Search Google" for every title.
- Sign in with Plex; per-user lists, email and language. English and Polish.
- Optional TMDB ratings, fetched right after start and on every nightly refresh.
- Docker image for amd64 and arm64; runs as an unprivileged user.
- App version shown in the page footer, `/api/health` and the startup log.

### Fixed
- The guide list refills itself when hiding titles empties the loaded page.
- The title count no longer stays too high after hiding the last episode of a show.

[0.1.0-alpha]: https://github.com/kepak1/recpick/releases/tag/v0.1.0-alpha
