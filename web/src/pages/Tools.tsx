import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useApp } from '../app';

/** Tool tiles; each tool has its own page under /tools. */
export function Tools() {
  const { t } = useTranslation();
  const { tools, reloadTools } = useApp();

  useEffect(() => {
    void reloadTools();
  }, [reloadTools]);

  const duplicates = tools?.duplicates.count ?? 0;

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
      </div>
    </div>
  );
}
