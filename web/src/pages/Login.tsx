import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api';
import { Logo } from '../components/Logo';

/** Plex PIN login: redirect to app.plex.tv, which sends the user back here with ?pin=<id>. */
export function Login() {
  const { t } = useTranslation();
  const [state, setState] = useState<'idle' | 'waiting' | 'denied' | 'failed'>('idle');
  const [detail, setDetail] = useState('');

  useEffect(() => {
    const pin = new URLSearchParams(location.search).get('pin');
    if (!pin) return;
    setState('waiting');
    let tries = 0;
    let errors = 0;
    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      try {
        const res = await api<{ status: string }>(`/api/auth/pin/${pin}`, { method: 'POST' });
        if (res.status === 'ok') {
          location.replace('/');
          return;
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          setState('denied');
          return;
        }
        if (err instanceof ApiError && err.status === 410) {
          // The PIN belongs to another browser or expired: start over.
          setDetail(t('login.expired'));
          setState('failed');
          return;
        }
        // Network hiccups and plex.tv errors are retried a few times before giving up.
        if (++errors >= 4) {
          setDetail(err instanceof Error ? err.message : String(err));
          setState('failed');
          return;
        }
      }
      if (++tries < 80) setTimeout(poll, 1500);
      else {
        setDetail(t('login.timeout'));
        setState('failed');
      }
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
    } catch (err) {
      setDetail(err instanceof Error ? err.message : String(err));
      setState('failed');
    }
  };

  return (
    <div className="login">
      <div className="login-card">
        <div className="brand big">
          <Logo size={32} /> {t('app.name')}
        </div>
        <h1>{t('login.title')}</h1>
        <p className="muted">{t('login.text')}</p>
        {state === 'waiting' ? (
          <p>{t('login.waiting')}</p>
        ) : (
          <button className="primary" onClick={start}>{t('login.button')}</button>
        )}
        {state === 'denied' && <p className="error">{t('login.denied')}</p>}
        {state === 'failed' && (
          <p className="error">
            {t('login.failed')}
            {detail && <span className="small muted"> ({detail})</span>}
          </p>
        )}
      </div>
    </div>
  );
}
