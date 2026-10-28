import { useI18n } from './i18n';
import { useState } from 'react';
import { analyticsCsv, type ExportInput } from './api/csv-export';

export default function CsvDownload({ input, unavailable, buttonLabel, compact = false }: { input: ExportInput | null; unavailable: string | null; buttonLabel?: string; compact?: boolean }) {
  const { t } = useI18n();
  const [message, setMessage] = useState<number | null>(null);
  const [error, setError] = useState(false);
  function download() {
    if (!input || unavailable) return;
    let url: string | undefined;
    let link: HTMLAnchorElement | undefined;
    try {
      const file = analyticsCsv(input);
      url = URL.createObjectURL(new Blob([file.text], { type: 'text/csv;charset=utf-8' }));
      link = document.createElement('a'); link.href = url; link.download = file.filename;
      document.body.append(link); link.click();
      setError(false); setMessage(file.rowCount);
    } catch {
      setError(true); setMessage(null);
    } finally {
      link?.remove();
      if (url) { const release = url; setTimeout(() => URL.revokeObjectURL(release), 1000); }
    }
  }
  return <div className="csv-export">
    <button className="secondary-button" type="button" disabled={!input || !!unavailable} onClick={download} aria-describedby="csv-export-status">{buttonLabel ?? t('admin:downloadCsv')}</button>
    <p id="csv-export-status" className={error && !unavailable ? 'form-error' : compact && !unavailable && message === null ? 'sr-only' : 'context-note'} role={error && !unavailable ? 'alert' : 'status'}>
      {unavailable ?? (error ? t('admin:csvFailed') : message !== null ? t('admin:csvRequested', { count: message }) : t('admin:csvHelp'))}
    </p>
  </div>;
}
