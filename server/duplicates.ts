import { db, getMeta, now, setMeta } from './db.js';
import { copiesOf, showKey, type Library, type LibraryCopy, type LibraryMetadata } from './library.js';
import { normalize } from './text.js';

// Duplicate recordings in the Plex library: the same episode or movie stored more than once, either
// as several versions of one item (Plex merged the files) or as separate items. RecPick only lists
// them with a link to Plex Web; removing copies is done in Plex (the app never writes to Plex).

// A copy this much shorter than the longest one in its group was probably cut short.
const SHORT_SHARE = 0.8;

// Groups someone marked as "not a duplicate". The signature is the set of copies at that time,
// so the group comes back when a copy is added or removed.
db.exec(`
CREATE TABLE IF NOT EXISTS duplicate_ignores (
  group_key TEXT PRIMARY KEY,
  signature TEXT NOT NULL,
  user_id INTEGER,
  created_at INTEGER NOT NULL
);
`);

export interface DuplicateCopy extends LibraryCopy {
  short: boolean;
}

export interface DuplicateGroup {
  key: string;
  kind: 'episode' | 'movie';
  /** Show title for episodes. */
  show: string | null;
  title: string;
  season: number | null;
  episode: number | null;
  airDate: string | null;
  year: number | null;
  copies: DuplicateCopy[];
  ignored: boolean;
}

interface Scan {
  scannedAt: number;
  groups: Omit<DuplicateGroup, 'ignored'>[];
}

let scan: Scan | null = null;

function stored(): Scan | null {
  if (!scan) {
    const raw = getMeta('duplicates');
    scan = raw ? (JSON.parse(raw) as Scan) : null;
  }
  return scan;
}

const signature = (g: Omit<DuplicateGroup, 'ignored'>) =>
  g.copies
    .map((c) => c.mediaId)
    .sort((a, b) => a - b)
    .join(',');

function ignoredSignatures(): Map<string, string> {
  const rows = db.prepare('SELECT group_key, signature FROM duplicate_ignores').all() as { group_key: string; signature: string }[];
  return new Map(rows.map((r) => [r.group_key, r.signature]));
}

function episodeKey(m: LibraryMetadata): string | null {
  const show = showKey(m);
  if (m.index != null) return `e|${show}|${m.parentIndex ?? ''}|${m.index}`;
  // Daily shows often have no numbers: match by episode title and air date. Both are needed when
  // both are known, as such titles are often generic (the show's name, "Episode 01-11").
  const title = normalize(m.title ?? '');
  const date = m.originallyAvailableAt ?? '';
  return title || date ? `e|${show}|t:${title}|d:${date}` : null;
}

const movieKey = (m: LibraryMetadata) => `m|${normalize(m.title)}|${m.year ?? ''}`;

/** Groups library items by episode (or movie) and keeps the groups with more than one copy. */
export function findDuplicates({ movies, episodes }: Library): Scan {
  const groups = new Map<string, Omit<DuplicateGroup, 'ignored'>>();
  const add = (key: string, m: LibraryMetadata, kind: 'episode' | 'movie') => {
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        kind,
        show: kind === 'episode' ? (m.grandparentTitle ?? null) : null,
        title: m.title,
        season: kind === 'episode' ? (m.parentIndex ?? null) : null,
        episode: kind === 'episode' ? (m.index ?? null) : null,
        airDate: m.originallyAvailableAt ?? null,
        year: m.year ?? null,
        copies: [],
      };
      groups.set(key, g);
    }
    g.copies.push(...copiesOf(m).map((c) => ({ ...c, short: false })));
  };
  for (const m of episodes) {
    const key = episodeKey(m);
    if (key) add(key, m, 'episode');
  }
  for (const m of movies) add(movieKey(m), m, 'movie');

  const out = [...groups.values()].filter((g) => g.copies.length > 1);
  for (const g of out) {
    const longest = Math.max(0, ...g.copies.map((c) => c.duration ?? 0));
    for (const c of g.copies) c.short = longest > 0 && (c.duration ?? 0) < longest * SHORT_SHARE;
    g.copies.sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0));
  }
  out.sort(
    (a, b) =>
      (a.show ?? a.title).localeCompare(b.show ?? b.title) ||
      (a.season ?? 0) - (b.season ?? 0) ||
      (a.episode ?? 0) - (b.episode ?? 0) ||
      a.title.localeCompare(b.title),
  );
  return { scannedAt: now(), groups: out };
}

/** Scans library data the sync (or the tools' refresh) has fetched. */
export function updateDuplicates(lib: Library): void {
  scan = findDuplicates(lib);
  setMeta('duplicates', JSON.stringify(scan));
  console.log(`[duplicates] ${scan.groups.length} groups`);
}

/** Every group from the last scan, with ignored ones flagged. */
export function duplicateGroups(): { scannedAt: number | null; groups: DuplicateGroup[] } {
  const s = stored();
  const ignored = ignoredSignatures();
  return {
    scannedAt: s?.scannedAt ?? null,
    groups: (s?.groups ?? []).map((g) => ({ ...g, ignored: ignored.get(g.key) === signature(g) })),
  };
}

/** Groups not marked as "not a duplicate", for the menu counter. */
export function duplicateCount(): number {
  return duplicateGroups().groups.filter((g) => !g.ignored).length;
}

export function ignoreDuplicate(key: string, userId: number): boolean {
  const g = stored()?.groups.find((x) => x.key === key);
  if (!g) return false;
  db.prepare(
    `INSERT INTO duplicate_ignores (group_key, signature, user_id, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(group_key) DO UPDATE SET signature = excluded.signature, user_id = excluded.user_id, created_at = excluded.created_at`,
  ).run(key, signature(g), userId, now());
  return true;
}

export function unignoreDuplicate(key: string): void {
  db.prepare('DELETE FROM duplicate_ignores WHERE group_key = ?').run(key);
}
