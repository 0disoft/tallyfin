import { useId, useState } from 'react';
import { Trend } from './Dashboard';
import { formatCount, type DailyRecord } from './data';
import type { PropertyAnalysis } from './api/event-analysis.ts';

type PropertyRow = PropertyAnalysis['rows'][number];

function valueLabel(value: PropertyRow['value']): string {
  if (value === null) return '값 없음';
  if (value === true) return '참 (true)';
  if (value === false) return '거짓 (false)';
  return String(value);
}

function formatShare(share: number | null): string {
  return share === null ? '—' : `${share.toFixed(1)}%`;
}

// The parent remounts this component when the project, schema, event, grouping or
// period changes. A plain re-render that swaps the analysis still resets the
// selection to the highest-count row so a stale key never mixes datasets.
function signatureOf(analysis: PropertyAnalysis): string {
  return `${analysis.total}|${analysis.rows.map(row => `${row.key}=${row.count}`).join(',')}`;
}

export default function EventPropertyBreakdown({ analysis, propertyName }: { analysis: PropertyAnalysis; propertyName: string }) {
  const headingId = useId();
  const trendHeadingId = useId();
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
    <div className="section-header"><h2 id={headingId}>{propertyName} 값별 분포</h2></div>
    {analysis.rows.length === 0
      ? <div className="property-analysis-empty" role="status"><h3>표시할 속성 값이 없어요</h3><p>선택한 기간에 이 이벤트의 {propertyName} 값이 없어 비중은 알 수 없음(—)이에요.</p></div>
      : <>
        <p className="context-note">비중은 ‘값별 건수 ÷ 선택한 이벤트 전체 건수 × 100’이고 전환율이 아니에요. 표시 비중은 소수점 한 자리로 반올림해서 값별 합이 100.0%와 조금 다를 수 있어요. 값을 고르면 아래 추이에 그 값의 일별 건수를 보여줘요.</p>
        <div className="table-scroll property-analysis-scroll" tabIndex={0} aria-label={`${propertyName} 값별 집계 표`}>
          <table className="event-table property-analysis-table">
            <caption className="sr-only">{propertyName} 값별 건수와 비중. 비중은 선택한 이벤트 전체 {formatCount(analysis.total)}건 대비 값별 건수이고 소수점 한 자리로 반올림해요.</caption>
            <thead><tr><th scope="col">{propertyName} 값</th><th scope="col" className="number-cell">건수</th><th scope="col" className="number-cell">비중</th></tr></thead>
            <tbody>{analysis.rows.map(row => <tr key={row.key}>
              <th scope="row"><button type="button" className="text-button property-analysis-value" aria-pressed={row.key === activeKey} onClick={() => setSelection({ signature, key: row.key })}>{valueLabel(row.value)}</button></th>
              <td className="number-cell">{formatCount(row.count)}</td>
              <td className="number-cell">{formatShare(row.share)}</td>
            </tr>)}</tbody>
            <tfoot><tr><th scope="row">합계</th><td className="number-cell">{formatCount(analysis.total)}</td><td className="number-cell">{formatShare(analysis.total === 0 ? null : 100)}</td></tr></tfoot>
          </table>
        </div>
        {selectedRow && <section className="property-analysis-trend" aria-labelledby={trendHeadingId}>
          <h3 id={trendHeadingId}>{propertyName} · {valueLabel(selectedRow.value)} 일별 건수</h3>
          <Trend records={records} event="count" />
        </section>}
      </>}
  </section>;
}
