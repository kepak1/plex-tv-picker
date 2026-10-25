import { db, now } from './db.js';
import { libraryMetadata, serverAccountId, watchHistory, type HistoryEntry } from './plex.js';
import { normalize } from './text.js';
import { tmdbEnabled, watchedDetails, watchedKey, type WatchedDetails, type WatchedTitle } from './tmdb.js';
import { allItems, inLibrary, type Item } from './catalog.js';

// Recommendations from each user's Plex watch history. Two signals are combined:
//  - "similar": TMDB's recommendations for every watched title, matched to guide titles by TMDB id;
//  - "profile": how much the user watches each genre and country, with rarer ones counting more.
// Recent viewing counts more (the weight halves every year) and a show counts more when several of
// its episodes were watched. Without TMDB only the genre profile is used.

const HALF_LIFE = 365 * 86400;
const RECOMMENDED = 150;
const MOVIE_CAP = 1.5;
const SHOW_CAP = 3;
const SIMILAR_SHARE = 0.65;

export interface Recommendation {
  score: number;
  /** A watched title TMDB links this one to. */
  because: string | null;
}

interface UserRecommendations {
  computedAt: number;
  /** Distinct titles in the user's watch history. */
  watched: number;
  items: Map<string, Recommendation>;
}

const byUser = new Map<number, UserRecommendations>();

export function recommendationsFor(userId: number): UserRecommendations | undefined {
  return byUser.get(userId);
}

interface Watched extends WatchedTitle {
  weight: number;
  libKey: string | null;
}

/** Folds history entries into one weighted entry per movie or show. */
function aggregate(entries: HistoryEntry[]): Watched[] {
  const ts = now();
  const out = new Map<string, Watched>();
  for (const e of entries) {
    const show = e.type === 'episode';
    if (!show && e.type !== 'movie') continue;
    const title = show ? e.grandparentTitle : e.title;
    if (!title) continue;
    const type = show ? 'show' : 'movie';
    const titleNorm = normalize(title);
    const key = watchedKey(type, titleNorm);
    const libKey = show ? (e.grandparentKey?.split('/').pop() ?? null) : (e.ratingKey ?? null);
    const w = out.get(key) ?? { type, title, titleNorm, year: null, tmdbId: null, weight: 0, libKey };
    w.weight += Math.pow(0.5, Math.max(0, ts - e.viewedAt) / HALF_LIFE);
    w.libKey ??= libKey;
    out.set(key, w);
  }
  for (const w of out.values()) w.weight = Math.min(w.weight, w.type === 'show' ? SHOW_CAP : MOVIE_CAP);
  return [...out.values()];
}

/** Genre and country features; "g:" Plex genre names, "t:" TMDB genre ids, "c:" country codes. */
function itemFeatures(item: Item): string[] {
  return [...item.genres.map((g) => `g:${g}`), ...item.tmdbGenres.map((g) => `t:${g}`), ...(item.countries ?? []).map((c) => `c:${c}`)];
}

const featureWeight = (f: string) => (f.startsWith('c:') ? 0.5 : 1);

/** Recomputes recommendations for every user; called after each sync. */
export async function computeRecommendations(): Promise<void> {
  const users = db.prepare('SELECT id, username, email FROM users').all() as { id: number; username: string; email: string | null }[];
  if (users.length === 0) return;
  const started = Date.now();
  const history = await watchHistory();
  const items = [...allItems()];

  // Genres of everything ever seen in the guide, for watched recordings no longer in the library.
  const guideGenres = new Map<string, string[]>();
  for (const r of db.prepare('SELECT type, title_norm, genres FROM items').all() as { type: string; title_norm: string; genres: string }[]) {
    guideGenres.set(watchedKey(r.type, r.title_norm), JSON.parse(r.genres));
  }

  // How common each feature is in the guide: rare ones (e.g. "Western") say more than "Drama".
  const df = new Map<string, number>();
  for (const item of items) for (const f of new Set(itemFeatures(item))) df.set(f, (df.get(f) ?? 0) + 1);
  const idf = (f: string) => Math.log(1 + items.length / (df.get(f) ?? 1));

  for (const user of users) {
    const accountId = await serverAccountId(user);
    const watched = aggregate(history.filter((e) => e.accountID === accountId));
    if (watched.length === 0) {
      byUser.set(user.id, { computedAt: now(), watched: 0, items: new Map() });
      continue;
    }

    const meta = await libraryMetadata([...new Set(watched.map((w) => w.libKey).filter((k): k is string => !!k))]);
    for (const w of watched) w.tmdbId = (w.libKey && meta.get(w.libKey)?.tmdbId) || null;
    const tmdb: Map<string, WatchedDetails> = tmdbEnabled() ? await watchedDetails(watched) : new Map();

    // Profile: share of the (weighted) history that has each feature.
    const affinity = new Map<string, number>();
    let total = 0;
    const watchedIds = new Set<string>();
    const watchedKeys = new Set<string>();
    // Similar: TMDB id -> summed weight of the watched titles recommending it, and the strongest one.
    const similar = new Map<string, { score: number; because: string; best: number }>();
    for (const w of watched) {
      const key = watchedKey(w.type, w.titleNorm);
      const d = tmdb.get(key);
      watchedKeys.add(key);
      if (d?.tmdbId) watchedIds.add(`${w.type}|${d.tmdbId}`);
      const features = new Set([
        ...(meta.get(w.libKey ?? '')?.genres ?? guideGenres.get(key) ?? []).map((g) => `g:${g}`),
        ...(d?.genres ?? []).map((g) => `t:${g}`),
        ...(d?.countries ?? []).map((c) => `c:${c}`),
      ]);
      for (const f of features) affinity.set(f, (affinity.get(f) ?? 0) + w.weight);
      total += w.weight;
      (d?.recommendations ?? []).forEach((id, rank) => {
        // TMDB lists the closest matches first.
        const contribution = w.weight * (1 - rank / 40);
        const k = `${w.type}|${id}`;
        const s = similar.get(k) ?? { score: 0, because: w.title, best: 0 };
        s.score += contribution;
        if (contribution > s.best) Object.assign(s, { because: w.title, best: contribution });
        similar.set(k, s);
      });
    }

    const ts = now();
    const candidates: { item: Item; similar: number; profile: number; because: string | null }[] = [];
    for (const item of items) {
      if (watchedKeys.has(watchedKey(item.type, item.titleNorm))) continue;
      if (item.tmdbId && watchedIds.has(`${item.type}|${item.tmdbId}`)) continue;
      // Movies you have, or shows whose every upcoming episode you have, are nothing to record.
      if (item.type === 'movie' ? inLibrary(item) : item.airings.every((a) => a.endsAt < ts || inLibrary(item, a))) continue;
      // Cosine similarity between the title's features and the profile, both weighted by rarity.
      let dot = 0;
      let norm = 0;
      for (const f of itemFeatures(item)) {
        const weight = idf(f) * featureWeight(f);
        dot += ((affinity.get(f) ?? 0) / total) * weight * weight;
        norm += weight * weight;
      }
      const s = item.tmdbId ? similar.get(`${item.type}|${item.tmdbId}`) : undefined;
      candidates.push({ item, similar: s?.score ?? 0, profile: norm ? dot / Math.sqrt(norm) : 0, because: s?.because ?? null });
    }

    const maxSimilar = Math.max(0, ...candidates.map((c) => c.similar));
    const maxProfile = Math.max(0, ...candidates.map((c) => c.profile));
    const scored = candidates
      .map((c) => {
        const sim = maxSimilar ? c.similar / maxSimilar : 0;
        const prof = maxProfile ? c.profile / maxProfile : 0;
        let score = maxSimilar ? SIMILAR_SHARE * sim + (1 - SIMILAR_SHARE) * prof : prof;
        // Well-rated titles get a small push (a 10 keeps its score, a 5 loses an eighth).
        if (c.item.rating != null) score *= 0.75 + 0.025 * c.item.rating;
        return { guid: c.item.guid, score, because: c.because };
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, RECOMMENDED);

    byUser.set(user.id, {
      computedAt: now(),
      watched: watched.length,
      items: new Map(scored.map((s) => [s.guid, { score: Math.round(s.score * 1000) / 1000, because: s.because }])),
    });
  }
  console.log(`[recommend] ${users.length} users, ${history.length} history entries, ${Math.round((Date.now() - started) / 1000)}s`);
}
