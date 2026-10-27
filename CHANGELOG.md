# Changelog

All notable changes to RecPick are listed here. Versions follow [Semantic Versioning](https://semver.org/); `0.x` and `-alpha` releases may still change behaviour between versions.

## [0.3.0-alpha] - 2026-10-27

### Added
- *Tools* tab for library helpers, with a counter in the menu. The first tool, *Duplicate recordings*, lists episodes and movies stored in the library more than once (several versions of one item or separate items with the same season and episode number, episode title or air date; movies with the same title and year). Each copy shows its length, size, quality, date added and file path, with a link to Plex Web; copies much shorter than the longest one are flagged as probably cut short. A group can be marked "not a duplicate" for everyone until its copies change. The list is refreshed with every sync or on demand ([#6](https://github.com/kepak1/recpick/issues/6)).

## [0.2.0-alpha] - 2026-10-25

### Added
- Sort direction: a ↑/↓ button next to the sort list. Every sort starts in its natural direction (soonest, A-Z, newest, best rated) and can be reversed, e.g. oldest movies first ([#3](https://github.com/kepak1/recpick/issues/3)).
- Country of origin from TMDB, shown with a flag on every title, with a country filter that also offers "Unknown country" ([#1](https://github.com/kepak1/recpick/issues/1)).
- Auto-hide rules on the *Hidden* page: many rules per user, each with several conditions (type, genres, channels, countries, years, TMDB rating below). Channel rules hide only the airings on those channels. Rules can be switched off, show how many titles they hide, can be created from the current filters, and apply to the list, alerts, the daily email and recommendations. With *Show hidden*, titles hidden by a rule are labelled with the rule's name ([#2](https://github.com/kepak1/recpick/issues/2)).
- Recommendations from each user's Plex watch history: an *Only recommended* filter in the guide and an optional "Recommended to record" section (top 20 from the whole guide) in the daily email ([#4](https://github.com/kepak1/recpick/issues/4)).

### Changed
- With a TMDB key, every guide title is looked up once more after the upgrade to fetch countries and genres (a few minutes in the background).
- The daily email can now contain new titles, recommendations or both.
- Fewer TMDB requests: titles every user has hidden are not looked up, and data is rechecked every 90 days (was 30) with one request instead of two.
- TMDB movie search retries without the year when the guide's year is off by one (more movies get a rating and a country).

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

[0.3.0-alpha]: https://github.com/kepak1/recpick/releases/tag/v0.3.0-alpha
[0.2.0-alpha]: https://github.com/kepak1/recpick/releases/tag/v0.2.0-alpha
[0.1.0-alpha]: https://github.com/kepak1/recpick/releases/tag/v0.1.0-alpha
