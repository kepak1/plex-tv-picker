import i18n, { localeTag } from './i18n';

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000;

export function formatAiring(ts: number): string {
  const date = new Date(ts * 1000);
  const today = dayStart(new Date());
  const day = dayStart(date);
  const time = date.toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit' });
  if (day === today) return `${i18n.t('time.today')} ${time}`;
  if (day === today + 86400) return `${i18n.t('time.tomorrow')} ${time}`;
  return `${date.toLocaleDateString(localeTag(), { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}

export function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString(localeTag(), { dateStyle: 'medium', timeStyle: 'short' });
}

export function episodeLabel(a: { season: number | null; episode: number | null }): string {
  return [a.season != null ? i18n.t('item.season', { season: a.season }) : '', a.episode != null ? i18n.t('item.episode', { episode: a.episode }) : '']
    .join('')
    .trim();
}

export function channelName(raw: string | null): string {
  if (!raw) return '';
  const m = raw.match(/\((.+)\)\s*$/);
  return m ? m[1] : raw.replace(/^\d+\s+/, '');
}

export type When = 'today' | 'tomorrow' | 'next3' | 'next7' | 'all';

export function whenRange(when: When): { from?: number; to?: number } {
  const now = Math.floor(Date.now() / 1000);
  const today = dayStart(new Date());
  switch (when) {
    case 'today':
      return { from: now, to: today + 86400 };
    case 'tomorrow':
      return { from: today + 86400, to: today + 2 * 86400 };
    case 'next3':
      return { from: now, to: today + 3 * 86400 };
    case 'next7':
      return { from: now, to: today + 7 * 86400 };
    default:
      return {};
  }
}

/** Poster URL resized by the backend. */
export function img(url: string | null, width = 300): string | undefined {
  return url ? `/api/img?w=${width}&u=${encodeURIComponent(url)}` : undefined;
}

/** Filter value for titles whose country is unknown (UNKNOWN_COUNTRY in server/catalog.ts). */
export const UNKNOWN_COUNTRY = 'none';

// Codes TMDB uses for countries that no longer exist (or aren't in ISO 3166). Browsers would name
// them after today's successor (SU -> Russia), so they have their own names in locales/*.json.
const HISTORICAL = new Set(['AN', 'CS', 'DD', 'SU', 'XC', 'XG', 'XI', 'YU']);

/** "US" -> 🇺🇸 (regional indicator letters); none for historical countries. */
export function flag(code: string): string {
  return /^[A-Z]{2}$/.test(code) && !HISTORICAL.has(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '';
}

const regionNames = new Map<string, Intl.DisplayNames>();
/** Country name in the UI language, from the browser (no translations to maintain). */
export function countryName(code: string): string {
  if (HISTORICAL.has(code)) return i18n.t(`countries.${code}`);
  const locale = localeTag();
  let names = regionNames.get(locale);
  if (!names) {
    names = new Intl.DisplayNames([locale], { type: 'region' });
    regionNames.set(locale, names);
  }
  try {
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Country options for a MultiSelect, by name in the UI language, with "unknown" last. */
export function countryOptions(codes: string[], unknownLabel: string): { value: string; label: string }[] {
  const named = codes.map((c) => ({ value: c, label: `${flag(c)} ${countryName(c)}`.trim(), name: countryName(c) }));
  named.sort((a, b) => a.name.localeCompare(b.name, localeTag()));
  return [...named.map(({ value, label }) => ({ value, label })), { value: UNKNOWN_COUNTRY, label: unknownLabel }];
}
