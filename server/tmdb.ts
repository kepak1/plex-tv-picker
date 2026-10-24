import { config } from './config.js';
import { db, now } from './db.js';
import { normalize } from './text.js';

const RECHECK_AFTER = 30 * 24 * 3600;

interface TmdbResult {
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  vote_average?: number;
  vote_count?: number;
}

export const tmdbEnabled = () => Boolean(config.tmdbApiKey);

async function search(type: string, title: string, year: number | null): Promise<number | null> {
  const key = config.tmdbApiKey!;
  // v4 read access tokens are long JWTs; v3 keys are 32 hex chars.
  const bearer = key.length > 40;
  const url = new URL(`https://api.themoviedb.org/3/search/${type === 'movie' ? 'movie' : 'tv'}`);
  url.searchParams.set('query', title);
  url.searchParams.set('language', 'pl-PL');
  if (year) url.searchParams.set(type === 'movie' ? 'year' : 'first_air_date_year', String(year));
  if (!bearer) url.searchParams.set('api_key', key);
  const res = await fetch(url, {
    headers: bearer ? { Authorization: `Bearer ${key}` } : {},
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 2000));
    return search(type, title, year);
  }
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  const data = (await res.json()) as { results: TmdbResult[] };
  const norm = normalize(title);
  const match =
    data.results.find((r) =>
      [r.title, r.name, r.original_title, r.original_name].some((t) => t && normalize(t) === norm),
    ) ?? data.results[0];
  if (!match || !match.vote_count) return null;
  return Math.round((match.vote_average ?? 0) * 10) / 10;
}

export async function fetchMissingRatings(): Promise<void> {
  if (!tmdbEnabled()) return;
  const rows = db
    .prepare(
      `SELECT guid, type, title, year FROM items
       WHERE guid IN (SELECT DISTINCT item_guid FROM airings) AND (tmdb_checked_at IS NULL OR tmdb_checked_at < ?)`,
    )
    .all(now() - RECHECK_AFTER) as { guid: string; type: string; title: string; year: number | null }[];
  if (rows.length === 0) return;
  console.log(`[tmdb] looking up ${rows.length} titles`);
  const update = db.prepare('UPDATE items SET tmdb_rating = ?, tmdb_checked_at = ? WHERE guid = ?');
  let index = 0;
  let failures = 0;
  const worker = async () => {
    while (index < rows.length) {
      const row = rows[index++];
      try {
        // Show years in the guide are often the episode's year, so search shows without a year.
        const rating = await search(row.type, row.title, row.type === 'movie' ? row.year : null);
        update.run(rating, now(), row.guid);
      } catch (err) {
        if (++failures === 1) console.warn('[tmdb] lookup failed', err);
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(`[tmdb] done (${failures} failures)`);
}
