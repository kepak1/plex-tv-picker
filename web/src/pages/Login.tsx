import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api';

/** Plex PIN login: redirect to app.plex.tv, which sends the user back here with ?pin=<id>. */
export function Login() {
  const { t } = useTranslation();
  const [state, setState] = useState<'idle' | 'waiting' | 'denied' | 'failed'>('idle');

  useEffect(() => {
    const pin = new URLSearchParams(location.search).get('pin');
    if (!pin) return;
    setState('waiting');
    let tries = 0;
    let stopped = false;
    const poll = async () => {
      try {
        const res = await api<{ status: string }>(`/api/auth/pin/${pin}`, { method: 'POST' });
        if (res.status === 'ok') {
          location.replace('/');
          return;
        }
      } catch (err) {
        setState(err instanceof ApiError && err.status === 403 ? 'denied' : 'failed');
        return;
      }
      if (!stopped && ++tries < 60) setTimeout(poll, 1500);
      else setState('failed');
    };
    void poll();
    return () => {
      stopped = true;
    };
  }, []);

  const start = async () => {
    setState('waiting');
    try {
      const { url } = await api<{ url: string }>('/api/auth/pin', {
        method: 'POST',
        json: { forwardUrl: `${location.origin}/login` },
      });
      location.href = url;
    } catch {
      setState('failed');
    }
  };

  return (
    <div className="login">
      <div className="login-card">
        <div className="brand big">
          <span className="brand-mark">▶</span> {t('app.name')}
        </div>
        <h1>{t('login.title')}</h1>
        <p className="muted">{t('login.text')}</p>
        {state === 'waiting' ? (
          <p>{t('login.waiting')}</p>
        ) : (
          <button className="primary" onClick={start}>{t('login.button')}</button>
        )}
        {state === 'denied' && <p className="error">{t('login.denied')}</p>}
        {state === 'failed' && <p className="error">{t('login.failed')}</p>}
      </div>
    </div>
  );
}
