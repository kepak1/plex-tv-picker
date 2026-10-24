import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type Ignore } from '../api';
import { formatDate, img } from '../format';

const PAGE = 100;

interface IgnoreList {
  total: number;
  counts: { title: number; episode: number };
  items: Ignore[];
}

export function Ignored() {
  const { t } = useTranslation();
  const [data, setData] = useState<IgnoreList | null>(null);
  const [scope, setScope] = useState<'' | 'title' | 'episode'>('');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  const load = useCallback(
    async (append: boolean, offset = 0) => {
      const id = ++requestId.current;
      setLoading(true);
      const params = new URLSearchParams({ offset: String(offset), limit: String(PAGE) });
      if (scope) params.set('scope', scope);
      if (debounced) params.set('q', debounced);
      try {
        const res = await api<IgnoreList>(`/api/ignores?${params}`);
        if (id !== requestId.current) return;
        setData((prev) => (append && prev ? { ...res, items: [...prev.items, ...res.items] } : res));
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [scope, debounced],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const restore = async (row: Ignore) => {
    await api(`/api/ignores?id=${row.id}`, { method: 'DELETE' });
    setData((d) =>
      d && {
        total: d.total - 1,
        counts: { ...d.counts, [row.scope]: d.counts[row.scope] - 1 },
        items: d.items.filter((x) => x.id !== row.id),
      },
    );
  };

  const all = data ? data.counts.title + data.counts.episode : 0;
  const clearCount = scope && data ? data.counts[scope] : all;

  const clear = async () => {
    const question = scope === 'title' ? 'ignored.confirmClearTitles' : scope === 'episode' ? 'ignored.confirmClearEpisodes' : 'ignored.confirmClearAll';
    if (!window.confirm(t(question, { count: clearCount }))) return;
    const { removed } = await api<{ removed: number }>('/api/ignores/clear', { method: 'POST', json: { scope: scope || undefined } });
    setMessage(t('ignored.cleared', { count: removed }));
    setTimeout(() => setMessage(null), 4000);
    await load(false);
  };

  const scopes: { value: typeof scope; label: string }[] = [
    { value: '', label: `${t('filters.all')} (${all})` },
    { value: 'title', label: `${t('ignored.titles')} (${data?.counts.title ?? 0})` },
    { value: 'episode', label: `${t('ignored.episodes')} (${data?.counts.episode ?? 0})` },
  ];

  return (
    <div className="page narrow">
      <h1>{t('ignored.title')}</h1>
      <p className="muted">{t('ignored.text')}</p>

      {message && <p className="ok-text">{message}</p>}
      {data && all === 0 ? (
        <p className="empty">{t('ignored.empty')}</p>
      ) : (
        <>
          <div className="ignored-toolbar">
            <div className="segmented">
              {scopes.map((s) => (
                <button key={s.value} className={scope === s.value ? 'on' : ''} onClick={() => setScope(s.value)}>
                  {s.label}
                </button>
              ))}
            </div>
            <span className="spacer" />
            <button className="danger" onClick={clear} disabled={!clearCount}>
              {scope === 'title' ? t('ignored.clearTitles') : scope === 'episode' ? t('ignored.clearEpisodes') : t('ignored.clearAll')}
            </button>
          </div>
          <input type="search" className="search" placeholder={t('filters.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
          {data && debounced && <p className="muted small">{t('ignored.found', { count: data.total })}</p>}
        </>
      )}

      <ul className="rows">
        {data?.items.map((r) => (
          <li key={r.id} className="row-item">
            {r.thumb ? <img src={img(r.thumb, 100)} alt="" className="row-thumb" loading="lazy" /> : <span className="row-thumb empty" />}
            <div className="grow">
              <div>
                <b>{r.title}</b>
                {r.episode_label && <span> · {r.episode_label}</span>}
              </div>
              <div className="muted small">
                {r.scope === 'title' ? t('ignored.wholeTitle') : t('ignored.episode')} · {t('ignored.since', { date: formatDate(r.created_at) })}
              </div>
            </div>
            <button onClick={() => restore(r)}>{t('ignored.restore')}</button>
          </li>
        ))}
      </ul>

      {data && data.items.length < data.total && (
        <div className="more">
          <button onClick={() => load(true, data.items.length)} disabled={loading}>
            {loading ? t('common.loading') : `${t('browse.loadMore')} (${data.total - data.items.length})`}
          </button>
        </div>
      )}
    </div>
  );
}
