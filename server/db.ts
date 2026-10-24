import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(join(config.dataDir, 'plex-tv-picker.sqlite'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Every movie/show ever seen in the guide. first_seen_at drives the daily "new in guide" email.
CREATE TABLE IF NOT EXISTS items (
  guid TEXT PRIMARY KEY,
  type TEXT NOT NULL,            -- 'movie' | 'show'
  title TEXT NOT NULL,
  title_norm TEXT NOT NULL,
  year INTEGER,
  summary TEXT,
  thumb TEXT,
  art TEXT,
  genres TEXT NOT NULL DEFAULT '[]',
  content_rating TEXT,
  epg_key TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  tmdb_rating REAL,
  tmdb_checked_at INTEGER
);

-- Current guide airings; rebuilt on every sync.
CREATE TABLE IF NOT EXISTS airings (
  id INTEGER PRIMARY KEY,
  item_guid TEXT NOT NULL,
  episode_guid TEXT,
  episode_title TEXT,
  season INTEGER,
  episode INTEGER,
  episode_summary TEXT,
  episode_thumb TEXT,
  epg_key TEXT NOT NULL,
  grid_key TEXT NOT NULL,
  channel_title TEXT,
  channel_vcn TEXT,
  channel_thumb TEXT,
  begins_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  premiere INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS airings_item ON airings(item_guid);

-- Snapshot of the Plex library, used for "already have it".
CREATE TABLE IF NOT EXISTS library_movies (guid TEXT, title_norm TEXT, year INTEGER);
CREATE TABLE IF NOT EXISTS library_episodes (guid TEXT, show_guid TEXT, show_norm TEXT, season INTEGER, episode INTEGER, title_norm TEXT);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,        -- plex.tv account id
  username TEXT NOT NULL,
  email TEXT,
  thumb TEXT,
  language TEXT,
  notify_email TEXT,
  alerts_enabled INTEGER NOT NULL DEFAULT 1,
  digest_enabled INTEGER NOT NULL DEFAULT 0,
  last_digest_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ignores (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,           -- 'title' | 'episode'
  item_guid TEXT NOT NULL,
  episode_guid TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  episode_label TEXT,
  thumb TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, scope, item_guid, episode_guid)
);

CREATE TABLE IF NOT EXISTS wishlist (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,            -- 'title' (picked from suggestions) | 'phrase'
  type TEXT,                     -- 'movie' | 'show' | null (any)
  guid TEXT,
  title TEXT NOT NULL,
  title_norm TEXT NOT NULL,
  year INTEGER,
  thumb TEXT,
  created_at INTEGER NOT NULL
);

-- Alert keys already emailed, so every airing/episode is reported once.
CREATE TABLE IF NOT EXISTS notified (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`);

export function getMeta(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setMeta(key: string, value: string): void {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const now = () => Math.floor(Date.now() / 1000);
