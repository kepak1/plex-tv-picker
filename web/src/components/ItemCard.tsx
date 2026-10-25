import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Airing, Item } from '../api';
import { useApp } from '../app';
import { channelName, countryName, episodeLabel, flag, formatAiring, img } from '../format';

export interface ItemActions {
  ignoreTitle: (item: Item) => void;
  unignoreTitle: (item: Item) => void;
  ignoreEpisode: (item: Item, airing: Airing) => void;
  unignoreEpisode: (item: Item, airing: Airing) => void;
  watch: (item: Item) => void;
}

export function ItemCard({ item, view, actions }: { item: Item; view: 'list' | 'grid'; actions: ItemActions }) {
  const { t } = useTranslation();
  const { plexLink, wishes } = useApp();
  const [expanded, setExpanded] = useState(false);
  const [showAirings, setShowAirings] = useState(false);
  const watching = wishes.some((w) => w.matches.some((m) => m.guid === item.guid));
  const next = item.airings[0];
  const mainLink = plexLink(item.type === 'movie' ? next.epgKey : item.epgKey);
  const googleQuery = [item.title, item.year, t(`item.googleKind.${item.type}`)].filter(Boolean).join(' ');
  const googleLink = `https://www.google.com/search?q=${encodeURIComponent(googleQuery)}`;

  return (
    <article className={`card ${view}${item.ignored || item.hiddenBy ? ' dimmed' : ''}`}>
      <a className="poster" href={mainLink} target="_blank" rel="noreferrer">
        {item.thumb ? <img src={img(item.thumb, view === 'grid' ? 360 : 280)} alt="" loading="lazy" /> : <div className="poster-empty">{item.title}</div>}
        <div className="poster-badges">
          {item.isNew && <span className="badge new">{t('item.new')}</span>}
          {item.rating != null && <span className="badge rating">★ {item.rating.toFixed(1)}</span>}
        </div>
      </a>
      <div className="body">
        <div className="title-row">
          <a className="title" href={mainLink} target="_blank" rel="noreferrer">
            {item.title}
          </a>
          {item.year && <span className="muted"> ({item.year})</span>}
        </div>
        <div className="meta">
          <span className="badge type">{t(`item.${item.type}`)}</span>
          {item.subscribed && <span className="badge ok">{t('item.subscribed')}</span>}
          {item.ignored && <span className="badge">{t('item.ignoredBadge')}</span>}
          {item.hiddenBy && <span className="badge">{t('item.hiddenByRule', { name: item.hiddenBy })}</span>}
          {(item.countries ?? []).slice(0, view === 'grid' ? 1 : 3).map((c) => (
            <span key={c} className="country" title={countryName(c)}>
              {flag(c)} {view === 'list' && countryName(c)}
            </span>
          ))}
          {item.genres.slice(0, view === 'grid' ? 2 : 6).map((g) => (
            <span key={g} className="genre">{g}</span>
          ))}
        </div>
        <div className="next">
          {next.channelThumb && <img src={next.channelThumb} alt="" className="chlogo" loading="lazy" />}
          <span>
            {formatAiring(next.beginsAt)} · {channelName(next.channelTitle)}
          </span>
        </div>
        {item.summary && (
          <p className={`summary${expanded ? ' open' : ''}`} onClick={() => setExpanded(!expanded)} title={expanded ? t('item.readLess') : t('item.readMore')}>
            {item.summary}
          </p>
        )}
        <div className="actions">
          <a className="button primary" href={mainLink} target="_blank" rel="noreferrer">
            {t('item.openInPlex')}
          </a>
          {item.ignored ? (
            <button onClick={() => actions.unignoreTitle(item)}>{t('item.unignore')}</button>
          ) : (
            <button onClick={() => actions.ignoreTitle(item)}>{item.type === 'show' ? t('item.ignoreTitle') : t('item.ignore')}</button>
          )}
          <button className={watching ? 'on' : ''} disabled={watching} onClick={() => actions.watch(item)}>
            {watching ? `✓ ${t('item.watching')}` : `☆ ${t('item.watch')}`}
          </button>
          <a className="button" href={googleLink} target="_blank" rel="noreferrer">
            {t('item.google')}
          </a>
          <button className="link" onClick={() => setShowAirings(!showAirings)}>
            {showAirings ? t('item.hideAirings') : t('item.airings', { count: item.airings.length })} {showAirings ? '▴' : '▾'}
          </button>
        </div>
        {showAirings && (
          <ul className="airings">
            {item.airings.map((a) => (
              <li key={a.id} className={a.ignored || a.hiddenBy ? 'dimmed' : ''}>
                <a href={plexLink(a.epgKey)} target="_blank" rel="noreferrer" className="when">
                  {formatAiring(a.beginsAt)}
                </a>
                <span className="channel">
                  {a.channelThumb && <img src={a.channelThumb} alt="" className="chlogo" loading="lazy" />}
                  {channelName(a.channelTitle)}
                </span>
                {a.episodeGuid && (
                  <span className="ep">
                    <b>{episodeLabel(a)}</b> {a.episodeTitle !== item.title ? a.episodeTitle : ''}
                  </span>
                )}
                <span className="flags">
                  {a.premiere && <span className="badge new">{t('item.premiere')}</span>}
                  {a.scheduled && <span className="badge ok">{t('item.scheduled')}</span>}
                  {a.inLibrary && <span className="badge lib">{t('item.inLibrary')}</span>}
                  {a.hiddenBy && <span className="badge">{t('item.hiddenByRule', { name: a.hiddenBy })}</span>}
                </span>
                {a.episodeGuid &&
                  (a.ignored ? (
                    <button className="link small" onClick={() => actions.unignoreEpisode(item, a)}>
                      {t('item.unignore')}
                    </button>
                  ) : (
                    <button className="link small" onClick={() => actions.ignoreEpisode(item, a)}>
                      {t('item.ignoreEpisode')}
                    </button>
                  ))}
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}
