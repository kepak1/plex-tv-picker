import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type Suggestion } from '../api';
import { useApp } from '../app';
import { channelName, episodeLabel, formatAiring, img } from '../format';

const MATCHES_SHOWN = 5;

export function Wishlist() {
  const { t } = useTranslation();
  const { wishes, reloadWishes, plexLink } = useApp();
  const [query, setQuery] = useState('');
  const [phraseType, setPhraseType] = useState<'' | 'movie' | 'show'>('');
  const [suggestions, setSuggestions] = useState<{ guide: Suggestion[]; plex: Suggestion[] }>({ guide: [], plex: [] });

  useEffect(() => {
    void reloadWishes();
  }, [reloadWishes]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setSuggestions({ guide: [], plex: [] });
      return;
    }
    let cancelled = false;
    const id = setTimeout(async () => {
      const res = await api<{ guide: Suggestion[]; plex: Suggestion[] }>(`/api/wishlist/suggest?q=${encodeURIComponent(query.trim())}`);
      if (!cancelled) setSuggestions(res);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [query]);

  // Wishes found in the guide first, soonest airing first; the rest stay newest first.
  const sorted = useMemo(
    () =>
      [...wishes].sort((a, b) => {
        const na = a.matches[0]?.next.beginsAt;
        const nb = b.matches[0]?.next.beginsAt;
        if (na != null && nb != null) return na - nb;
        return na != null ? -1 : nb != null ? 1 : 0;
      }),
    [wishes],
  );
  const found = wishes.filter((w) => w.matchCount > 0).length;

  const add = async (body: object) => {
    await api('/api/wishlist', { method: 'POST', json: body });
    setQuery('');
    await reloadWishes();
  };

  const remove = async (id: number) => {
    await api(`/api/wishlist/${id}`, { method: 'DELETE' });
    await reloadWishes();
  };

  const renderSuggestion = (s: Suggestion) => (
    <li key={s.guid}>
      <button className="suggestion" onClick={() => add({ kind: 'title', ...s })}>
        {s.thumb ? <img src={img(s.thumb, 80)} alt="" loading="lazy" /> : <span className="thumb-empty" />}
        <span>
          <b>{s.title}</b> {s.year && <span className="muted">({s.year})</span>}
          <span className="badge type">{t(`item.${s.type}`)}</span>
        </span>
        <span className="add">＋</span>
      </button>
    </li>
  );

  return (
    <div className="page narrow">
      <h1>{t('wishlist.title')}</h1>
      <p className="muted">{t('wishlist.text')}</p>

      <div className="wish-search">
        <input type="search" placeholder={t('wishlist.searchPlaceholder')} value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        {query.trim().length >= 2 && (
          <div className="suggestions">
            <div className="phrase-row">
              <button className="primary" onClick={() => add({ kind: 'phrase', type: phraseType || null, title: query.trim() })}>
                {t('wishlist.addPhrase', { phrase: query.trim() })}
              </button>
              <select value={phraseType} onChange={(e) => setPhraseType(e.target.value as typeof phraseType)}>
                <option value="">{t('wishlist.anyType')}</option>
                <option value="movie">{t('item.movie')}</option>
                <option value="show">{t('item.show')}</option>
              </select>
              <span className="muted small">{t('wishlist.phraseHint')}</span>
            </div>
            {suggestions.guide.length > 0 && (
              <>
                <h3>{t('wishlist.suggestionsGuide')}</h3>
                <ul>{suggestions.guide.map(renderSuggestion)}</ul>
              </>
            )}
            {suggestions.plex.length > 0 && (
              <>
                <h3>{t('wishlist.suggestionsPlex')}</h3>
                <ul>{suggestions.plex.map(renderSuggestion)}</ul>
              </>
            )}
          </div>
        )}
      </div>

      {wishes.length === 0 ? (
        <p className="empty">{t('wishlist.empty')}</p>
      ) : (
        <>
          {found > 0 && <p className="ok-text small">{t('wishlist.foundCount', { count: found })}</p>}
          <ul className="rows">
            {sorted.map((w) => (
              <li key={w.id} className={`row-item${w.matchCount ? ' found' : ''}`}>
                {w.thumb ? <img src={img(w.thumb, 100)} alt="" className="row-thumb" loading="lazy" /> : <span className="row-thumb empty">“”</span>}
                <div className="grow">
                  <div>
                    <b>{w.title}</b> {w.year && <span className="muted">({w.year})</span>}{' '}
                    {w.kind === 'phrase' ? <span className="badge">{t('wishlist.phrase')}</span> : null}
                    {w.type && <span className="badge type">{t(`item.${w.type}`)}</span>}
                    {w.matchCount > 0 && <span className="badge ok">{t('wishlist.found')}</span>}
                  </div>
                  {w.matchCount ? (
                    <ul className="wish-matches">
                      {w.matches.slice(0, MATCHES_SHOWN).map((m) => (
                        <li key={m.guid}>
                          <a className="when" href={plexLink(m.epgKey)} target="_blank" rel="noreferrer">
                            {formatAiring(m.next.beginsAt)}
                          </a>
                          <span>
                            {m.title}
                            {m.year && <span className="muted"> ({m.year})</span>}
                            {m.type === 'show' && episodeLabel(m.next) && <span className="muted"> · {episodeLabel(m.next)}</span>}
                          </span>
                          <span className="muted">{[m.next.channelVcn, channelName(m.next.channelTitle)].filter(Boolean).join(' ')}</span>
                          <a className="small" href={plexLink(m.epgKey)} target="_blank" rel="noreferrer">
                            {t('item.openInPlex')}
                          </a>
                        </li>
                      ))}
                      {w.matchCount > MATCHES_SHOWN && <li className="muted">{t('wishlist.moreMatches', { count: w.matchCount - MATCHES_SHOWN })}</li>}
                    </ul>
                  ) : (
                    <div className="muted small">{t('wishlist.notInGuide')}</div>
                  )}
                </div>
                <button onClick={() => remove(w.id)}>{t('wishlist.remove')}</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
