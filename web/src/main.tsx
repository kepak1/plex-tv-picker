import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import './i18n';
import './styles.css';
import { api } from './api';
import { AppProvider, useApp } from './app';
import { Login } from './pages/Login';
import { Browse } from './pages/Browse';
import { Wishlist } from './pages/Wishlist';
import { Ignored } from './pages/Ignored';
import { Settings } from './pages/Settings';
import { Tools } from './pages/Tools';
import { Duplicates } from './pages/Duplicates';
import { ShortRecordings } from './pages/ShortRecordings';
import { Logo } from './components/Logo';

function Shell() {
  const { t } = useTranslation();
  const { me, config, tools } = useApp();
  const toolCount = (tools?.duplicates.count ?? 0) + (tools?.short.count ?? 0);
  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    location.href = '/';
  };
  return (
    <>
      <header className="topbar">
        <NavLink to="/" className="brand">
          <Logo /> {t('app.name')}
        </NavLink>
        <nav>
          <NavLink to="/" end>{t('nav.browse')}</NavLink>
          <NavLink to="/wishlist">{t('nav.wishlist')}</NavLink>
          <NavLink to="/ignored">{t('nav.ignored')}</NavLink>
          <NavLink to="/tools">
            {t('nav.tools')}
            {toolCount > 0 && <span className="nav-count">{toolCount}</span>}
          </NavLink>
          <NavLink to="/settings">{t('nav.settings')}</NavLink>
        </nav>
        <div className="user">
          {me.thumb && <img src={me.thumb} alt="" />}
          <span className="user-name">{me.username}</span>
          <button className="link" onClick={logout}>{t('nav.logout')}</button>
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Browse />} />
          <Route path="/wishlist" element={<Wishlist />} />
          <Route path="/ignored" element={<Ignored />} />
          <Route path="/tools" element={<Tools />} />
          <Route path="/tools/duplicates" element={<Duplicates />} />
          <Route path="/tools/short" element={<ShortRecordings />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer className="support">
        <span>{t('support.text')}</span>
        <a className="button kofi" href="https://ko-fi.com/kepak1" target="_blank" rel="noreferrer">
          ☕ {t('support.button')}
        </a>
        <a className="version" href={`https://github.com/kepak1/recpick/releases`} target="_blank" rel="noreferrer">
          RecPick v{config.version}
        </a>
      </footer>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppProvider login={() => <Login />}>
        <Shell />
      </AppProvider>
    </BrowserRouter>
  </StrictMode>,
);
