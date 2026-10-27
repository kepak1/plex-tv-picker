import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { LibraryCopy } from '../api';
import { useApp } from '../app';
import { formatSize } from '../format';

// Selected files and a bash script that deletes them. RecPick never deletes anything itself:
// the user downloads the script and runs it on the machine that has the files.

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
  const clear = useCallback(() => setSelected(new Set()), []);

  return { selected, toggle, add, clear };
}

interface PathMap {
  from: string;
  to: string;
}

const PATH_MAP_KEY = 'recpick.pathMap';

const filesOf = (c: LibraryCopy) => c.files ?? (c.file ? [c.file] : []);

export function mapPath(path: string, map: PathMap): string {
  const from = map.from.trim().replace(/\/+$/, '');
  if (!from || (path !== from && !path.startsWith(`${from}/`))) return path;
  return map.to.trim().replace(/\/+$/, '') + path.slice(from.length);
}

/** Single-quoted for bash: nothing inside is expanded. */
const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function buildScript(
  copies: LibraryCopy[],
  map: PathMap,
  text: {
    header: string;
    summary: (files: number, size: string) => string;
    missing: string;
    nothing: string;
    confirm: string;
    cancelled: string;
    done: string;
    yes: string;
  },
): string {
  const paths = [...new Set(copies.flatMap(filesOf).map((p) => mapPath(p, map)))].filter((p) => p && !/[\n\r]/.test(p));
  const size = copies.reduce((sum, c) => sum + (c.size ?? 0), 0);
  // Each answer letter in both cases, e.g. "t" -> [tT], plus "y" which always works.
  const yes = [...new Set([text.yes, 'y'])].map((l) => `[${l.toLowerCase()}${l.toUpperCase()}]*`).join('|');
  return [
    '#!/usr/bin/env bash',
    `# ${text.header}`,
    `# ${text.summary(paths.length, formatSize(size))}`,
    'set -u',
    '',
    'files=(',
    ...paths.map((p) => `  ${quote(p)}`),
    ')',
    '',
    'present=()',
    'for f in "${files[@]}"; do',
    '  if [ -e "$f" ]; then present+=("$f"); else echo ' + quote(`${text.missing}: `) + '"$f"; fi',
    'done',
    'if [ ${#present[@]} -eq 0 ]; then',
    `  echo ${quote(text.nothing)}`,
    '  exit 0',
    'fi',
    `printf '  %s\\n' "\${present[@]}"`,
    `read -r -p ${quote(`${text.confirm} `)}"(\${#present[@]}) [${text.yes}/N] " answer`,
    'case "$answer" in',
    `  ${yes}) ;;`,
    `  *) echo ${quote(text.cancelled)}; exit 1 ;;`,
    'esac',
    'failed=0',
    'for f in "${present[@]}"; do',
    '  rm -v -- "$f" || failed=1',
    'done',
    `echo ${quote(text.done)}`,
    'exit $failed',
    '',
  ].join('\n');
}

/**
 * Selected files with their total size, a prefix mapping for paths and the script download.
 * `warnings` lists things to double-check, e.g. episodes with every copy selected.
 */
export function SelectionBar({
  tool,
  copies,
  warnings = [],
  actions,
  onSuggest,
  onClear,
}: {
  tool: string;
  copies: LibraryCopy[];
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
  const example = copies.map((c) => filesOf(c)[0]).find(Boolean);

  const download = () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    const script = buildScript(copies, map, {
      header: t('script.header', { version: config.version, date: d.toLocaleString() }),
      summary: (files, size) => t('script.summary', { count: files, size }),
      missing: t('script.missing'),
      nothing: t('script.nothing'),
      confirm: t('script.confirm'),
      cancelled: t('script.cancelled'),
      done: t('script.done'),
      yes: t('script.yes'),
    });
    const url = URL.createObjectURL(new Blob([script], { type: 'text/x-shellscript' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `recpick-delete-${tool}-${stamp}.sh`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="selection-bar">
      <div className="selection-row">
        <span>
          <b>{t('script.selected', { count: copies.length })}</b>
          {copies.length > 0 && <span className="muted"> · {formatSize(size)}</span>}
        </span>
        <button className="small" onClick={onSuggest}>{t('script.suggest')}</button>
        {copies.length > 0 && (
          <button className="small" onClick={onClear}>{t('script.clear')}</button>
        )}
        <button className="small link" onClick={() => setShowPaths((v) => !v)}>{t('script.paths')}</button>
        <span className="spacer" />
        {actions}
        <button className="primary small" disabled={copies.length === 0} onClick={download}>
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
      {warnings.length > 0 && (
        <p className="error small">
          {t('script.allCopies', { count: warnings.length })} {warnings.slice(0, 5).join(', ')}
          {warnings.length > 5 && ` +${warnings.length - 5}`}
        </p>
      )}
      {copies.length > 0 && <p className="muted small">{t('script.howTo')}</p>}
    </div>
  );
}
