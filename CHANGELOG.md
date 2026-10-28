# Changelog

All notable changes to RecPick are listed here. Versions follow [Semantic Versioning](https://semver.org/); `0.x` and `-alpha` releases may still change behaviour between versions.

## [0.7.1-alpha] - 2026-10-28

### Changed
- Wishlist: entries found in the TV guide come first (soonest airing first) and are marked *In the guide*. Each match shows its next airing (time, channel, episode for shows) with a link to Plex Web to record it. Only titles that still air count as found.

## [0.7.0-alpha] - 2026-10-28

### Added
- *Film series* tool in *Tools* (with a TMDB key): every series (TMDB collection) you own at least one movie from, most complete first, with owned, missing and upcoming parts. Missing movies go on the wishlist one by one or with *Add missing (N)*, including unreleased ones (the alert comes when they reach the guide). Series and single movies can be hidden per user. The tile shows how many series are incomplete; this isn't added to the menu counter ([#15](https://github.com/kepak1/recpick/issues/15)).

### Changed
- Wishlist entries can carry a TMDB id and then also match guide titles by it.
- A library movie's runtime and series come from one TMDB request, stored in a new table. After the upgrade every library movie is looked up once more (one request per movie).

## [0.6.0-alpha] - 2026-10-27

### Added
- *Duplicate recordings*: the downloaded script can now **join the parts of a two-part episode** and **renumber files filed under the wrong episode**, besides deleting ([#13](https://github.com/kepak1/recpick/issues/13)).
  - Groups whose file names carry part markers ("cz. 2", "część 2", "Part II") are labelled *Parts*. *Join parts* numbers one copy per part (the longest one not cut short), and any copy can be set as part N by hand. The script can't be downloaded until the parts are numbered 1..N without gaps.
  - Joining uses ffmpeg. Parts with the same codecs and resolution are joined without re-encoding, even from different containers. Otherwise the result is re-encoded to the best part's codec and frame size with AAC audio. The joined `.mkv` is named after part 1 with "(cz. 1-N)", keeps the owner of the original, and the parts are deleted only when ffprobe shows the right total length.
  - Groups whose files carry different episode titles are labelled *Different episodes?*. Any copy can be renumbered (`SxxEyy` in the file name), and with TMDB the right number is suggested by matching the title to the show's episode titles (Polish, then the original language; cached for 90 days).
  - The script renames first, then joins, then deletes, after one confirmation that lists everything. It never overwrites a file.



### Fixed
- Delete script: when run without permission to delete some of the files (recordings usually belong to the Plex user), it now stops before asking, deletes nothing and tells you to run it with `sudo`, instead of asking about every write-protected file and failing half way. Files are removed with `rm -f`, so the single confirmation covers all of them.
- Delete script: running it with `sh` (dash on Debian/Ubuntu) failed with `Syntax error: "(" unexpected`; it now switches to bash by itself.

## [0.5.0-alpha] - 2026-10-27

### Added
- Delete script on *Duplicate recordings* and *Short recordings*: tick files (or use *Select suspicious*), see their count and total size, and download a bash script that lists them, skips missing ones, asks for confirmation and removes them with `rm`. Multi-part copies include every part. An optional path prefix mapping covers running the script where the files live under a different path. The selection and mapping are remembered in the browser. The duplicates page warns when every copy of an item is selected. RecPick still never deletes anything itself ([#10](https://github.com/kepak1/recpick/issues/10)).
- *Short recordings*: a movie can be added to the wishlist with one click, or all selected movies at once, so you get an alert when it airs again (once it is no longer in the library).

## [0.4.0-alpha] - 2026-10-27

### Added
- *Short recordings* tool in *Tools*: episodes much shorter than the median recording of their season or show (or than TMDB's episode runtime for shows with only 1-2 recordings) and, with a TMDB key, movies shorter than their TMDB runtime. Each recording shows its length, the expected length and where it comes from, the percentage, size, quality, date added, file path and a Plex Web link. "This is OK" hides a recording for everyone until its file changes. The threshold (50-95%, default 80%) is a per-user setting ([#8](https://github.com/kepak1/recpick/issues/8)).

### Changed
- *Refresh* on a tool page now runs in the background and refreshes all tools; the page updates when it is done.
- The *Tools* menu counter adds up duplicates and short recordings.

## [0.3.0-alpha] - 2026-10-27

### Added
- *Tools* tab for library helpers, with a counter in the menu. The first tool, *Duplicate recordings*, lists episodes and movies stored in the library more than once (several versions of one item or separate items with the same season and episode number, or the same episode title and air date; movies with the same title and year). Each copy shows its length, size, quality, date added and file path, with a link to Plex Web; copies much shorter than the longest one are flagged as probably cut short. A group can be marked "not a duplicate" for everyone until its copies change. The list is refreshed with every sync or on demand ([#6](https://github.com/kepak1/recpick/issues/6)).

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

[0.7.1-alpha]: https://github.com/kepak1/recpick/releases/tag/v0.7.1-alpha
[0.7.0-alpha]: https://github.com/kepak1/recpick/releases/tag/v0.7.0-alpha
[0.6.0-alpha]: https://github.com/kepak1/recpick/releases/tag/v0.6.0-alpha
[0.5.1-alpha]: https://github.com/kepak1/recpick/releases/tag/v0.5.1-alpha
[0.5.0-alpha]: https://github.com/kepak1/recpick/releases/tag/v0.5.0-alpha
[0.4.0-alpha]: https://github.com/kepak1/recpick/releases/tag/v0.4.0-alpha
[0.3.0-alpha]: https://github.com/kepak1/recpick/releases/tag/v0.3.0-alpha
[0.2.0-alpha]: https://github.com/kepak1/recpick/releases/tag/v0.2.0-alpha
[0.1.0-alpha]: https://github.com/kepak1/recpick/releases/tag/v0.1.0-alpha
