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

function Shell() {
  const { t } = useTranslation();
  const { me } = useApp();
  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    location.href = '/';
  };
  return (
    <>
      <header className="topbar">
        <NavLink to="/" className="brand">
          <span className="brand-mark">▶</span> {t('app.name')}
        </NavLink>
        <nav>
          <NavLink to="/" end>{t('nav.browse')}</NavLink>
          <NavLink to="/wishlist">{t('nav.wishlist')}</NavLink>
          <NavLink to="/ignored">{t('nav.ignored')}</NavLink>
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
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
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
