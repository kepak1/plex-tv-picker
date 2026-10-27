import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type LibraryCopy } from '../api';
import { useApp } from '../app';
import { localeTag } from '../i18n';
import { formatDate, formatDuration, formatResolution, formatSize } from '../format';

const pad = (n: number) => String(n).padStart(2, '0');

/** "S01E03 · Title", "Title · 14 Feb 2025" (no numbers) or "Title (1983)" (movies). */
export function recordingLabel(r: {
  kind: 'episode' | 'movie';
  title: string;
  season: number | null;
  episode: number | null;
  airDate: string | null;
  year: number | null;
}): string {
  if (r.kind === 'movie') return r.year ? `${r.title} (${r.year})` : r.title;
  if (r.episode != null) return `S${pad(r.season ?? 0)}E${pad(r.episode)} · ${r.title}`;
  const date = r.airDate ? new Date(`${r.airDate}T12:00:00`).toLocaleDateString(localeTag(), { dateStyle: 'medium' }) : '';
  return [r.title, date].filter(Boolean).join(' · ');
}

/** One file: Plex link, length, size, quality, date added and path. `badges` go after the length. */
export function RecordingLine({ copy, badges, extra }: { copy: LibraryCopy; badges?: ReactNode; extra?: ReactNode }) {
  const { t } = useTranslation();
  const { plexLink } = useApp();
  const quality = [copy.resolution && formatResolution(copy.resolution), ...[copy.videoCodec, copy.audioCodec, copy.container].map((x) => x?.toUpperCase())]
    .filter(Boolean)
    .join(' · ');
  return (
    <>
      <div className="dup-line">
        <a className="when" href={plexLink(`/library/metadata/${copy.ratingKey}`)} target="_blank" rel="noreferrer">
          {t('tools.openInPlex')}
        </a>
        <span className="dup-duration">{copy.duration != null ? formatDuration(copy.duration) : '?'}</span>
        {badges}
        {copy.size != null && <span>{formatSize(copy.size)}</span>}
        {quality && <span className="muted">{quality}</span>}
        {copy.addedAt != null && <span className="muted">{t('tools.added', { date: formatDate(copy.addedAt) })}</span>}
        {extra}
      </div>
      {copy.file && (
        <div className="dup-file muted small">
          {copy.file}
          {copy.parts > 1 && ` ${t('tools.parts', { count: copy.parts })}`}
        </div>
      )}
    </>
  );
}

/**
 * Loads a tool's data and refreshes the library in the background: the server answers right away
 * and the page polls until the refresh is done (the first one can take a while with TMDB).
 */
export function useToolData<T extends { scanning: boolean }>(path: string) {
  const { reloadTools } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wasScanning = useRef(false);

  const load = useCallback(async () => setData(await api<T>(path)), [path]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (wasScanning.current && data && !data.scanning) void reloadTools();
    wasScanning.current = !!data?.scanning;
    if (!data?.scanning) return;
    const id = setTimeout(() => void load(), 2000);
    return () => clearTimeout(id);
  }, [data, load, reloadTools]);

  const refresh = async () => {
    setError(null);
    try {
      await api('/api/tools/scan', { method: 'POST' });
      await load();
    } catch (err) {
      setError(String(err));
    }
  };

  return { data, setData, refresh, error };
}

/** Last refresh time and the Refresh button. */
export function ScanStatus({ scannedAt, scanning, error, onRefresh }: { scannedAt: number | null; scanning: boolean; error: string | null; onRefresh: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="status-row">
      <span className="muted small">{scannedAt ? t('tools.scannedAt', { date: formatDate(scannedAt) }) : t('tools.notScanned')}</span>
      <button onClick={onRefresh} disabled={scanning}>
        {scanning ? t('tools.scanning') : t('tools.rescan')}
      </button>
      {error && <span className="error small">{error}</span>}
    </div>
  );
}
