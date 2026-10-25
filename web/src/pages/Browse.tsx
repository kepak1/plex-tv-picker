import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api, type Airing, type FilterOptions, type Item, type RuleConditions, type Status } from '../api';
import { useApp } from '../app';
import { ItemCard, type ItemActions } from '../components/ItemCard';
import { MultiSelect } from '../components/MultiSelect';
import { countryOptions, formatDate, whenRange, type When } from '../format';

interface Filters {
  type: '' | 'movie' | 'show';
  q: string;
  when: When;
  genres: string[];
  countries: string[];
  channels: string[];
  yearMin: string;
  yearMax: string;
  ratingMin: string;
  hideScheduled: boolean;
  hideLibrary: boolean;
  showIgnored: boolean;
  recommended: boolean;
  sort: SortKey;
  dir: 'asc' | 'desc';
}

type SortKey = 'start' | 'title' | 'year' | 'rating' | 'added';

// Same as NATURAL_DIR in server/catalog.ts: picking a sort starts in its natural direction.
const NATURAL_DIR: Record<SortKey, 'asc' | 'desc'> = { start: 'asc', title: 'asc', year: 'desc', rating: 'desc', added: 'desc' };

const DEFAULTS: Filters = {
  type: 'movie',
  q: '',
  when: 'all',
  genres: [],
  countries: [],
  channels: [],
  yearMin: '',
  yearMax: '',
  ratingMin: '',
  hideScheduled: true,
  hideLibrary: true,
  showIgnored: false,
  recommended: false,
  sort: 'start',
  dir: 'asc',
};
const PAGE = 48;
const AUTO_FILL = 12;
const STORAGE_KEY = 'ptp_filters';

function stored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export function Browse() {
  const { t } = useTranslation();
  const { config, reloadWishes } = useApp();
  const navigate = useNavigate();
  const [filters, setFilters] = useState<Filters>(() => {
    const saved = stored<Partial<Filters>>(STORAGE_KEY, {});
    // Filters saved before sort direction existed start in the sort's natural direction.
    return { ...DEFAULTS, ...saved, dir: saved.dir ?? NATURAL_DIR[saved.sort ?? DEFAULTS.sort] };
  });
  const [view, setView] = useState<'list' | 'grid'>(() => stored('ptp_view', { v: 'list' as 'list' | 'grid' }).v);
  const [moreOpen, setMoreOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState<FilterOptions>({ genres: [], channels: [], countries: [] });
  const [status, setStatus] = useState<Status | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [debouncedQ, setDebouncedQ] = useState(filters.q);
  const requestId = useRef(0);
  const loadedCount = useRef(0);
  loadedCount.current = items.length;

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((f) => ({ ...f, [key]: value }));

  useEffect(() => store(STORAGE_KEY, filters), [filters]);
  useEffect(() => store('ptp_view', { v: view }), [view]);
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(filters.q), 250);
    return () => clearTimeout(id);
  }, [filters.q]);

  const loadStatus = useCallback(async () => {
    const s = await api<Status>('/api/status');
    setStatus(s);
    return s;
  }, []);

  useEffect(() => {
    void api<FilterOptions>('/api/filters').then(setOptions);
    void loadStatus();
  }, [loadStatus]);

  const params = useCallback(
    (offset: number) => {
      const p = new URLSearchParams();
      const range = whenRange(filters.when);
      if (filters.type) p.set('type', filters.type);
      if (debouncedQ) p.set('q', debouncedQ);
      if (filters.genres.length) p.set('genres', filters.genres.join(','));
      if (filters.countries.length && config.tmdb) p.set('countries', filters.countries.join(','));
      if (filters.channels.length) p.set('channels', filters.channels.join(','));
      if (range.from) p.set('from', String(range.from));
      if (range.to) p.set('to', String(range.to));
      if (filters.yearMin) p.set('yearMin', filters.yearMin);
      if (filters.yearMax) p.set('yearMax', filters.yearMax);
      if (filters.ratingMin && config.tmdb) p.set('ratingMin', filters.ratingMin);
      if (filters.hideScheduled) p.set('hideScheduled', '1');
      if (filters.hideLibrary) p.set('hideLibrary', '1');
      if (filters.showIgnored) p.set('showIgnored', '1');
      if (filters.recommended) p.set('recommended', '1');
      p.set('sort', filters.sort);
      p.set('dir', filters.dir);
      p.set('offset', String(offset));
      p.set('limit', String(PAGE));
      return p.toString();
    },
    [filters, debouncedQ, config.tmdb],
  );

  const load = useCallback(
    async (append: boolean) => {
      const id = ++requestId.current;
      setLoading(true);
      try {
        const res = await api<{ total: number; items: Item[] }>(`/api/catalog?${params(append ? loadedCount.current : 0)}`);
        if (id !== requestId.current) return;
        setTotal(res.total);
        setItems((prev) => (append ? [...prev, ...res.items] : res.items));
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [params],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  // Hiding titles empties the loaded page; top it up instead of leaving only a "Show more" button.
  useEffect(() => {
    if (!loading && items.length < AUTO_FILL && items.length < total) void load(true);
  }, [loading, items.length, total, load]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const refresh = async () => {
    await api('/api/sync', { method: 'POST' });
    setStatus((s) => (s ? { ...s, syncing: true } : s));
    const poll = async () => {
      const s = await loadStatus();
      if (s.syncing) setTimeout(poll, 3000);
      else {
        void api<FilterOptions>('/api/filters').then(setOptions);
        void load(false);
      }
    };
    setTimeout(poll, 3000);
  };

  const removeLocally = (guid: string) => {
    setItems((prev) => prev.filter((i) => i.guid !== guid));
    setTotal((n) => n - 1);
  };

  const patchItem = (guid: string, fn: (i: Item) => Item | null) =>
    setItems((prev) => prev.flatMap((i) => (i.guid === guid ? (fn(i) ?? []) : [i])));

  const actions: ItemActions = {
    ignoreTitle: async (item) => {
      await api('/api/ignores', { method: 'POST', json: { scope: 'title', itemGuid: item.guid } });
      if (filters.showIgnored) patchItem(item.guid, (i) => ({ ...i, ignored: true }));
      else removeLocally(item.guid);
    },
    unignoreTitle: async (item) => {
      await api(`/api/ignores?itemGuid=${encodeURIComponent(item.guid)}`, { method: 'DELETE' });
      patchItem(item.guid, (i) => ({ ...i, ignored: false }));
    },
    ignoreEpisode: async (item, airing: Airing) => {
      await api('/api/ignores', { method: 'POST', json: { scope: 'episode', itemGuid: item.guid, episodeGuid: airing.episodeGuid } });
      // The show leaves the list when its last visible airing is hidden.
      if (!filters.showIgnored && item.airings.every((a) => a.episodeGuid === airing.episodeGuid)) setTotal((n) => n - 1);
      patchItem(item.guid, (i) => {
        const airings = filters.showIgnored
          ? i.airings.map((a) => (a.episodeGuid === airing.episodeGuid ? { ...a, ignored: true } : a))
          : i.airings.filter((a) => a.episodeGuid !== airing.episodeGuid);
        return airings.length ? { ...i, airings } : null;
      });
    },
    unignoreEpisode: async (item, airing) => {
      await api(`/api/ignores?episodeGuid=${encodeURIComponent(airing.episodeGuid!)}`, { method: 'DELETE' });
      patchItem(item.guid, (i) => ({
        ...i,
        airings: i.airings.map((a) => (a.episodeGuid === airing.episodeGuid ? { ...a, ignored: false } : a)),
      }));
    },
    watch: async (item) => {
      await api('/api/wishlist', {
        method: 'POST',
        json: { kind: 'title', type: item.type, guid: item.guid, title: item.title, year: item.year, thumb: item.thumb },
      });
      await reloadWishes();
      flash(t('wishlist.added'));
    },
  };

  // Opens the rule editor prefilled with the filters; the rule then hides what they show.
  const saveAsRule = () => {
    const draft: RuleConditions = {};
    if (filters.type) draft.type = filters.type;
    if (filters.genres.length) draft.genres = filters.genres;
    if (filters.channels.length) draft.channels = filters.channels;
    if (filters.countries.length && config.tmdb) draft.countries = filters.countries;
    if (filters.yearMin) draft.yearMin = Number(filters.yearMin);
    if (filters.yearMax) draft.yearMax = Number(filters.yearMax);
    navigate('/ignored?tab=rules', { state: { draft } });
  };

  const whenOptions: When[] = ['today', 'tomorrow', 'next3', 'next7', 'all'];
  const advancedActive =
    filters.genres.length + filters.channels.length + (config.tmdb ? filters.countries.length : 0) > 0 || !!filters.yearMin || !!filters.yearMax || !!filters.ratingMin;

  return (
    <div className="browse">
      <section className="filters">
        <div className="row">
          <div className="segmented">
            {(['', 'movie', 'show'] as const).map((type) => (
              <button key={type} className={filters.type === type ? 'on' : ''} onClick={() => set('type', type)}>
                {type === '' ? t('filters.all') : type === 'movie' ? t('filters.movies') : t('filters.shows')}
              </button>
            ))}
          </div>
          <input className="search" type="search" placeholder={t('filters.search')} value={filters.q} onChange={(e) => set('q', e.target.value)} />
          <div className="segmented when">
            {whenOptions.map((w) => (
              <button key={w} className={filters.when === w ? 'on' : ''} onClick={() => set('when', w)}>
                {t(w === 'all' ? 'filters.anyTime' : `filters.${w}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <label className="toggle">
            <input type="checkbox" checked={filters.hideScheduled} onChange={(e) => set('hideScheduled', e.target.checked)} />
            {t('filters.hideScheduled')}
          </label>
          <label className="toggle">
            <input type="checkbox" checked={filters.hideLibrary} onChange={(e) => set('hideLibrary', e.target.checked)} />
            {t('filters.hideLibrary')}
          </label>
          <label className="toggle" title={t('filters.recommendedHint')}>
            <input type="checkbox" checked={filters.recommended} onChange={(e) => set('recommended', e.target.checked)} />
            {t('filters.recommended')}
          </label>
          <label className="toggle">
            <input type="checkbox" checked={filters.showIgnored} onChange={(e) => set('showIgnored', e.target.checked)} />
            {t('filters.showIgnored')}
          </label>
          <button className={`link${advancedActive ? ' active' : ''}`} onClick={() => setMoreOpen(!moreOpen)}>
            {moreOpen ? t('filters.less') : t('filters.more')} {advancedActive && '•'}
          </button>
          <span className="spacer" />
          <label className="inline">
            {t('filters.sort')}
            <select
              value={filters.sort}
              onChange={(e) => {
                const sort = e.target.value as SortKey;
                setFilters((f) => ({ ...f, sort, dir: NATURAL_DIR[sort] }));
              }}
            >
              <option value="start">{t('filters.sortStart')}</option>
              <option value="added">{t('filters.sortAdded')}</option>
              <option value="title">{t('filters.sortTitle')}</option>
              <option value="year">{t('filters.sortYear')}</option>
              {config.tmdb && <option value="rating">{t('filters.sortRating')}</option>}
            </select>
          </label>
          <button
            className="icon"
            onClick={() => set('dir', filters.dir === 'asc' ? 'desc' : 'asc')}
            title={t(filters.dir === 'asc' ? 'filters.ascending' : 'filters.descending')}
            aria-label={t(filters.dir === 'asc' ? 'filters.ascending' : 'filters.descending')}
          >
            {filters.dir === 'asc' ? '↑' : '↓'}
          </button>
          <div className="segmented small">
            <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} title={t('view.list')}>☰</button>
            <button className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')} title={t('view.grid')}>▦</button>
          </div>
        </div>
        {moreOpen && (
          <div className="row advanced">
            <MultiSelect
              label={t('filters.genres')}
              emptyLabel={t('filters.anyGenre')}
              options={options.genres.map((g) => ({ value: g, label: g }))}
              value={filters.genres}
              onChange={(v) => set('genres', v)}
            />
            {config.tmdb && (
              <MultiSelect
                label={t('filters.countries')}
                emptyLabel={t('filters.anyCountry')}
                options={countryOptions(options.countries, t('filters.unknownCountry'))}
                value={filters.countries}
                onChange={(v) => set('countries', v)}
              />
            )}
            <MultiSelect
              label={t('filters.channels')}
              emptyLabel={t('filters.anyChannel')}
              options={options.channels.map((c) => ({ value: c.gridKey, label: `${c.vcn ?? ''} ${c.title}`.trim(), icon: c.thumb }))}
              value={filters.channels}
              onChange={(v) => set('channels', v)}
            />
            <div className="field">
              <span className="field-label">{t('filters.year')}</span>
              <div className="pair">
                <input type="number" placeholder={t('filters.from')} value={filters.yearMin} onChange={(e) => set('yearMin', e.target.value)} />
                <input type="number" placeholder={t('filters.to')} value={filters.yearMax} onChange={(e) => set('yearMax', e.target.value)} />
              </div>
            </div>
            {config.tmdb && (
              <div className="field">
                <span className="field-label">{t('filters.rating')}</span>
                <input type="number" min={0} max={10} step={0.5} value={filters.ratingMin} onChange={(e) => set('ratingMin', e.target.value)} />
              </div>
            )}
            <button className="link" onClick={() => setFilters({ ...DEFAULTS, type: filters.type })}>
              {t('filters.reset')}
            </button>
            <button className="link" onClick={saveAsRule} title={t('rules.fromFiltersHint')}>
              {t('rules.fromFilters')}
            </button>
          </div>
        )}
      </section>

      <div className="status-row">
        <span>{t('browse.count', { count: total })}</span>
        <span className="spacer" />
        {status?.lastSyncError && <span className="error">{t('browse.syncError', { error: status.lastSyncError })}</span>}
        <span className="muted">
          {status?.lastSyncAt ? t('browse.lastSync', { date: formatDate(status.lastSyncAt) }) : t('browse.neverSynced')}
        </span>
        <button onClick={refresh} disabled={status?.syncing}>
          {status?.syncing ? t('browse.refreshing') : t('browse.refresh')}
        </button>
      </div>

      {!loading && items.length === 0 && (
        <p className="empty">
          {!status?.lastSyncAt
            ? t('browse.noData')
            : filters.recommended && !status.recommendations?.count
              ? t(status.recommendations ? 'browse.noRecommendations' : 'browse.recommendationsPending')
              : t('browse.empty')}
        </p>
      )}

      <div className={`items ${view}`}>
        {items.map((item) => (
          <ItemCard key={item.guid} item={item} view={view} actions={actions} />
        ))}
      </div>

      {items.length < total && (
        <div className="more">
          <button onClick={() => load(true)} disabled={loading}>
            {loading ? t('common.loading') : t('browse.loadMore')}
          </button>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
