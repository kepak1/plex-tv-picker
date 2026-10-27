import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api, type DuplicateCopy, type DuplicateGroup, type Duplicates as DuplicatesData } from '../api';
import { useApp } from '../app';
import { recordingLabel, RecordingLine, ScanStatus, useToolData } from '../components/Recording';
import { SelectionBar, usePlans, useSelection } from '../components/DeleteScript';
import { episodeCode, operations, storyOf, type CopyPlan, type PathMap, type Plans } from '../components/plan';

const MAX_PART = 6;

/** The best copy of a part: not cut short, then the longest. */
const better = (a: DuplicateCopy, b: DuplicateCopy) => (a.short !== b.short ? (a.short ? b : a) : (a.duration ?? 0) >= (b.duration ?? 0) ? a : b);

/** TMDB's number for a copy, when it differs from the episode Plex filed it under. */
const tmdbNumber = (g: DuplicateGroup, c: DuplicateCopy) =>
  c.suggested && (c.suggested.season !== g.season || c.suggested.episode !== g.episode) ? c.suggested : null;

/**
 * Duplicate recordings in the Plex library, with a Plex Web link per copy. Copies can be selected for
 * deletion, joined as the parts of one episode or renumbered; the downloaded script does the work.
 */
export function Duplicates() {
  const { t } = useTranslation();
  const { reloadTools } = useApp();
  const { data, setData, refresh, error } = useToolData<DuplicatesData>('/api/tools/duplicates');
  const [query, setQuery] = useState('');
  const [showIgnored, setShowIgnored] = useState(false);
  const allCopies = useMemo(() => (data ? data.groups.flatMap((g) => g.copies) : null), [data]);
  const selection = useSelection('duplicates', allCopies);
  const plans = usePlans('duplicates', allCopies);

  const setIgnored = async (group: DuplicateGroup, ignored: boolean) => {
    await api(`/api/tools/duplicates/ignored/${encodeURIComponent(group.key)}`, { method: ignored ? 'PUT' : 'DELETE' });
    setData((d) => d && { ...d, groups: d.groups.map((g) => (g.key === group.key ? { ...g, ignored } : g)) });
    await reloadTools();
  };

  // A copy is deleted, joined or renumbered, never two of these at once.
  const toggleDelete = (id: number) => {
    if (!selection.selected.has(id)) plans.set({ [id]: undefined });
    selection.toggle(id);
  };
  const setPlans = (changes: Record<number, CopyPlan | undefined>) => {
    plans.set(changes);
    selection.remove(Object.entries(changes).filter(([, p]) => p).map(([id]) => Number(id)));
  };

  /**
   * Numbers the copies whose file names carry part markers, one copy per part. A group can mix
   * stories ("Fabryki śmierci cz. 1-2" and "Bunkier cz. 1"); only the story with most parts is joined.
   */
  const joinParts = (g: DuplicateGroup) => {
    const stories = new Map<string, Set<number>>();
    for (const c of g.copies) if (c.part && c.fileTitle) stories.set(storyOf(c.fileTitle), (stories.get(storyOf(c.fileTitle)) ?? new Set()).add(c.part));
    const story = [...stories].sort((a, b) => b[1].size - a[1].size)[0]?.[0];
    const best = new Map<number, DuplicateCopy>();
    for (const c of g.copies) {
      if (!c.part || !c.fileTitle || storyOf(c.fileTitle) !== story) continue;
      best.set(c.part, best.has(c.part) ? better(best.get(c.part)!, c) : c);
    }
    setPlans(Object.fromEntries(g.copies.map((c) => [c.mediaId, best.get(c.part ?? 0) === c ? { part: c.part! } : plans.plans[c.mediaId]?.part ? undefined : plans.plans[c.mediaId]])));
  };

  /** Renumbers every copy TMDB places under another episode. */
  const applyTmdb = (g: DuplicateGroup) => {
    setPlans(
      Object.fromEntries(
        g.copies.flatMap((c) => {
          const n = tmdbNumber(g, c);
          return n ? [[c.mediaId, { renumber: episodeCode(n.season, n.episode) }]] : [];
        }),
      ),
    );
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

  const label = useCallback((g: DuplicateGroup) => (g.show ? `${g.show} ${recordingLabel(g)}` : recordingLabel(g)), []);
  const selectedCopies = (allCopies ?? []).filter((c) => selection.selected.has(c.mediaId));
  // Selecting every copy of an episode would delete it completely; worth a second look.
  const everyCopy = (data?.groups ?? []).filter((g) => g.copies.every((c) => selection.selected.has(c.mediaId))).map(label);
  const suggest = () => {
    const ids = visible.flatMap((g) => g.copies.filter((c) => c.short && !plans.plans[c.mediaId]).map((c) => c.mediaId));
    selection.add(ids);
  };
  const clear = () => {
    selection.clear();
    plans.clear();
  };
  const ops = useCallback(
    (map: PathMap) =>
      operations(data?.groups ?? [], selection.selected, plans.plans, map, {
        label,
        partsSuffix: (count) => t('plan.partsSuffix', { count }),
        missingPart: (part) => t('plan.missingPart', { part }),
        onePart: t('plan.onePart'),
        badNumber: t('plan.badNumber'),
      }),
    [data, selection.selected, plans.plans, label, t],
  );

  const ignoredCount = data?.groups.filter((g) => g.ignored).length ?? 0;
  const active = (data?.groups.length ?? 0) - ignoredCount;
  const groupProps = { onIgnore: setIgnored, selected: selection.selected, onSelect: toggleDelete, plans: plans.plans, onPlan: setPlans, onJoin: joinParts, onTmdb: applyTmdb };

  return (
    <div className="page narrow">
      <Link to="/tools" className="back muted small">← {t('tools.title')}</Link>
      <h1>{t('duplicates.title')}</h1>
      <p className="muted">{t('duplicates.text')}</p>

      <ScanStatus scannedAt={data?.scannedAt ?? null} scanning={!!data?.scanning} error={error} onRefresh={refresh} />

      {data && (
        <>
          <SelectionBar tool="duplicates" copies={selectedCopies} operations={ops} warnings={everyCopy} onSuggest={suggest} onClear={clear} />
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
                <Group key={g.key} group={g} {...groupProps} />
              ))}
            </section>
          ))}
          {sections.movies.length > 0 && (
            <section className="dup-section">
              <h2>{t('duplicates.movies')}</h2>
              {sections.movies.map((g) => (
                <Group key={g.key} group={g} {...groupProps} />
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
  plans,
  onPlan,
  onJoin,
  onTmdb,
}: {
  group: DuplicateGroup;
  onIgnore: (g: DuplicateGroup, ignored: boolean) => void;
  selected: Set<number>;
  onSelect: (mediaId: number) => void;
  plans: Plans;
  onPlan: (changes: Record<number, CopyPlan | undefined>) => void;
  onJoin: (g: DuplicateGroup) => void;
  onTmdb: (g: DuplicateGroup) => void;
}) {
  const { t } = useTranslation();
  const episodes = group.kind === 'episode';
  const planned = group.copies.some((c) => plans[c.mediaId]);
  // Joining and renumbering are offered right away where the file names suggest them.
  const [open, setOpen] = useState(false);
  const showPlan = episodes && (open || planned || !!group.hasParts || !!group.differentEpisodes);
  const tmdbFixes = group.copies.filter((c) => tmdbNumber(group, c)).length;

  return (
    <div className={`dup-group${group.ignored ? ' dimmed' : ''}`}>
      <div className="dup-head">
        <b className="grow">{recordingLabel(group)}</b>
        {group.differentEpisodes && <span className="badge warn" title={t('plan.differentHint')}>{t('plan.different')}</span>}
        {group.hasParts && <span className="badge">{t('plan.parts')}</span>}
        <span className="muted small">{t('duplicates.copies', { count: group.copies.length })}</span>
        {episodes && !showPlan && (
          <button className="small link" onClick={() => setOpen(true)}>{t('plan.more')}</button>
        )}
        <button className="small" onClick={() => onIgnore(group, !group.ignored)} title={group.ignored ? undefined : t('duplicates.ignoreHint')}>
          {group.ignored ? t('duplicates.unignore') : t('duplicates.ignore')}
        </button>
      </div>
      {showPlan && (group.hasParts || tmdbFixes > 0) && (
        <div className="dup-actions">
          {group.hasParts && <button className="small" onClick={() => onJoin(group)}>{t('plan.joinParts')}</button>}
          {tmdbFixes > 0 && <button className="small" onClick={() => onTmdb(group)}>{t('plan.applyTmdb', { count: tmdbFixes })}</button>}
        </div>
      )}
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
            {showPlan && <CopyPlanRow group={group} copy={c} plan={plans[c.mediaId]} onPlan={onPlan} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CopyPlanRow({
  group,
  copy,
  plan,
  onPlan,
}: {
  group: DuplicateGroup;
  copy: DuplicateCopy;
  plan: CopyPlan | undefined;
  onPlan: (changes: Record<number, CopyPlan | undefined>) => void;
}) {
  const { t } = useTranslation();
  const value = plan?.part ? `p${plan.part}` : plan?.renumber !== undefined ? 'renumber' : '';
  const suggestion = tmdbNumber(group, copy);
  const current = group.season != null && group.episode != null ? episodeCode(group.season, group.episode) : '';

  const choose = (v: string) => {
    if (v === '') onPlan({ [copy.mediaId]: undefined });
    else if (v === 'renumber') onPlan({ [copy.mediaId]: { renumber: suggestion ? episodeCode(suggestion.season, suggestion.episode) : current } });
    else onPlan({ [copy.mediaId]: { part: Number(v.slice(1)) } });
  };

  return (
    <div className="dup-plan">
      <select value={value} onChange={(e) => choose(e.target.value)} aria-label={t('plan.action')}>
        <option value="">{t('plan.keep')}</option>
        {Array.from({ length: MAX_PART }, (_, i) => (
          <option key={i} value={`p${i + 1}`}>{t('plan.asPart', { part: i + 1 })}</option>
        ))}
        <option value="renumber">{t('plan.renumber')}</option>
      </select>
      {value === 'renumber' && (
        <input
          className="episode-code"
          value={plan?.renumber ?? ''}
          placeholder="S01E02"
          onChange={(e) => onPlan({ [copy.mediaId]: { renumber: e.target.value.toUpperCase() } })}
        />
      )}
      {copy.fileTitle && <span className="muted">{t('plan.fileTitle', { title: copy.fileTitle })}</span>}
      {copy.part && <span className="muted">{t('plan.detectedPart', { part: copy.part })}</span>}
      {suggestion && (
        <button
          className="small link"
          title={t('plan.tmdbHint')}
          onClick={() => onPlan({ [copy.mediaId]: { renumber: episodeCode(suggestion.season, suggestion.episode) } })}
        >
          TMDB: {episodeCode(suggestion.season, suggestion.episode)} · {suggestion.title}
        </button>
      )}
    </div>
  );
}
