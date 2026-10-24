import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type Ignore } from '../api';
import { formatDate, img } from '../format';

export function Ignored() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Ignore[] | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    void api<Ignore[]>('/api/ignores').then(setRows);
  }, []);

  const restore = async (row: Ignore) => {
    await api(`/api/ignores?id=${row.id}`, { method: 'DELETE' });
    setRows((r) => r?.filter((x) => x.id !== row.id) ?? null);
  };

  const shown = (rows ?? []).filter((r) => r.title.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="page narrow">
      <h1>{t('ignored.title')}</h1>
      <p className="muted">{t('ignored.text')}</p>
      {rows && rows.length > 0 && (
        <input type="search" className="search" placeholder={t('filters.search')} value={filter} onChange={(e) => setFilter(e.target.value)} />
      )}
      {rows && rows.length === 0 && <p className="empty">{t('ignored.empty')}</p>}
      <ul className="rows">
        {shown.map((r) => (
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
    </div>
  );
}
