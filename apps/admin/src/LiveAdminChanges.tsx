import { useEffect, useMemo, useRef, useState } from 'react';
import type { ApiClient } from './api/client.ts';
import { AdminChangeList, type AdminChangeListState } from './api/admin-change-list.ts';
import type { AdminChangeDetail, ChangeField } from './api/admin-changes-contract.ts';
import { useI18n } from './i18n';
import { useMessageText } from './i18n/messages';

type Role = 'reader' | 'owner';

function ActorCell({ actor }: { actor: { kind: 'administrator'; issuer: string; subject: string } | { kind: 'local_operator' } }) {
  const { t } = useI18n();
  if (actor.kind === 'local_operator')
    return <div className="admin-changes-cell"><span className="admin-changes-actor">{t('operations:changesLocalOperator')}</span>
      <span className="admin-changes-detail">{t('operations:changesLocalOperatorDetail')}</span></div>;
  return <div className="admin-changes-cell"><span className="admin-changes-actor">{actor.subject}</span>
    <span className="admin-changes-detail">{t('operations:changesIssuer', { issuer: actor.issuer })}</span></div>;
}

function ChangeCell({ change }: { change: AdminChangeDetail }) {
  const { t } = useI18n();
  // A schema.status_changed row carries only its action and version; the active/retired value is not recovered here.
  const roleLabel = (role: Role | null): string => role === 'owner' ? t('operations:roleOwner') : role === 'reader' ? t('operations:roleReader') : t('operations:changesRoleNone');
  const fieldLabel = (field: ChangeField) => {
    switch (field) {
      case 'name': return t('operations:fieldName');
      case 'status': return t('operations:fieldStatus');
      case 'allowedOrigins': return t('operations:fieldAllowedOrigins');
      case 'requestsPerMinute': return t('operations:fieldRequestsPerMinute');
      case 'newReceiptsPerUtcDay': return t('operations:fieldNewReceiptsPerUtcDay');
      default: return field;
    }
  };
  if (change.action === 'project.created')
    return <div className="admin-changes-cell"><span className="admin-changes-actor">{t('operations:changesProjectCreated')}</span></div>;
  if (change.action === 'project.settings_changed')
    return <div className="admin-changes-cell"><span className="admin-changes-actor">{t('operations:changesSettingsChanged')}</span>
      <span className="admin-changes-detail">{t('operations:changesFields', { fields: change.fields.map(fieldLabel).join(', ') })}</span></div>;
  if (change.action === 'schema.published' || change.action === 'schema.status_changed')
    return <div className="admin-changes-cell">
      <span className="admin-changes-actor">{t(change.action === 'schema.published' ? 'operations:changesSchemaPublished' : 'operations:changesSchemaStatus')}</span>
      <span className="admin-changes-detail">{t('operations:changesSchemaVersion', { version: change.schemaVersion })}</span></div>;
  if (change.action === 'publisher.granted' || change.action === 'publisher.revoked')
    return <div className="admin-changes-cell">
      <span className="admin-changes-actor">{t(change.action === 'publisher.granted' ? 'operations:changesPublisherGranted' : 'operations:changesPublisherRevoked')}</span>
      <span className="admin-changes-detail">{t('operations:changesTarget', { subject: change.target.subject, issuer: change.target.issuer })}</span></div>;
  if (change.action === 'grant.created' || change.action === 'grant.role_changed' || change.action === 'grant.revoked')
    return <div className="admin-changes-cell">
      <span className="admin-changes-actor">{t(change.action === 'grant.created' ? 'operations:changesGrantCreated' : change.action === 'grant.role_changed' ? 'operations:changesGrantRoleChanged' : 'operations:changesGrantRevoked')}</span>
      <span className="admin-changes-detail">{t('operations:changesTarget', { subject: change.target.subject, issuer: change.target.issuer })}</span>
      <span className="admin-changes-detail">{change.action === 'grant.created' ? t('operations:changesRole', { role: roleLabel(change.afterRole) })
        : change.action === 'grant.revoked' ? t('operations:changesPreviousRole', { role: roleLabel(change.beforeRole) })
        : t('operations:changesRoleArrow', { before: roleLabel(change.beforeRole), after: roleLabel(change.afterRole) })}</span></div>;
  return null;
}

export default function LiveAdminChanges({ client, projectId, canView, timeZone, refreshTick, locked = false, onAccessLost }: {
  client: ApiClient; projectId: string; canView: boolean; timeZone: string; refreshTick: string | number;
  locked?: boolean; onAccessLost?: () => void;
}) {
  const { t, locale } = useI18n();
  const messageText = useMessageText();
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
    try { return new Intl.DateTimeFormat(locale, { timeZone, calendar: 'gregory', dateStyle: 'medium', timeStyle: 'medium' }); }
    catch { return null; }
  }, [timeZone, locale]);
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
      <h3 id="project-changes-heading" className="settings-subheading">{t('operations:changesHeading')}</h3>
      <span className="settings-badge">{t('operations:ownerOnlyBadge')}</span>
      {visible && <div className="admin-changes-actions">
        <button className="secondary-button" type="button" disabled={actionsLocked} onClick={() => { void listRef.current?.refresh(); }}>{t('operations:reloadFromStart')}</button>
        <button className="secondary-button" type="button" disabled={actionsLocked || state?.phase !== 'ready' || !state.data?.page.nextCursor}
          onClick={() => { void listRef.current?.next(); }}>{t('operations:nextPage')}</button>
      </div>}
    </div>
    {!visible && <p className="notice" role="status">{t(lost ? 'operations:changesLost' : 'operations:changesNoAccess')}</p>}
    {visible && <p className="notice">{t('operations:changesIntro')}</p>}
    {loading && <p className="context-note" role="status">{t('operations:changesLoading')}</p>}
    {state?.phase === 'error' && <div role="alert">
      <p className="form-error">{messageText(state.message)}</p>
      {!state.denied && <button className="secondary-button" type="button" disabled={actionsLocked} onClick={() => { void listRef.current?.retry(); }}>{t('operations:retryPage')}</button>}
    </div>}
    {ready && <>
      <p className="context-note" role="status">{t('operations:changesPage', { page: state?.pageNumber ?? 0, count: ready.data.length })}{ready.page.nextCursor === null ? t('operations:lastPage') : ''}{t('operations:changesViewedAt')}<time dateTime={ready.generatedAt}>{format(ready.generatedAt)}</time>{t('operations:changesViewedAtZone', { timeZone })}</p>
      {ready.data.length === 0 ? <p className="notice">{t('operations:changesEmpty')}</p>
        : <div className="table-scroll" tabIndex={0} role="region" aria-label={t('operations:changesTableLabel')}>
          <table className="event-table admin-changes-table">
            <caption className="sr-only">{t('operations:changesTableCaption')}</caption>
            <thead><tr><th scope="col">{t('operations:changesTimeColumn')}</th><th scope="col">{t('operations:changesActorColumn')}</th><th scope="col">{t('operations:changesChangeColumn')}</th></tr></thead>
            <tbody>{ready.data.map(row => <tr key={row.id}>
              <td className="admin-changes-time"><time dateTime={row.occurredAt}>{format(row.occurredAt)}</time></td>
              <td><ActorCell actor={row.actor} /></td>
              <td><ChangeCell change={row.change} /></td>
            </tr>)}</tbody>
          </table>
        </div>}
      <p className="context-note">{t('operations:changesFooter')}</p>
    </>}
  </section>;
}
