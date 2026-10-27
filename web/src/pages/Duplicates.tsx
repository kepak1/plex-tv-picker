import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api, type DuplicateCopy, type DuplicateGroup, type Duplicates as DuplicatesData } from '../api';
import { useApp } from '../app';
import { localeTag } from '../i18n';
import { formatDate, formatDuration, formatResolution, formatSize } from '../format';

const pad = (n: number) => String(n).padStart(2, '0');

/** Duplicate recordings in the Plex library, with a Plex Web link per copy (removal happens in Plex). */
export function Duplicates() {
  const { t } = useTranslation();
  const { reloadTools } = useApp();
  const [data, setData] = useState<DuplicatesData | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showIgnored, setShowIgnored] = useState(false);

  useEffect(() => {
    void api<DuplicatesData>('/api/tools/duplicates').then(setData);
  }, []);

  const rescan = async () => {
    setScanning(true);
    setError(null);
    try {
      setData(await api<DuplicatesData>('/api/tools/duplicates/scan', { method: 'POST' }));
      await reloadTools();
    } catch (err) {
      setError(String(err));
    } finally {
      setScanning(false);
    }
  };

  const setIgnored = async (group: DuplicateGroup, ignored: boolean) => {
    await api(`/api/tools/duplicates/ignored/${encodeURIComponent(group.key)}`, { method: ignored ? 'PUT' : 'DELETE' });
    setData((d) => d && { ...d, groups: d.groups.map((g) => (g.key === group.key ? { ...g, ignored } : g)) });
    await reloadTools();
  };

  const visible = useMemo(() => {
    const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return (data?.groups ?? []).filter((g) => {
      if (g.ignored && !showIgnored) return false;
      const text = [g.show, g.title, ...g.copies.map((c) => c.file)].join(' ').toLocaleLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [data, query, showIgnored]);

  // Episodes grouped by show, then movies.
  const sections = useMemo(() => {
    const shows = new Map<string, DuplicateGroup[]>();
    const movies: DuplicateGroup[] = [];
    for (const g of visible) {
      if (g.kind === 'movie') movies.push(g);
      else shows.set(g.show ?? '', [...(shows.get(g.show ?? '') ?? []), g]);
    }
    return { shows: [...shows.entries()], movies };
  }, [visible]);

  const ignoredCount = data?.groups.filter((g) => g.ignored).length ?? 0;
  const active = (data?.groups.length ?? 0) - ignoredCount;

  return (
    <div className="page narrow">
      <Link to="/tools" className="back muted small">← {t('tools.title')}</Link>
      <h1>{t('duplicates.title')}</h1>
      <p className="muted">{t('duplicates.text')}</p>

      <div className="status-row">
        <span className="muted small">
          {data?.scannedAt ? t('duplicates.scannedAt', { date: formatDate(data.scannedAt) }) : t('duplicates.notScanned')}
        </span>
        <button onClick={rescan} disabled={scanning || data?.scanning}>
          {scanning || data?.scanning ? t('duplicates.scanning') : t('duplicates.rescan')}
        </button>
        {error && <span className="error small">{error}</span>}
      </div>

      {data && (
        <>
          <input className="search" type="search" placeholder={t('duplicates.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="status-row">
            <span>{t('duplicates.summary', { count: active })}</span>
            {ignoredCount > 0 && (
              <label className="toggle muted small">
                <input type="checkbox" checked={showIgnored} onChange={(e) => setShowIgnored(e.target.checked)} />
                {t('duplicates.showIgnored', { count: ignoredCount })}
              </label>
            )}
          </div>

          {visible.length === 0 && <p className="empty">{data.groups.length === 0 ? t('duplicates.none') : t('duplicates.noMatches')}</p>}

          {sections.shows.map(([show, groups]) => (
            <section key={show} className="dup-section">
              <h2>{show}</h2>
              {groups.map((g) => (
                <Group key={g.key} group={g} onIgnore={setIgnored} />
              ))}
            </section>
          ))}
          {sections.movies.length > 0 && (
            <section className="dup-section">
              <h2>{t('duplicates.movies')}</h2>
              {sections.movies.map((g) => (
                <Group key={g.key} group={g} onIgnore={setIgnored} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function groupLabel(g: DuplicateGroup): string {
  if (g.kind === 'movie') return g.year ? `${g.title} (${g.year})` : g.title;
  if (g.episode != null) return `S${pad(g.season ?? 0)}E${pad(g.episode)} · ${g.title}`;
  const date = g.airDate ? new Date(`${g.airDate}T12:00:00`).toLocaleDateString(localeTag(), { dateStyle: 'medium' }) : '';
  return [g.title, date].filter(Boolean).join(' · ');
}

function Group({ group, onIgnore }: { group: DuplicateGroup; onIgnore: (g: DuplicateGroup, ignored: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <div className={`dup-group${group.ignored ? ' dimmed' : ''}`}>
      <div className="dup-head">
        <b className="grow">{groupLabel(group)}</b>
        <span className="muted small">{t('duplicates.copies', { count: group.copies.length })}</span>
        <button className="small" onClick={() => onIgnore(group, !group.ignored)} title={group.ignored ? undefined : t('duplicates.ignoreHint')}>
          {group.ignored ? t('duplicates.unignore') : t('duplicates.ignore')}
        </button>
      </div>
      <ul className="dup-copies">
        {group.copies.map((c) => (
          <Copy key={c.mediaId} copy={c} groupTitle={group.title} />
        ))}
      </ul>
    </div>
  );
}

function Copy({ copy, groupTitle }: { copy: DuplicateCopy; groupTitle: string }) {
  const { t } = useTranslation();
  const { plexLink } = useApp();
  const quality = [copy.resolution && formatResolution(copy.resolution), ...[copy.videoCodec, copy.audioCodec, copy.container].map((x) => x?.toUpperCase())]
    .filter(Boolean)
    .join(' · ');
  return (
    <li>
      <div className="dup-line">
        <a className="when" href={plexLink(`/library/metadata/${copy.ratingKey}`)} target="_blank" rel="noreferrer">
          {t('duplicates.openInPlex')}
        </a>
        <span className="dup-duration">{copy.duration != null ? formatDuration(copy.duration) : '?'}</span>
        {copy.short && <span className="badge warn">{t('duplicates.short')}</span>}
        {copy.size != null && <span>{formatSize(copy.size)}</span>}
        {quality && <span className="muted">{quality}</span>}
        {copy.addedAt != null && <span className="muted">{t('duplicates.added', { date: formatDate(copy.addedAt) })}</span>}
        {copy.title !== groupTitle && <span className="muted">{copy.title}</span>}
      </div>
      {copy.file && (
        <div className="dup-file muted small">
          {copy.file}
          {copy.parts > 1 && ` ${t('duplicates.parts', { count: copy.parts })}`}
        </div>
      )}
    </li>
  );
}
