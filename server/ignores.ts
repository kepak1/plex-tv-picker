import { addColumn, db, now, transaction } from './db.js';
import { normalize } from './text.js';
import { activeRules, type CompiledRule } from './rules.js';
import type { Item } from './catalog.js';

// Hidden lists are expected to grow into the thousands, so they are indexed, paged and searched
// in SQL, and the per-user lookup sets used by every catalog request are cached in memory.

if (addColumn('ignores', 'title_norm', "TEXT NOT NULL DEFAULT ''")) {
  const rows = db.prepare('SELECT id, title FROM ignores').all() as { id: number; title: string }[];
  const update = db.prepare('UPDATE ignores SET title_norm = ? WHERE id = ?');
  transaction(() => rows.forEach((r) => update.run(normalize(r.title), r.id)));
}
// The guide sometimes gives a title a new guid (e.g. a show re-matched in Plex), so hidden titles
// also match by TMDB id and by type + normalised title (+ year for movies; show years in the guide
// are often the episode's year).
const addedType = addColumn('ignores', 'item_type', 'TEXT');
addColumn('ignores', 'item_year', 'INTEGER');
addColumn('ignores', 'tmdb_id', 'INTEGER');
if (addedType) {
  db.exec(`
    UPDATE ignores SET (item_type, item_year, tmdb_id) =
      (SELECT type, year, tmdb_id FROM items WHERE items.guid = ignores.item_guid)
    WHERE item_guid IN (SELECT guid FROM items);
    UPDATE ignores SET item_type = 'show' WHERE item_type IS NULL AND item_guid LIKE 'plex://show/%';
    UPDATE ignores SET item_type = 'movie' WHERE item_type IS NULL AND item_guid LIKE 'plex://movie/%';
  `);
}
db.exec(`
CREATE INDEX IF NOT EXISTS ignores_user_created ON ignores(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ignores_user_title ON ignores(user_id, title_norm);
`);

export type IgnoreScope = 'title' | 'episode';

export interface UserIgnores {
  /** Hidden titles: guids, `tmdb:<type>:<id>` and `title:<type>:<norm>[:<year>]` keys. */
  titles: Set<string>;
  episodes: Set<string>;
  /** Enabled auto-hide rules. */
  rules: CompiledRule[];
}

function titleKeys(t: { type: string | null; titleNorm: string; year: number | null; tmdbId: number | null }): string[] {
  const keys: string[] = [];
  if (!t.type) return keys;
  if (t.tmdbId != null) keys.push(`tmdb:${t.type}:${t.tmdbId}`);
  if (t.type === 'show') keys.push(`title:show:${t.titleNorm}`);
  else if (t.year != null) keys.push(`title:movie:${t.titleNorm}:${t.year}`);
  return keys;
}

const itemKeys = (item: Item) => [item.guid, ...titleKeys(item)];

/** Whether the user hid this title by hand, under its current guid or an earlier one. */
export function titleIgnored(item: Item, ign: UserIgnores): boolean {
  return itemKeys(item).some((k) => ign.titles.has(k));
}

const cache = new Map<number, Omit<UserIgnores, 'rules'>>();

/** Everything the user has hidden: titles and episodes by hand, plus auto-hide rules. */
export function userIgnores(userId: number): UserIgnores {
  let sets = cache.get(userId);
  if (!sets) {
    const rows = db
      .prepare('SELECT scope, item_guid, episode_guid, title_norm, item_type, item_year, tmdb_id FROM ignores WHERE user_id = ?')
      .all(userId) as {
      scope: IgnoreScope;
      item_guid: string;
      episode_guid: string;
      title_norm: string;
      item_type: string | null;
      item_year: number | null;
      tmdb_id: number | null;
    }[];
    sets = { titles: new Set(), episodes: new Set() };
    for (const r of rows) {
      if (r.scope === 'title') {
        sets.titles.add(r.item_guid);
        for (const k of titleKeys({ type: r.item_type, titleNorm: r.title_norm, year: r.item_year, tmdbId: r.tmdb_id })) sets.titles.add(k);
      } else sets.episodes.add(r.episode_guid);
    }
    cache.set(userId, sets);
  }
  return { ...sets, rules: activeRules(userId) };
}

export function addIgnore(
  userId: number,
  entry: { scope: IgnoreScope; item: Item; episodeGuid?: string; episodeLabel: string | null },
): void {
  const { item } = entry;
  db.prepare(
    `INSERT OR IGNORE INTO ignores
       (user_id, scope, item_guid, episode_guid, title, title_norm, episode_label, thumb, item_type, item_year, tmdb_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    userId, entry.scope, item.guid, entry.scope === 'episode' ? (entry.episodeGuid ?? '') : '', item.title,
    normalize(item.title), entry.episodeLabel, item.thumb, item.type, item.year, item.tmdbId, now(),
  );
  cache.delete(userId);
}

/** Removes one entry by id, an episode, or a title (with entries matching it under an earlier guid). */
export function removeIgnore(userId: number, by: { id?: number; itemGuid?: string; episodeGuid?: string; item?: Item }): void {
  if (by.id) db.prepare('DELETE FROM ignores WHERE id = ? AND user_id = ?').run(by.id, userId);
  else if (by.episodeGuid) db.prepare("DELETE FROM ignores WHERE user_id = ? AND scope = 'episode' AND episode_guid = ?").run(userId, by.episodeGuid);
  else if (by.itemGuid) {
    db.prepare("DELETE FROM ignores WHERE user_id = ? AND scope = 'title' AND item_guid = ?").run(userId, by.itemGuid);
    const item = by.item;
    if (item) {
      if (item.tmdbId != null) {
        db.prepare("DELETE FROM ignores WHERE user_id = ? AND scope = 'title' AND item_type = ? AND tmdb_id = ?").run(userId, item.type, item.tmdbId);
      }
      if (item.type === 'show') {
        db.prepare("DELETE FROM ignores WHERE user_id = ? AND scope = 'title' AND item_type = 'show' AND title_norm = ?").run(userId, item.titleNorm);
      } else if (item.year != null) {
        db.prepare("DELETE FROM ignores WHERE user_id = ? AND scope = 'title' AND item_type = 'movie' AND title_norm = ? AND item_year = ?").run(
          userId, item.titleNorm, item.year,
        );
      }
    }
  }
  cache.delete(userId);
}

/** Removes every hidden entry of the user (optionally only titles or only episodes); returns how many. */
export function clearIgnores(userId: number, scope?: IgnoreScope): number {
  const res = scope
    ? db.prepare('DELETE FROM ignores WHERE user_id = ? AND scope = ?').run(userId, scope)
    : db.prepare('DELETE FROM ignores WHERE user_id = ?').run(userId);
  cache.delete(userId);
  return Number(res.changes);
}

export interface IgnoreRow {
  id: number;
  scope: IgnoreScope;
  item_guid: string;
  episode_guid: string;
  title: string;
  episode_label: string | null;
  thumb: string | null;
  created_at: number;
}

export function listIgnores(
  userId: number,
  opts: { q?: string; scope?: IgnoreScope; offset?: number; limit?: number },
): { total: number; counts: Record<IgnoreScope, number>; items: IgnoreRow[] } {
  const where = ['user_id = ?'];
  const params: (string | number)[] = [userId];
  if (opts.scope) {
    where.push('scope = ?');
    params.push(opts.scope);
  }
  const q = opts.q ? normalize(opts.q) : '';
  if (q) {
    // Word-prefix match, same as the guide search; normalised text has no LIKE wildcards.
    where.push("(' ' || title_norm) LIKE ?");
    params.push(`% ${q}%`);
  }
  const clause = where.join(' AND ');
  const total = (db.prepare(`SELECT count(*) AS n FROM ignores WHERE ${clause}`).get(...params) as { n: number }).n;
  const items = db
    .prepare(
      `SELECT id, scope, item_guid, episode_guid, title, episode_label, thumb, created_at FROM ignores
       WHERE ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, Math.min(opts.limit ?? 100, 500), opts.offset ?? 0) as unknown as IgnoreRow[];
  const counts = { title: 0, episode: 0 };
  for (const row of db.prepare('SELECT scope, count(*) AS n FROM ignores WHERE user_id = ? GROUP BY scope').all(userId) as {
    scope: IgnoreScope;
    n: number;
  }[]) {
    counts[row.scope] = row.n;
  }
  return { total, counts, items };
}
