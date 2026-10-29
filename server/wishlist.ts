import { db, now } from './db.js';
import { shortRecordings, validThreshold } from './short.js';

// Movie wishes that got recorded: a copy of the movie reached the library after the wish was
// added. They stay on the list as "Recorded" for a few days, with a link to the movie, and then
// go. Shows and phrases stay, as they keep matching new airings.

export const RECORDED_KEEP_DAYS = 3;

interface LibraryMovieRow {
  guid: string;
  title_norm: string;
  year: number | null;
  rating_key: string | null;
  tmdb_id: number | null;
  media_id: number;
}

interface PendingWish {
  id: number;
  user_id: number;
  guid: string | null;
  tmdb_id: number | null;
  title: string;
  title_norm: string;
  year: number | null;
  media_baseline: number;
  short_threshold: number | null;
}

function sameMovie(w: PendingWish, m: LibraryMovieRow): boolean {
  if (w.guid && w.guid === m.guid) return true;
  if (w.tmdb_id != null && w.tmdb_id === m.tmdb_id) return true;
  return w.title_norm === m.title_norm && (w.year == null || m.year == null || Math.abs(w.year - m.year) <= 1);
}

/** Runs after each library sync: marks recorded movie wishes and removes those kept long enough. */
export function updateRecordedWishes(): void {
  const max = (db.prepare('SELECT max(media_id) AS n FROM library_movies').get() as { n: number | null }).n;
  if (max == null) return;
  // Wishes added before the library had media ids (or before this version) start from here.
  db.prepare('UPDATE wishlist SET media_baseline = ? WHERE media_baseline IS NULL').run(max);

  const pending = db
    .prepare(
      `SELECT w.id, w.user_id, w.guid, w.tmdb_id, w.title, w.title_norm, w.year, w.media_baseline, u.short_threshold
       FROM wishlist w JOIN users u ON u.id = w.user_id
       WHERE w.kind = 'title' AND w.type = 'movie' AND w.recorded_at IS NULL`,
    )
    .all() as unknown as PendingWish[];
  if (pending.length > 0) {
    const from = Math.min(...pending.map((w) => w.media_baseline));
    const fresh = db.prepare('SELECT * FROM library_movies WHERE media_id > ?').all(from) as unknown as LibraryMovieRow[];
    const shortByThreshold = new Map<number, Set<number>>();
    const isShort = (mediaId: number, threshold: number) => {
      let ids = shortByThreshold.get(threshold);
      if (!ids) {
        ids = new Set(shortRecordings(threshold).recordings.map((r) => r.mediaId));
        shortByThreshold.set(threshold, ids);
      }
      return ids.has(mediaId);
    };
    const mark = db.prepare('UPDATE wishlist SET recorded_at = ?, recorded_key = ? WHERE id = ?');
    for (const w of pending) {
      const threshold = validThreshold(w.short_threshold);
      const copy = fresh.find((m) => m.media_id > w.media_baseline && sameMovie(w, m) && !isShort(m.media_id, threshold));
      if (!copy) continue;
      mark.run(now(), copy.rating_key, w.id);
      console.log(`[wishlist] recorded: ${w.title} (user ${w.user_id})`);
    }
  }

  const removed = db.prepare('DELETE FROM wishlist WHERE recorded_at < ?').run(now() - RECORDED_KEEP_DAYS * 86400).changes;
  if (removed) console.log(`[wishlist] removed ${removed} recorded wishes`);
}

/** Highest movie media id in the library now; a new wish counts copies above it. */
export function mediaBaseline(): number | null {
  return (db.prepare('SELECT max(media_id) AS n FROM library_movies').get() as { n: number | null }).n;
}
