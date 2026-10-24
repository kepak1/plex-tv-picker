import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from './config.js';

// Every locales/<code>.json file is a language; adding a file adds a language to the UI and emails.
type Dict = Record<string, unknown>;
const dir = resolve(process.env.LOCALES_DIR ?? 'locales');
const dicts = new Map<string, Dict>();
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  dicts.set(file.replace(/\.json$/, ''), JSON.parse(readFileSync(join(dir, file), 'utf8')));
}

export const languages = () => [...dicts.keys()];

export function resolveLanguage(lang?: string | null): string {
  if (lang && dicts.has(lang)) return lang;
  const short = lang?.split('-')[0];
  if (short && dicts.has(short)) return short;
  return dicts.has(config.defaultLanguage) ? config.defaultLanguage : (languages()[0] ?? 'en');
}

export function localeOf(lang: string): string {
  return ((dicts.get(lang)?._meta as { locale?: string } | undefined)?.locale) ?? lang;
}

function lookup(dict: Dict | undefined, key: string): string | undefined {
  let node: unknown = dict;
  for (const part of key.split('.')) node = (node as Dict | undefined)?.[part];
  return typeof node === 'string' ? node : undefined;
}

/** Minimal i18next-compatible translate: dotted keys, {{var}} interpolation and _one/_few/_many/_other plurals. */
export function t(lang: string, key: string, vars: Record<string, string | number> = {}): string {
  const dict = dicts.get(lang);
  const fallback = dicts.get(resolveLanguage(null));
  let text: string | undefined;
  if (typeof vars.count === 'number') {
    const form = new Intl.PluralRules(localeOf(lang)).select(vars.count);
    text = lookup(dict, `${key}_${form}`) ?? lookup(dict, `${key}_other`);
  }
  text ??= lookup(dict, key) ?? lookup(fallback, key) ?? key;
  return text.replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars[name] ?? ''));
}
