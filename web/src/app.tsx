import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, type AppConfig, type Me, type ToolsSummary, type Wish } from './api';

interface AppState {
  config: AppConfig;
  me: Me;
  reloadMe: () => Promise<void>;
  plexLink: (epgKey: string) => string;
  wishes: Wish[];
  reloadWishes: () => Promise<void>;
  /** Counters for the Tools menu entry; null until loaded. */
  tools: ToolsSummary | null;
  reloadTools: () => Promise<void>;
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
  const [tools, setTools] = useState<ToolsSummary | null>(null);

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
  const reloadTools = useCallback(async () => setTools(await api<ToolsSummary>('/api/tools')), []);

  useEffect(() => {
    void api<AppConfig>('/api/config').then(setConfig);
    void reloadMe();
  }, [reloadMe]);

  useEffect(() => {
    if (me) {
      void reloadWishes();
      void reloadTools();
    }
  }, [me, reloadWishes, reloadTools]);

  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage ?? 'pl';
  }, [i18n.resolvedLanguage]);

  // Same format as plexWebLink in server/plex.ts: guide items need the provider in the route,
  // library items (/library/metadata/...) must not have one.
  const plexLink = useCallback(
    (epgKey: string) => {
      if (!config?.machineIdentifier) return `${config?.plexUrl}/web/index.html`;
      const provider = epgKey.startsWith('/library/') ? undefined : epgKey.match(/^\/([^/]+)\//)?.[1];
      const route = provider ? `server/${config.machineIdentifier}/provider/${provider}` : `server/${config.machineIdentifier}`;
      return `${config.plexUrl}/web/index.html#!/${route}/details?key=${encodeURIComponent(epgKey)}`;
    },
    [config],
  );

  const value = useMemo(
    () => (config && me ? { config, me, reloadMe, plexLink, wishes, reloadWishes, tools, reloadTools } : null),
    [config, me, reloadMe, plexLink, wishes, reloadWishes, tools, reloadTools],
  );

  if (!config || me === undefined) return <div className="splash" />;
  if (me === null) return <>{login(config)}</>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
