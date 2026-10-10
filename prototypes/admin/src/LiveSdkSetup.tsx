import { useEffect, useState } from 'react';
import type { ApiClient } from './api/client.ts';
import type { EventSource, Registry } from './api/types.ts';
import { sdkSetup } from './api/sdk-setup.ts';

export default function LiveSdkSetup({ client, projectId, refreshTick }: { client: ApiClient; projectId: string; refreshTick: number }) {
  const [origin, setOrigin] = useState(''), [reload, setReload] = useState(0), [copyStatus, setCopyStatus] = useState('');
  const key = JSON.stringify([projectId, refreshTick, reload]);
  const [read, setRead] = useState<{ client: ApiClient; key: string; registry: Registry | null; status: 'loading' | 'ready' | 'empty' | 'error' } | null>(null);
  const current = read?.client === client && read.key === key ? read : null;
  const registry = current?.registry ?? null, status = current?.status ?? 'loading';
  const [choice, setChoice] = useState<{ key: string; source: EventSource } | null>(null);
  useEffect(() => {
    const controller = new AbortController(); setRead({ client, key, status: 'loading', registry: null }); setCopyStatus('');
    void (async () => {
      try {
        const list = await client.listSchemas(projectId, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (list.latestVersion === null) { setRead({ client, key, status: 'empty', registry: null }); return; }
        const definition = await client.getSchema(projectId, list.latestVersion, { signal: controller.signal });
        if (!controller.signal.aborted) setRead({ client, key, registry: definition, status: 'ready' });
      } catch { if (!controller.signal.aborted) setRead({ client, key, status: 'error', registry: null }); }
    })();
    return () => controller.abort();
  }, [client, projectId, refreshTick, reload]);
  const scope = registry ? JSON.stringify([projectId, registry.schemaVersion]) : '';
  const source: EventSource = choice?.key === scope && registry?.events.some(event => event.source === choice.source)
    ? choice.source : registry?.events.some(event => event.source === 'browser') ? 'browser' : 'server';
  let snippet = '', error = '';
  if (registry && origin) try { snippet = sdkSetup(registry, origin, source); } catch (e) { error = e instanceof Error ? e.message : '수집 서버 주소를 확인해 주세요.'; }
  async function copy() {
    try { await navigator.clipboard.writeText(snippet); setCopyStatus('연결 코드를 복사했어요.'); }
    catch { setCopyStatus('복사하지 못했어요. 아래 코드를 직접 선택해 복사해 주세요.'); }
  }
  return <section className="settings-section sdk-setup" id="sdk-setup" aria-labelledby="sdk-setup-heading" aria-busy={status === 'loading' || undefined}>
    <div className="settings-head"><h2 id="sdk-setup-heading">SDK 연결 안내</h2><button className="secondary-button" onClick={() => setReload(r => r + 1)}>등록 스키마 다시 확인</button></div>
    {status === 'loading' && <p role="status">등록한 스키마를 확인하고 있어요.</p>}
    {status === 'error' && <p className="form-error" role="alert">등록한 스키마를 조회하지 못했어요. 다시 확인해 주세요.</p>}
    {status === 'empty' && <p className="notice">첫 스키마를 발행하면 연결 코드를 만들 수 있어요. <a href="#schema-heading">이벤트 스키마 등록</a></p>}
    {registry && <>
      <p className="context-note">프로젝트 {projectId} · 최신 스키마 v{registry.schemaVersion}.</p>
      {!!registry.funnels?.length && <p className="notice">퍼널 정의는 등록되어 있지만 단계 연결 수집은 아직 지원하지 않아요. 아래 코드는 일반 이벤트와 기존 작업 흐름을 수집해요.</p>}
      <label className="field-label" htmlFor="sdk-source">SDK 발행 출처</label>
      <select className="text-input settings-select" id="sdk-source" value={source} onChange={event => {
        setChoice({ key: scope, source: event.target.value === 'server' ? 'server' : 'browser' }); setCopyStatus('');
      }}><option value="browser" disabled={!registry.events.some(event => event.source === 'browser')}>브라우저</option>
        <option value="server" disabled={!registry.events.some(event => event.source === 'server')}>서버</option></select>
      <p className="field-help">{source === 'browser' ? '서비스 출처가 브라우저 허용 목록에 있어야 해요.' : '서버에는 전용 발행자 인증과 프로젝트 발행 권한이 필요해요. 브라우저 허용 출처는 사용하지 않아요.'}</p>
      <ol className="sdk-instructions"><li>SDK는 아직 공개 패키지로 배포하지 않았어요. Tallyfin 저장소에서 <code>npm run build:{source}</code>를 실행하세요.</li>
        <li>서비스에서 빌드한 <code>packages/{source}</code> 로컬 패키지를 연결하세요.{source === 'server' ? ' 서버 SDK와 발행자 토큰을 브라우저에 넣지 마세요.' : ' 서버용 코어를 브라우저에 넣지 마세요.'}</li>
        <li>{source === 'server' ? '실제 서비스에서 발행자 토큰을 얻는 getToken 함수를 연결 코드에 전달하세요. 관리자 토큰은 사용하지 않아요.' : '실제 수집 서버의 출처를 아래에 입력하고 연결 코드를 사용하세요. 관리자 토큰은 넣지 않아요.'}</li></ol>
      <label className="field-label" htmlFor="sdk-origin">수집 서버 출처</label>
      <input className="text-input" id="sdk-origin" value={origin} placeholder="https://analytics.example.com" type="url" autoComplete="off"
        aria-describedby="sdk-origin-help sdk-origin-error" aria-invalid={Boolean(error) || undefined} onChange={e => { setOrigin(e.target.value); setCopyStatus(''); }} />
      <p className="field-help" id="sdk-origin-help">관리자 화면 주소와 같다고 가정하지 않아요. 경로·쿼리·토큰을 제외하고 출처만 입력하세요.</p>
      <p className="form-error" id="sdk-origin-error" role={error ? 'alert' : undefined}>{error}</p>
      {snippet && <><textarea className="text-input schema-textarea sdk-code" readOnly rows={12} aria-label={`${source === 'server' ? '서버' : '브라우저'} SDK 연결 코드`} value={snippet} spellCheck={false} />
        <div className="form-actions"><button className="secondary-button" onClick={() => { void copy(); }}>연결 코드 복사</button></div></>}
      <p role="status">{copyStatus}</p>
    </>}
  </section>;
}
