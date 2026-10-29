import { db, getMeta, now } from './db.js';
import { matchesWords, normalize } from './text.js';
import { recordingState, type RecordingState } from './plex.js';
import { titleIgnored, userIgnores, type UserIgnores } from './ignores.js';
import { airingRule, channelRules, titleRule } from './rules.js';

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
  tmdbId: number | null;
  /** ISO country codes from TMDB; empty when TMDB doesn't know, null before the lookup. */
  countries: string[] | null;
  tmdbGenres: number[];
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
let countries: string[] = [];
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
      tmdbId: row.tmdb_id,
      countries: row.countries ? JSON.parse(row.countries) : null,
      tmdbGenres: row.tmdb_genres ? JSON.parse(row.tmdb_genres) : [],
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
  countries = [...new Set([...next.values()].flatMap((i) => i.countries ?? []))].sort();

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

export function getCountries(): string[] {
  return countries;
}

/** Filter value for titles whose country TMDB doesn't know. */
export const UNKNOWN_COUNTRY = 'none';

export function matchesCountries(item: Item, wanted: Set<string>): boolean {
  if (!item.countries) return false;
  if (item.countries.length === 0) return wanted.has(UNKNOWN_COUNTRY);
  return item.countries.some((c) => wanted.has(c));
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

export type SortKey = 'start' | 'title' | 'year' | 'rating' | 'added';

/** Direction each sort uses unless the user flips it: soonest, A-Z, newest, best, newest in guide. */
export const NATURAL_DIR: Record<SortKey, 'asc' | 'desc'> = { start: 'asc', title: 'asc', year: 'desc', rating: 'desc', added: 'desc' };

export interface Query {
  type?: 'movie' | 'show';
  q?: string;
  genres?: string[];
  countries?: string[];
  channels?: string[];
  from?: number;
  to?: number;
  yearMin?: number;
  yearMax?: number;
  ratingMin?: number;
  hideScheduled?: boolean;
  hideLibrary?: boolean;
  showIgnored?: boolean;
  /** Only these titles (the user's recommendations). */
  only?: Set<string>;
  sort?: SortKey;
  /** Defaults to the sort's natural direction (see NATURAL_DIR). */
  dir?: 'asc' | 'desc';
  offset?: number;
  limit?: number;
}

export interface AiringView extends Airing {
  scheduled: boolean;
  inLibrary: boolean;
  ignored: boolean;
  /** Name of the auto-hide rule that hides this airing. */
  hiddenBy: string | null;
}

export interface ItemView extends Omit<Item, 'airings' | 'titleNorm' | 'tmdbId' | 'tmdbGenres'> {
  subscribed: boolean;
  ignored: boolean;
  /** Name of the auto-hide rule that hides the whole title. */
  hiddenBy: string | null;
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
  const byChannel = channelRules(item, ign.rules);
  for (const a of item.airings) {
    if (a.endsAt < ts) continue;
    if (opts.from && a.endsAt < opts.from) continue;
    if (opts.to && a.beginsAt > opts.to) continue;
    if (opts.channels && !opts.channels.has(a.gridKey)) continue;
    const ignored = !!a.episodeGuid && ign.episodes.has(a.episodeGuid);
    if (ignored && !opts.showIgnored) continue;
    const hiddenBy = byChannel.length ? (airingRule(a, byChannel)?.name ?? null) : null;
    if (hiddenBy && !opts.showIgnored) continue;
    const scheduled = isScheduled(item, a, rec);
    if (scheduled && opts.hideScheduled) continue;
    const lib = inLibrary(item, a);
    if (lib && opts.hideLibrary) continue;
    out.push({ ...a, scheduled, inLibrary: lib, ignored, hiddenBy });
  }
  return out;
}

/** Hidden by hand or by a rule that covers the whole title (channel rules hide single airings). */
export function isHidden(item: Item, ign: UserIgnores): boolean {
  return titleIgnored(item, ign) || titleRule(item, ign.rules) !== undefined;
}

export function toView(item: Item, airings: AiringView[], ign: UserIgnores, rec: RecordingState): ItemView {
  const { titleNorm: _n, airings: _a, tmdbId: _i, tmdbGenres: _g, ...rest } = item;
  return {
    ...rest,
    subscribed: rec.subscribed.has(item.guid),
    ignored: titleIgnored(item, ign),
    hiddenBy: titleRule(item, ign.rules)?.name ?? null,
    isNew: item.firstSeenAt > firstSyncAt && item.firstSeenAt > now() - 2 * 86400,
    airings,
  };
}

export async function queryCatalog(userId: number, q: Query): Promise<{ total: number; items: ItemView[] }> {
  const rec = await getRecordingState();
  const ign = userIgnores(userId);
  const search = q.q ? normalize(q.q) : '';
  const genreSet = q.genres?.length ? new Set(q.genres) : null;
  const countrySet = q.countries?.length ? new Set(q.countries) : null;
  const channelSet = q.channels?.length ? new Set(q.channels) : undefined;

  const matched: { view: ItemView; first: number }[] = [];
  for (const item of items.values()) {
    if (q.type && item.type !== q.type) continue;
    if (q.only && !q.only.has(item.guid)) continue;
    if (!q.showIgnored && isHidden(item, ign)) continue;
    if (q.hideScheduled && rec.subscribed.has(item.guid)) continue;
    if (search && !matchesWords(item.titleNorm, search)) continue;
    if (genreSet && !item.genres.some((g) => genreSet.has(g))) continue;
    if (countrySet && !matchesCountries(item, countrySet)) continue;
    if (q.yearMin && (item.year ?? 0) < q.yearMin) continue;
    if (q.yearMax && (item.year ?? 9999) > q.yearMax) continue;
    if (q.ratingMin && (item.rating ?? 0) < q.ratingMin) continue;
    const airings = visibleAirings(item, ign, rec, { ...q, channels: channelSet });
    if (airings.length === 0) continue;
    matched.push({ view: toView(item, airings, ign, rec), first: airings[0].beginsAt });
  }

  // Each sorter is ascending; ties always fall back to the title A-Z, whatever the direction.
  type Entry = (typeof matched)[number];
  const byTitle = (a: Entry, b: Entry) => a.view.title.localeCompare(b.view.title, 'pl');
  const sorters: Record<SortKey, (a: Entry, b: Entry) => number> = {
    start: (a, b) => a.first - b.first,
    title: byTitle,
    year: (a, b) => (a.view.year ?? 0) - (b.view.year ?? 0),
    rating: (a, b) => (a.view.rating ?? 0) - (b.view.rating ?? 0),
    added: (a, b) => a.view.firstSeenAt - b.view.firstSeenAt,
  };
  const key: SortKey = q.sort && q.sort in sorters ? q.sort : 'start';
  const sign = (q.dir ?? NATURAL_DIR[key]) === 'desc' ? -1 : 1;
  const primary = sorters[key];
  // Titles without a year or rating go last in either direction.
  const missing = (e: Entry) => (key === 'year' ? e.view.year : key === 'rating' ? e.view.rating : 0) == null;
  matched.sort((a, b) => Number(missing(a)) - Number(missing(b)) || sign * primary(a, b) || byTitle(a, b));

  const offset = q.offset ?? 0;
  const limit = Math.min(q.limit ?? 48, 200);
  return { total: matched.length, items: matched.slice(offset, offset + limit).map((m) => m.view) };
}
