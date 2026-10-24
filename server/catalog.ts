import { db, getMeta, now } from './db.js';
import { matchesWords, normalize } from './text.js';
import { recordingState, type RecordingState } from './plex.js';
import { userIgnores, type UserIgnores } from './ignores.js';

export { userIgnores, type UserIgnores };

export interface Airing {
  id: number;
  episodeGuid: string | null;
  episodeTitle: string | null;
  season: number | null;
  episode: number | null;
  episodeSummary: string | null;
  episodeThumb: string | null;
  epgKey: string;
  gridKey: string;
  channelTitle: string | null;
  channelVcn: string | null;
  channelThumb: string | null;
  beginsAt: number;
  endsAt: number;
  premiere: boolean;
}

export interface Item {
  guid: string;
  type: 'movie' | 'show';
  title: string;
  titleNorm: string;
  year: number | null;
  summary: string | null;
  thumb: string | null;
  art: string | null;
  genres: string[];
  contentRating: string | null;
  epgKey: string;
  firstSeenAt: number;
  rating: number | null;
  airings: Airing[];
}

export interface Channel {
  gridKey: string;
  title: string;
  vcn: string | null;
  thumb: string | null;
}

let items = new Map<string, Item>();
let channels: Channel[] = [];
let genres: string[] = [];
let firstSyncAt = 0;
const library = {
  movieGuids: new Set<string>(),
  movieTitles: new Map<string, (number | null)[]>(),
  episodeGuids: new Set<string>(),
  episodeNumbers: new Set<string>(),
  episodeTitles: new Set<string>(),
};

export function reloadCatalog(): void {
  firstSyncAt = Number(getMeta('first_sync_at') ?? 0);
  const next = new Map<string, Item>();
  for (const row of db.prepare('SELECT * FROM items WHERE guid IN (SELECT DISTINCT item_guid FROM airings)').all() as Record<string, any>[]) {
    next.set(row.guid, {
      guid: row.guid,
      type: row.type,
      title: row.title,
      titleNorm: row.title_norm,
      year: row.year,
      summary: row.summary,
      thumb: row.thumb,
      art: row.art,
      genres: JSON.parse(row.genres),
      contentRating: row.content_rating,
      epgKey: row.epg_key,
      firstSeenAt: row.first_seen_at,
      rating: row.tmdb_rating,
      airings: [],
    });
  }
  const channelMap = new Map<string, Channel>();
  for (const a of db.prepare('SELECT * FROM airings ORDER BY begins_at').all() as Record<string, any>[]) {
    const item = next.get(a.item_guid);
    if (!item) continue;
    item.airings.push({
      id: a.id,
      episodeGuid: a.episode_guid,
      episodeTitle: a.episode_title,
      season: a.season,
      episode: a.episode,
      episodeSummary: a.episode_summary,
      episodeThumb: a.episode_thumb,
      epgKey: a.epg_key,
      gridKey: a.grid_key,
      channelTitle: a.channel_title,
      channelVcn: a.channel_vcn,
      channelThumb: a.channel_thumb,
      beginsAt: a.begins_at,
      endsAt: a.ends_at,
      premiere: a.premiere === 1,
    });
    if (!channelMap.has(a.grid_key)) {
      channelMap.set(a.grid_key, { gridKey: a.grid_key, title: channelName(a.channel_title), vcn: a.channel_vcn, thumb: a.channel_thumb });
    }
  }
  items = next;
  channels = [...channelMap.values()].sort((a, b) => Number(a.vcn ?? 9999) - Number(b.vcn ?? 9999));
  genres = [...new Set([...next.values()].flatMap((i) => i.genres))].sort((a, b) => a.localeCompare(b, 'pl'));

  library.movieGuids.clear();
  library.movieTitles.clear();
  for (const m of db.prepare('SELECT * FROM library_movies').all() as { guid: string; title_norm: string; year: number | null }[]) {
    library.movieGuids.add(m.guid);
    const years = library.movieTitles.get(m.title_norm) ?? [];
    years.push(m.year);
    library.movieTitles.set(m.title_norm, years);
  }
  library.episodeGuids.clear();
  library.episodeNumbers.clear();
  library.episodeTitles.clear();
  for (const e of db.prepare('SELECT * FROM library_episodes').all() as Record<string, any>[]) {
    library.episodeGuids.add(e.guid);
    if (e.season != null && e.episode != null) library.episodeNumbers.add(`${e.show_norm}|${e.season}|${e.episode}`);
    if (e.title_norm && e.title_norm !== e.show_norm) library.episodeTitles.add(`${e.show_norm}|${e.title_norm}`);
  }
}

/** "002 TV4HDPL (TV4 HD)" -> "TV4 HD" */
function channelName(raw: string | null): string {
  if (!raw) return '?';
  const m = raw.match(/\((.+)\)\s*$/);
  return m ? m[1] : raw.replace(/^\d+\s+/, '');
}

export function getChannels(): Channel[] {
  return channels;
}

export function getGenres(): string[] {
  return genres;
}

export function getItem(guid: string): Item | undefined {
  return items.get(guid);
}

export function allItems(): Iterable<Item> {
  return items.values();
}

export function inLibrary(item: Item, airing?: Airing): boolean {
  if (item.type === 'movie') {
    if (library.movieGuids.has(item.guid)) return true;
    const years = library.movieTitles.get(item.titleNorm);
    return !!years?.some((y) => y == null || item.year == null || Math.abs(y - item.year) <= 1);
  }
  if (!airing?.episodeGuid) return false;
  if (library.episodeGuids.has(airing.episodeGuid)) return true;
  if (airing.season != null && airing.episode != null && library.episodeNumbers.has(`${item.titleNorm}|${airing.season}|${airing.episode}`)) {
    return true;
  }
  const epNorm = airing.episodeTitle ? normalize(airing.episodeTitle) : '';
  return epNorm !== '' && epNorm !== item.titleNorm && library.episodeTitles.has(`${item.titleNorm}|${epNorm}`);
}

// Recording rules change while browsing, so they are fetched live with a short cache.
let recordingCache: { at: number; state: RecordingState } | null = null;
export async function getRecordingState(force = false): Promise<RecordingState> {
  if (force || !recordingCache || Date.now() - recordingCache.at > 60_000) {
    try {
      recordingCache = { at: Date.now(), state: await recordingState() };
    } catch (err) {
      console.warn('[plex] could not read recording schedule', err);
      if (!recordingCache) return { subscribed: new Set(), scheduled: new Set() };
    }
  }
  return recordingCache!.state;
}

export function isScheduled(item: Item, airing: Airing, rec: RecordingState): boolean {
  return rec.scheduled.has(`${airing.episodeGuid ?? item.guid}|${airing.beginsAt}`);
}

export interface Query {
  type?: 'movie' | 'show';
  q?: string;
  genres?: string[];
  channels?: string[];
  from?: number;
  to?: number;
  yearMin?: number;
  yearMax?: number;
  ratingMin?: number;
  hideScheduled?: boolean;
  hideLibrary?: boolean;
  showIgnored?: boolean;
  sort?: 'start' | 'title' | 'year' | 'rating' | 'added';
  offset?: number;
  limit?: number;
}

export interface AiringView extends Airing {
  scheduled: boolean;
  inLibrary: boolean;
  ignored: boolean;
}

export interface ItemView extends Omit<Item, 'airings' | 'titleNorm'> {
  subscribed: boolean;
  ignored: boolean;
  isNew: boolean;
  airings: AiringView[];
}

/** Airings of an item that the user still cares about, with status flags. */
export function visibleAirings(
  item: Item,
  ign: UserIgnores,
  rec: RecordingState,
  opts: { hideScheduled?: boolean; hideLibrary?: boolean; showIgnored?: boolean; from?: number; to?: number; channels?: Set<string> },
): AiringView[] {
  const ts = now();
  const out: AiringView[] = [];
  for (const a of item.airings) {
    if (a.endsAt < ts) continue;
    if (opts.from && a.endsAt < opts.from) continue;
    if (opts.to && a.beginsAt > opts.to) continue;
    if (opts.channels && !opts.channels.has(a.gridKey)) continue;
    const ignored = !!a.episodeGuid && ign.episodes.has(a.episodeGuid);
    if (ignored && !opts.showIgnored) continue;
    const scheduled = isScheduled(item, a, rec);
    if (scheduled && opts.hideScheduled) continue;
    const lib = inLibrary(item, a);
    if (lib && opts.hideLibrary) continue;
    out.push({ ...a, scheduled, inLibrary: lib, ignored });
  }
  return out;
}

export function toView(item: Item, airings: AiringView[], ign: UserIgnores, rec: RecordingState): ItemView {
  const { titleNorm: _n, airings: _a, ...rest } = item;
  return {
    ...rest,
    subscribed: rec.subscribed.has(item.guid),
    ignored: ign.titles.has(item.guid),
    isNew: item.firstSeenAt > firstSyncAt && item.firstSeenAt > now() - 2 * 86400,
    airings,
  };
}

export async function queryCatalog(userId: number, q: Query): Promise<{ total: number; items: ItemView[] }> {
  const rec = await getRecordingState();
  const ign = userIgnores(userId);
  const search = q.q ? normalize(q.q) : '';
  const genreSet = q.genres?.length ? new Set(q.genres) : null;
  const channelSet = q.channels?.length ? new Set(q.channels) : undefined;

  const matched: { view: ItemView; first: number }[] = [];
  for (const item of items.values()) {
    if (q.type && item.type !== q.type) continue;
    if (ign.titles.has(item.guid) && !q.showIgnored) continue;
    if (q.hideScheduled && rec.subscribed.has(item.guid)) continue;
    if (search && !matchesWords(item.titleNorm, search)) continue;
    if (genreSet && !item.genres.some((g) => genreSet.has(g))) continue;
    if (q.yearMin && (item.year ?? 0) < q.yearMin) continue;
    if (q.yearMax && (item.year ?? 9999) > q.yearMax) continue;
    if (q.ratingMin && (item.rating ?? 0) < q.ratingMin) continue;
    const airings = visibleAirings(item, ign, rec, { ...q, channels: channelSet });
    if (airings.length === 0) continue;
    matched.push({ view: toView(item, airings, ign, rec), first: airings[0].beginsAt });
  }

  const byTitle = (a: { view: ItemView }, b: { view: ItemView }) => a.view.title.localeCompare(b.view.title, 'pl');
  const sorters: Record<string, (a: (typeof matched)[number], b: (typeof matched)[number]) => number> = {
    start: (a, b) => a.first - b.first || byTitle(a, b),
    title: byTitle,
    year: (a, b) => (b.view.year ?? 0) - (a.view.year ?? 0) || byTitle(a, b),
    rating: (a, b) => (b.view.rating ?? -1) - (a.view.rating ?? -1) || byTitle(a, b),
    added: (a, b) => b.view.firstSeenAt - a.view.firstSeenAt || a.first - b.first,
  };
  matched.sort(sorters[q.sort ?? 'start'] ?? sorters.start);

  const offset = q.offset ?? 0;
  const limit = Math.min(q.limit ?? 48, 200);
  return { total: matched.length, items: matched.slice(offset, offset + limit).map((m) => m.view) };
}
