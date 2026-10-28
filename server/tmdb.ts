import { config } from './config.js';
import { addColumn, db, now } from './db.js';
import { normalize } from './text.js';

// Ratings and countries rarely change; a recheck reuses the stored TMDB id (one request instead of two).
const RECHECK_AFTER = 90 * 24 * 3600;
// Bump to look every title up again after the stored details change (2: country and genres).
const DETAILS_VERSION = 2;

addColumn('items', 'tmdb_id', 'INTEGER');
addColumn('items', 'countries', 'TEXT');
addColumn('items', 'tmdb_genres', 'TEXT');
addColumn('items', 'tmdb_version', 'INTEGER NOT NULL DEFAULT 0');

// TMDB data for titles from the watch history, which are mostly no longer in the guide or the library.
db.exec(`
CREATE TABLE IF NOT EXISTS tmdb_watched (
  type TEXT NOT NULL,            -- 'movie' | 'show'
  title_norm TEXT NOT NULL,
  tmdb_id INTEGER,
  genres TEXT NOT NULL DEFAULT '[]',
  countries TEXT NOT NULL DEFAULT '[]',
  recommendations TEXT NOT NULL DEFAULT '[]',
  checked_at INTEGER NOT NULL,
  PRIMARY KEY (type, title_norm)
);
`);

export interface TmdbDetails {
  id: number;
  rating: number | null;
  /** ISO 3166-1 codes, country of origin first. */
  countries: string[];
  genres: number[];
  /** TMDB ids of titles of the same type that TMDB recommends to fans of this one. */
  recommendations: number[];
}

interface SearchResult {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
}

interface DetailsResponse {
  id: number;
  vote_average?: number;
  vote_count?: number;
  origin_country?: string[];
  production_countries?: { iso_3166_1: string }[];
  genres?: { id: number }[];
  recommendations?: { results: { id: number }[] };
}

export const tmdbEnabled = () => Boolean(config.tmdbApiKey);

class TmdbAuthError extends Error {}

const tmdbType = (type: string) => (type === 'movie' ? 'movie' : 'tv');

async function call<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const key = config.tmdbApiKey!;
  // v4 read access tokens are long JWTs; v3 keys are 32 hex chars.
  const bearer = key.length > 40;
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  if (!bearer) url.searchParams.set('api_key', key);
  for (;;) {
    const res = await fetch(url, {
      headers: bearer ? { Authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    if (res.status === 401) throw new TmdbAuthError('TMDB rejected the API key (401)');
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`TMDB ${res.status}`);
    return (await res.json()) as T;
  }
}

async function searchId(type: string, title: string, year: number | null): Promise<number | null> {
  const search = async (withYear: boolean) => {
    const params: Record<string, string> = { query: title, language: 'pl-PL' };
    if (withYear && year) params[type === 'movie' ? 'year' : 'first_air_date_year'] = String(year);
    return (await call<{ results: SearchResult[] }>(`/search/${tmdbType(type)}`, params))?.results ?? [];
  };
  let results = await search(true);
  if (results.length === 0 && year) {
    // Guide years are often a year off from TMDB's release year; accept only near misses.
    results = (await search(false)).filter((r) => {
      const released = Number((r.release_date ?? r.first_air_date ?? '').slice(0, 4));
      return released && Math.abs(released - year) <= 1;
    });
  }
  const norm = normalize(title);
  const match =
    results.find((r) => [r.title, r.name, r.original_title, r.original_name].some((t) => t && normalize(t) === norm)) ?? results[0];
  return match?.id ?? null;
}

async function details(type: string, id: number, withRecommendations: boolean): Promise<TmdbDetails | null> {
  const params: Record<string, string> = { language: 'pl-PL' };
  if (withRecommendations) params.append_to_response = 'recommendations';
  const d = await call<DetailsResponse>(`/${tmdbType(type)}/${id}`, params);
  if (!d) return null;
  const origin = d.origin_country ?? [];
  const production = (d.production_countries ?? []).map((c) => c.iso_3166_1);
  return {
    id: d.id,
    rating: d.vote_count ? Math.round((d.vote_average ?? 0) * 10) / 10 : null,
    countries: [...new Set([...origin, ...production])],
    genres: (d.genres ?? []).map((g) => g.id),
    recommendations: (d.recommendations?.results ?? []).map((r) => r.id),
  };
}

/** Finds a title on TMDB (or takes the known id) and returns its details. */
async function lookup(
  type: string,
  title: string,
  year: number | null,
  opts: { id?: number | null; recommendations?: boolean } = {},
): Promise<TmdbDetails | null> {
  const id = opts.id ?? (await searchId(type, title, year));
  return id ? details(type, id, opts.recommendations ?? false) : null;
}

/** Runs `fn` over `rows` with a few parallel workers; a rejected key stops everything at once. */
async function pool<T>(label: string, rows: T[], fn: (row: T) => Promise<boolean>): Promise<void> {
  if (rows.length === 0) return;
  console.log(`[tmdb] looking up ${rows.length} ${label}`);
  let index = 0;
  let failures = 0;
  let found = 0;
  let authFailed = false;
  const worker = async () => {
    while (index < rows.length && !authFailed) {
      const row = rows[index++];
      try {
        if (await fn(row)) found++;
      } catch (err) {
        if (err instanceof TmdbAuthError) {
          // A bad key fails every request; stop instead of sending thousands of them.
          if (!authFailed) console.error('[tmdb] TMDB rejected the API key (401): check TMDB_API_KEY (v3 key or v4 read access token)');
          authFailed = true;
        } else if (++failures === 1) {
          console.warn('[tmdb] lookup failed', err);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(`[tmdb] ${label} done: ${found} found, ${failures} failures${authFailed ? ', stopped: invalid API key' : ''}`);
}

/**
 * Ratings, countries and genres for guide titles that have none yet or were checked long ago.
 * Titles every user has hidden by hand are skipped (they get looked up if someone restores them);
 * titles hidden only by rules are not, as rules need countries and ratings to match.
 */
export async function fetchMissingDetails(): Promise<void> {
  if (!tmdbEnabled()) return;
  const rows = db
    .prepare(
      `SELECT guid, type, title, year, tmdb_id FROM items
       WHERE guid IN (SELECT DISTINCT item_guid FROM airings)
         AND (tmdb_version < ? OR tmdb_checked_at IS NULL OR tmdb_checked_at < ?)
         AND guid NOT IN (
           SELECT item_guid FROM ignores WHERE scope = 'title'
           GROUP BY item_guid HAVING count(DISTINCT user_id) = (SELECT count(*) FROM users)
         )`,
    )
    .all(DETAILS_VERSION, now() - RECHECK_AFTER) as { guid: string; type: string; title: string; year: number | null; tmdb_id: number | null }[];
  const update = db.prepare(
    'UPDATE items SET tmdb_rating = ?, tmdb_id = ?, countries = ?, tmdb_genres = ?, tmdb_checked_at = ?, tmdb_version = ? WHERE guid = ?',
  );
  await pool('guide titles', rows, async (row) => {
    // Show years in the guide are often the episode's year, so search shows without a year.
    const d = await lookup(row.type, row.title, row.type === 'movie' ? row.year : null, { id: row.tmdb_id });
    update.run(d?.rating ?? null, d?.id ?? null, JSON.stringify(d?.countries ?? []), JSON.stringify(d?.genres ?? []), now(), DETAILS_VERSION, row.guid);
    return d != null;
  });
}

export interface WatchedTitle {
  type: 'movie' | 'show';
  title: string;
  titleNorm: string;
  year: number | null;
  /** From the library item's tmdb:// guid, when it is still in the library. */
  tmdbId: number | null;
}

export interface WatchedDetails {
  tmdbId: number | null;
  genres: number[];
  countries: string[];
  recommendations: number[];
}

export const watchedKey = (type: string, titleNorm: string) => `${type}|${titleNorm}`;

/** TMDB details with recommendations for watched titles, looked up once and rechecked monthly. */
export async function watchedDetails(titles: WatchedTitle[]): Promise<Map<string, WatchedDetails>> {
  const stored = new Map<string, WatchedDetails & { checkedAt: number }>();
  for (const r of db.prepare('SELECT * FROM tmdb_watched').all() as Record<string, any>[]) {
    stored.set(watchedKey(r.type, r.title_norm), {
      tmdbId: r.tmdb_id,
      genres: JSON.parse(r.genres),
      countries: JSON.parse(r.countries),
      recommendations: JSON.parse(r.recommendations),
      checkedAt: r.checked_at,
    });
  }
  if (tmdbEnabled()) {
    const stale = titles.filter((w) => (stored.get(watchedKey(w.type, w.titleNorm))?.checkedAt ?? 0) < now() - RECHECK_AFTER);
    const save = db.prepare(
      `INSERT INTO tmdb_watched (type, title_norm, tmdb_id, genres, countries, recommendations, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(type, title_norm) DO UPDATE SET tmdb_id = excluded.tmdb_id, genres = excluded.genres,
         countries = excluded.countries, recommendations = excluded.recommendations, checked_at = excluded.checked_at`,
    );
    await pool('watched titles', stale, async (w) => {
      const id = w.tmdbId ?? stored.get(watchedKey(w.type, w.titleNorm))?.tmdbId;
      const d = await lookup(w.type, w.title, w.type === 'movie' ? w.year : null, { id, recommendations: true });
      const entry = { tmdbId: d?.id ?? null, genres: d?.genres ?? [], countries: d?.countries ?? [], recommendations: d?.recommendations ?? [] };
      save.run(w.type, w.titleNorm, entry.tmdbId, JSON.stringify(entry.genres), JSON.stringify(entry.countries), JSON.stringify(entry.recommendations), now());
      stored.set(watchedKey(w.type, w.titleNorm), { ...entry, checkedAt: now() });
      return d != null;
    });
  }
  const out = new Map<string, WatchedDetails>();
  for (const w of titles) {
    const d = stored.get(watchedKey(w.type, w.titleNorm));
    if (d) out.set(watchedKey(w.type, w.titleNorm), d);
  }
  return out;
}

// Runtimes of library titles, for the short recordings tool: a movie's runtime, or every episode's in a season.
db.exec(`
CREATE TABLE IF NOT EXISTS tmdb_runtimes (
  kind TEXT NOT NULL,            -- 'movie' | 'season'
  tmdb_id INTEGER NOT NULL,
  season INTEGER NOT NULL DEFAULT -1,
  runtimes TEXT NOT NULL,        -- movie: minutes or null; season: {"<episode>": minutes}
  checked_at INTEGER NOT NULL,
  PRIMARY KEY (kind, tmdb_id, season)
);
`);

/** Stored runtimes of one kind, looking up the missing and stale ones first. */
async function runtimes<T>(
  kind: 'movie' | 'season',
  wanted: { id: number; season: number }[],
  fetchOne: (id: number, season: number) => Promise<T | null>,
): Promise<Map<string, T | null>> {
  const key = (id: number, season: number) => `${id}|${season}`;
  const stored = new Map<string, { value: T | null; checkedAt: number }>();
  for (const r of db.prepare('SELECT * FROM tmdb_runtimes WHERE kind = ?').all(kind) as Record<string, any>[]) {
    stored.set(key(r.tmdb_id, r.season), { value: JSON.parse(r.runtimes), checkedAt: r.checked_at });
  }
  const unique = [...new Map(wanted.map((w) => [key(w.id, w.season), w])).values()];
  if (tmdbEnabled()) {
    const stale = unique.filter((w) => (stored.get(key(w.id, w.season))?.checkedAt ?? 0) < now() - RECHECK_AFTER);
    const save = db.prepare(
      `INSERT INTO tmdb_runtimes (kind, tmdb_id, season, runtimes, checked_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(kind, tmdb_id, season) DO UPDATE SET runtimes = excluded.runtimes, checked_at = excluded.checked_at`,
    );
    await pool(kind === 'movie' ? 'movie runtimes' : 'season runtimes', stale, async (w) => {
      const value = await fetchOne(w.id, w.season);
      save.run(kind, w.id, w.season, JSON.stringify(value), now());
      stored.set(key(w.id, w.season), { value, checkedAt: now() });
      return value != null;
    });
  }
  return new Map(unique.map((w) => [key(w.id, w.season), stored.get(key(w.id, w.season))?.value ?? null]));
}

// Library movies' runtime and series, from one request per movie (short recordings, film series).
db.exec(`
CREATE TABLE IF NOT EXISTS tmdb_movies (
  tmdb_id INTEGER PRIMARY KEY,
  runtime INTEGER,               -- minutes
  collection_id INTEGER,         -- the TMDB collection (film series) the movie belongs to
  checked_at INTEGER NOT NULL
);
`);

export interface MovieDetails {
  runtime: number | null;
  collection: number | null;
}

/** Runtime and series of each movie, looked up once and rechecked every 90 days. */
export async function movieDetails(ids: number[]): Promise<Map<number, MovieDetails>> {
  const stored = new Map<number, MovieDetails & { checkedAt: number }>();
  for (const r of db.prepare('SELECT * FROM tmdb_movies').all() as Record<string, any>[]) {
    stored.set(r.tmdb_id, { runtime: r.runtime, collection: r.collection_id, checkedAt: r.checked_at });
  }
  const unique = [...new Set(ids)];
  if (tmdbEnabled()) {
    const stale = unique.filter((id) => (stored.get(id)?.checkedAt ?? 0) < now() - RECHECK_AFTER);
    const save = db.prepare(
      `INSERT INTO tmdb_movies (tmdb_id, runtime, collection_id, checked_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(tmdb_id) DO UPDATE SET runtime = excluded.runtime, collection_id = excluded.collection_id, checked_at = excluded.checked_at`,
    );
    await pool('movie details', stale, async (id) => {
      const d = await call<{ runtime?: number; belongs_to_collection?: { id: number } | null }>(`/movie/${id}`, {});
      const value = { runtime: d?.runtime || null, collection: d?.belongs_to_collection?.id ?? null };
      save.run(id, value.runtime, value.collection, now());
      stored.set(id, { ...value, checkedAt: now() });
      return d != null;
    });
  }
  return new Map(unique.filter((id) => stored.has(id)).map((id) => [id, stored.get(id)!]));
}

/** TMDB runtime in minutes by movie id; movies without one are missing. */
export async function movieRuntimes(ids: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  for (const [id, d] of await movieDetails(ids)) if (d.runtime) out.set(id, d.runtime);
  return out;
}

// Film series. New parts get announced, so these are rechecked more often than titles.
const COLLECTION_RECHECK = 30 * 24 * 3600;

db.exec(`
CREATE TABLE IF NOT EXISTS tmdb_collections (
  id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,            -- Collection as JSON
  checked_at INTEGER NOT NULL
);
`);

export interface CollectionPart {
  id: number;
  title: string;
  /** YYYY-MM-DD; null when not announced yet. */
  releaseDate: string | null;
  poster: string | null;
}

export interface Collection {
  id: number;
  name: string;
  poster: string | null;
  parts: CollectionPart[];
}

const posterUrl = (path: string | null | undefined) => (path ? `https://image.tmdb.org/t/p/w185${path}` : null);

/** Each collection with its parts (Polish titles), looked up once and rechecked every 30 days. */
export async function collections(ids: number[]): Promise<Map<number, Collection>> {
  const stored = new Map<number, { value: Collection | null; checkedAt: number }>();
  for (const r of db.prepare('SELECT * FROM tmdb_collections').all() as Record<string, any>[]) {
    stored.set(r.id, { value: JSON.parse(r.data), checkedAt: r.checked_at });
  }
  const unique = [...new Set(ids)];
  if (tmdbEnabled()) {
    const stale = unique.filter((id) => (stored.get(id)?.checkedAt ?? 0) < now() - COLLECTION_RECHECK);
    const save = db.prepare(
      `INSERT INTO tmdb_collections (id, data, checked_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, checked_at = excluded.checked_at`,
    );
    await pool('film series', stale, async (id) => {
      const d = await call<{
        name: string;
        poster_path?: string | null;
        parts?: { id: number; title: string; release_date?: string; poster_path?: string | null }[];
      }>(`/collection/${id}`, { language: 'pl-PL' });
      const value: Collection | null = d && {
        id,
        name: d.name,
        poster: posterUrl(d.poster_path),
        parts: (d.parts ?? []).map((p) => ({ id: p.id, title: p.title, releaseDate: p.release_date || null, poster: posterUrl(p.poster_path) })),
      };
      save.run(id, JSON.stringify(value), now());
      stored.set(id, { value, checkedAt: now() });
      return value != null;
    });
  }
  const out = new Map<number, Collection>();
  for (const id of unique) {
    const value = stored.get(id)?.value;
    if (value) out.set(id, value);
  }
  return out;
}

/** Episode runtimes in minutes for each "<show id>|<season>". */
export async function seasonRuntimes(seasons: { id: number; season: number }[]): Promise<Map<string, Record<string, number>>> {
  const found = await runtimes('season', seasons, async (id, season) => {
    const d = await call<{ episodes?: { episode_number: number; runtime?: number | null }[] }>(`/tv/${id}/season/${season}`, {});
    if (!d) return null;
    return Object.fromEntries((d.episodes ?? []).filter((e) => e.runtime).map((e) => [String(e.episode_number), e.runtime!]));
  });
  const out = new Map<string, Record<string, number>>();
  for (const [k, v] of found) if (v) out.set(k, v);
  return out;
}

// Episode titles of a whole show (Polish and original language), for telling which episode a
// recording really is when the guide filed it under the wrong number.
db.exec(`
CREATE TABLE IF NOT EXISTS tmdb_episodes (
  tmdb_id INTEGER PRIMARY KEY,
  episodes TEXT NOT NULL,        -- [{"season": 1, "episode": 2, "names": ["...", "..."]}]
  checked_at INTEGER NOT NULL
);
`);

export interface EpisodeTitles {
  season: number;
  episode: number;
  /** Polish title first, then the original-language one; placeholders like "Odcinek 5" are left out. */
  names: string[];
}

const PLACEHOLDER = /^(?:odcinek|episode|folge|episodio|épisode)\s*\d+$/i;

async function fetchEpisodeTitles(id: number): Promise<EpisodeTitles[] | null> {
  const show = await call<{ original_language?: string; seasons?: { season_number: number }[] }>(`/tv/${id}`, { language: 'pl-PL' });
  if (!show) return null;
  const languages = ['pl-PL', ...(show.original_language && show.original_language !== 'pl' ? [show.original_language] : [])];
  const byEpisode = new Map<string, EpisodeTitles>();
  for (const { season_number } of show.seasons ?? []) {
    for (const language of languages) {
      const s = await call<{ episodes?: { episode_number: number; name?: string }[] }>(`/tv/${id}/season/${season_number}`, { language });
      for (const e of s?.episodes ?? []) {
        const key = `${season_number}|${e.episode_number}`;
        const entry = byEpisode.get(key) ?? { season: season_number, episode: e.episode_number, names: [] };
        const name = e.name?.trim();
        if (name && !PLACEHOLDER.test(name) && !entry.names.includes(name)) entry.names.push(name);
        byEpisode.set(key, entry);
      }
    }
  }
  return [...byEpisode.values()];
}

/** Every episode's titles for each show id, looked up once and rechecked every 90 days. */
export async function showEpisodeTitles(ids: number[]): Promise<Map<number, EpisodeTitles[]>> {
  const stored = new Map<number, { value: EpisodeTitles[]; checkedAt: number }>();
  for (const r of db.prepare('SELECT * FROM tmdb_episodes').all() as Record<string, any>[]) {
    stored.set(r.tmdb_id, { value: JSON.parse(r.episodes), checkedAt: r.checked_at });
  }
  const unique = [...new Set(ids)];
  if (tmdbEnabled()) {
    const stale = unique.filter((id) => (stored.get(id)?.checkedAt ?? 0) < now() - RECHECK_AFTER);
    const save = db.prepare(
      `INSERT INTO tmdb_episodes (tmdb_id, episodes, checked_at) VALUES (?, ?, ?)
       ON CONFLICT(tmdb_id) DO UPDATE SET episodes = excluded.episodes, checked_at = excluded.checked_at`,
    );
    await pool('show episode titles', stale, async (id) => {
      const value = (await fetchEpisodeTitles(id)) ?? [];
      save.run(id, JSON.stringify(value), now());
      stored.set(id, { value, checkedAt: now() });
      return value.length > 0;
    });
  }
  return new Map(unique.filter((id) => stored.has(id)).map((id) => [id, stored.get(id)!.value]));
}
