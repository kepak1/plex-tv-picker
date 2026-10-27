import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api, type ShortRecording, type ShortRecordings as ShortData } from '../api';
import { useApp } from '../app';
import { recordingLabel, RecordingLine, ScanStatus, useToolData } from '../components/Recording';
import { SelectionBar, useSelection } from '../components/DeleteScript';
import { formatDuration } from '../format';

/** Recordings much shorter than their season, show or TMDB runtime; removal or re-recording happens in Plex. */
export function ShortRecordings() {
  const { t } = useTranslation();
  const { config, reloadTools } = useApp();
  const { data, setData, refresh, error } = useToolData<ShortData>('/api/tools/short');
  const [query, setQuery] = useState('');
  const [showIgnored, setShowIgnored] = useState(false);
  const selection = useSelection('short', data?.recordings ?? null);

  const setIgnored = async (r: ShortRecording, ignored: boolean) => {
    await api(`/api/tools/short/ignored/${r.mediaId}`, { method: ignored ? 'PUT' : 'DELETE' });
    setData((d) => d && { ...d, recordings: d.recordings.map((x) => (x.mediaId === r.mediaId ? { ...x, ignored } : x)) });
    await reloadTools();
  };

  const visible = useMemo(() => {
    const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return (data?.recordings ?? []).filter((r) => {
      if (r.ignored && !showIgnored) return false;
      const text = [r.show, r.title, r.file].join(' ').toLocaleLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [data, query, showIgnored]);

  // Episodes grouped by show, then movies.
  const sections = useMemo(() => {
    const shows = new Map<string, ShortRecording[]>();
    const movies: ShortRecording[] = [];
    for (const r of visible) {
      if (r.kind === 'movie') movies.push(r);
      else shows.set(r.show ?? '', [...(shows.get(r.show ?? '') ?? []), r]);
    }
    return { shows: [...shows.entries()], movies };
  }, [visible]);

  const selectedCopies = (data?.recordings ?? []).filter((r) => selection.selected.has(r.mediaId));
  const suggest = () => selection.add(visible.filter((r) => !r.ignored).map((r) => r.mediaId));

  const ignoredCount = data?.recordings.filter((r) => r.ignored).length ?? 0;
  const active = (data?.recordings.length ?? 0) - ignoredCount;

  return (
    <div className="page narrow">
      <Link to="/tools" className="back muted small">← {t('tools.title')}</Link>
      <h1>{t('short.title')}</h1>
      <p className="muted">{t(config.tmdb ? 'short.text' : 'short.textNoTmdb')}</p>

      <ScanStatus scannedAt={data?.scannedAt ?? null} scanning={!!data?.scanning} error={error} onRefresh={refresh} />

      {data && (
        <>
          <p className="muted small">
            {t('short.threshold', { threshold: data.threshold })} <Link to="/settings">{t('short.change')}</Link>
          </p>
          <SelectionBar tool="short" copies={selectedCopies} onSuggest={suggest} onClear={selection.clear} />
          <input className="search" type="search" placeholder={t('duplicates.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="status-row">
            <span>{t('short.summary', { count: active })}</span>
            {ignoredCount > 0 && (
              <label className="toggle muted small">
                <input type="checkbox" checked={showIgnored} onChange={(e) => setShowIgnored(e.target.checked)} />
                {t('duplicates.showIgnored', { count: ignoredCount })}
              </label>
            )}
          </div>

          {visible.length === 0 && <p className="empty">{data.recordings.length === 0 ? t('short.none') : t('duplicates.noMatches')}</p>}

          {sections.shows.map(([show, recordings]) => (
            <section key={show} className="dup-section">
              <h2>{show}</h2>
              {recordings.map((r) => (
                <Row key={r.mediaId} recording={r} onIgnore={setIgnored} selected={selection.selected.has(r.mediaId)} onSelect={selection.toggle} />
              ))}
            </section>
          ))}
          {sections.movies.length > 0 && (
            <section className="dup-section">
              <h2>{t('duplicates.movies')}</h2>
              {sections.movies.map((r) => (
                <Row key={r.mediaId} recording={r} onIgnore={setIgnored} selected={selection.selected.has(r.mediaId)} onSelect={selection.toggle} />
              ))}
            </section>
          )}
          {config.tmdb && data.moviesUnchecked > 0 && <p className="muted small">{t('short.moviesUnchecked', { count: data.moviesUnchecked })}</p>}
        </>
      )}
    </div>
  );
}

function Row({
  recording: r,
  onIgnore,
  selected,
  onSelect,
}: {
  recording: ShortRecording;
  onIgnore: (r: ShortRecording, ignored: boolean) => void;
  selected: boolean;
  onSelect: (mediaId: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={`dup-group${r.ignored ? ' dimmed' : ''}`}>
      <div className="dup-head">
        <b className="grow">{recordingLabel(r)}</b>
        <button className="small" onClick={() => onIgnore(r, !r.ignored)} title={r.ignored ? undefined : t('short.ignoreHint')}>
          {r.ignored ? t('duplicates.unignore') : t('short.ignore')}
        </button>
      </div>
      <div className="dup-copies single">
        <RecordingLine
          copy={r}
          selected={selected}
          onSelect={onSelect}
          badges={
            <>
              <span className="badge warn">{Math.floor(r.ratio * 100)}%</span>
              <span className="muted">{t(`short.basis.${r.basis}`, { length: formatDuration(r.reference) })}</span>
            </>
          }
        />
      </div>
    </div>
  );
}
