import { useEffect, useMemo, useRef, useState } from 'react';
import type { ApiClient } from './api/client.ts';
import { AdminChangeList, type AdminChangeListState } from './api/admin-change-list.ts';
import type { AdminChangeDetail, ChangeField } from './api/admin-changes-contract.ts';

type Role = 'reader' | 'owner';
const FIELD_LABELS: Record<ChangeField, string> = {
  name: '이름', status: '상태', allowedOrigins: '허용 출처',
  requestsPerMinute: '분당 요청 한도', newReceiptsPerUtcDay: 'UTC 하루 신규 수신 한도',
};
// A schema.status_changed row carries only its action and version; the active/retired value is not recovered here.
const roleLabel = (role: Role | null): string => role === 'owner' ? '소유자' : role === 'reader' ? '조회' : '없음';

function ActorCell({ actor }: { actor: { kind: 'administrator'; issuer: string; subject: string } | { kind: 'local_operator' } }) {
  if (actor.kind === 'local_operator')
    return <div className="admin-changes-cell"><span className="admin-changes-actor">로컬 운영자</span>
      <span className="admin-changes-detail">등록 도구에서 변경</span></div>;
  return <div className="admin-changes-cell"><span className="admin-changes-actor">{actor.subject}</span>
    <span className="admin-changes-detail">발급자 {actor.issuer}</span></div>;
}

function ChangeCell({ change }: { change: AdminChangeDetail }) {
  if (change.action === 'project.created')
    return <div className="admin-changes-cell"><span className="admin-changes-actor">프로젝트 생성</span></div>;
  if (change.action === 'project.settings_changed')
    return <div className="admin-changes-cell"><span className="admin-changes-actor">프로젝트 설정 변경</span>
      <span className="admin-changes-detail">바뀐 항목: {change.fields.map(field => FIELD_LABELS[field]).join(', ')}</span></div>;
  if (change.action === 'schema.published' || change.action === 'schema.status_changed')
    return <div className="admin-changes-cell">
      <span className="admin-changes-actor">{change.action === 'schema.published' ? '스키마 발행' : '스키마 상태 변경'}</span>
      <span className="admin-changes-detail">스키마 버전 {change.schemaVersion}</span></div>;
  if (change.action === 'publisher.granted' || change.action === 'publisher.revoked')
    return <div className="admin-changes-cell">
      <span className="admin-changes-actor">{change.action === 'publisher.granted' ? '서버 발행 권한 부여' : '서버 발행 권한 회수'}</span>
      <span className="admin-changes-detail">대상 계정 {change.target.subject} · 발급자 {change.target.issuer}</span></div>;
  if (change.action === 'grant.created' || change.action === 'grant.role_changed' || change.action === 'grant.revoked')
    return <div className="admin-changes-cell">
      <span className="admin-changes-actor">{change.action === 'grant.created' ? '권한 부여' : change.action === 'grant.role_changed' ? '권한 역할 변경' : '권한 회수'}</span>
      <span className="admin-changes-detail">대상 계정 {change.target.subject} · 발급자 {change.target.issuer}</span>
      <span className="admin-changes-detail">{change.action === 'grant.created' ? `역할 ${roleLabel(change.afterRole)}`
        : change.action === 'grant.revoked' ? `이전 역할 ${roleLabel(change.beforeRole)}`
        : `${roleLabel(change.beforeRole)} → ${roleLabel(change.afterRole)}`}</span></div>;
  return null;
}

export default function LiveAdminChanges({ client, projectId, canView, timeZone, refreshTick, locked = false, onAccessLost }: {
  client: ApiClient; projectId: string; canView: boolean; timeZone: string; refreshTick: string | number;
  locked?: boolean; onAccessLost?: () => void;
}) {
  const [snapshot, setSnapshot] = useState<{ client: ApiClient; projectId: string; state: AdminChangeListState } | null>(null);
  const [lostScope, setLostScope] = useState<{ client: ApiClient; projectId: string } | null>(null);
  const listRef = useRef<AdminChangeList | null>(null), scopeRef = useRef<{ client: ApiClient; projectId: string } | null>(null);
  const renderedScope = useRef({ client, projectId }); renderedScope.current = { client, projectId };
  const callbacksRef = useRef(onAccessLost); callbacksRef.current = onAccessLost;
  // A refreshTick change recreates the controller, so the list restarts from the first page rather than an older cursor.
  useEffect(() => {
    if (!canView) { setSnapshot(null); listRef.current?.destroy(); listRef.current = null; return; }
    const scope = { client, projectId }; scopeRef.current = scope;
    const current = () => scopeRef.current === scope && renderedScope.current.client === client && renderedScope.current.projectId === projectId;
    setLostScope(null);
    const list = new AdminChangeList(client, projectId); listRef.current = list;
    const unsubscribe = list.subscribe(state => {
      if (!current()) return;
      setSnapshot({ ...scope, state });
      if (state.denied) {
        setLostScope(scope); setSnapshot(null); list.destroy();
        if (listRef.current === list) listRef.current = null;
        callbacksRef.current?.();
      }
    });
    void list.refresh();
    return () => {
      unsubscribe(); list.destroy();
      if (scopeRef.current === scope) scopeRef.current = null;
      if (listRef.current === list) listRef.current = null;
    };
  }, [client, projectId, canView, refreshTick]);
  const formatter = useMemo(() => {
    try { return new Intl.DateTimeFormat('ko-KR', { timeZone, dateStyle: 'medium', timeStyle: 'medium' }); }
    catch { return null; }
  }, [timeZone]);
  // Never render a previous connection/project snapshot, even before effect cleanup runs.
  const lost = lostScope?.client === client && lostScope.projectId === projectId;
  const visible = canView && !lost;
  const state = visible && snapshot?.client === client && snapshot.projectId === projectId ? snapshot.state : null;
  const loading = visible && (!state || state.phase === 'loading');
  const ready = state?.phase === 'ready' ? state.data : null;
  const format = (value: string) => formatter ? formatter.format(new Date(value)) : value;
  const actionsLocked = locked || loading;
  return <section className="settings-section admin-changes-section" aria-labelledby="project-changes-heading" aria-busy={loading || undefined}>
    <div className="settings-head">
      <h3 id="project-changes-heading" className="settings-subheading">변경 이력</h3>
      <span className="settings-badge">소유자 전용</span>
      {visible && <div className="admin-changes-actions">
        <button className="secondary-button" type="button" disabled={actionsLocked} onClick={() => { void listRef.current?.refresh(); }}>처음부터 새로고침</button>
        <button className="secondary-button" type="button" disabled={actionsLocked || state?.phase !== 'ready' || !state.data?.page.nextCursor}
          onClick={() => { void listRef.current?.next(); }}>다음 페이지</button>
      </div>}
    </div>
    {!visible && <p className="notice" role="status">{lost ? '소유자 권한을 확인할 수 없어 변경 이력을 닫았어요. 최신 설정이나 연결을 확인해 주세요.' : '설정에서 소유자 권한을 확인하면 변경 이력을 볼 수 있어요. 조회 권한으로 연결한 계정에는 이력을 표시하지 않아요.'}</p>}
    {visible && <p className="notice">도입 이후 API와 등록 도구에서 기록한 최근 90일 변경을 보여줘요.</p>}
    {loading && <p className="context-note" role="status">변경 이력을 불러오는 중이에요.</p>}
    {state?.phase === 'error' && <div role="alert">
      <p className="form-error">{state.message}</p>
      {!state.denied && <button className="secondary-button" type="button" disabled={actionsLocked} onClick={() => { void listRef.current?.retry(); }}>이 페이지 다시 시도</button>}
    </div>}
    {ready && <>
      <p className="context-note" role="status">{state?.pageNumber}페이지 · 표시 중 {ready.data.length}건{ready.page.nextCursor === null ? ' · 마지막 페이지' : ''} · 조회 시각 <time dateTime={ready.generatedAt}>{format(ready.generatedAt)}</time> ({timeZone})</p>
      {ready.data.length === 0 ? <p className="notice">최근 90일에 기록된 변경이 없어요.</p>
        : <div className="table-scroll" tabIndex={0} role="region" aria-label="프로젝트 변경 이력 표">
          <table className="event-table admin-changes-table">
            <caption className="sr-only">최근 90일의 관리자 변경 기록: 시각, 작업자, 변경 내용</caption>
            <thead><tr><th scope="col">시각</th><th scope="col">작업자</th><th scope="col">변경</th></tr></thead>
            <tbody>{ready.data.map(row => <tr key={row.id}>
              <td className="admin-changes-time"><time dateTime={row.occurredAt}>{format(row.occurredAt)}</time></td>
              <td><ActorCell actor={row.actor} /></td>
              <td><ChangeCell change={row.change} /></td>
            </tr>)}</tbody>
          </table>
        </div>}
      <p className="context-note">한 페이지에 25건까지 보여줘요. 뒤에 추가된 변경은 처음부터 새로고침하면 보여요.</p>
    </>}
  </section>;
}
