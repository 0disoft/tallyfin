import { localeRestoreFailed, setAdminLocale, useI18n } from './index';
import { useState } from 'react';
import { ACTIVE_LOCALES, TARGET_LOCALES } from './preference';
import './locale-control.css';

export default function LanguageControl() {
  const { t, locale } = useI18n();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(localeRestoreFailed);
  return <label className="locale-control">
    <span className="sr-only">{t('admin:language')}</span>
    <select value={locale} disabled={loading} aria-busy={loading} onChange={async event => {
      setLoading(true); setFailed(false);
      try { await setAdminLocale(event.target.value); }
      catch { setFailed(true); }
      finally { setLoading(false); }
    }}>
      {TARGET_LOCALES.filter(item => ACTIVE_LOCALES.includes(item.code)).map(item =>
        <option key={item.code} value={item.code} lang={item.code}>{item.name}</option>)}
    </select>
    {failed && <span role="alert">{t('admin:localeLoadFailed')}</span>}
  </label>;
}
