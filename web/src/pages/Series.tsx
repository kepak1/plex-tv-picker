import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api, type FilmSeries, type SeriesData, type SeriesPart } from '../api';
import { useApp } from '../app';
import { ScanStatus, useToolData } from '../components/Recording';
import { localeTag } from '../i18n';
import { img } from '../format';

const today = () => new Date().toISOString().slice(0, 10);
const released = (p: SeriesPart) => !!p.releaseDate && p.releaseDate <= today();
const year = (p: SeriesPart) => (p.releaseDate ? Number(p.releaseDate.slice(0, 4)) : null);

/** Film series with at least one movie in the library; missing parts can go on the wishlist. */
export function Series() {
  const { t } = useTranslation();
  const { config, wishes, reloadWishes, reloadTools } = useApp();
  const { data, setData, refresh, error } = useToolData<SeriesData>('/api/tools/series');
  const [query, setQuery] = useState('');
  const [onlyIncomplete, setOnlyIncomplete] = useState(true);
  const [showHidden, setShowHidden] = useState(false);
  const [adding, setAdding] = useState(false);

  const onWishlist = (p: SeriesPart) =>
    wishes.some(
      (w) =>
        w.kind === 'title' &&
        w.type !== 'show' &&
        (w.tmdb_id === p.tmdbId ||
          (w.title.toLocaleLowerCase() === p.title.toLocaleLowerCase() && (!w.year || !year(p) || Math.abs(w.year - year(p)!) <= 1))),
    );
  /** Missing parts that could go on the wishlist: not hidden and not there yet. */
  const wishable = (s: FilmSeries) => s.parts.filter((p) => !p.ratingKey && !p.hidden && !onWishlist(p));

  const addToWishlist = async (parts: SeriesPart[]) => {
    setAdding(true);
    try {
      for (const p of parts) {
        await api('/api/wishlist', { method: 'POST', json: { kind: 'title', type: 'movie', tmdbId: p.tmdbId, title: p.title, year: year(p), thumb: p.poster } });
      }
      await reloadWishes();
    } finally {
      setAdding(false);
    }
  };

  const setHidden = async (kind: 'series' | 'movie', id: number, hidden: boolean) => {
    await api(`/api/tools/series/hidden/${kind}/${id}`, { method: hidden ? 'PUT' : 'DELETE' });
    setData(
      (d) =>
        d && {
          ...d,
          series: d.series.map((s) =>
            kind === 'series'
              ? s.id === id ? { ...s, hidden } : s
              : { ...s, parts: s.parts.map((p) => (p.tmdbId === id ? { ...p, hidden } : p)) },
          ),
        },
    );
    await reloadTools();
  };

  const missing = (s: FilmSeries) => s.parts.filter((p) => !p.ratingKey && !p.hidden);
  const visible = useMemo(() => {
    const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return (data?.series ?? []).filter((s) => {
      if (s.hidden && !showHidden) return false;
      if (onlyIncomplete && missing(s).length === 0) return false;
      const text = [s.name, ...s.parts.map((p) => p.title)].join(' ').toLocaleLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [data, query, onlyIncomplete, showHidden]);

  const hiddenCount = (data?.series ?? []).reduce((n, s) => n + (s.hidden ? 1 : 0) + s.parts.filter((p) => p.hidden).length, 0);
  const incomplete = (data?.series ?? []).filter((s) => !s.hidden && missing(s).some(released)).length;

  return (
    <div className="page narrow">
      <Link to="/tools" className="back muted small">← {t('tools.title')}</Link>
      <h1>{t('series.title')}</h1>
      <p className="muted">{t('series.text')}</p>

      {!config.tmdb ? (
        <p className="empty">{t('series.needsTmdb')}</p>
      ) : (
        <>
          <ScanStatus scannedAt={data?.scannedAt ?? null} scanning={!!data?.scanning} error={error} onRefresh={refresh} />
          {data && (
            <>
              <input className="search" type="search" placeholder={t('series.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
              <div className="status-row">
                <span>{t('series.summary', { count: data.series.length, incomplete })}</span>
                <label className="toggle muted small">
                  <input type="checkbox" checked={onlyIncomplete} onChange={(e) => setOnlyIncomplete(e.target.checked)} />
                  {t('series.onlyIncomplete')}
                </label>
                {hiddenCount > 0 && (
                  <label className="toggle muted small">
                    <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
                    {t('series.showHidden', { count: hiddenCount })}
                  </label>
                )}
              </div>
              {visible.length === 0 && <p className="empty">{data.series.length === 0 ? t('series.none') : t('duplicates.noMatches')}</p>}
              {visible.map((s) => (
                <SeriesCard
                  key={s.id}
                  series={s}
                  showHidden={showHidden}
                  wishable={wishable(s)}
                  onWishlist={onWishlist}
                  adding={adding}
                  onAdd={addToWishlist}
                  onHide={setHidden}
                />
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

function SeriesCard({
  series: s,
  showHidden,
  wishable,
  onWishlist,
  adding,
  onAdd,
  onHide,
}: {
  series: FilmSeries;
  showHidden: boolean;
  wishable: SeriesPart[];
  onWishlist: (p: SeriesPart) => boolean;
  adding: boolean;
  onAdd: (parts: SeriesPart[]) => void;
  onHide: (kind: 'series' | 'movie', id: number, hidden: boolean) => void;
}) {
  const { t } = useTranslation();
  const { plexLink } = useApp();
  const owned = s.parts.filter((p) => p.ratingKey).length;
  const parts = s.parts.filter((p) => showHidden || !p.hidden);

  return (
    <div className={`dup-group series${s.hidden ? ' dimmed' : ''}`}>
      <div className="dup-head">
        {s.poster ? <img className="series-poster" src={img(s.poster, 92)} alt="" loading="lazy" /> : <span className="series-poster" />}
        <span className="series-name">
          <b>{s.name}</b>
          <span className="muted small">{t('series.owned', { owned, total: s.parts.length })}</span>
        </span>
        {!s.hidden && wishable.length > 0 && (
          <button className="small" disabled={adding} onClick={() => onAdd(wishable)}>
            ★ {t('series.addMissing', { count: wishable.length })}
          </button>
        )}
        <button className="small" onClick={() => onHide('series', s.id, !s.hidden)}>
          {s.hidden ? t('duplicates.unignore') : t('series.notInterested')}
        </button>
      </div>
      <ul className="series-parts">
        {parts.map((p) => (
          <li key={p.tmdbId} className={p.ratingKey ? 'owned' : p.hidden ? 'dimmed' : ''}>
            <span className="series-mark">{p.ratingKey ? '✓' : '·'}</span>
            <span className="series-title">
              {p.title}
              {p.releaseDate && <span className="muted"> ({p.releaseDate.slice(0, 4)})</span>}
            </span>
            {p.ratingKey ? (
              <a className="when" href={plexLink(`/library/metadata/${p.ratingKey}`)} target="_blank" rel="noreferrer">
                {t('tools.openInPlex')}
              </a>
            ) : (
              <>
                {!released(p) && (
                  <span className="badge">
                    {p.releaseDate
                      ? t('series.upcoming', { date: new Date(`${p.releaseDate}T12:00:00`).toLocaleDateString(localeTag(), { dateStyle: 'medium' }) })
                      : t('series.announced')}
                  </span>
                )}
                {onWishlist(p) ? (
                  <span className="badge ok">★ {t('short.onWishlist')}</span>
                ) : (
                  !p.hidden && (
                    <button className="small" disabled={adding} onClick={() => onAdd([p])}>
                      ★ {t('short.wish')}
                    </button>
                  )
                )}
                <button className="small link" onClick={() => onHide('movie', p.tmdbId, !p.hidden)}>
                  {p.hidden ? t('duplicates.unignore') : t('series.hideMovie')}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
