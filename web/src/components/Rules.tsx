import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type FilterOptions, type Rule, type RuleConditions } from '../api';
import { useApp } from '../app';
import { channelName, countryName, countryOptions, UNKNOWN_COUNTRY } from '../format';
import { MultiSelect } from './MultiSelect';

interface Form {
  id?: number;
  name: string;
  enabled: boolean;
  type: '' | 'movie' | 'show';
  genres: string[];
  channels: string[];
  countries: string[];
  yearMin: string;
  yearMax: string;
  ratingBelow: string;
}

const EMPTY: Form = { name: '', enabled: true, type: '', genres: [], channels: [], countries: [], yearMin: '', yearMax: '', ratingBelow: '' };

function toForm(c: RuleConditions, rest: Partial<Form> = {}): Form {
  return {
    ...EMPTY,
    type: c.type ?? '',
    genres: c.genres ?? [],
    channels: c.channels ?? [],
    countries: c.countries ?? [],
    yearMin: c.yearMin != null ? String(c.yearMin) : '',
    yearMax: c.yearMax != null ? String(c.yearMax) : '',
    ratingBelow: c.ratingBelow != null ? String(c.ratingBelow) : '',
    ...rest,
  };
}

function toConditions(f: Form, tmdb: boolean): RuleConditions {
  const c: RuleConditions = {};
  if (f.type) c.type = f.type;
  if (f.genres.length) c.genres = f.genres;
  if (f.channels.length) c.channels = f.channels;
  if (tmdb && f.countries.length) c.countries = f.countries;
  if (f.yearMin) c.yearMin = Number(f.yearMin);
  if (f.yearMax) c.yearMax = Number(f.yearMax);
  if (tmdb && f.ratingBelow) c.ratingBelow = Number(f.ratingBelow);
  return c;
}

/** Auto-hide rules: list with on/off switches, and an editor with a live match count. */
export function Rules({ draft }: { draft?: RuleConditions }) {
  const { t } = useTranslation();
  const { config } = useApp();
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [options, setOptions] = useState<FilterOptions>({ genres: [], channels: [], countries: [] });
  const [form, setForm] = useState<Form | null>(() => (draft ? toForm(draft) : null));
  const [preview, setPreview] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setRules(await api<Rule[]>('/api/rules')), []);

  useEffect(() => {
    void load();
    void api<FilterOptions>('/api/filters').then(setOptions);
  }, [load]);

  const conditions = form ? toConditions(form, config.tmdb) : null;
  const conditionsKey = JSON.stringify(conditions);
  useEffect(() => {
    if (!conditions || Object.keys(conditions).length === 0) {
      setPreview(null);
      return;
    }
    const id = setTimeout(async () => {
      const res = await api<{ matchCount: number }>('/api/rules/preview', { method: 'POST', json: { conditions } });
      setPreview(res.matchCount);
    }, 300);
    return () => clearTimeout(id);
  }, [conditionsKey]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => f && { ...f, [key]: value });

  const save = async () => {
    if (!form || !conditions) return;
    if (Object.keys(conditions).length === 0) return setError(t('rules.needCondition'));
    const body = { name: form.name.trim() || t('rules.defaultName'), enabled: form.enabled, conditions };
    try {
      if (form.id) await api(`/api/rules/${form.id}`, { method: 'PUT', json: body });
      else await api('/api/rules', { method: 'POST', json: body });
      setForm(null);
      setError(null);
      await load();
    } catch (err) {
      setError(String(err));
    }
  };

  const toggle = async (rule: Rule) => {
    await api(`/api/rules/${rule.id}`, { method: 'PUT', json: { name: rule.name, enabled: !rule.enabled, conditions: rule.conditions } });
    await load();
  };

  const remove = async (rule: Rule) => {
    if (!window.confirm(t('rules.confirmDelete', { name: rule.name }))) return;
    await api(`/api/rules/${rule.id}`, { method: 'DELETE' });
    await load();
  };

  const channelLabel = (key: string) => {
    const c = options.channels.find((x) => x.gridKey === key);
    return c ? channelName(c.title) : key;
  };
  const countryLabel = (code: string) => (code === UNKNOWN_COUNTRY ? t('filters.unknownCountry') : countryName(code));
  const short = (values: string[], label: (v: string) => string) =>
    values.slice(0, 3).map(label).join(', ') + (values.length > 3 ? ` +${values.length - 3}` : '');

  const describe = (c: RuleConditions) => {
    const parts: string[] = [];
    if (c.type) parts.push(t(c.type === 'movie' ? 'filters.movies' : 'filters.shows'));
    if (c.genres) parts.push(short(c.genres, (g) => g));
    if (c.countries) parts.push(short(c.countries, countryLabel));
    if (c.yearMin != null && c.yearMax != null) parts.push(t('rules.yearsBetween', { from: c.yearMin, to: c.yearMax }));
    else if (c.yearMin != null) parts.push(t('rules.yearsFrom', { from: c.yearMin }));
    else if (c.yearMax != null) parts.push(t('rules.yearsTo', { to: c.yearMax }));
    if (c.ratingBelow != null) parts.push(t('rules.ratingBelowShort', { rating: c.ratingBelow }));
    if (c.channels) parts.push(t('rules.onChannels', { channels: short(c.channels, channelLabel) }));
    return parts.join(' · ');
  };

  return (
    <div className="rules">
      <p className="muted">{t('rules.text')}</p>

      {form ? (
        <div className="rule-editor">
          <label className="field">
            <span className="field-label">{t('rules.name')}</span>
            <input value={form.name} placeholder={t('rules.defaultName')} onChange={(e) => set('name', e.target.value)} />
          </label>
          <div className="field">
            <span className="field-label">{t('rules.type')}</span>
            <div className="segmented">
              {(['', 'movie', 'show'] as const).map((type) => (
                <button key={type} className={form.type === type ? 'on' : ''} onClick={() => set('type', type)}>
                  {type === '' ? t('wishlist.anyType') : type === 'movie' ? t('filters.movies') : t('filters.shows')}
                </button>
              ))}
            </div>
          </div>
          <div className="row">
            <MultiSelect
              label={t('filters.genres')}
              emptyLabel={t('rules.anyGenre')}
              options={options.genres.map((g) => ({ value: g, label: g }))}
              value={form.genres}
              onChange={(v) => set('genres', v)}
            />
            {config.tmdb && (
              <MultiSelect
                label={t('filters.countries')}
                emptyLabel={t('rules.anyCountry')}
                options={countryOptions(options.countries, t('filters.unknownCountry'))}
                value={form.countries}
                onChange={(v) => set('countries', v)}
              />
            )}
            <MultiSelect
              label={t('filters.channels')}
              emptyLabel={t('rules.anyChannel')}
              options={options.channels.map((c) => ({ value: c.gridKey, label: `${c.vcn ?? ''} ${c.title}`.trim(), icon: c.thumb }))}
              value={form.channels}
              onChange={(v) => set('channels', v)}
            />
            <div className="field">
              <span className="field-label">{t('filters.year')}</span>
              <div className="pair">
                <input type="number" placeholder={t('filters.from')} value={form.yearMin} onChange={(e) => set('yearMin', e.target.value)} />
                <input type="number" placeholder={t('filters.to')} value={form.yearMax} onChange={(e) => set('yearMax', e.target.value)} />
              </div>
            </div>
            {config.tmdb && (
              <div className="field">
                <span className="field-label">{t('rules.ratingBelow')}</span>
                <input type="number" min={0} max={10} step={0.5} value={form.ratingBelow} onChange={(e) => set('ratingBelow', e.target.value)} />
              </div>
            )}
          </div>
          {form.channels.length > 0 && <p className="muted small">{t('rules.channelHint')}</p>}
          <p className="muted small">{t(config.tmdb ? 'rules.missingHint' : 'rules.missingHintNoTmdb')}</p>
          <div className="actions">
            <button className="primary" onClick={save}>{t('settings.save')}</button>
            <button onClick={() => { setForm(null); setError(null); }}>{t('common.cancel')}</button>
            <span className="muted">{preview != null && t('rules.matches', { count: preview })}</span>
          </div>
          {error && <p className="error">{error}</p>}
        </div>
      ) : (
        <button className="primary" onClick={() => setForm({ ...EMPTY })}>+ {t('rules.add')}</button>
      )}

      {rules && rules.length === 0 && !form && <p className="empty">{t('rules.empty')}</p>}
      <ul className="rows">
        {rules?.map((r) => (
          <li key={r.id} className={`row-item${r.enabled ? '' : ' dimmed'}`}>
            <label className="toggle" title={t(r.enabled ? 'rules.disable' : 'rules.enable')}>
              <input type="checkbox" checked={r.enabled} onChange={() => toggle(r)} />
            </label>
            <div className="grow">
              <div><b>{r.name}</b></div>
              <div className="muted small">{describe(r.conditions)}</div>
              <div className="muted small">{r.enabled ? t('rules.matches', { count: r.matchCount }) : t('rules.disabled')}</div>
            </div>
            <button onClick={() => setForm(toForm(r.conditions, { id: r.id, name: r.name, enabled: r.enabled }))}>{t('rules.edit')}</button>
            <button className="danger" onClick={() => remove(r)}>{t('rules.delete')}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
