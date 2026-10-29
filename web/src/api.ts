export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: json !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText);
  return data as T;
}

export interface AppConfig {
  version: string;
  machineIdentifier: string | null;
  plexUrl: string;
  languages: { code: string; name: string; locale: string }[];
  defaultLanguage: string;
  tmdb: boolean;
  mail: boolean;
  timezone: string;
}

export interface Me {
  id: number;
  username: string;
  thumb: string | null;
  email: string | null;
  notifyEmail: string | null;
  language: string | null;
  alertsEnabled: boolean;
  digestEnabled: boolean;
  recsEnabled: boolean;
  shortThreshold: number;
  shortThresholds: number[];
}

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
  scheduled: boolean;
  inLibrary: boolean;
  ignored: boolean;
  hiddenBy: string | null;
}

export interface Item {
  guid: string;
  type: 'movie' | 'show';
  title: string;
  year: number | null;
  summary: string | null;
  thumb: string | null;
  art: string | null;
  genres: string[];
  contentRating: string | null;
  epgKey: string;
  firstSeenAt: number;
  rating: number | null;
  countries: string[] | null;
  subscribed: boolean;
  ignored: boolean;
  hiddenBy: string | null;
  isNew: boolean;
  airings: Airing[];
}

export interface Channel {
  gridKey: string;
  title: string;
  vcn: string | null;
  thumb: string | null;
}

export interface FilterOptions {
  genres: string[];
  channels: Channel[];
  countries: string[];
}

export interface Status {
  lastSyncAt: number | null;
  lastSyncError: string | null;
  syncing: boolean;
  /** Null until computed after the first refresh. */
  recommendations: { watched: number; count: number } | null;
}

export interface Wish {
  id: number;
  kind: 'title' | 'phrase';
  type: 'movie' | 'show' | null;
  guid: string | null;
  tmdb_id?: number | null;
  title: string;
  year: number | null;
  thumb: string | null;
  /** Movie recorded after the wish was added; the wish is removed at `removeAt`. */
  recorded: { at: number; ratingKey: string | null; removeAt: number } | null;
  matchCount: number;
  /** Guide titles that match and still air, soonest airing first. */
  matches: {
    guid: string;
    title: string;
    year: number | null;
    type: string;
    epgKey: string;
    next: { beginsAt: number; channelTitle: string | null; channelVcn: string | null; season: number | null; episode: number | null };
    /** Start of the first upcoming airing Plex will record. */
    scheduledAt: number | null;
    /** The title has a recording rule. */
    subscribed: boolean;
  }[];
}

export interface Suggestion {
  guid: string;
  type: 'movie' | 'show';
  title: string;
  year: number | null;
  thumb: string | null;
}

export interface Ignore {
  id: number;
  scope: 'title' | 'episode';
  item_guid: string;
  episode_guid: string;
  title: string;
  episode_label: string | null;
  thumb: string | null;
  created_at: number;
}

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
  matchCount: number;
}

export interface ToolsSummary {
  scanning: boolean;
  duplicates: { count: number };
  short: { count: number };
  series: { count: number };
}

export interface LibraryCopy {
  ratingKey: string;
  mediaId: number;
  title: string;
  duration: number | null;
  size: number | null;
  addedAt: number | null;
  resolution: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  container: string | null;
  file: string | null;
  /** Missing in scans made before 0.5.0. */
  files?: string[];
  parts: number;
}

export interface DuplicateCopy extends LibraryCopy {
  short: boolean;
  /** The following are missing in scans made before 0.6.0. */
  fileTitle?: string | null;
  part?: number | null;
  suggested?: { season: number; episode: number; title: string } | null;
}

export interface DuplicateGroup {
  key: string;
  kind: 'episode' | 'movie';
  show: string | null;
  title: string;
  season: number | null;
  episode: number | null;
  airDate: string | null;
  year: number | null;
  differentEpisodes?: boolean;
  hasParts?: boolean;
  copies: DuplicateCopy[];
  ignored: boolean;
}

export interface Duplicates {
  scannedAt: number | null;
  scanning: boolean;
  groups: DuplicateGroup[];
}

export interface ShortRecording extends LibraryCopy {
  kind: 'episode' | 'movie';
  /** Missing in scans made before 0.5.0. */
  guid?: string;
  show: string | null;
  season: number | null;
  episode: number | null;
  airDate: string | null;
  year: number | null;
  reference: number;
  basis: 'season' | 'show' | 'tmdb';
  ratio: number;
  ignored: boolean;
}

export interface ShortRecordings {
  scannedAt: number | null;
  scanning: boolean;
  threshold: number;
  moviesUnchecked: number;
  recordings: ShortRecording[];
}

export interface SeriesPart {
  tmdbId: number;
  title: string;
  releaseDate: string | null;
  poster: string | null;
  ratingKey: string | null;
  hidden: boolean;
}

export interface FilmSeries {
  id: number;
  name: string;
  poster: string | null;
  parts: SeriesPart[];
  hidden: boolean;
}

export interface SeriesData {
  scannedAt: number | null;
  scanning: boolean;
  series: FilmSeries[];
}
