import { useEffect, useState } from 'react';
import type { ApiClient } from './api/client.ts';
import { ApiError } from './api/client.ts';
import { loadCollectionDiagnostics, originMatch, type CollectionDiagnostics as Diagnostics } from './api/collection-diagnostics.ts';
import { formatCount } from './data.ts';
import CollectionRejections from './CollectionRejections.tsx';
import type { EventSource } from './api/types.ts';

export default function CollectionDiagnostics({ client, projectId, version, refreshTick }: {
  client: ApiClient; projectId: string; version: number | null; refreshTick: number;
}) {
  const [read, setRead] = useState<{ client: ApiClient; key: string; data: Diagnostics } | null>(null);
  const [reload, setReload] = useState(0), [origin, setOrigin] = useState('');
  const scope = JSON.stringify([projectId, version]);
  const [choice, setChoice] = useState<{ scope: string; source: EventSource } | null>(null);
  const requestedSource = choice?.scope === scope ? choice.source : undefined;
  const key = JSON.stringify([projectId, version, refreshTick, reload, requestedSource]);
  const data = read?.client === client && read.key === key ? read.data : null;
  useEffect(() => {
    const controller = new AbortController();
    void loadCollectionDiagnostics(client, projectId, version, controller.signal, new Date(), requestedSource)
      .then(data => { if (!controller.signal.aborted) setRead({ client, key, data }); })
      .catch(() => { if (!controller.signal.aborted) {
        const error = new ApiError('contract', '진단 결과를 읽지 못했어요. 다시 확인해 주세요.');
        setRead({ client, key, data: { settings: { error }, schema: { error }, receipt: null, rejections: { error } } });
      } });
    return () => controller.abort();
  }, [client, projectId, version, key]);
  const settings = data?.settings.value, schema = data?.schema.value, summary = data?.receipt?.value;
  const source = requestedSource ?? summary?.meta.source ?? (schema && !schema.events.some(event => event.source === 'browser') ? 'server' : 'browser');
  const receipt = summary?.meta.latestReceivedAt;
  const match = settings ? originMatch(origin, settings.allowedOrigins) : 'empty';
  const timeZone = summary?.meta.timeZone ?? 'UTC';
  const time = (value: string) => new Intl.DateTimeFormat('ko-KR', { timeZone, dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value));
  return <section className="settings-section collection-diagnostics" aria-labelledby="collection-diagnostics-heading" aria-busy={!data || undefined}>
    <div className="settings-head"><h2 id="collection-diagnostics-heading">수집 상태 진단</h2>
      <button className="secondary-button" type="button" disabled={!data} onClick={() => setReload(value => value + 1)}>수집 상태 다시 확인</button></div>
    <p className="context-note">저장된 수신 기록과 현재 설정을 확인해요. 자동 새로고침이나 테스트 이벤트 전송은 하지 않아요.</p>
      <label className="api-field"><span>수집 진단 출처</span>
        <select className="text-input settings-select" aria-label="수집 진단 출처" value={source} disabled={!schema} onChange={event => setChoice({ scope,
          source: event.target.value === 'server' ? 'server' : 'browser' })}>
          <option value="browser">브라우저</option><option value="server">서버</option></select></label>
    {!data ? <p role="status">수집 상태를 확인하고 있어요.</p> : <>
      <dl className="diagnostic-facts">
        <div><dt>프로젝트 수집 설정</dt><dd>{settings ? settings.project.status === 'active' ? '수집 허용' : '수집 일시정지' : '확인하지 못함'}</dd></div>
        <div><dt>선택한 스키마</dt><dd>{schema ? `v${schema.schemaVersion} · ${schema.schemaStatus === 'active' ? '사용 중' : '사용 중지'}` : '확인하지 못함'}</dd></div>
        <div><dt>마지막 신규 수신 · 프로젝트 전체</dt><dd>{summary ? receipt ? <time dateTime={receipt}>{time(receipt)} · {timeZone}</time> : '신규 수신 기록 없음' : '확인하지 못함'}</dd></div>
        <div><dt>오늘의 {source === 'server' ? '서버' : '브라우저'} 이벤트 · 선택 스키마</dt><dd>{summary ? `${formatCount(summary.totalEvents)}건 · ${summary.meta.from} · ${timeZone}` : '확인하지 못함'}</dd></div>
        <div><dt>분당 요청 한도</dt><dd>{settings ? `${formatCount(settings.limits.requestsPerMinute)}회` : '확인하지 못함'}</dd></div>
        <div><dt>UTC 하루 신규 수신 한도</dt><dd>{settings ? `${formatCount(settings.limits.newReceiptsPerUtcDay)}건` : '확인하지 못함'}</dd></div>
      </dl>
      {summary && <p className="field-help">조회 시각: <time dateTime={summary.meta.generatedAt}>{time(summary.meta.generatedAt)}</time> · {timeZone}. 마지막 신규 수신은 기간·스키마와 무관한 프로젝트 전체 기록이며, 중복 재전송으로 갱신되지 않아요. 기록이 오래됐거나 없어도 장애로 단정하지 않아요.</p>}
      {data.settings.error && <p className="form-error" role="alert">프로젝트 설정 조회 실패: {data.settings.error.message}</p>}
      {data.schema.error && <p className="form-error" role="alert">스키마 조회 실패: {data.schema.error.message}</p>}
      {data.receipt?.error && <p className="form-error" role="alert">수신 기록 조회 실패: {data.receipt.error.message}</p>}
      <CollectionRejections read={data.rejections} />
      {settings?.project.status === 'paused' && <p className="notice">프로젝트가 일시정지되어 있어요. 새 수집 요청은 거부돼요. {settings.canEdit ? '아래 프로젝트 설정에서 상태를 변경할 수 있어요.' : '프로젝트 소유자에게 수집 재개를 요청해 주세요.'}</p>}
      {schema?.schemaStatus === 'retired' && <p className="notice">이 스키마는 사용 중지 상태예요. SDK가 사용하는 버전과 발행된 활성 스키마를 확인해 주세요.</p>}
      {source === 'server' && <p className="notice">서버 발행에는 브라우저 허용 출처를 사용하지 않아요. 전송 서비스의 발행자 인증과 이 프로젝트의 발행 권한을 확인해 주세요.</p>}
      {settings && source === 'browser' && <>
        {!settings.allowedOrigins.length && <p className="notice">허용 출처가 비어 있어 모든 브라우저 수집이 차단돼요.</p>}
        <h3 className="settings-subheading">서비스 주소의 출처 확인</h3>
        <label className="field-label" htmlFor="diagnostic-origin">연결할 서비스 주소 (선택)</label>
        <input id="diagnostic-origin" className="text-input" type="url" autoComplete="off" placeholder="https://app.example.com" value={origin}
          onChange={event => setOrigin(event.target.value)} aria-describedby="diagnostic-origin-help diagnostic-origin-result" />
        <p id="diagnostic-origin-help" className="field-help">이 탭에서만 비교해요. 경로는 제외하고 프로토콜·호스트·포트가 정확히 같은지 확인해요. 입력한 주소를 서버로 보내거나 저장하지 않아요.</p>
        <p id="diagnostic-origin-result" role="status">{match === 'allowed' ? '허용 출처에 있어요. 실제 전송·수신 여부는 별도로 확인해야 해요.' : match === 'denied' ? `허용 출처에 없어요. ${settings.canEdit ? '아래 설정에서 출처를 추가해 주세요.' : '프로젝트 소유자에게 출처 추가를 요청해 주세요.'}` : match === 'invalid' ? 'http 또는 https 주소를 입력해 주세요. 로그인 정보가 포함된 주소는 사용하지 않아요.' : '서비스 주소를 입력하면 허용 목록과 비교해요.'}</p>
        <details><summary>현재 허용 출처 {settings.allowedOrigins.length}개</summary><ul className="diagnostic-origins">{settings.allowedOrigins.map(value => <li key={value}><code>{value}</code></li>)}</ul></details>
      </>}
      <details className="diagnostic-troubleshooting"><summary>수집되지 않을 때 확인할 항목</summary>
        <p className="context-note">거부 기록에는 누락이 있을 수 있어요. 아래는 실제 실패 이력이 아닌 확인 순서예요. 설정 한도도 사용량이나 잔여량을 뜻하지 않아요.</p>
        <ol><li>{source === 'server' ? '프로젝트가 수집 허용 상태인지, 전용 발행자 토큰의 issuer·audience와 프로젝트 발행 권한이 맞는지 확인해요.' : '프로젝트가 수집 허용 상태인지, 서비스 출처가 허용 목록에 있는지 확인해요.'}</li>
          <li>SDK의 프로젝트 ID·스키마 버전과 등록된 이벤트 이름·속성 형식이 같은지 확인해요.</li>
          <li>{source === 'server' ? '서버 SDK의 send 결과와 HTTP 상태를 확인해요. 401·403은 발행자 인증·권한을 확인해야 해요.' : '브라우저 개발자 도구의 네트워크에서 수집 응답을 확인해요.'} 429는 요청 또는 일일 한도에 걸린 경우예요. 응답의 Retry-After에 따라 기다려요.</li>
          <li>응답의 오류 코드와 requestId를 확인해요. 503이면 저장소 상태를 확인해요. 토큰·입력 원문은 제보에 넣지 않아요.</li></ol>
      </details>
    </>}
  </section>;
}
