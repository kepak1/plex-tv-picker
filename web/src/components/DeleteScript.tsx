import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { LibraryCopy } from '../api';
import { useApp } from '../app';
import { formatSize } from '../format';
import { buildScript, filesOf, mapPath, type CopyPlan, type Operations, type PathMap, type Plans } from './plan';

// Selected files, planned renames and joins, and the bash script that carries them out. RecPick
// never changes files itself: the user downloads the script and runs it where the files are.

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or blocked storage: the selection just isn't remembered.
  }
}

/** Selected copies (by Plex media id) of one tool page, remembered in this browser. */
export function useSelection(tool: string, available: LibraryCopy[] | null) {
  const key = `recpick.selection.${tool}`;
  const [selected, setSelected] = useState<Set<number>>(() => new Set(readStorage<number[]>(key, [])));

  // Copies that are gone after a refresh (deleted, replaced) drop out of the selection.
  useEffect(() => {
    if (!available) return;
    const ids = new Set(available.map((c) => c.mediaId));
    setSelected((s) => {
      const kept = [...s].filter((id) => ids.has(id));
      return kept.length === s.size ? s : new Set(kept);
    });
  }, [available]);

  useEffect(() => writeStorage(key, [...selected]), [key, selected]);

  const toggle = useCallback((id: number) => {
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);
  const add = useCallback((ids: number[]) => setSelected((s) => new Set([...s, ...ids])), []);
  const remove = useCallback(
    (ids: number[]) =>
      setSelected((s) => {
        if (!ids.some((id) => s.has(id))) return s;
        const next = new Set(s);
        for (const id of ids) next.delete(id);
        return next;
      }),
    [],
  );
  const clear = useCallback(() => setSelected(new Set()), []);

  return { selected, toggle, add, remove, clear };
}

/** Planned joins and renames per copy, remembered in this browser like the selection. */
export function usePlans(tool: string, available: LibraryCopy[] | null) {
  const key = `recpick.plans.${tool}`;
  const [plans, setPlans] = useState<Plans>(() => readStorage<Plans>(key, {}));

  useEffect(() => {
    if (!available) return;
    const ids = new Set(available.map((c) => c.mediaId));
    setPlans((p) => {
      const kept = Object.entries(p).filter(([id]) => ids.has(Number(id)));
      return kept.length === Object.keys(p).length ? p : Object.fromEntries(kept);
    });
  }, [available]);

  useEffect(() => writeStorage(key, plans), [key, plans]);

  /** Sets (or with `undefined`, clears) the plan of several copies at once. */
  const set = useCallback((changes: Record<number, CopyPlan | undefined>) => {
    setPlans((p) => {
      const next = { ...p };
      for (const [id, plan] of Object.entries(changes)) {
        if (plan && (plan.part || plan.renumber !== undefined)) next[Number(id)] = plan;
        else delete next[Number(id)];
      }
      return next;
    });
  }, []);
  const clear = useCallback(() => setPlans({}), []);

  return { plans, set, clear };
}

const PATH_MAP_KEY = 'recpick.pathMap';

/**
 * Selected files with their total size, planned renames and joins, a prefix mapping for paths and
 * the script download. `warnings` lists things to double-check, e.g. episodes with every copy selected.
 */
export function SelectionBar({
  tool,
  copies,
  operations,
  warnings = [],
  actions,
  onSuggest,
  onClear,
}: {
  tool: string;
  /** Copies selected for deletion. */
  copies: LibraryCopy[];
  /** Everything the script should do, for pages with more than deletions. */
  operations?: (map: PathMap) => Operations;
  warnings?: string[];
  /** Extra buttons for the selected copies, shown before the download. */
  actions?: ReactNode;
  onSuggest: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const { config } = useApp();
  const [map, setMap] = useState<PathMap>(() => readStorage<PathMap>(PATH_MAP_KEY, { from: '', to: '' }));
  const [showPaths, setShowPaths] = useState(() => !!map.from);

  useEffect(() => writeStorage(PATH_MAP_KEY, map), [map]);

  const size = useMemo(() => copies.reduce((sum, c) => sum + (c.size ?? 0), 0), [copies]);
  const ops: Operations = useMemo(
    () => operations?.(map) ?? { renames: [], joins: [], deletes: copies.flatMap(filesOf).map((p) => mapPath(p, map)), errors: [] },
    [operations, copies, map],
  );
  const renameCount = new Set(ops.renames.map((r) => r.from)).size;
  const empty = copies.length === 0 && ops.renames.length === 0 && ops.joins.length === 0;
  const example = copies.map((c) => filesOf(c)[0]).find(Boolean) ?? ops.renames[0]?.from ?? ops.joins[0]?.parts[0];

  const download = () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    const script = buildScript(ops, {
      header: t('script.header', { version: config.version, date: d.toLocaleString() }),
      summary: [
        ops.deletes.length ? t('script.summary', { count: ops.deletes.length, size: formatSize(size) }) : '',
        ops.renames.length ? t('plan.renames', { count: renameCount }) : '',
        ops.joins.length ? t('plan.joins', { count: ops.joins.length }) : '',
      ]
        .filter(Boolean)
        .join(', '),
      missing: t('script.missing'),
      nothing: t('script.nothing'),
      noPermission: t('script.noPermission'),
      noFfmpeg: t('script.noFfmpeg'),
      encodeSlow: t('script.encodeSlow'),
      renameHeading: t('script.renameHeading'),
      joinHeading: t('script.joinHeading'),
      deleteHeading: t('script.deleteHeading'),
      exists: t('script.exists'),
      joinFailed: t('script.joinFailed'),
      durationMismatch: t('script.durationMismatch'),
      confirm: t('script.confirmAll'),
      cancelled: t('script.cancelled'),
      done: t('script.done'),
      yes: t('script.yes'),
    });
    const url = URL.createObjectURL(new Blob([script], { type: 'text/x-shellscript' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `recpick-${tool}-${stamp}.sh`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="selection-bar">
      <div className="selection-row">
        <span>
          <b>{t('script.selected', { count: copies.length })}</b>
          {copies.length > 0 && <span className="muted"> · {formatSize(size)}</span>}
          {renameCount > 0 && <span className="muted"> · {t('plan.renames', { count: renameCount })}</span>}
          {ops.joins.length > 0 && <span className="muted"> · {t('plan.joins', { count: ops.joins.length })}</span>}
        </span>
        <button className="small" onClick={onSuggest}>{t('script.suggest')}</button>
        {!empty && (
          <button className="small" onClick={onClear}>{t('script.clear')}</button>
        )}
        <button className="small link" onClick={() => setShowPaths((v) => !v)}>{t('script.paths')}</button>
        <span className="spacer" />
        {actions}
        <button className="primary small" disabled={empty || ops.errors.length > 0} onClick={download}>
          {t('script.download')}
        </button>
      </div>
      {showPaths && (
        <div className="selection-paths">
          <label className="field">
            <span className="field-label">{t('script.pathFrom')}</span>
            <input value={map.from} placeholder="/mnt/video" onChange={(e) => setMap({ ...map, from: e.target.value })} />
          </label>
          <label className="field">
            <span className="field-label">{t('script.pathTo')}</span>
            <input value={map.to} placeholder="/srv/media" onChange={(e) => setMap({ ...map, to: e.target.value })} />
          </label>
          {example && map.from && <span className="muted small dup-file">{mapPath(example, map)}</span>}
        </div>
      )}
      {ops.errors.length > 0 && (
        <p className="error small">
          {t('plan.blocked')} {ops.errors.slice(0, 5).join('; ')}
          {ops.errors.length > 5 && ` +${ops.errors.length - 5}`}
        </p>
      )}
      {warnings.length > 0 && (
        <p className="error small">
          {t('script.allCopies', { count: warnings.length })} {warnings.slice(0, 5).join(', ')}
          {warnings.length > 5 && ` +${warnings.length - 5}`}
        </p>
      )}
      {!empty && <p className="muted small">{t(ops.joins.length ? 'script.howToJoin' : 'script.howTo')}</p>}
    </div>
  );
}
