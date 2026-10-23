import { useEffect, useState } from 'react';
import type { ApiClient } from './api/client.ts';
import { ApiError } from './api/api-error.ts';
import type { SchemaMetadata } from './api/schema-contract.ts';
import { loadSchemaComparison, type SchemaChange, type SchemaComparison } from './api/schema-comparison.ts';
import './schema-version-comparison.css';

const SECTIONS: Record<SchemaChange['section'], string> = { event: '이벤트', property: '속성', workflow: '작업 흐름', funnel: '퍼널', schema: '스키마' };
const FIELDS: Record<string, string> = { definition: '정의 전체', label: '표시 이름', source: '출처', type: '자료형', required: '필수 여부',
  purpose: '용도', values: '허용 값 (순서 포함)', minimum: '최솟값', maximum: '최댓값', startEvent: '시작 이벤트', successEvent: '성공 이벤트',
  failureEvent: '실패 이벤트', failureReasonProperty: '실패 원인 속성', dimensions: '분류 기준 (순서 포함)', steps: '단계 (순서 포함)',
  representativeWorkflowId: '대표 작업 흐름', order: '표시 순서' };
const KINDS: Record<SchemaChange['kind'], string> = { added: '추가', removed: '삭제', changed: '변경' };
function ChangeValue({ field, value }: { field: string; value: unknown }) {
  if (value === undefined) return <>없음</>;
  if (value === null) return <>없음 (null)</>;
  if (field === 'definition') return <details><summary>정의 보기</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>;
  if (field === 'steps' && Array.isArray(value)) return <pre>{value.map((step, index) => `${index + 1}. ${step.eventName} (${step.source})`).join('\n')}</pre>;
  const text = Array.isArray(value) ? JSON.stringify(value) : String(value);
  return <pre>{text}</pre>;
}
type Request = { client: ApiClient; projectId: string; from: number; to: number };
type Result = { request: Request; refreshTick: number; data?: SchemaComparison; error?: string };

export default function SchemaVersionComparison({ client, projectId, versions, enabled, refreshTick }: {
  client: ApiClient; projectId: string; versions: SchemaMetadata[]; enabled: boolean; refreshTick: number;
}) {
  const [from, setFrom] = useState(String(versions[1]?.schemaVersion ?? ''));
  const [to, setTo] = useState(String(versions[0]?.schemaVersion ?? ''));
  const [request, setRequest] = useState<Request | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const valid = from !== '' && to !== '' && from !== to && [from, to].every(v => versions.some(row => String(row.schemaVersion) === v));
  const current = enabled && valid && request?.client === client && request.projectId === projectId &&
    String(request.from) === from && String(request.to) === to ? request : null;
  const visible = current && result?.request === current && result.refreshTick === refreshTick ? result : null;
  const loading = Boolean(current && !visible);
  useEffect(() => {
    if (!current) { setResult(null); if (request) setRequest(null); return; }
    const controller = new AbortController(); let active = true;
    void loadSchemaComparison(client, projectId, current.from, current.to, controller.signal).then(
      data => { if (active) setResult({ request: current, refreshTick, data }); },
      error => { if (active) setResult({ request: current, refreshTick,
        error: error instanceof ApiError ? error.message : '정의를 불러오지 못했어요. 다시 비교해 주세요.' }); },
    );
    return () => { active = false; controller.abort(); };
  }, [client, projectId, current, request, refreshTick]);
  const select = (side: 'from' | 'to', value: string) => {
    setRequest(null); setResult(null);
    if (side === 'from') setFrom(value); else setTo(value);
  };
  return <section className="schema-version-comparison" aria-labelledby="schema-comparison-heading" aria-busy={loading || undefined}>
    <h3 id="schema-comparison-heading">버전 간 정의 비교</h3>
    <p className="context-note">발행된 두 버전의 정의를 비교해요. 작성 중인 초안은 바뀌지 않아요.</p>
    {versions.length < 2 ? <p role="status">발행된 버전이 두 개 이상이면 비교할 수 있어요.</p> : <>
      <form className="schema-compare-controls" onSubmit={event => {
        event.preventDefault();
        if (enabled && valid) { setResult(null); setRequest({ client, projectId, from: Number(from), to: Number(to) }); }
      }}>
        {(['from', 'to'] as const).map(side => <label className="settings-field" key={side}>
          <span className="field-label">{side === 'from' ? '기준 버전' : '비교 버전'}</span>
          <select className="text-input" value={side === 'from' ? from : to} disabled={!enabled}
            onChange={event => select(side, event.target.value)} aria-describedby="schema-compare-help">
            <option value="">버전 선택</option>
            {versions.map(row => <option key={row.schemaVersion} value={row.schemaVersion}>v{row.schemaVersion}{row.schemaStatus === 'retired' ? ' · 사용 중지' : ''}</option>)}
          </select>
        </label>)}
        <button className="secondary-button" type="submit" disabled={!enabled || !valid || loading}>
          {loading ? '비교 중…' : visible?.error ? '다시 비교' : '정의 비교'}
        </button>
      </form>
      <p className="field-help" id="schema-compare-help">서로 다른 버전을 골라 주세요. 목록에 없는 버전은 위의 이전 버전 더 보기로 불러올 수 있어요.</p>
      {!enabled && <p role="status">스키마 목록과 권한 확인을 마치면 비교할 수 있어요.</p>}
      {loading && <p role="status">두 버전의 정의를 불러오는 중이에요.</p>}
      {visible?.error && <p className="form-error" role="alert">{visible.error}</p>}
      {visible?.data && <>
        <p role="status">v{visible.data.from} → v{visible.data.to} · {visible.data.changes.length ? `정의 차이 ${visible.data.changes.length}건` : '정의 차이가 없어요.'}</p>
        <p className="notice">같은 이름이어도 출처·허용 값·단계가 달라지면 측정 의미가 달라질 수 있어요. 이 표는 호환성을 판정하지 않으며, 버전 간 집계·전환율을 합치거나 계산하지 않아요.</p>
        {visible.data.changes.length > 0 && <><p className="field-help">표를 좌우로 스크롤하면 두 버전의 값을 모두 볼 수 있어요.</p>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="스키마 정의 차이">
          <table className="event-table schema-definition-diff">
            <caption className="sr-only">기준 v{visible.data.from}와 비교 v{visible.data.to}의 정의 변경</caption>
            <thead><tr><th scope="col">구분·항목</th><th scope="col">변경 필드</th><th scope="col">차이</th><th scope="col">기준 v{visible.data.from}</th><th scope="col">비교 v{visible.data.to}</th></tr></thead>
            <tbody>{visible.data.changes.map((change, index) => <tr key={index}>
              <th scope="row">{SECTIONS[change.section]}<div className="event-label">{change.field === 'order' ? SECTIONS[change.name as SchemaChange['section']] : change.name === 'representativeWorkflowId' ? '대표 작업 흐름' : change.name}</div></th>
              <td>{FIELDS[change.field] ?? change.field}</td><td>{KINDS[change.kind]}</td>
              <td><ChangeValue field={change.field} value={change.before} /></td><td><ChangeValue field={change.field} value={change.after} /></td>
            </tr>)}</tbody>
          </table>
        </div></>}
      </>}
    </>}
  </section>;
}
