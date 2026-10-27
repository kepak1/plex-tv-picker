import { updateDuplicates } from './duplicates.js';
import { fetchLibrary, type Library } from './library.js';
import { updateShortRecordings } from './short.js';

// Library tools share one read of the library: the sync passes the lists it fetched anyway,
// and the tools' Refresh button fetches them again.

let scanning: Promise<void> | null = null;

export async function updateLibraryTools(lib: Library): Promise<void> {
  updateDuplicates(lib);
  // TMDB lookups can fail (network, key); the duplicates above are kept either way.
  try {
    await updateShortRecordings(lib);
  } catch (err) {
    console.error('[short] failed', err);
  }
}

/** Starts a refresh in the background (it can take a while the first time TMDB runtimes are fetched). */
export function rescanLibraryTools(): Promise<void> {
  if (!scanning) {
    scanning = fetchLibrary()
      .then(updateLibraryTools)
      .catch((err) => console.error('[tools] refresh failed', err))
      .finally(() => {
        scanning = null;
      });
  }
  return scanning;
}

export function isScanning(): boolean {
  return scanning !== null;
}
