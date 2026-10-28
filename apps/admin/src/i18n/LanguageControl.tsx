import { localeRestoreFailed, setAdminLocale, useI18n } from './index';
import { useState } from 'react';
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
      <option value="ko" lang="ko">한국어</option>
      <option value="en" lang="en">English</option>
    </select>
    {failed && <span role="alert">{t('admin:localeLoadFailed')}</span>}
  </label>;
}
