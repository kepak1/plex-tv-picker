import { addColumn, db, now, transaction } from './db.js';
import { normalize } from './text.js';
import { activeRules, type CompiledRule } from './rules.js';

// Hidden lists are expected to grow into the thousands, so they are indexed, paged and searched
// in SQL, and the per-user lookup sets used by every catalog request are cached in memory.

if (addColumn('ignores', 'title_norm', "TEXT NOT NULL DEFAULT ''")) {
  const rows = db.prepare('SELECT id, title FROM ignores').all() as { id: number; title: string }[];
  const update = db.prepare('UPDATE ignores SET title_norm = ? WHERE id = ?');
  transaction(() => rows.forEach((r) => update.run(normalize(r.title), r.id)));
}
db.exec(`
CREATE INDEX IF NOT EXISTS ignores_user_created ON ignores(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ignores_user_title ON ignores(user_id, title_norm);
`);

export type IgnoreScope = 'title' | 'episode';

export interface UserIgnores {
  titles: Set<string>;
  episodes: Set<string>;
  /** Enabled auto-hide rules. */
  rules: CompiledRule[];
}

const cache = new Map<number, Omit<UserIgnores, 'rules'>>();

/** Everything the user has hidden: titles and episodes by hand, plus auto-hide rules. */
export function userIgnores(userId: number): UserIgnores {
  let sets = cache.get(userId);
  if (!sets) {
    const rows = db.prepare('SELECT scope, item_guid, episode_guid FROM ignores WHERE user_id = ?').all(userId) as {
      scope: IgnoreScope;
      item_guid: string;
      episode_guid: string;
    }[];
    sets = { titles: new Set(), episodes: new Set() };
    for (const r of rows) {
      if (r.scope === 'title') sets.titles.add(r.item_guid);
      else sets.episodes.add(r.episode_guid);
    }
    cache.set(userId, sets);
  }
  return { ...sets, rules: activeRules(userId) };
}

export function addIgnore(
  userId: number,
  entry: { scope: IgnoreScope; itemGuid: string; episodeGuid?: string; title: string; episodeLabel: string | null; thumb: string | null },
): void {
  db.prepare(
    `INSERT OR IGNORE INTO ignores (user_id, scope, item_guid, episode_guid, title, title_norm, episode_label, thumb, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    userId, entry.scope, entry.itemGuid, entry.scope === 'episode' ? (entry.episodeGuid ?? '') : '', entry.title,
    normalize(entry.title), entry.episodeLabel, entry.thumb, now(),
  );
  cache.delete(userId);
}

export function removeIgnore(userId: number, by: { id?: number; itemGuid?: string; episodeGuid?: string }): void {
  if (by.id) db.prepare('DELETE FROM ignores WHERE id = ? AND user_id = ?').run(by.id, userId);
  else if (by.episodeGuid) db.prepare("DELETE FROM ignores WHERE user_id = ? AND scope = 'episode' AND episode_guid = ?").run(userId, by.episodeGuid);
  else if (by.itemGuid) db.prepare("DELETE FROM ignores WHERE user_id = ? AND scope = 'title' AND item_guid = ?").run(userId, by.itemGuid);
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
