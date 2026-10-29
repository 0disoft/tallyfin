import { useId, useState } from 'react';
import HelpTerm from './HelpTerm';
import { Trend } from './Dashboard';
import type { DailyRecord } from './data';
import type { PropertyAnalysis } from './api/event-analysis.ts';
import { useI18n } from './i18n';
import { useLocaleFormat } from './i18n/format';

type PropertyRow = PropertyAnalysis['rows'][number];

// The parent remounts this component when the project, schema, event, grouping or
// period changes. A plain re-render that swaps the analysis still resets the
// selection to the highest-count row so a stale key never mixes datasets.
function signatureOf(analysis: PropertyAnalysis): string {
  return `${analysis.total}|${analysis.rows.map(row => `${row.key}=${row.count}`).join(',')}`;
}

export default function EventPropertyBreakdown({ analysis, propertyName }: { analysis: PropertyAnalysis; propertyName: string }) {
  const headingId = useId();
  const trendHeadingId = useId();
  const { t } = useI18n();
  const { count: formatCount, rate: formatRate } = useLocaleFormat();
  const valueLabel = (value: PropertyRow['value']): string => value === null ? t('analysis:valueMissing')
    : value === true ? t('analysis:valueTrue') : value === false ? t('analysis:valueFalse') : String(value);
  const signature = signatureOf(analysis);
  const firstKey = analysis.rows[0]?.key ?? null;
  const [selection, setSelection] = useState<{ signature: string; key: string | null }>({ signature, key: firstKey });
  let activeKey = selection.key;
  if (selection.signature !== signature) {
    activeKey = firstKey;
    setSelection({ signature, key: firstKey });
  }
  if (activeKey !== null && !analysis.rows.some(row => row.key === activeKey)) activeKey = firstKey;
  const selectedRow = analysis.rows.find(row => row.key === activeKey) ?? null;
  const records: DailyRecord[] = selectedRow ? selectedRow.daily.map(day => ({ date: day.date, events: { count: day.count } })) : [];

  return <section className="property-analysis" aria-labelledby={headingId}>
    <div className="section-header"><h2 id={headingId}>{t('analysis:propertyDistribution', { property: propertyName })}</h2></div>
    {analysis.rows.length === 0
      ? <div className="property-analysis-empty" role="status"><h3>{t('analysis:noPropertyValuesTitle')}</h3><p>{t('analysis:noPropertyValuesBody', { property: propertyName })}</p></div>
      : <>
        <details className="property-analysis-help"><summary>{t('analysis:shareHelpSummary')}</summary><p className="context-note">{t('analysis:shareHelpBody')}</p></details>
        <div className="table-scroll property-analysis-scroll" tabIndex={0} aria-label={t('analysis:propertyBreakdownTable', { property: propertyName })}>
          <table className="event-table property-analysis-table">
            <caption className="sr-only">{t('analysis:propertyBreakdownCaption', { property: propertyName, count: formatCount(analysis.total) })}</caption>
            <thead><tr><th scope="col">{t('analysis:propertyValue', { property: propertyName })}</th><th scope="col" className="number-cell">{t('analysis:eventCount')}</th><th scope="col" className="number-cell"><HelpTerm content={t('analysis:shareHelpBody')}>{t('analysis:share')}</HelpTerm></th></tr></thead>
            <tbody>{analysis.rows.map(row => <tr key={row.key}>
              <th scope="row"><button type="button" className="text-button property-analysis-value" aria-pressed={row.key === activeKey} onClick={() => setSelection({ signature, key: row.key })}>{valueLabel(row.value)}</button></th>
              <td className="number-cell">{formatCount(row.count)}</td>
              <td className="number-cell"><span className="event-property-share">{formatRate(row.share)}{row.share !== null && <meter min={0} max={100} value={row.share} aria-label={t('analysis:shareAria', { value: valueLabel(row.value) })} />}</span></td>
            </tr>)}</tbody>
            <tfoot><tr><th scope="row">{t('analysis:total')}</th><td className="number-cell">{formatCount(analysis.total)}</td><td className="number-cell">{formatRate(analysis.total === 0 ? null : 100)}</td></tr></tfoot>
          </table>
        </div>
        {selectedRow && <details className="property-analysis-trend">
          <summary><h3 id={trendHeadingId}>{t('analysis:dailyCountHeading', { property: propertyName, value: valueLabel(selectedRow.value) })}</h3></summary>
          <Trend records={records} event="count" />
        </details>}
      </>}
  </section>;
}
