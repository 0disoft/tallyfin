import { useEffect, useState } from 'react';
import type { ApiClient } from './api/client.ts';
import type { EventSource, FunnelDefinition, Registry } from './api/types.ts';
import type { SdkProfile } from './api/sdk-setup.ts';
import { latestSchema } from './api/latest-schema.ts';
import { sdkFunnels, sdkSetup } from './api/sdk-setup.ts';

/** Funnels with at least one step in this source. Unreadable definitions never offer an example. */
function sourceFunnels(registry: Registry | null, source: EventSource): FunnelDefinition[] {
  if (!registry) return [];
  try { return sdkFunnels(registry, source); } catch { return []; }
}

export default function LiveSdkSetup({ client, projectId, refreshTick }: { client: ApiClient; projectId: string; refreshTick: number }) {
  const [origin, setOrigin] = useState(''), [reload, setReload] = useState(0);
  const [copyStatus, setCopyStatus] = useState<{ client: ApiClient; key: string; snippet: string; text: string } | null>(null);
  const key = JSON.stringify([projectId, refreshTick, reload]);
  const [read, setRead] = useState<{ client: ApiClient; key: string; registry: Registry | null; status: 'loading' | 'ready' | 'empty' | 'error' } | null>(null);
  const current = read?.client === client && read.key === key ? read : null;
  const registry = current?.registry ?? null, status = current?.status ?? 'loading';
  const [choice, setChoice] = useState<{ key: string; source: EventSource } | null>(null);
  const [kind, setKind] = useState<{ key: string; profile: SdkProfile } | null>(null);
  const [example, setExample] = useState<{ key: string; funnelId: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController(); setRead({ client, key, status: 'loading', registry: null }); setCopyStatus(null);
    void (async () => {
      try {
        const selected = await latestSchema(client, projectId, controller.signal);
        if (controller.signal.aborted) return;
        if (selected.active === null) { setRead({ client, key, status: 'empty', registry: null }); return; }
        const definition = await client.getSchema(projectId, selected.active, { signal: controller.signal });
        if (!controller.signal.aborted) setRead({ client, key, registry: definition, status: 'ready' });
      } catch { if (!controller.signal.aborted) setRead({ client, key, status: 'error', registry: null }); }
    })();
    return () => controller.abort();
  }, [client, projectId, refreshTick, reload]);
  const scope = registry ? JSON.stringify([projectId, registry.schemaVersion]) : '';
  const source: EventSource = choice?.key === scope && registry?.events.some(event => event.source === choice.source)
    ? choice.source : registry?.events.some(event => event.source === 'browser') ? 'browser' : 'server';
  // 선택은 현재 프로젝트·스키마·출처에 묶고, 등록에서 사라진 값은 기본값으로 되돌린다.
  const choiceScope = JSON.stringify([scope, source]);
  const funnels = sourceFunnels(registry, source), browserFunnels = sourceFunnels(registry, 'browser');
  const profile: SdkProfile = kind?.key === choiceScope && kind.profile === 'funnels' && browserFunnels.length ? 'funnels' : 'standard';
  const funnelId = example?.key === choiceScope && funnels.some(funnel => funnel.id === example.funnelId) ? example.funnelId : funnels[0]?.id ?? '';
  const showKind = source === 'browser' && browserFunnels.length > 0;
  const showExample = funnels.length > 0 && (source === 'server' || profile === 'funnels');
  const options: { profile?: SdkProfile; funnelId?: string } = source === 'browser' ? { profile } : {};
  if (showExample && funnelId) options.funnelId = funnelId;
  let snippet = '', error = '';
  if (registry && origin) try { snippet = sdkSetup(registry, origin, source, options); } catch (e) { error = e instanceof Error ? e.message : '수집 서버 주소를 확인해 주세요.'; }
  async function copy() {
    try { await navigator.clipboard.writeText(snippet); setCopyStatus({ client, key, snippet, text: '연결 코드를 복사했어요.' }); }
    catch { setCopyStatus({ client, key, snippet, text: '복사하지 못했어요. 아래 코드를 직접 선택해 복사해 주세요.' }); }
  }
  return <section className="settings-section sdk-setup" id="sdk-setup" aria-labelledby="sdk-setup-heading" aria-busy={status === 'loading' || undefined}>
    <div className="settings-head"><h2 id="sdk-setup-heading">SDK 연결 안내</h2><button className="secondary-button" onClick={() => setReload(r => r + 1)}>등록 스키마 다시 확인</button></div>
    {status === 'loading' && <p role="status">등록한 스키마를 확인하고 있어요.</p>}
    {status === 'error' && <p className="form-error" role="alert">등록한 스키마를 조회하지 못했어요. 다시 확인해 주세요.</p>}
    {status === 'empty' && <p className="notice">활성 스키마를 발행하면 연결 코드를 만들 수 있어요. <a href="#schema-heading">이벤트 스키마 등록</a></p>}
    {registry && <>
      <p className="context-note">프로젝트 {projectId} · 최신 활성 스키마 v{registry.schemaVersion}.</p>
      <label className="field-label" htmlFor="sdk-source">SDK 발행 출처</label>
      <select className="text-input settings-select" id="sdk-source" value={source} onChange={event => {
        setChoice({ key: scope, source: event.target.value === 'server' ? 'server' : 'browser' }); setCopyStatus(null);
      }}><option value="browser" disabled={!registry.events.some(event => event.source === 'browser')}>브라우저</option>
        <option value="server" disabled={!registry.events.some(event => event.source === 'server')}>서버</option></select>
      <p className="field-help">{source === 'browser' ? '서비스 출처가 브라우저 허용 목록에 있어야 해요.' : '서버에는 전용 발행자 인증과 프로젝트 발행 권한이 필요해요. 브라우저 허용 출처는 사용하지 않아요.'}</p>
      {showKind && <>
        <label className="field-label" htmlFor="sdk-browser-kind">브라우저 SDK 종류</label>
        <select className="text-input settings-select" id="sdk-browser-kind" value={profile} aria-describedby="sdk-browser-kind-help" onChange={event => {
          setKind({ key: choiceScope, profile: event.target.value === 'funnels' ? 'funnels' : 'standard' }); setCopyStatus(null);
        }}><option value="standard">일반 이벤트·작업 흐름</option><option value="funnels">작업 퍼널</option></select>
        <p className="field-help" id="sdk-browser-kind-help">{profile === 'funnels'
          ? '작업 퍼널 프로필은 일반 이벤트와 등록한 퍼널 단계를 수집하며 기존 작업 흐름은 수집하지 않아요. 작업 흐름에만 쓰는 이벤트는 스키마에서 빼고, 기본 엔트리에는 퍼널 코드가 들어가지 않아요.'
          : '일반 엔트리는 등록한 이벤트와 기존 작업 흐름을 그대로 수집해요. 작업 퍼널도 쓰는 서비스만 작업 퍼널을 고르세요.'}</p>
      </>}
      {showExample && <>
        <label className="field-label" htmlFor="sdk-funnel-example">퍼널 사용 예제</label>
        <select className="text-input settings-select" id="sdk-funnel-example" value={funnelId} aria-describedby="sdk-funnel-example-help" onChange={event => {
          setExample({ key: choiceScope, funnelId: event.target.value }); setCopyStatus(null);
        }}>{funnels.map(funnel => <option key={funnel.id} value={funnel.id}>{funnel.label}</option>)}</select>
        <p className="field-help" id="sdk-funnel-example-help">{source === 'server'
          ? '서버 코드는 등록한 서버 퍼널을 스키마에 함께 넣어요. 작업 링크는 funnelId·runId·startedAt만 가진 무작위 작업 메타데이터이고 인증 수단이 아니에요. 실제 발행은 전용 발행자 인증과 프로젝트 권한 검사를 그대로 통과하고, 작업을 끝낸 서버가 성공 단계를 발행해요. 호스트는 같은 작업의 분류 값과 각 단계의 최초 발생 시각을 그대로 보존하세요.'
          : '작업 링크는 funnelId·runId·startedAt만 가진 무작위 작업 메타데이터일 뿐 인증 수단이나 방문자 식별자가 아니에요. 호스트는 같은 작업의 분류 값과 각 단계의 최초 발생 시각을 바꾸지 말고, 수동 재시도에는 원래 발생 시각을 넘기세요. 서버 단계는 서버가 실제 완료를 확인해 발행해요.'}</p>
      </>}
      <ol className="sdk-instructions"><li>SDK는 아직 공개 패키지로 배포하지 않았어요. Tallyfin 저장소에서 <code>npm run build:{source}</code>를 실행하세요.</li>
        <li>서비스에서 빌드한 <code>packages/{source}</code> 로컬 패키지를 연결하세요.{source === 'server' ? ' 서버 SDK와 발행자 토큰을 브라우저에 넣지 마세요.' : profile === 'funnels' ? ' funnels 엔트리(@tallyfin/browser/funnels)를 쓰고 서버용 코어는 브라우저에 넣지 마세요.' : ' 서버용 코어를 브라우저에 넣지 마세요.'}</li>
        <li>{source === 'server' ? '실제 서비스에서 발행자 토큰을 얻는 getToken 함수를 연결 코드에 전달하세요. 관리자 토큰은 사용하지 않아요.' : '실제 수집 서버의 출처를 아래에 입력하고 연결 코드를 사용하세요. 관리자 토큰은 넣지 않아요.'}</li></ol>
      <label className="field-label" htmlFor="sdk-origin">수집 서버 출처</label>
      <input className="text-input" id="sdk-origin" value={origin} placeholder="https://analytics.example.com" type="url" autoComplete="off"
        aria-describedby="sdk-origin-help sdk-origin-error" aria-invalid={Boolean(error) || undefined} onChange={e => { setOrigin(e.target.value); setCopyStatus(null); }} />
      <p className="field-help" id="sdk-origin-help">관리자 화면 주소와 같다고 가정하지 않아요. 경로·쿼리·토큰을 제외하고 출처만 입력하세요.</p>
      <p className="form-error" id="sdk-origin-error" role={error ? 'alert' : undefined}>{error}</p>
      {snippet && <><textarea className="text-input schema-textarea sdk-code" readOnly rows={12} aria-label={`${source === 'server' ? '서버' : '브라우저'} SDK 연결 코드`} value={snippet} spellCheck={false} />
        <div className="form-actions"><button className="secondary-button" onClick={() => { void copy(); }}>연결 코드 복사</button></div></>}
      <p role="status">{copyStatus?.client === client && copyStatus.key === key && copyStatus.snippet === snippet ? copyStatus.text : ''}</p>
    </>}
  </section>;
}
