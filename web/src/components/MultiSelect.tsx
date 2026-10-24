import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Option {
  value: string;
  label: string;
  icon?: string | null;
}

export function MultiSelect({
  label,
  emptyLabel,
  options,
  value,
  onChange,
}: {
  label: string;
  emptyLabel: string;
  options: Option[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const selected = new Set(value);
  const shown = useMemo(() => {
    const f = filter.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(f));
  }, [options, filter]);

  const toggle = (v: string) => onChange(selected.has(v) ? value.filter((x) => x !== v) : [...value, v]);
  const summary =
    value.length === 0
      ? emptyLabel
      : value.length === 1
        ? (options.find((o) => o.value === value[0])?.label ?? value[0])
        : t('filters.selected', { count: value.length });

  return (
    <div className="multiselect" ref={ref}>
      <span className="field-label">{label}</span>
      <button type="button" className={`select-button${value.length ? ' active' : ''}`} onClick={() => setOpen(!open)}>
        <span>{summary}</span>
        <span className="caret">▾</span>
      </button>
      {open && (
        <div className="dropdown">
          <input autoFocus placeholder="…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          {value.length > 0 && (
            <button type="button" className="link small" onClick={() => onChange([])}>
              {t('filters.reset')}
            </button>
          )}
          <div className="options">
            {shown.map((o) => (
              <label key={o.value} className="option">
                <input type="checkbox" checked={selected.has(o.value)} onChange={() => toggle(o.value)} />
                {o.icon && <img src={o.icon} alt="" loading="lazy" />}
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
