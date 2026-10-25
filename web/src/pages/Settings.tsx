import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useApp } from '../app';

export function Settings() {
  const { t, i18n } = useTranslation();
  const { me, config, reloadMe } = useApp();
  const [language, setLanguage] = useState(me.language ?? i18n.resolvedLanguage ?? config.defaultLanguage);
  const [notifyEmail, setNotifyEmail] = useState(me.notifyEmail ?? '');
  const [alertsEnabled, setAlertsEnabled] = useState(me.alertsEnabled);
  const [digestEnabled, setDigestEnabled] = useState(me.digestEnabled);
  const [recsEnabled, setRecsEnabled] = useState(me.recsEnabled);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const save = async () => {
    try {
      await api('/api/settings', { method: 'PUT', json: { language, notifyEmail, alertsEnabled, digestEnabled, recsEnabled } });
      await i18n.changeLanguage(language);
      await reloadMe();
      setMessage({ text: t('settings.saved', { lng: language }) });
    } catch (err) {
      setMessage({ text: String(err), error: true });
    }
  };

  const test = async () => {
    try {
      await save();
      await api('/api/settings/test-email', { method: 'POST' });
      setMessage({ text: t('settings.testSent') });
    } catch (err) {
      setMessage({ text: String(err), error: true });
    }
  };

  return (
    <div className="page narrow">
      <h1>{t('settings.title')}</h1>
      <div className="form">
        <label className="field">
          <span className="field-label">{t('settings.language')}</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {config.languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t('settings.email')}</span>
          <input type="email" value={notifyEmail} placeholder={me.email ?? ''} onChange={(e) => setNotifyEmail(e.target.value)} />
          <span className="muted small">{t('settings.emailHint')}</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={alertsEnabled} onChange={(e) => setAlertsEnabled(e.target.checked)} />
          <span>
            <b>{t('settings.alerts')}</b>
            <span className="muted small">{t('settings.alertsHint')}</span>
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={digestEnabled} onChange={(e) => setDigestEnabled(e.target.checked)} />
          <span>
            <b>{t('settings.digest')}</b>
            <span className="muted small">{t('settings.digestHint')}</span>
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={recsEnabled} onChange={(e) => setRecsEnabled(e.target.checked)} />
          <span>
            <b>{t('settings.recs')}</b>
            <span className="muted small">{t('settings.recsHint')}</span>
          </span>
        </label>
        {!config.mail && <p className="error">{t('settings.smtpMissing')}</p>}
        <div className="actions">
          <button className="primary" onClick={save}>{t('settings.save')}</button>
          <button onClick={test} disabled={!config.mail}>{t('settings.testEmail')}</button>
        </div>
        {message && <p className={message.error ? 'error' : 'ok-text'}>{message.text}</p>}
      </div>
    </div>
  );
}
