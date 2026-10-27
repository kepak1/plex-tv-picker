import type { DuplicateCopy, DuplicateGroup, LibraryCopy } from '../api';

// What the downloaded script will do: rename files to the right episode number, join the parts of
// a two-part episode into one file, and delete files. RecPick only writes the script; nothing
// happens to the files until the user runs it on the machine that has them.

/** What to do with one copy besides deleting it (deletion is the page's selection). */
export interface CopyPlan {
  /** Join as this part (1, 2, ...) with the other numbered copies of its episode. */
  part?: number;
  /** Rename to this episode number, "S01E02". */
  renumber?: string;
}

export type Plans = Record<number, CopyPlan>;

export interface PathMap {
  from: string;
  to: string;
}

export interface Rename {
  from: string;
  to: string;
}

export interface Join {
  /** Files in playing order; a copy split into several files contributes all of them. */
  parts: string[];
  output: string;
  /** Different codecs or resolution: re-encode instead of joining the streams as they are. */
  encode: boolean;
  /** For re-encoding: the video codec to use and which part's resolution to keep. */
  videoCodec: 'libx265' | 'libx264';
  bestPart: number;
}

export interface Operations {
  renames: Rename[];
  joins: Join[];
  deletes: string[];
  /** Problems that block the download, e.g. "S18E01: part 2 is missing". */
  errors: string[];
}

export const filesOf = (c: LibraryCopy) => c.files ?? (c.file ? [c.file] : []);

export function mapPath(path: string, map: PathMap): string {
  const from = map.from.trim().replace(/\/+$/, '');
  if (!from || (path !== from && !path.startsWith(`${from}/`))) return path;
  return map.to.trim().replace(/\/+$/, '') + path.slice(from.length);
}

const EPISODE = /\bS\d{1,4}E\d{1,4}\b/i;
const AIR_DATE = /\b\d{4}-\d{2}-\d{2} \d{2} \d{2} \d{2}\b/;
// Same markers as server/episodeFiles.ts: "cz.2", "cz. 2", "część 2", "Part II".
const PART = /\s*[([]?\s*\b(?:cz(?:ęść|esc)?\.?|part)\s*(?:\d{1,2}|iv|v|i{1,3})\b\s*[)\]]?/i;

/** The story a title belongs to, ignoring part markers: "Fabryki śmierci cz. 2" -> "fabryki śmierci". */
export const storyOf = (title: string) =>
  title
    .replace(PART, ' ')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const split = (path: string) => {
  const slash = path.lastIndexOf('/');
  const name = path.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  return { dir: path.slice(0, slash + 1), base: dot > 0 ? name.slice(0, dot) : name, ext: dot > 0 ? name.slice(dot) : '' };
};

export function parseEpisodeNumber(value: string): { season: number; episode: number } | null {
  const m = value.trim().match(/^S(\d{1,4})\s*E(\d{1,4})$/i);
  return m ? { season: Number(m[1]), episode: Number(m[2]) } : null;
}

export const episodeCode = (season: number, episode: number) =>
  `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;

/**
 * The same file with another episode number: the "S01E01" in its name is replaced (Plex files
 * episodes by it), or the air date in date-based DVR names; " (copy N)" is dropped.
 */
export function renumberedPath(path: string, code: string): string {
  const { dir, base, ext } = split(path);
  const clean = base.replace(/\s*\(copy \d+\)$/i, '');
  const name = EPISODE.test(clean) ? clean.replace(EPISODE, code) : AIR_DATE.test(clean) ? clean.replace(AIR_DATE, code) : `${clean} - ${code}`;
  return `${dir}${name}${ext}`;
}

/** Name of the joined file: part 1's name without its part marker, plus e.g. " (cz. 1-2)", as .mkv. */
export function joinedPath(firstPart: string, suffix: string): string {
  const { dir, base } = split(firstPart);
  const clean = base
    .replace(/\s*\(copy \d+\)$/i, '')
    .replace(PART, '')
    .replace(/[\s,.:;-]+$/, '');
  return `${dir}${clean} (${suffix}).mkv`;
}

// Higher is better: "4k" > "1080" > "720" > "576" > "sd".
const resolutionRank = (r: string | null) => (r === '4k' ? 2160 : r && /^\d+$/.test(r) ? Number(r) : r === 'sd' ? 480 : 0);

/** Turns the page's selection and plans into script operations, and checks that they make sense. */
export function operations(
  groups: DuplicateGroup[],
  selected: Set<number>,
  plans: Plans,
  map: PathMap,
  text: { label: (g: DuplicateGroup) => string; partsSuffix: (count: number) => string; missingPart: (part: number) => string; onePart: string; badNumber: string },
): Operations {
  const ops: Operations = { renames: [], joins: [], deletes: [], errors: [] };
  const mapped = (p: string) => mapPath(p, map);
  for (const g of groups) {
    const parts: { part: number; copy: DuplicateCopy }[] = [];
    for (const c of g.copies) {
      const plan = plans[c.mediaId];
      if (selected.has(c.mediaId)) ops.deletes.push(...filesOf(c).map(mapped));
      else if (plan?.renumber !== undefined) {
        const n = parseEpisodeNumber(plan.renumber);
        if (!n) ops.errors.push(`${text.label(g)}: ${text.badNumber}`);
        else for (const f of filesOf(c)) ops.renames.push({ from: mapped(f), to: mapped(renumberedPath(f, episodeCode(n.season, n.episode))) });
      } else if (plan?.part) parts.push({ part: plan.part, copy: c });
    }
    if (parts.length === 0) continue;
    parts.sort((a, b) => a.part - b.part);
    const numbers = parts.map((p) => p.part);
    if (parts.length === 1) {
      ops.errors.push(`${text.label(g)}: ${text.onePart}`);
      continue;
    }
    // Exactly one copy per part, numbered 1..N with no gaps.
    const missing = numbers.map((_, i) => i + 1).find((n, i) => numbers[i] !== n);
    if (missing !== undefined) {
      ops.errors.push(`${text.label(g)}: ${text.missingPart(missing)}`);
      continue;
    }
    const copies = parts.map((p) => p.copy);
    const same = (key: 'videoCodec' | 'audioCodec' | 'resolution') => new Set(copies.map((c) => c[key])).size === 1;
    const best = copies.reduce((b, c, i) =>
      resolutionRank(c.resolution) > resolutionRank(copies[b].resolution) ||
      (resolutionRank(c.resolution) === resolutionRank(copies[b].resolution) && (c.size ?? 0) > (copies[b].size ?? 0))
        ? i
        : b, 0);
    const files = copies.flatMap(filesOf);
    ops.joins.push({
      parts: files.map(mapped),
      output: mapped(joinedPath(filesOf(copies[0])[0] ?? '', text.partsSuffix(copies.length))),
      encode: !(same('videoCodec') && same('audioCodec') && same('resolution')),
      videoCodec: copies[best].videoCodec === 'hevc' ? 'libx265' : 'libx264',
      // The first file of the best copy; its height is read by ffprobe when the script runs.
      bestPart: copies.slice(0, best).reduce((n, c) => n + filesOf(c).length, 0),
    });
  }
  return ops;
}

/** Single-quoted for bash: nothing inside is expanded. */
export const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export interface ScriptText {
  header: string;
  summary: string;
  missing: string;
  nothing: string;
  noPermission: string;
  noFfmpeg: string;
  encodeSlow: string;
  renameHeading: string;
  joinHeading: string;
  deleteHeading: string;
  exists: string;
  joinFailed: string;
  durationMismatch: string;
  confirm: string;
  cancelled: string;
  done: string;
  yes: string;
}

const valid = (p: string) => p && !/[\n\r]/.test(p);

/**
 * The bash script: renames first (so joins and deletes see final names), then joins, then deletes,
 * after one confirmation that lists everything. It refuses to start without permission for every
 * folder involved (instead of failing half way), never overwrites a file, and deletes the parts of
 * a join only after ffprobe confirms the joined file is as long as the parts together.
 */
export function buildScript(ops: Omit<Operations, 'errors'>, text: ScriptText): string {
  const renames = ops.renames.filter((r) => valid(r.from) && valid(r.to) && r.from !== r.to);
  const joins = ops.joins.filter((j) => valid(j.output) && j.parts.every(valid));
  const deletes = [...new Set(ops.deletes.filter(valid))];
  const yes = [...new Set([text.yes, 'y'])].map((l) => `[${l.toLowerCase()}${l.toUpperCase()}]*`).join('|');
  const say = (s: string) => `echo ${quote(s)}`;

  const lines = [
    '#!/usr/bin/env bash',
    `# ${text.header}`,
    `# ${text.summary}`,
    // `sh script.sh` runs dash on Debian/Ubuntu, which has no arrays: switch to bash first.
    // Shells run a script line by line, so this happens before the arrays below are parsed.
    'if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi',
    'set -u',
    '',
    '# Renames: pairs of "from" and "to".',
    'renames=(',
    ...renames.flatMap((r) => [`  ${quote(r.from)}`, `  ${quote(r.to)}`]),
    ')',
    '# Files to delete.',
    'deletes=(',
    ...deletes.map((p) => `  ${quote(p)}`),
    ')',
    '# Joins, one after another: output file, mode (copy or encode), video codec, index of the part',
    '# whose resolution to keep, number of parts, then the parts in order.',
    'joins=(',
    ...joins.map((j) => `  ${quote(j.output)} ${j.encode ? 'encode' : 'copy'} ${j.videoCodec} ${j.bestPart} ${j.parts.length} ${j.parts.map(quote).join(' ')}`),
    ')',
    '',
    'duration() { ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 -- "$1" 2>/dev/null; }',
    '',
    '# Keeps the owner and mode of the original file (the script usually runs as root).',
    'copy_owner() {',
    '  local owner mode',
    '  owner=$(stat -c "%u:%g" -- "$1" 2>/dev/null || stat -f "%u:%g" -- "$1")',
    '  mode=$(stat -c "%a" -- "$1" 2>/dev/null || stat -f "%Lp" -- "$1")',
    '  chown "$owner" -- "$2" 2>/dev/null; chmod "$mode" -- "$2" 2>/dev/null; return 0',
    '}',
    '',
    'join_files() {',
    '  local out=$1 mode=$2 vcodec=$3 best=$4; shift 4',
    '  local tmp="${out%.*}.recpick-tmp.mkv" expected=0 d rc',
    `  if [ -e "$out" ]; then echo ${quote(`${text.exists}: `)}"$out"; return 1; fi`,
    '  for p in "$@"; do',
    `    d=$(duration "$p") && [ -n "$d" ] || { echo ${quote(`${text.joinFailed}: `)}"$p"; return 1; }`,
    '    expected=$(awk -v a="$expected" -v b="$d" \'BEGIN { print a + b }\')',
    '  done',
    '  if [ "$mode" = copy ]; then',
    // Containers store AAC differently (.ts vs .mkv), so parts from different containers are first
    // rewrapped into .mkv (stream copy, quick); then the concat demuxer joins them.
    '    local list work ext="" p i=0',
    '    list=$(mktemp); work=$(mktemp -d)',
    '    for p in "$@"; do [ -z "$ext" ] && ext=${p##*.}; [ "${p##*.}" = "$ext" ] || ext=mixed; done',
    // The list names the parts by simple temporary names (a link, or the rewrapped file), so file
    // names with quotes or other special characters never need escaping for ffmpeg.
    '    for p in "$@"; do',
    '      if [ "$ext" = mixed ]; then',
    '        ffmpeg -nostdin -hide_banner -loglevel error -y -i "$p" -map 0:v:0 -map "0:a?" -c copy -- "$work/$i.mkv" || { rm -rf -- "$work" "$list"; echo ' + quote(`${text.joinFailed}: `) + '"$p"; return 1; }',
    '        echo "file \'$work/$i.mkv\'" >> "$list"',
    '      else',
    '        ln -s -- "$p" "$work/$i.$ext"; echo "file \'$work/$i.$ext\'" >> "$list"',
    '      fi',
    '      i=$((i + 1))',
    '    done',
    '    ffmpeg -nostdin -hide_banner -loglevel error -y -f concat -safe 0 -i "$list" -map 0:v:0 -map "0:a?" -c copy -fflags +genpts -- "$tmp"; rc=$?',
    '    rm -rf -- "$list" "$work"',
    '  else',
    // Re-encode to the best part's frame size (others are scaled to fit and padded), stereo AAC.
    '    local size w h inputs=() filter="" streams="" i=0',
    '    size=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x -- "${@:$((best + 1)):1}")',
    '    w=${size%x*}; h=${size#*x}',
    '    for p in "$@"; do',
    '      inputs+=(-i "$p")',
    '      filter+="[$i:v:0]scale=$w:$h:force_original_aspect_ratio=decrease,pad=$w:$h:(ow-iw)/2:(oh-ih)/2,setsar=1[v$i];"',
    '      filter+="[$i:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a$i];"',
    '      streams+="[v$i][a$i]"; i=$((i + 1))',
    '    done',
    '    local quality=(-crf 20); [ "$vcodec" = libx265 ] && quality=(-crf 22)',
    '    ffmpeg -nostdin -hide_banner -loglevel error -stats -y "${inputs[@]}" -filter_complex "${filter}${streams}concat=n=$i:v=1:a=1[v][a]" \\',
    '      -map "[v]" -map "[a]" -c:v "$vcodec" -preset medium "${quality[@]}" -c:a aac -b:a 192k -- "$tmp"; rc=$?',
    '  fi',
    `  if [ $rc -ne 0 ]; then rm -f -- "$tmp"; echo ${quote(`${text.joinFailed}: `)}"$out"; return 1; fi`,
    '  d=$(duration "$tmp")',
    // Accept a difference of 2% or 30 seconds, whichever is more.
    '  if ! awk -v g="${d:-0}" -v e="$expected" \'BEGIN { t = e * 0.02; if (t < 30) t = 30; x = g - e; if (x < 0) x = -x; exit !(x <= t) }\'; then',
    `    rm -f -- "$tmp"; echo ${quote(`${text.durationMismatch}: `)}"$out (\${d:-?}s / \${expected}s)"; return 1`,
    '  fi',
    '  copy_owner "$1" "$tmp"',
    `  mv -n -- "$tmp" "$out" && [ ! -e "$tmp" ] || { rm -f -- "$tmp"; echo ${quote(`${text.exists}: `)}"$out"; return 1; }`,
    '  echo "$out"',
    '  rm -fv -- "$@"',
    '}',
    '',
    '# What is still there (a file deleted by hand or by an earlier run is skipped).',
    'todo_renames=(); todo_joins=(); todo_deletes=(); dirs=()',
    'for ((i = 0; i < ${#renames[@]}; i += 2)); do',
    '  from=${renames[i]}; to=${renames[i + 1]}',
    `  if [ ! -e "$from" ]; then echo ${quote(`${text.missing}: `)}"$from"`,
    `  elif [ -e "$to" ]; then echo ${quote(`${text.exists}: `)}"$to"`,
    '  else todo_renames+=("$from" "$to"); dirs+=("$(dirname -- "$from")"); fi',
    'done',
    '# Each join starts at an index of "joins"; its parts follow its five fields.',
    'j=0',
    'while [ $j -lt ${#joins[@]} ]; do',
    '  n=${joins[j + 4]}; ok=1',
    '  for p in "${joins[@]:j + 5:n}"; do',
    `    [ -e "$p" ] || { echo ${quote(`${text.missing}: `)}"$p"; ok=0; }`,
    '  done',
    '  if [ $ok = 1 ]; then',
    '    todo_joins+=("$j"); dirs+=("$(dirname -- "${joins[j]}")")',
    '    for p in "${joins[@]:j + 5:n}"; do dirs+=("$(dirname -- "$p")"); done',
    '  fi',
    '  j=$((j + 5 + n))',
    'done',
    'for f in "${deletes[@]}"; do',
    `  if [ -e "$f" ]; then todo_deletes+=("$f"); dirs+=("$(dirname -- "$f")"); else echo ${quote(`${text.missing}: `)}"$f"; fi`,
    'done',
    'if [ $(( ${#todo_renames[@]} + ${#todo_joins[@]} + ${#todo_deletes[@]} )) -eq 0 ]; then',
    `  ${say(text.nothing)}`,
    '  exit 0',
    'fi',
    '',
    // Recordings usually belong to the Plex user: say so up front instead of failing half way.
    'if [ "$(id -u)" -ne 0 ]; then',
    '  for d in "${dirs[@]}"; do',
    `    [ -w "$d" ] || { ${say(text.noPermission)}; echo "  sudo bash $0"; exit 1; }`,
    '  done',
    'fi',
    'if [ ${#todo_joins[@]} -gt 0 ] && ! { command -v ffmpeg && command -v ffprobe; } >/dev/null; then',
    `  ${say(text.noFfmpeg)}`,
    '  exit 1',
    'fi',
    '',
    'if [ ${#todo_renames[@]} -gt 0 ]; then',
    `  echo; echo ${quote(text.renameHeading)}" ($(( \${#todo_renames[@]} / 2 )))"`,
    '  for ((i = 0; i < ${#todo_renames[@]}; i += 2)); do printf \'  %s\\n    -> %s\\n\' "${todo_renames[i]}" "$(basename -- "${todo_renames[i + 1]}")"; done',
    'fi',
    'encoding=0',
    'if [ ${#todo_joins[@]} -gt 0 ]; then',
    `  echo; echo ${quote(text.joinHeading)}" (\${#todo_joins[@]})"`,
    '  for j in "${todo_joins[@]}"; do',
    '    if [ "${joins[j + 1]}" = encode ]; then encoding=1; echo "  ${joins[j]} [ffmpeg: ${joins[j + 2]}]"; else echo "  ${joins[j]}"; fi',
    '    for p in "${joins[@]:j + 5:${joins[j + 4]}}"; do echo "    <- $p"; done',
    '  done',
    `  [ $encoding = 1 ] && echo ${quote(text.encodeSlow)}`,
    'fi',
    'if [ ${#todo_deletes[@]} -gt 0 ]; then',
    `  echo; echo ${quote(text.deleteHeading)}" (\${#todo_deletes[@]})"`,
    `  printf '  %s\\n' "\${todo_deletes[@]}"`,
    'fi',
    'echo',
    `read -r -p ${quote(`${text.confirm} [${text.yes}/N] `)} answer`,
    'case "$answer" in',
    `  ${yes}) ;;`,
    `  *) ${say(text.cancelled)}; exit 1 ;;`,
    'esac',
    '',
    'failed=0',
    'for ((i = 0; i < ${#todo_renames[@]}; i += 2)); do',
    '  mv -nv -- "${todo_renames[i]}" "${todo_renames[i + 1]}" && [ ! -e "${todo_renames[i]}" ] || failed=1',
    'done',
    'for j in "${todo_joins[@]}"; do',
    '  join_files "${joins[j]}" "${joins[j + 1]}" "${joins[j + 2]}" "${joins[j + 3]}" "${joins[@]:j + 5:${joins[j + 4]}}" || failed=1',
    'done',
    'for f in "${todo_deletes[@]}"; do',
    // -f: no question for each write-protected file; the answer above covers all of them.
    '  rm -fv -- "$f" || failed=1',
    'done',
    `${say(text.done)}`,
    'exit $failed',
    '',
  ];
  return lines.join('\n');
}
