import { db, getMeta, now, setMeta } from './db.js';
import { copiesOf, showKey, tmdbIdOf, type Library, type LibraryCopy, type LibraryMetadata } from './library.js';
import { libraryMetadata } from './plex.js';
import { movieRuntimes, seasonRuntimes, tmdbEnabled } from './tmdb.js';

// Recordings much shorter than they should be (a recording that stopped early). Episodes are
// compared with the typical length of their season or show; shows with too few recordings for that,
// and movies, with the runtime from TMDB. Each user picks the threshold in their settings.

export const THRESHOLDS = [50, 55, 60, 65, 70, 75, 80, 85, 90, 95];
export const DEFAULT_THRESHOLD = 80;
const MAX_THRESHOLD = Math.max(...THRESHOLDS);
// Enough recordings for a typical length: a season's own, or else the whole show's.
const SEASON_MIN = 5;
const SHOW_MIN = 3;

db.exec(`
CREATE TABLE IF NOT EXISTS short_ignores (
  media_id INTEGER PRIMARY KEY,
  signature TEXT NOT NULL,       -- the file at the time, so a replaced recording is checked again
  user_id INTEGER,
  created_at INTEGER NOT NULL
);
`);

export interface ShortRecording extends LibraryCopy {
  kind: 'episode' | 'movie';
  show: string | null;
  season: number | null;
  episode: number | null;
  airDate: string | null;
  year: number | null;
  /** Expected length in milliseconds. */
  reference: number;
  basis: 'season' | 'show' | 'tmdb';
  /** duration / reference */
  ratio: number;
}

interface Scan {
  scannedAt: number;
  /** Everything under the highest threshold; each user sees the part under their own. */
  recordings: ShortRecording[];
  /** Movies with no TMDB id or runtime (only with TMDB). */
  moviesUnchecked: number;
}

let scan: Scan | null = null;

function stored(): Scan | null {
  if (!scan) {
    const raw = getMeta('short_recordings');
    scan = raw ? (JSON.parse(raw) as Scan) : null;
  }
  return scan;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const MINUTE = 60_000;

interface EpisodeCopy {
  m: LibraryMetadata;
  copy: LibraryCopy & { duration: number };
}

function recording(m: LibraryMetadata, copy: LibraryCopy & { duration: number }, kind: 'episode' | 'movie', reference: number, basis: ShortRecording['basis']): ShortRecording {
  return {
    ...copy,
    kind,
    show: kind === 'episode' ? (m.grandparentTitle ?? null) : null,
    season: kind === 'episode' ? (m.parentIndex ?? null) : null,
    episode: kind === 'episode' ? (m.index ?? null) : null,
    airDate: m.originallyAvailableAt ?? null,
    year: m.year ?? null,
    reference,
    basis,
    ratio: Math.round((copy.duration / reference) * 1000) / 1000,
  };
}

async function findShort({ movies, episodes }: Library): Promise<Scan> {
  const out: ShortRecording[] = [];
  const keep = (r: ShortRecording) => {
    if (r.ratio < MAX_THRESHOLD / 100) out.push(r);
  };

  // ---------- Episodes ----------
  const shows = new Map<string, EpisodeCopy[]>();
  for (const m of episodes) {
    for (const copy of copiesOf(m)) {
      if (!copy.duration) continue;
      const k = showKey(m);
      shows.set(k, [...(shows.get(k) ?? []), { m, copy: copy as EpisodeCopy['copy'] }]);
    }
  }
  const fewRecordings: EpisodeCopy[][] = [];
  for (const copies of shows.values()) {
    if (copies.length < SHOW_MIN) {
      fewRecordings.push(copies);
      continue;
    }
    const showMedian = median(copies.map((c) => c.copy.duration));
    const bySeason = new Map<number | undefined, number[]>();
    for (const c of copies) bySeason.set(c.m.parentIndex, [...(bySeason.get(c.m.parentIndex) ?? []), c.copy.duration]);
    const seasonMedian = new Map([...bySeason].filter(([, d]) => d.length >= SEASON_MIN).map(([s, d]) => [s, median(d)]));
    for (const c of copies) {
      const season = seasonMedian.get(c.m.parentIndex);
      keep(recording(c.m, c.copy, 'episode', season ?? showMedian, season ? 'season' : 'show'));
    }
  }

  // Shows with one or two recordings: TMDB's runtime of that episode.
  if (tmdbEnabled() && fewRecordings.length) {
    const flat = fewRecordings.flat().filter((c) => c.m.grandparentRatingKey && c.m.parentIndex != null && c.m.index != null);
    const meta = await libraryMetadata([...new Set(flat.map((c) => c.m.grandparentRatingKey!))]);
    const showId = (c: EpisodeCopy) => meta.get(c.m.grandparentRatingKey!)?.tmdbId ?? null;
    const runtimes = await seasonRuntimes(flat.filter(showId).map((c) => ({ id: showId(c)!, season: c.m.parentIndex! })));
    for (const c of flat) {
      const minutes = showId(c) ? runtimes.get(`${showId(c)}|${c.m.parentIndex}`)?.[String(c.m.index)] : undefined;
      if (minutes) keep(recording(c.m, c.copy, 'episode', minutes * MINUTE, 'tmdb'));
    }
  }

  // ---------- Movies ----------
  let moviesUnchecked = 0;
  if (tmdbEnabled()) {
    const runtimes = await movieRuntimes([...new Set(movies.map(tmdbIdOf).filter((id): id is number => id != null))]);
    for (const m of movies) {
      const id = tmdbIdOf(m);
      const minutes = id != null ? runtimes.get(id) : undefined;
      if (!minutes) {
        moviesUnchecked++;
        continue;
      }
      for (const copy of copiesOf(m)) {
        if (copy.duration) keep(recording(m, copy as EpisodeCopy['copy'], 'movie', minutes * MINUTE, 'tmdb'));
      }
    }
  }

  out.sort(
    (a, b) =>
      (a.show ?? a.title).localeCompare(b.show ?? b.title) ||
      (a.season ?? 0) - (b.season ?? 0) ||
      (a.episode ?? 0) - (b.episode ?? 0) ||
      (a.airDate ?? '').localeCompare(b.airDate ?? '') ||
      a.ratio - b.ratio,
  );
  return { scannedAt: now(), recordings: out, moviesUnchecked };
}

/** Scans library data the sync (or the tools' refresh) has fetched; may look up TMDB runtimes. */
export async function updateShortRecordings(lib: Library): Promise<void> {
  scan = await findShort(lib);
  setMeta('short_recordings', JSON.stringify(scan));
  console.log(`[short] ${scan.recordings.length} recordings under ${MAX_THRESHOLD}%`);
}

const signature = (r: LibraryCopy) => `${r.file ?? ''}|${r.size ?? ''}|${r.duration ?? ''}`;

export function shortRecordings(threshold: number): {
  scannedAt: number | null;
  moviesUnchecked: number;
  recordings: (ShortRecording & { ignored: boolean })[];
} {
  const s = stored();
  const rows = db.prepare('SELECT media_id, signature FROM short_ignores').all() as { media_id: number; signature: string }[];
  const ignored = new Map(rows.map((r) => [r.media_id, r.signature]));
  return {
    scannedAt: s?.scannedAt ?? null,
    moviesUnchecked: s?.moviesUnchecked ?? 0,
    recordings: (s?.recordings ?? [])
      .filter((r) => r.ratio < threshold / 100)
      .map((r) => ({ ...r, ignored: ignored.get(r.mediaId) === signature(r) })),
  };
}

export function shortCount(threshold: number): number {
  return shortRecordings(threshold).recordings.filter((r) => !r.ignored).length;
}

export function ignoreShort(mediaId: number, userId: number): boolean {
  const r = stored()?.recordings.find((x) => x.mediaId === mediaId);
  if (!r) return false;
  db.prepare(
    `INSERT INTO short_ignores (media_id, signature, user_id, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(media_id) DO UPDATE SET signature = excluded.signature, user_id = excluded.user_id, created_at = excluded.created_at`,
  ).run(mediaId, signature(r), userId, now());
  return true;
}

export function unignoreShort(mediaId: number): void {
  db.prepare('DELETE FROM short_ignores WHERE media_id = ?').run(mediaId);
}

/** A threshold from settings, or the default when it isn't one of the offered values. */
export const validThreshold = (v: unknown): number => (typeof v === 'number' && THRESHOLDS.includes(v) ? v : DEFAULT_THRESHOLD);
