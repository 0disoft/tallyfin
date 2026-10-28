import { setAdminLocale, useI18n } from './index';
import './locale-control.css';

export default function LanguageControl() {
  const { t, locale } = useI18n();
  return <label className="locale-control">
    <span className="sr-only">{t('admin:language')}</span>
    <select value={locale} onChange={event => setAdminLocale(event.target.value)}>
      <option value="ko" lang="ko">한국어</option>
      <option value="en" lang="en">English</option>
    </select>
  </label>;
}
