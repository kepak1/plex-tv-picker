import { db, getMeta, now, setMeta } from './db.js';
import { tmdbIdOf, type Library } from './library.js';
import { collections, movieDetails, tmdbEnabled } from './tmdb.js';

// Film series (TMDB collections) with at least one movie in the library: which parts are there and
// which are missing, so the missing ones can go on the wishlist. Each user can hide a whole series
// or a single movie they aren't interested in.

db.exec(`
CREATE TABLE IF NOT EXISTS series_hidden (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,            -- 'series' | 'movie'
  tmdb_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, tmdb_id)
);
`);

export interface SeriesPart {
  tmdbId: number;
  title: string;
  releaseDate: string | null;
  poster: string | null;
  /** Library rating key when the movie is in the library. */
  ratingKey: string | null;
}

export interface Series {
  id: number;
  name: string;
  poster: string | null;
  parts: SeriesPart[];
}

interface Scan {
  scannedAt: number;
  series: Series[];
}

let scan: Scan | null = null;

function stored(): Scan | null {
  if (!scan) {
    const raw = getMeta('series');
    scan = raw ? (JSON.parse(raw) as Scan) : null;
  }
  return scan;
}

const today = () => new Date().toISOString().slice(0, 10);
export const isReleased = (p: SeriesPart, on = today()) => !!p.releaseDate && p.releaseDate <= on;

/** Looks up the series of every library movie (TMDB only) and stores those with an owned part. */
export async function updateSeries({ movies }: Library): Promise<void> {
  if (!tmdbEnabled()) {
    scan = { scannedAt: now(), series: [] };
    setMeta('series', JSON.stringify(scan));
    return;
  }
  const owned = new Map<number, string>();
  for (const m of movies) {
    const id = tmdbIdOf(m);
    if (id != null && !owned.has(id)) owned.set(id, m.ratingKey);
  }
  const details = await movieDetails([...owned.keys()]);
  const ids = [...new Set([...details.values()].map((d) => d.collection).filter((c): c is number => c != null))];
  const found = await collections(ids);

  const series: Series[] = [];
  for (const c of found.values()) {
    const parts = c.parts
      .map((p) => ({ tmdbId: p.id, title: p.title, releaseDate: p.releaseDate, poster: p.poster, ratingKey: owned.get(p.id) ?? null }))
      // Release order; parts without a date (announced only) last.
      .sort((a, b) => (a.releaseDate ?? '9999').localeCompare(b.releaseDate ?? '9999'));
    if (parts.some((p) => p.ratingKey)) series.push({ id: c.id, name: c.name, poster: c.poster, parts });
  }
  // Most complete first.
  const share = (s: Series) => s.parts.filter((p) => p.ratingKey).length / s.parts.length;
  series.sort((a, b) => share(b) - share(a) || a.name.localeCompare(b.name));
  scan = { scannedAt: now(), series };
  setMeta('series', JSON.stringify(scan));
  console.log(`[series] ${series.length} series with owned movies`);
}

function hiddenOf(userId: number): { series: Set<number>; movies: Set<number> } {
  const rows = db.prepare('SELECT kind, tmdb_id FROM series_hidden WHERE user_id = ?').all(userId) as { kind: string; tmdb_id: number }[];
  return {
    series: new Set(rows.filter((r) => r.kind === 'series').map((r) => r.tmdb_id)),
    movies: new Set(rows.filter((r) => r.kind === 'movie').map((r) => r.tmdb_id)),
  };
}

export function seriesFor(userId: number) {
  const s = stored();
  const hidden = hiddenOf(userId);
  return {
    scannedAt: s?.scannedAt ?? null,
    series: (s?.series ?? []).map((x) => ({
      ...x,
      hidden: hidden.series.has(x.id),
      parts: x.parts.map((p) => ({ ...p, hidden: hidden.movies.has(p.tmdbId) })),
    })),
  };
}

/** Series the user hasn't hidden that miss at least one released movie they haven't hidden. */
export function seriesCount(userId: number): number {
  const on = today();
  return seriesFor(userId).series.filter((s) => !s.hidden && s.parts.some((p) => !p.ratingKey && !p.hidden && isReleased(p, on))).length;
}

export function setSeriesHidden(userId: number, kind: 'series' | 'movie', tmdbId: number, hidden: boolean): void {
  if (hidden) {
    db.prepare('INSERT OR IGNORE INTO series_hidden (user_id, kind, tmdb_id, created_at) VALUES (?, ?, ?, ?)').run(userId, kind, tmdbId, now());
  } else {
    db.prepare('DELETE FROM series_hidden WHERE user_id = ? AND kind = ? AND tmdb_id = ?').run(userId, kind, tmdbId);
  }
}
