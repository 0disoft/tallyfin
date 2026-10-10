import { useEffect, useMemo, useRef, useState } from 'react';
import type { ApiClient } from './api/client.ts';
import { GrantList, type GrantListState } from './api/grant-list.ts';

export default function LiveGrants({ client, projectId, canView, timeZone, refreshTick }: {
  client: ApiClient; projectId: string; canView: boolean; timeZone: string; refreshTick: number;
}) {
  const [snapshot, setSnapshot] = useState<{ client: ApiClient; projectId: string; state: GrantListState } | null>(null);
  const listRef = useRef<GrantList | null>(null), tickRef = useRef(refreshTick);
  useEffect(() => {
    if (!canView) { setSnapshot(null); return; }
    const list = new GrantList(client, projectId); listRef.current = list;
    const unsubscribe = list.subscribe(state => setSnapshot({ client, projectId, state }));
    void list.refresh();
    return () => { unsubscribe(); list.destroy(); if (listRef.current === list) listRef.current = null; };
  }, [client, projectId, canView]);
  useEffect(() => {
    if (tickRef.current !== refreshTick) { tickRef.current = refreshTick; void listRef.current?.refresh(); }
  }, [refreshTick]);
  const formatter = useMemo(() => {
    try { return new Intl.DateTimeFormat('ko-KR', { timeZone, dateStyle: 'medium', timeStyle: 'short' }); }
    catch { return null; }
  }, [timeZone]);
  // Never render a previous connection/project snapshot, even before effect cleanup runs.
  const state = canView && snapshot?.client === client && snapshot.projectId === projectId ? snapshot.state : null;
  const loading = canView && (!state || state.phase === 'loading');
  return <section className="settings-section grants-section" aria-labelledby="project-grants-heading" aria-busy={loading || undefined}>
    <div className="settings-head">
      <h3 id="project-grants-heading" className="settings-subheading">프로젝트 권한</h3>
      <span className="settings-badge">소유자 전용</span>
      {canView && <div className="grants-actions">
        <button className="secondary-button" type="button" disabled={loading} onClick={() => { void listRef.current?.refresh(); }}>처음부터 새로고침</button>
        <button className="secondary-button" type="button" disabled={state?.phase !== 'ready' || !state.data?.page.nextCursor}
          onClick={() => { void listRef.current?.next(); }}>다음 페이지</button>
      </div>}
    </div>
    <p className="context-note">권한을 가진 계정의 식별자와 역할을 확인해요. 권한 부여·변경·회수는 운영자 CLI에서 처리해요.</p>
    {!canView && <p className="notice" role="status">설정에서 소유자 권한을 확인하면 목록을 볼 수 있어요. 조회 권한으로 연결한 계정에는 목록을 표시하지 않아요.</p>}
    {loading && <p className="context-note" role="status">권한 목록을 불러오는 중이에요.</p>}
    {state?.phase === 'error' && <div role="alert">
      <p className="form-error">{state.message}</p>
      {!state.denied && <button className="secondary-button" type="button" onClick={() => { void listRef.current?.retry(); }}>이 페이지 다시 시도</button>}
    </div>}
    {state?.phase === 'ready' && state.data && <>
      <p className="context-note" role="status">{state.pageNumber}페이지 · 표시 중 {state.data.data.length}건{state.data.page.nextCursor === null ? ' · 마지막 페이지' : ''} · 등록 시각: {timeZone}</p>
      {state.data.data.length === 0 ? <p className="notice">이 페이지에 표시할 권한이 없어요. 처음부터 새로고침하면 현재 목록을 다시 확인할 수 있어요.</p>
        : <div className="table-scroll" tabIndex={0} role="region" aria-label="프로젝트 권한 표">
          <table className="event-table grants-table">
            <caption className="sr-only">현재 프로젝트에 등록된 계정 식별자, 발급자, 권한, 등록 시각</caption>
            <thead><tr><th scope="col">계정 식별자</th><th scope="col">발급자</th><th scope="col">권한</th><th scope="col">등록 시각</th></tr></thead>
            <tbody>{state.data.data.map(grant => <tr key={JSON.stringify([grant.issuer, grant.subject])}>
              <th scope="row">{grant.subject}</th><td>{grant.issuer}</td>
              <td><span className="settings-badge grant-role">{grant.role === 'owner' ? '소유자' : '조회'}</span></td>
              <td><time dateTime={grant.createdAt}>{formatter ? formatter.format(new Date(grant.createdAt)) : grant.createdAt}</time></td>
            </tr>)}</tbody>
          </table>
        </div>}
      <p className="context-note">발급자와 식별자 순서로 25건씩 보여줘요. 앞쪽에 추가된 권한은 처음부터 새로고침하면 보여요.</p>
    </>}
  </section>;
}
