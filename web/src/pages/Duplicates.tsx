import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api, type DuplicateGroup, type Duplicates as DuplicatesData } from '../api';
import { useApp } from '../app';
import { recordingLabel, RecordingLine, ScanStatus, useToolData } from '../components/Recording';
import { SelectionBar, useSelection } from '../components/DeleteScript';

/** Duplicate recordings in the Plex library, with a Plex Web link per copy (removal happens in Plex). */
export function Duplicates() {
  const { t } = useTranslation();
  const { reloadTools } = useApp();
  const { data, setData, refresh, error } = useToolData<DuplicatesData>('/api/tools/duplicates');
  const [query, setQuery] = useState('');
  const [showIgnored, setShowIgnored] = useState(false);
  const allCopies = useMemo(() => (data ? data.groups.flatMap((g) => g.copies) : null), [data]);
  const selection = useSelection('duplicates', allCopies);

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

  const selectedCopies = (allCopies ?? []).filter((c) => selection.selected.has(c.mediaId));
  // Selecting every copy of an episode would delete it completely; worth a second look.
  const everyCopy = (data?.groups ?? [])
    .filter((g) => g.copies.every((c) => selection.selected.has(c.mediaId)))
    .map((g) => (g.show ? `${g.show} ${recordingLabel(g)}` : recordingLabel(g)));
  const suggest = () => selection.add(visible.flatMap((g) => g.copies.filter((c) => c.short).map((c) => c.mediaId)));

  const ignoredCount = data?.groups.filter((g) => g.ignored).length ?? 0;
  const active = (data?.groups.length ?? 0) - ignoredCount;

  return (
    <div className="page narrow">
      <Link to="/tools" className="back muted small">← {t('tools.title')}</Link>
      <h1>{t('duplicates.title')}</h1>
      <p className="muted">{t('duplicates.text')}</p>

      <ScanStatus scannedAt={data?.scannedAt ?? null} scanning={!!data?.scanning} error={error} onRefresh={refresh} />

      {data && (
        <>
          <SelectionBar tool="duplicates" copies={selectedCopies} warnings={everyCopy} onSuggest={suggest} onClear={selection.clear} />
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
                <Group key={g.key} group={g} onIgnore={setIgnored} selected={selection.selected} onSelect={selection.toggle} />
              ))}
            </section>
          ))}
          {sections.movies.length > 0 && (
            <section className="dup-section">
              <h2>{t('duplicates.movies')}</h2>
              {sections.movies.map((g) => (
                <Group key={g.key} group={g} onIgnore={setIgnored} selected={selection.selected} onSelect={selection.toggle} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Group({
  group,
  onIgnore,
  selected,
  onSelect,
}: {
  group: DuplicateGroup;
  onIgnore: (g: DuplicateGroup, ignored: boolean) => void;
  selected: Set<number>;
  onSelect: (mediaId: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={`dup-group${group.ignored ? ' dimmed' : ''}`}>
      <div className="dup-head">
        <b className="grow">{recordingLabel(group)}</b>
        <span className="muted small">{t('duplicates.copies', { count: group.copies.length })}</span>
        <button className="small" onClick={() => onIgnore(group, !group.ignored)} title={group.ignored ? undefined : t('duplicates.ignoreHint')}>
          {group.ignored ? t('duplicates.unignore') : t('duplicates.ignore')}
        </button>
      </div>
      <ul className="dup-copies">
        {group.copies.map((c) => (
          <li key={c.mediaId}>
            <RecordingLine
              copy={c}
              selected={selected.has(c.mediaId)}
              onSelect={onSelect}
              badges={c.short && <span className="badge warn">{t('duplicates.short')}</span>}
              extra={c.title !== group.title && <span className="muted">{c.title}</span>}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
