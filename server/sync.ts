import { db, getMeta, now, setMeta, transaction } from './db.js';
import { epgProviders, librarySections, serverGet, serverGetAll, type PlexMetadata } from './plex.js';
import { normalize } from './text.js';
import { fetchMissingDetails } from './tmdb.js';
import { reloadCatalog } from './catalog.js';
import { sendAlerts, sendDigests } from './notify.js';
import { computeRecommendations } from './recommend.js';
import { episodeListPath, movieListPath, tmdbIdOf, type LibraryMetadata } from './library.js';
import { updateLibraryTools } from './tools.js';
import { updateRecordedWishes } from './wishlist.js';

interface Section {
  key: string;
  type: string;
  title: string;
}

let running: Promise<void> | null = null;

export function isSyncing(): boolean {
  return running !== null;
}

/** Runs a full sync (guide + library + ratings), then sends alerts and digests. Concurrent calls share one run. */
export function runSync(opts: { notify?: boolean } = {}): Promise<void> {
  if (!running) {
    running = doSync(opts.notify ?? true).finally(() => {
      running = null;
    });
  }
  return running;
}

/** Fetches TMDB details for titles that have none yet, e.g. right after a TMDB key was added or an upgrade. */
export function refreshTmdb(): Promise<void> {
  if (!running) {
    running = fetchMissingDetails()
      .then(() => reloadCatalog())
      .then(() => updateRecommendations())
      .catch((err) => console.error('[tmdb] failed', err))
      .finally(() => {
        running = null;
      });
  }
  return running;
}

/** Recommendations are a bonus: a failure (e.g. history unavailable) must not fail the sync. */
export async function updateRecommendations(): Promise<void> {
  try {
    await computeRecommendations();
  } catch (err) {
    console.error('[recommend] failed', err);
  }
}

async function doSync(notify: boolean): Promise<void> {
  const started = Date.now();
  console.log('[sync] started');
  try {
    await syncGuide();
    await syncLibrary();
    reloadCatalog();
    await fetchMissingDetails();
    reloadCatalog();
    await updateRecommendations();
    setMeta('last_sync_at', String(now()));
    setMeta('last_sync_error', '');
    console.log(`[sync] guide and library done in ${Math.round((Date.now() - started) / 1000)}s`);
  } catch (err) {
    setMeta('last_sync_error', String(err));
    console.error('[sync] failed', err);
    throw err;
  }
  if (notify) {
    await sendAlerts();
    await sendDigests();
  }
}

function posterOf(m: PlexMetadata): string | undefined {
  return m.thumb ?? m.grandparentThumb;
}

async function syncGuide(): Promise<void> {
  const providers = await epgProviders();
  if (providers.length === 0) throw new Error('No Live TV & DVR guide found on the Plex server');

  const items = new Map<string, PlexMetadata & { kind: 'movie' | 'show' }>();
  const airings: {
    item: string;
    m: PlexMetadata;
    media: NonNullable<PlexMetadata['Media']>[number];
    episode: boolean;
  }[] = [];

  for (const provider of providers) {
    const sections = await serverGet<{ MediaContainer: { Directory?: Section[] } }>(`/${provider}/sections`);
    for (const section of sections.MediaContainer.Directory ?? []) {
      const base = `/${provider}/sections/${section.key}/all`;
      if (section.type === 'movie') {
        for (const m of await serverGetAll(base)) {
          items.set(m.guid, { ...m, kind: 'movie' });
          for (const media of m.Media ?? []) airings.push({ item: m.guid, m, media, episode: false });
        }
      } else if (section.type === 'show' && !/sport/i.test(section.title)) {
        for (const show of await serverGetAll(`${base}?type=2`)) items.set(show.guid, { ...show, kind: 'show' });
        for (const ep of await serverGetAll(`${base}?type=4`)) {
          if (!ep.grandparentGuid) continue;
          if (!items.has(ep.grandparentGuid)) {
            items.set(ep.grandparentGuid, {
              guid: ep.grandparentGuid,
              key: ep.grandparentKey ?? ep.key,
              type: 'show',
              kind: 'show',
              title: ep.grandparentTitle ?? ep.title,
              thumb: ep.grandparentThumb,
              Genre: ep.Genre,
            });
          }
          for (const media of ep.Media ?? []) airings.push({ item: ep.grandparentGuid, m: ep, media, episode: true });
        }
      }
    }
  }

  const ts = now();
  // Everything in the very first import is the baseline, not "new".
  if (!getMeta('first_sync_at')) setMeta('first_sync_at', String(ts));
  const upsertItem = db.prepare(`
    INSERT INTO items (guid, type, title, title_norm, year, summary, thumb, art, genres, content_rating, epg_key, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guid) DO UPDATE SET
      type = excluded.type, title = excluded.title, title_norm = excluded.title_norm, year = excluded.year,
      summary = excluded.summary, thumb = excluded.thumb, art = excluded.art, genres = excluded.genres,
      content_rating = excluded.content_rating, epg_key = excluded.epg_key, last_seen_at = excluded.last_seen_at`);
  const insertAiring = db.prepare(`
    INSERT INTO airings (item_guid, episode_guid, episode_title, season, episode, episode_summary, episode_thumb, epg_key,
      grid_key, channel_title, channel_vcn, channel_thumb, begins_at, ends_at, premiere)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  // Only items with at least one airing count as "seen" in this guide refresh.
  const withAirings = new Set(airings.map((a) => a.item));

  transaction(() => {
    for (const m of items.values()) {
      if (!withAirings.has(m.guid)) continue;
      const genres = [...new Set((m.Genre ?? []).map((g) => g.tag).filter((g) => g !== 'Movies'))];
      upsertItem.run(
        m.guid, m.kind, m.title, normalize(m.title), m.year ?? null, m.summary ?? null, posterOf(m) ?? null,
        m.art ?? null, JSON.stringify(genres), m.contentRating ?? null, m.key.replace(/\/children$/, ''), ts, ts,
      );
    }
    db.exec('DELETE FROM airings');
    // The same channel is often listed in several lineups (e.g. 002 and 021); keep one airing per channel+time.
    const seen = new Set<string>();
    for (const { item, m, media, episode } of airings) {
      const dedupe = `${m.guid}|${media.gridKey}|${media.beginsAt}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      insertAiring.run(
        item,
        episode ? m.guid : null,
        episode ? m.title : null,
        episode ? (m.parentIndex ?? null) : null,
        episode ? (m.index ?? null) : null,
        episode ? (m.summary ?? null) : null,
        episode ? (m.thumb ?? null) : null,
        m.key,
        media.gridKey,
        media.channelTitle ?? null,
        media.channelVcn ?? null,
        media.channelThumb ?? null,
        Number(media.beginsAt),
        Number(media.endsAt),
        media.premiere === true || media.premiere === '1' ? 1 : 0,
      );
    }
  });
  console.log(`[sync] guide: ${withAirings.size} titles, ${airings.length} airings before de-duplication`);
}

async function syncLibrary(): Promise<void> {
  const movies: { guid: string; norm: string; year: number | null; ratingKey: string; tmdbId: number | null; mediaId: number | null }[] = [];
  const episodes: { guid: string; showGuid: string; showNorm: string; season: number | null; episode: number | null; norm: string }[] = [];
  // The same lists, with versions and files, for the library tools.
  const rawMovies: LibraryMetadata[] = [];
  const rawEpisodes: LibraryMetadata[] = [];

  for (const section of await librarySections()) {
    if (section.type === 'movie') {
      for (const m of await serverGetAll(movieListPath(section.key))) {
        const lm = m as unknown as LibraryMetadata;
        const ids = (lm.Media ?? []).map((x) => x.id);
        movies.push({
          guid: m.guid, norm: normalize(m.title), year: m.year ?? null, ratingKey: lm.ratingKey, tmdbId: tmdbIdOf(lm),
          mediaId: ids.length ? Math.max(...ids) : null,
        });
        rawMovies.push(lm);
      }
    } else if (section.type === 'show') {
      for (const ep of await serverGetAll(episodeListPath(section.key))) {
        episodes.push({
          guid: ep.guid,
          showGuid: ep.grandparentGuid ?? '',
          showNorm: normalize(ep.grandparentTitle ?? ''),
          season: ep.parentIndex ?? null,
          episode: ep.index ?? null,
          norm: normalize(ep.title),
        });
        rawEpisodes.push(ep as unknown as LibraryMetadata);
      }
    }
  }

  transaction(() => {
    db.exec('DELETE FROM library_movies; DELETE FROM library_episodes;');
    const im = db.prepare('INSERT INTO library_movies (guid, title_norm, year, rating_key, tmdb_id, media_id) VALUES (?, ?, ?, ?, ?, ?)');
    for (const m of movies) im.run(m.guid, m.norm, m.year, m.ratingKey, m.tmdbId, m.mediaId);
    const ie = db.prepare('INSERT INTO library_episodes (guid, show_guid, show_norm, season, episode, title_norm) VALUES (?, ?, ?, ?, ?, ?)');
    for (const e of episodes) ie.run(e.guid, e.showGuid, e.showNorm, e.season, e.episode, e.norm);
  });
  console.log(`[sync] library: ${movies.length} movies, ${episodes.length} episodes`);
  await updateLibraryTools({ movies: rawMovies, episodes: rawEpisodes });
  // After the tools, so a short copy (failed recording) doesn't count as recorded.
  updateRecordedWishes();
}
