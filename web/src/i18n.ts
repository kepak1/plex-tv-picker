import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

// Every locales/<code>.json is picked up automatically: adding a file adds a language.
const files = import.meta.glob<{ default: Record<string, unknown> }>('../../locales/*.json', { eager: true });
const resources = Object.fromEntries(
  Object.entries(files).map(([path, mod]) => [path.match(/([\w-]+)\.json$/)![1], { translation: mod.default }]),
);

export const languageCodes = Object.keys(resources);

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: languageCodes.includes('pl') ? 'pl' : languageCodes[0],
    supportedLngs: languageCodes,
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
    detection: { order: ['localStorage', 'navigator'], lookupLocalStorage: 'ptp_lang', caches: ['localStorage'] },
  });

export function localeTag(): string {
  const meta = i18n.t('_meta.locale');
  return meta && meta !== '_meta.locale' ? meta : i18n.language;
}

export default i18n;
