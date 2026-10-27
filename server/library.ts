import { librarySections, serverGetAll, type PlexMetadata } from './plex.js';
import { normalize } from './text.js';

// Library data for the tools (duplicate and short recordings): the movie and TV lists with
// their versions and files. The sync reads the same lists, so tools reuse them instead of fetching twice.

interface LibraryPart {
  file?: string;
  size?: number;
  duration?: number;
}

interface LibraryMedia {
  id: number;
  duration?: number;
  videoResolution?: string;
  videoCodec?: string;
  audioCodec?: string;
  container?: string;
  Part?: LibraryPart[];
}

/** Library list entries carry more than guide entries; only the fields used here. */
export type LibraryMetadata = Omit<PlexMetadata, 'Media'> & {
  ratingKey: string;
  grandparentRatingKey?: string;
  addedAt?: number;
  originallyAvailableAt?: string;
  Guid?: { id: string }[];
  Media?: LibraryMedia[];
};

export interface Library {
  movies: LibraryMetadata[];
  episodes: LibraryMetadata[];
}

/** One file (Plex "media") of a library item. */
export interface LibraryCopy {
  ratingKey: string;
  mediaId: number;
  /** Title of the item the copy belongs to. */
  title: string;
  /** Milliseconds. */
  duration: number | null;
  size: number | null;
  addedAt: number | null;
  resolution: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  container: string | null;
  /** First part's path. */
  file: string | null;
  /** Every part's path (a copy can be split into several files). */
  files: string[];
  parts: number;
}

/** Movie lists need `includeGuids=1` for TMDB ids. */
export const movieListPath = (sectionKey: string) => `/library/sections/${sectionKey}/all?includeGuids=1`;
export const episodeListPath = (sectionKey: string) => `/library/sections/${sectionKey}/all?type=4`;

export async function fetchLibrary(): Promise<Library> {
  const lib: Library = { movies: [], episodes: [] };
  for (const section of await librarySections()) {
    if (section.type === 'movie') lib.movies.push(...((await serverGetAll(movieListPath(section.key))) as unknown as LibraryMetadata[]));
    else if (section.type === 'show') lib.episodes.push(...((await serverGetAll(episodeListPath(section.key))) as unknown as LibraryMetadata[]));
  }
  return lib;
}

/** Show identity: Plex's own guid when the show is matched, its title otherwise. */
export const showKey = (m: LibraryMetadata) =>
  m.grandparentGuid?.startsWith('plex://') ? m.grandparentGuid : `t:${normalize(m.grandparentTitle ?? '')}`;

export function tmdbIdOf(m: LibraryMetadata): number | null {
  const id = m.Guid?.find((g) => g.id.startsWith('tmdb://'))?.id.slice(7);
  return id && /^\d+$/.test(id) ? Number(id) : null;
}

export function copiesOf(m: LibraryMetadata): LibraryCopy[] {
  return (m.Media ?? []).map((media) => {
    const parts = media.Part ?? [];
    const size = parts.reduce((sum, p) => sum + (p.size ?? 0), 0);
    return {
      ratingKey: m.ratingKey,
      mediaId: media.id,
      title: m.title,
      duration: media.duration ?? (parts.reduce((sum, p) => sum + (p.duration ?? 0), 0) || null),
      size: size || null,
      addedAt: m.addedAt ?? null,
      resolution: media.videoResolution ?? null,
      videoCodec: media.videoCodec ?? null,
      audioCodec: media.audioCodec ?? null,
      container: media.container ?? null,
      file: parts[0]?.file ?? null,
      files: parts.map((p) => p.file).filter((f): f is string => !!f),
      parts: parts.length,
    };
  });
}
