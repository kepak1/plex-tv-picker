import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, type AppConfig, type Me, type Wish } from './api';

interface AppState {
  config: AppConfig;
  me: Me;
  reloadMe: () => Promise<void>;
  plexLink: (epgKey: string) => string;
  wishes: Wish[];
  reloadWishes: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const value = useContext(Ctx);
  if (!value) throw new Error('useApp outside provider');
  return value;
}

/** Loads config and the signed-in user; renders `login` when nobody is signed in. */
export function AppProvider({ children, login }: { children: ReactNode; login: (config: AppConfig) => ReactNode }) {
  const { i18n } = useTranslation();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [wishes, setWishes] = useState<Wish[]>([]);

  const reloadMe = useCallback(async () => {
    try {
      const user = await api<Me>('/api/me');
      setMe(user);
      if (user.language && user.language !== i18n.resolvedLanguage) await i18n.changeLanguage(user.language);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setMe(null);
      else throw err;
    }
  }, [i18n]);

  const reloadWishes = useCallback(async () => setWishes(await api<Wish[]>('/api/wishlist')), []);

  useEffect(() => {
    void api<AppConfig>('/api/config').then(setConfig);
    void reloadMe();
  }, [reloadMe]);

  useEffect(() => {
    if (me) void reloadWishes();
  }, [me, reloadWishes]);

  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage ?? 'pl';
  }, [i18n.resolvedLanguage]);

  const plexLink = useCallback(
    (epgKey: string) =>
      config?.machineIdentifier
        ? `${config.plexUrl}/web/index.html#!/server/${config.machineIdentifier}/details?key=${encodeURIComponent(epgKey)}`
        : `${config?.plexUrl}/web/index.html`,
    [config],
  );

  const value = useMemo(
    () => (config && me ? { config, me, reloadMe, plexLink, wishes, reloadWishes } : null),
    [config, me, reloadMe, plexLink, wishes, reloadWishes],
  );

  if (!config || me === undefined) return <div className="splash" />;
  if (me === null) return <>{login(config)}</>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
