import { ArrowRight } from '@phosphor-icons/react';
import type { EventSource } from './api/types';
import type { EventRow } from './api/dashboard-model';
import { useI18n } from './i18n';
import { useLocaleFormat } from './i18n/format';
export type { EventRow } from './api/dashboard-model';

export const sourceLabel = (source: EventSource, labels?: { server: string; browser: string }) =>
  source === 'server' ? labels?.server ?? '서버' : labels?.browser ?? '브라우저';
export default function SourceEventTable({ rows, source, selectedEvent, onSelect, total = false }: {
  rows: EventRow[]; source: EventSource; selectedEvent?: string | null; onSelect?: (name: string) => void; total?: boolean;
}) {
  const { t } = useI18n();
  const { count: formatCount } = useLocaleFormat();
  const labels = { server: t('analysis:sourceServer'), browser: t('analysis:sourceBrowser') };
  return <div className="table-scroll" tabIndex={0} aria-label={t('analysis:registeredEventCounts')}><table className="event-table">
    <caption className="sr-only">{t('analysis:eventReceiptCaption', { source: sourceLabel(source, labels) })}</caption>
    <thead><tr><th scope="col">{t('analysis:event')}</th><th scope="col">{t('analysis:sourceGroup')}</th><th scope="col" className="number-cell">{t('analysis:eventCount')}</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.definition.name}>
      <th scope="row">{onSelect && row.source === source
        ? <button className="text-button event-name" type="button" aria-pressed={selectedEvent === row.definition.name}
          onClick={() => onSelect(row.definition.name)}>{row.definition.name}<ArrowRight size={16} /></button>
        : <span className="event-name">{row.definition.name}</span>}<div className="event-label">{row.definition.label}</div></th>
      <td>{row.source ? sourceLabel(row.source, labels) : '—'}</td>
      <td className="number-cell">{row.count !== null ? formatCount(row.count) : row.source !== source ? t('analysis:otherSource') : '—'}</td>
    </tr>)}</tbody>
    {total && <tfoot><tr><th scope="row" colSpan={2}>{t('analysis:visibleEventTotal', { source: sourceLabel(source, labels) })}</th>
      <td className="number-cell">{formatCount(rows.reduce((sum, row) => sum + (row.count ?? 0), 0))}</td></tr></tfoot>}
  </table></div>;
}
