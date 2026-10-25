import { db, now } from './db.js';
import { tmdbEnabled } from './tmdb.js';
import type { Airing, Item } from './catalog.js';

// Auto-hide rules: each rule hides what matches all of its conditions. A rule with channels hides
// only the airings on those channels (a title disappears once nothing else is left); a rule without
// channels hides whole titles. Rules apply to the list, alerts, the daily email and recommendations.

db.exec(`
CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  conditions TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rules_user ON rules(user_id);
`);

export interface RuleConditions {
  type?: 'movie' | 'show';
  genres?: string[];
  channels?: string[];
  countries?: string[];
  yearMin?: number;
  yearMax?: number;
  ratingBelow?: number;
}

export interface Rule {
  id: number;
  name: string;
  enabled: boolean;
  conditions: RuleConditions;
  createdAt: number;
}

export interface CompiledRule {
  id: number;
  name: string;
  /** All conditions except channels. */
  matchesItem: (item: Item) => boolean;
  /** Grid keys; null when the rule hides whole titles. */
  channels: Set<string> | null;
}

const UNKNOWN_COUNTRY = 'none';

const strings = (v: unknown) =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x !== ''))].slice(0, 500) : [];
const number = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Keeps only known, non-empty conditions; returns null when nothing is left to match on. */
export function cleanConditions(raw: unknown): RuleConditions | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const c: RuleConditions = {};
  if (r.type === 'movie' || r.type === 'show') c.type = r.type;
  for (const key of ['genres', 'channels', 'countries'] as const) {
    const list = strings(r[key]);
    if (list.length) c[key] = list;
  }
  for (const key of ['yearMin', 'yearMax', 'ratingBelow'] as const) {
    const n = number(r[key]);
    if (n !== undefined) c[key] = n;
  }
  return Object.keys(c).length ? c : null;
}

function compile(rule: Rule): CompiledRule {
  const c = rule.conditions;
  const genres = c.genres ? new Set(c.genres) : null;
  const countries = c.countries ? new Set(c.countries) : null;
  // Without TMDB there is no country or rating, so such rules never match instead of guessing.
  const needsTmdb = countries !== null || c.ratingBelow !== undefined;
  const matchesItem = (item: Item): boolean => {
    if (needsTmdb && !tmdbEnabled()) return false;
    if (c.type && item.type !== c.type) return false;
    if (genres && !item.genres.some((g) => genres.has(g))) return false;
    // Missing data never matches: a rule should not hide a title only because TMDB doesn't know it.
    if (c.yearMin !== undefined && (item.year == null || item.year < c.yearMin)) return false;
    if (c.yearMax !== undefined && (item.year == null || item.year > c.yearMax)) return false;
    if (c.ratingBelow !== undefined && (item.rating == null || item.rating >= c.ratingBelow)) return false;
    if (countries) {
      if (!item.countries) return false;
      // "Unknown" is matched only when picked explicitly.
      if (item.countries.length === 0 ? !countries.has(UNKNOWN_COUNTRY) : !item.countries.some((x) => countries.has(x))) return false;
    }
    return true;
  };
  return { id: rule.id, name: rule.name, matchesItem, channels: c.channels ? new Set(c.channels) : null };
}

function toRule(row: Record<string, any>): Rule {
  return { id: row.id, name: row.name, enabled: row.enabled === 1, conditions: JSON.parse(row.conditions), createdAt: row.created_at };
}

export function listRules(userId: number): Rule[] {
  return (db.prepare('SELECT * FROM rules WHERE user_id = ? ORDER BY created_at, id').all(userId) as Record<string, any>[]).map(toRule);
}

const cache = new Map<number, CompiledRule[]>();

export function activeRules(userId: number): CompiledRule[] {
  let rules = cache.get(userId);
  if (!rules) {
    rules = listRules(userId)
      .filter((r) => r.enabled)
      .map(compile);
    cache.set(userId, rules);
  }
  return rules;
}

export function compileConditions(conditions: RuleConditions): CompiledRule {
  return compile({ id: 0, name: '', enabled: true, conditions, createdAt: 0 });
}

export function saveRule(userId: number, rule: { id?: number; name: string; enabled: boolean; conditions: RuleConditions }): number {
  let id = rule.id;
  if (id) {
    db.prepare('UPDATE rules SET name = ?, enabled = ?, conditions = ? WHERE id = ? AND user_id = ?').run(
      rule.name, Number(rule.enabled), JSON.stringify(rule.conditions), id, userId,
    );
  } else {
    const res = db
      .prepare('INSERT INTO rules (user_id, name, enabled, conditions, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(userId, rule.name, Number(rule.enabled), JSON.stringify(rule.conditions), now());
    id = Number(res.lastInsertRowid);
  }
  cache.delete(userId);
  return id;
}

export function deleteRule(userId: number, id: number): void {
  db.prepare('DELETE FROM rules WHERE id = ? AND user_id = ?').run(id, userId);
  cache.delete(userId);
}

/** The rule that hides the whole title, if any. */
export function titleRule(item: Item, rules: CompiledRule[]): CompiledRule | undefined {
  return rules.find((r) => !r.channels && r.matchesItem(item));
}

/** Channel rules matching the item, checked per airing with `airingRule`. */
export function channelRules(item: Item, rules: CompiledRule[]): CompiledRule[] {
  return rules.filter((r) => r.channels && r.matchesItem(item));
}

export function airingRule(airing: Airing, rules: CompiledRule[]): CompiledRule | undefined {
  return rules.find((r) => r.channels!.has(airing.gridKey));
}

/** How many guide titles a rule hides completely or in part (upcoming airings only). */
export function countMatches(rule: CompiledRule, items: Iterable<Item>): number {
  const ts = now();
  let n = 0;
  for (const item of items) {
    if (!rule.matchesItem(item)) continue;
    if (item.airings.some((a) => a.endsAt >= ts && (!rule.channels || rule.channels.has(a.gridKey)))) n++;
  }
  return n;
}
