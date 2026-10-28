import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useApp } from '../app';

/** Tool tiles; each tool has its own page under /tools. */
export function Tools() {
  const { t } = useTranslation();
  const { config, tools, reloadTools } = useApp();

  useEffect(() => {
    void reloadTools();
  }, [reloadTools]);

  const duplicates = tools?.duplicates.count ?? 0;
  const short = tools?.short.count ?? 0;
  const series = tools?.series.count ?? 0;

  return (
    <div className="page narrow">
      <h1>{t('tools.title')}</h1>
      <p className="muted">{t('tools.text')}</p>
      <div className="tool-tiles">
        <Link to="/tools/duplicates" className="tool-tile">
          <span className="tool-name">
            {t('duplicates.title')}
            {duplicates > 0 && <span className="nav-count">{duplicates}</span>}
          </span>
          <span className="muted small">{t('duplicates.tile')}</span>
        </Link>
        <Link to="/tools/short" className="tool-tile">
          <span className="tool-name">
            {t('short.title')}
            {short > 0 && <span className="nav-count">{short}</span>}
          </span>
          <span className="muted small">{t('short.tile')}</span>
        </Link>
        {config.tmdb && (
          <Link to="/tools/series" className="tool-tile">
            <span className="tool-name">
              {t('series.title')}
              {series > 0 && <span className="nav-count muted-count">{series}</span>}
            </span>
            <span className="muted small">{t('series.tile')}</span>
          </Link>
        )}
      </div>
    </div>
  );
}
