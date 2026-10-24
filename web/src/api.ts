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
  subscribed: boolean;
  ignored: boolean;
  isNew: boolean;
  airings: Airing[];
}

export interface Channel {
  gridKey: string;
  title: string;
  vcn: string | null;
  thumb: string | null;
}

export interface Status {
  lastSyncAt: number | null;
  lastSyncError: string | null;
  syncing: boolean;
}

export interface Wish {
  id: number;
  kind: 'title' | 'phrase';
  type: 'movie' | 'show' | null;
  guid: string | null;
  title: string;
  year: number | null;
  thumb: string | null;
  matchCount: number;
  matches: { guid: string; title: string; year: number | null; type: string }[];
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
