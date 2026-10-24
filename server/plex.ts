import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { getMeta, setMeta } from './db.js';

export const PRODUCT = 'RecPick';

export function clientId(): string {
  let id = getMeta('client_id');
  if (!id) {
    id = randomUUID();
    setMeta('client_id', id);
  }
  return id;
}

function plexHeaders(token?: string, language?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Plex-Product': PRODUCT,
    'X-Plex-Client-Identifier': clientId(),
  };
  if (token) headers['X-Plex-Token'] = token;
  if (language) headers['X-Plex-Language'] = language;
  return headers;
}

async function request<T>(url: string, init: RequestInit = {}, token?: string, language?: string): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...plexHeaders(token, language), ...(init.headers as Record<string, string> | undefined) },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url.replace(/X-Plex-Token=[^&]+/, 'X-Plex-Token=***')} -> ${res.status}`);
  return (await res.json()) as T;
}

// ---------- Local server ----------

export interface PlexMedia {
  beginsAt: number;
  endsAt: number;
  gridKey: string;
  channelTitle?: string;
  channelVcn?: string;
  channelThumb?: string;
  premiere?: boolean | string;
}

export interface PlexMetadata {
  guid: string;
  key: string;
  type: string;
  title: string;
  year?: number;
  summary?: string;
  thumb?: string;
  art?: string;
  contentRating?: string;
  index?: number;
  parentIndex?: number;
  grandparentGuid?: string;
  grandparentTitle?: string;
  grandparentKey?: string;
  grandparentThumb?: string;
  Genre?: { tag: string }[];
  Media?: PlexMedia[];
}

interface Container<T> {
  MediaContainer: T & { size?: number; totalSize?: number };
}

export function serverGet<T>(path: string): Promise<T> {
  return request<T>(`${config.plexUrl}${path}`, {}, config.plexToken);
}

/** Pages through a list endpoint and returns every Metadata entry. */
export async function serverGetAll(path: string, pageSize = 1000): Promise<PlexMetadata[]> {
  const all: PlexMetadata[] = [];
  const sep = path.includes('?') ? '&' : '?';
  for (let start = 0; ; start += pageSize) {
    const page = await serverGet<Container<{ Metadata?: PlexMetadata[] }>>(
      `${path}${sep}X-Plex-Container-Start=${start}&X-Plex-Container-Size=${pageSize}`,
    );
    const items = page.MediaContainer.Metadata ?? [];
    all.push(...items);
    const total = page.MediaContainer.totalSize ?? 0;
    if (items.length === 0 || start + items.length >= total) break;
  }
  return all;
}

let serverInfo: { machineIdentifier: string; myPlexUsername?: string } | undefined;
async function server(): Promise<{ machineIdentifier: string; myPlexUsername?: string }> {
  if (!serverInfo) {
    const root = await serverGet<Container<{ machineIdentifier: string; myPlexUsername?: string }>>('/');
    serverInfo = root.MediaContainer;
  }
  return serverInfo;
}

export async function machineIdentifier(): Promise<string> {
  return (await server()).machineIdentifier;
}

export async function epgProviders(): Promise<string[]> {
  const res = await serverGet<Container<{ Dvr?: { epgIdentifier: string }[] }>>('/livetv/dvrs');
  return [...new Set((res.MediaContainer.Dvr ?? []).map((d) => d.epgIdentifier))];
}

export async function librarySections(): Promise<{ key: string; type: string }[]> {
  const res = await serverGet<Container<{ Directory?: { key: string; type: string }[] }>>('/library/sections');
  return res.MediaContainer.Directory ?? [];
}

interface Subscription {
  type: number;
  Video?: { guid: string };
  Directory?: { guid: string };
}

interface GrabOperation {
  status: string;
  Metadata?: { guid: string; grandparentGuid?: string; Media?: PlexMedia[] };
}

export interface RecordingState {
  /** Movie/show GUIDs that have a recording rule. */
  subscribed: Set<string>;
  /** `${guid}|${beginsAt}` of airings that will be recorded. */
  scheduled: Set<string>;
}

export async function recordingState(): Promise<RecordingState> {
  const [subs, sched] = await Promise.all([
    serverGet<Container<{ MediaSubscription?: Subscription[] }>>('/media/subscriptions'),
    serverGet<Container<{ MediaGrabOperation?: GrabOperation[] }>>('/media/subscriptions/scheduled'),
  ]);
  const subscribed = new Set<string>();
  for (const s of subs.MediaContainer.MediaSubscription ?? []) {
    const guid = s.Video?.guid ?? s.Directory?.guid;
    if (guid) subscribed.add(guid);
  }
  const scheduled = new Set<string>();
  for (const op of sched.MediaContainer.MediaGrabOperation ?? []) {
    const m = op.Metadata;
    if (!m) continue;
    for (const media of m.Media ?? []) scheduled.add(`${m.guid}|${Number(media.beginsAt)}`);
  }
  return { subscribed, scheduled };
}

// ---------- Plex discover (title suggestions) ----------

export interface DiscoverResult {
  guid: string;
  type: 'movie' | 'show';
  title: string;
  year?: number;
  thumb?: string;
}

export async function discoverSearch(query: string, language: string): Promise<DiscoverResult[]> {
  const url = new URL('https://discover.provider.plex.tv/library/search');
  url.searchParams.set('query', query);
  url.searchParams.set('searchTypes', 'movies,tv');
  url.searchParams.set('searchProviders', 'discover');
  url.searchParams.set('includeMetadata', '1');
  url.searchParams.set('limit', '10');
  const res = await request<{
    MediaContainer: { SearchResults?: { SearchResult?: { Metadata: PlexMetadata & { Image?: { type: string; url: string }[] } }[] }[] };
  }>(url.toString(), {}, config.plexToken, language);
  const out: DiscoverResult[] = [];
  for (const group of res.MediaContainer.SearchResults ?? []) {
    for (const r of group.SearchResult ?? []) {
      const m = r.Metadata;
      if (m.type !== 'movie' && m.type !== 'show') continue;
      const poster = m.Image?.find((i) => i.type === 'coverPoster')?.url ?? m.thumb;
      out.push({ guid: m.guid, type: m.type, title: m.title, year: m.year, thumb: poster });
    }
  }
  return out;
}

// ---------- plex.tv (login) ----------

export interface Pin {
  id: number;
  code: string;
  authToken: string | null;
}

export function createPin(): Promise<Pin> {
  return request<Pin>('https://plex.tv/api/v2/pins?strong=true', { method: 'POST' });
}

export function checkPin(id: number): Promise<Pin> {
  return request<Pin>(`https://plex.tv/api/v2/pins/${id}`);
}

export function authUrl(code: string, forwardUrl: string): string {
  const params = new URLSearchParams({
    clientID: clientId(),
    code,
    forwardUrl,
    'context[device][product]': PRODUCT,
  });
  return `https://app.plex.tv/auth#?${params.toString()}`;
}

export interface PlexUser {
  id: number;
  username: string;
  title?: string;
  email?: string;
  thumb?: string;
}

export function plexUser(token: string): Promise<PlexUser> {
  return request<PlexUser>('https://plex.tv/api/v2/user', {}, token);
}

/** True when the account behind `token` can access this Plex server (owner or shared user). */
export async function hasServerAccess(token: string, account: PlexUser): Promise<boolean> {
  const { machineIdentifier: id, myPlexUsername } = await server();
  // The owner is recognised directly, so a slow or incomplete resources list cannot lock them out.
  if (myPlexUsername && [account.email, account.username].some((v) => v?.toLowerCase() === myPlexUsername.toLowerCase())) {
    return true;
  }
  // plex.tv sometimes returns an incomplete list for a token created seconds ago, so check twice.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000));
    const resources = await request<{ clientIdentifier: string }[]>('https://plex.tv/api/v2/resources?includeHttps=1', {}, token);
    if (resources.some((r) => r.clientIdentifier === id)) return true;
    console.warn(`[auth] ${account.username}: server not among ${resources.length} resources (attempt ${attempt + 1})`);
  }
  return false;
}

// ---------- Links ----------

/**
 * Plex Web page of a guide item. Guide items need the provider in the route
 * (/server/<id>/provider/<epg provider>/details); without it Plex Web treats them as
 * library items and shows "Play" instead of "Record". The provider is the key's first segment.
 */
export function plexWebLink(machineId: string, epgKey: string): string {
  const provider = epgKey.match(/^\/([^/]+)\//)?.[1];
  const route = provider ? `server/${machineId}/provider/${provider}` : `server/${machineId}`;
  return `${config.plexPublicUrl}/web/index.html#!/${route}/details?key=${encodeURIComponent(epgKey)}`;
}
