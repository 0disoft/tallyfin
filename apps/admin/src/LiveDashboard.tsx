import { useMessageText } from './i18n/messages';
import { useLocaleFormat } from './i18n/format';
import { useI18n } from './i18n';
import useSchemaVersion from './useSchemaVersion';
import useProjectPages from './useProjectPages';
import ProjectPicker from './ProjectPicker';
import { useMainAnalysis, usePeriodComparison, useEventSeries } from './useAnalysis';
import { lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BrowserLogin } from './auth/client';
import './auth/login-workspace.css';
import { CaretDown, Desktop, Database, Gear, PlugsConnected, WarningCircle } from '@phosphor-icons/react';
import EventWorkspace from './EventWorkspace';
import { createPortal } from 'react-dom';
import { Trend } from './Dashboard';
import DeferredPanel from './DeferredPanel';
import OverviewWorkspace from './OverviewWorkspace';
import DateRangePicker from './DateRangePicker';
import LiveIdentity from './LiveIdentity';
import { type DailyRecord, type Period, type View } from './data';
import { API_BASE_PATH, ApiClient, ApiError, resolveApiEndpoint } from './api/client';
import PeriodComparison from './PeriodComparison';
import CsvDownload from './CsvDownload';
import type { WorkflowGroupingState } from './api/workflow-analysis';
import { previousRange, recoverWorkflow } from './api/period-comparison';
import { dashboardEvents } from './api/dashboard-model';
import { dashboardExport } from './api/dashboard-export';
import EventPropertyBreakdown from './EventPropertyBreakdown';
import EventPropertyComparison from './EventPropertyComparison';
import useEventPropertyComparison from './useEventPropertyComparison';
import { eventContext, eventPropertyNames, selectedGrouping } from './api/event-analysis';
import type { EventGrouping } from './api/event-analysis';
import { comparisonRangeError, periodRange, rangeError, rangeLabel, todayInZone, type DateRange } from './api/dates';
import type { EventSource, Project, ProjectSettings, Registry } from './api/types';
import { DraftExitGuard } from './api/draft-exit-guard';

type ActiveProject = { name: string; timeZone: string };
type Session = { basePath: string; token?: string; login?: BrowserLogin };
const OidcLogin = lazy(() => import('./auth/OidcLogin'));
const LiveSettingsWorkspace = lazy(() => import('./LiveSettingsWorkspace'));
const LiveProjectCreate = lazy(() => import('./LiveProjectCreate'));
const ProjectOverview = lazy(() => import('./ProjectOverview'));
const LiveGoals = lazy(() => import('./LiveGoals'));

const MAX_SCHEMA_VERSION = 2147483647;

function describeError(error: ApiError, t: ReturnType<typeof useI18n>['t'], messageText: ReturnType<typeof useMessageText>): { title: string; detail: string } {
  switch (error.kind) {
    case 'unauthorized':
      return { title: t('workspace:authTitle'), detail: t('workspace:authHelp') };
    case 'forbidden':
      return { title: t('workspace:forbiddenTitle'), detail: t('workspace:forbiddenHelp') };
    case 'not_found':
      return { title: t('workspace:notFoundTitle'), detail: t('workspace:notFoundHelp') };
    case 'invalid_request':
      return { title: t('workspace:invalidTitle'), detail: t('workspace:invalidHelp') };
    case 'storage_unavailable':
      return { title: t('workspace:storageTitle'), detail: t('workspace:storageHelp') };
    case 'contract':
      return { title: t('workspace:contractTitle'), detail: t('workspace:contractHelp') };
    case 'network':
      return { title: t('workspace:networkTitle'), detail: t('workspace:networkHelp', { path: API_BASE_PATH }) };
    case 'timeout':
      return { title: t('workspace:timeoutTitle'), detail: messageText(error.message) };
    default:
      return { title: t('workspace:failedTitle'), detail: t('workspace:httpHelp', { status: error.status }) };
  }
}

function ErrorPanel({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  const { t } = useI18n();
  const messageText = useMessageText();
  const { title, detail } = describeError(error, t, messageText);
  return <section className="state-panel" role="alert"><WarningCircle size={32} /><h2>{title}</h2><p>{detail}</p><div className="state-actions"><button className="secondary-button" type="button" onClick={onRetry}>{t('workspace:retry')}</button></div>{error.requestId && <p className="context-note">requestId: {error.requestId}</p>}</section>;
}

export function LiveDashboard({ view, period, customPeriod, onActiveProjectChange, onNavigate, registerExitCheck, headerHost }: { view: View; period: Period; customPeriod: boolean; onActiveProjectChange: (info: ActiveProject | null) => void; onNavigate?: (view: View) => void; registerExitCheck?: (check: () => boolean) => () => void; headerHost?: HTMLElement | null }) {
  const currentOrigin = useMemo(() => window.location.origin, []);
  const { t } = useI18n();
  const messageText = useMessageText();
  const { count: formatCount } = useLocaleFormat();
  const [session, setSession] = useState<Session | null>(null);
  const [unauthorizedClient, setUnauthorizedClient] = useState<ApiClient | null>(null);
  const [token, setToken] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [endpointError, setEndpointError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [grouping, setGrouping] = useState<EventGrouping>(null);
  const [query, setQuery] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'properties' | 'daily'>('properties');
  const initialEventScope = useRef<{ client: ApiClient | null; key: string } | null>(null);
  const [selectedSource, setSelectedSource] = useState<EventSource>('browser');
  const source = view === 'goals' ? 'browser' : selectedSource;
  const analysisWorkspace = view === 'events' || view === 'goals';
  const compactWorkspace = analysisWorkspace || view === 'overview' || view === 'settings';
  const [refreshTick, setRefreshTick] = useState(0);
  const [settingsRefreshTick, setSettingsRefreshTick] = useState(0);
  const [settingsRegistry, setSettingsRegistry] = useState<Registry | null>(null);
  const [retainedSettings, setRetainedSettings] = useState<{ client: ApiClient; projectId: string } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newProjectId, setNewProjectId] = useState<string | null>(null);
  const [setupRefreshTick, setSetupRefreshTick] = useState(0);
  const [diagnosticsRevision, setDiagnosticsRevision] = useState(0);
  const [compare, setCompare] = useState(false);
  const [comparisonRetry, setComparisonRetry] = useState(0);
  const [workflowDetails, setWorkflowDetails] = useState<Record<string, WorkflowGroupingState>>({});
  const workflowContext = useRef('');
  const workflowStateChanged = useCallback((id: string, state: WorkflowGroupingState) => {
    if (state.context !== workflowContext.current) return;
    setWorkflowDetails(previous => ({ ...Object.fromEntries(Object.entries(previous).filter(([, value]) => value.context === state.context)), [id]: state }));
  }, []);
  const [customRange, setCustomRange] = useState<{ scope: string; range: DateRange } | null>(null);
  const [readDenial, setReadDenial] = useState<{ client: ApiClient; projectId: string; error: ApiError; revision: number } | null>(null);
  const readDenialHandler = useRef<(client: ApiClient, projectId: string, error: ApiError) => void>(() => {});
  useEffect(() => { if (!customPeriod) setCustomRange(null); }, [customPeriod]);

  const client = useMemo(() => {
    if (!session) return null;
    const next = new ApiClient({ basePath: session.basePath,
      ...(session.login ? { getBearer: () => session.login!.getAccessToken(), onDestroy: () => session.login!.destroy() } : { token: session.token ?? '' }),
      onUnauthorized: () => { if (clientRef.current === next) setUnauthorizedClient(next); },
      onAnalyticsAccessDenied: (projectId, error) => readDenialHandler.current(next, projectId, error),
    });
    return next;
  }, [session]);
  const { projects, nextCursor, more, pageError, loadMore, invalidatePages, resetProjects, updateProject, addProject, rememberProject } = useProjectPages(client, refreshTick, projectId);
  const clientRef = useRef<ApiClient | null>(null);
  clientRef.current = client;
  const draftExit = useMemo(() => new DraftExitGuard<ApiClient>(), []);
  const registerDraft = useCallback((scope: ApiClient, project: string | null, check: () => boolean) =>
    draftExit.register(scope, project, check), [draftExit]);

  const { versionInput, setVersionInput, loading: versionLoading, error: versionError, selectAutomatic, automatic: automaticVersion } = useSchemaVersion(client, projectId, refreshTick);
  const versionText = versionInput.trim();
  const version = /^[0-9]+$/.test(versionText) ? Number(versionText) : Number.NaN;
  const validVersion = Number.isInteger(version) && version >= 1 && version <= MAX_SCHEMA_VERSION;
  const activeProject = projects.data?.find(item => item.id === projectId) ?? null;
  const activeProjectId = activeProject?.id ?? null;
  const confirmDraftExit = useCallback((includeConnection = false) => !client || draftExit.canLeave(client, projectId, () =>
    window.confirm(t('workspace:draftExit')), includeConnection),
  [client, projectId, draftExit, t]);
  useEffect(() => registerExitCheck?.(() => confirmDraftExit(true)), [registerExitCheck, confirmDraftExit]);
  const settingsScopeRetained = retainedSettings?.client === client && retainedSettings?.projectId === projectId;
  const settingsProjectId = settingsScopeRetained ? retainedSettings.projectId : view === 'settings' ? activeProjectId : null;
  const settingsVisible = view === 'settings' && projects.status === 'ready' && settingsProjectId === activeProjectId;
  // Retain selection-scoped editors while the project list is unavailable.
  // Returning to settings rechecks server state; list data grants no edit authority.
  useEffect(() => {
    if (view === 'settings' && client && activeProjectId) {
      if (retainedSettings?.client === client && retainedSettings.projectId === activeProjectId)
        setSettingsRefreshTick(tick => tick + 1);
      setRetainedSettings({ client, projectId: activeProjectId });
    } else if (retainedSettings?.client !== client || retainedSettings?.projectId !== projectId)
      setRetainedSettings(null);
  }, [view, client, activeProjectId, projectId]);
  const activeTimeZone = activeProject?.timeZone ?? null;
  const deniedRead = readDenial?.client === client && readDenial.projectId === activeProjectId && readDenial.revision === refreshTick ? readDenial.error : null;
  readDenialHandler.current = (requestClient, requestProject, error) => {
    if (clientRef.current !== requestClient || requestProject !== activeProjectId) return;
    setReadDenial({ client: requestClient, projectId: requestProject, error, revision: refreshTick });
    setMain({ status: 'idle' }); setSeries({ status: 'idle' }); setComparison({ status: 'idle' });
    setWorkflowDetails({});
  };
  const projectToday = activeTimeZone ? todayInZone(activeTimeZone) : null;
  const dateScope = JSON.stringify([activeProjectId, activeTimeZone, period]);
  useEffect(() => { setCustomRange(previous => previous?.scope === dateScope ? previous : null); }, [dateScope]);
  const currentRange = projectToday ? customPeriod && customRange?.scope === dateScope ? customRange.range : periodRange(projectToday, period) : null;
  const dateError = currentRange && projectToday ? rangeError(currentRange, projectToday) : null;
  const mainKey = JSON.stringify([activeProjectId, activeTimeZone, versionText, currentRange?.from, currentRange?.to, refreshTick, view, source]);
  const [main, setMain] = useMainAnalysis({ client, activeProjectId, activeTimeZone, version, validVersion, currentRange, dateError, deniedRead, period, refreshTick, view, mainKey, source });
  const currentMain = !deniedRead && main.key === mainKey ? main : null;
  workflowContext.current = mainKey;
  const analysisRegistry = currentMain?.status === 'ready' && main.data?.registry.project.id === activeProjectId &&
    main.data.registry.schemaVersion === version && main.data.range.from === currentRange?.from && main.data.range.to === currentRange?.to
    ? main.data.registry : null;
  const analysisEvent = analysisRegistry?.events.find(event => event.name === selectedEvent && event.source === source) ?? null;
  useEffect(() => {
    if (view !== 'events' || !analysisRegistry) return;
    const scope = JSON.stringify([analysisRegistry.project.id, analysisRegistry.schemaVersion, source]);
    if (initialEventScope.current?.client === client && initialEventScope.current.key === scope) return;
    initialEventScope.current = { client, key: scope };
    setSelectedEvent(previous => analysisRegistry.events.some(event => event.name === previous && event.source === source)
      ? previous : analysisRegistry.events.find(event => event.source === source)?.name ?? null);
    setGrouping(null);
  }, [view, analysisRegistry, source, client]);
  const groupBy = analysisRegistry && analysisEvent ? selectedGrouping(analysisRegistry, analysisEvent, grouping) : '';
  const propertyNames = eventPropertyNames(analysisEvent);
  const seriesKey = analysisRegistry && analysisEvent && currentRange
    ? JSON.stringify([eventContext(analysisRegistry, analysisEvent), groupBy, currentRange.from, currentRange.to, refreshTick]) : null;
  const [series, setSeries] = useEventSeries({ client, view, analysisEvent, analysisRegistry, currentRange, seriesKey, version, source, groupBy });
  const currentSeries = seriesKey && series.key === seriesKey ? series : null;
  const seriesData = currentSeries?.status === 'ready' ? currentSeries.data ?? null : null;
  const retry = useCallback(() => {
    if (view === 'settings' && projects.status === 'ready') setSettingsRefreshTick(tick => tick + 1);
    else {
      invalidatePages();
      setRefreshTick(tick => tick + 1);
    }
  }, [view, projects.status, invalidatePages]);
  const settingsSaved = useCallback((settings: ProjectSettings) => {
    updateProject(settings.project);
    setDiagnosticsRevision(tick => tick + 1);
  }, [updateProject]);
  const projectCreated = useCallback((settings: ProjectSettings) => {
    addProject(settings.project);
    if (settings.project.id !== activeProjectId && !confirmDraftExit()) return false;
    setProjectId(settings.project.id); setSelectedEvent(null); setGrouping(null); setMain({ status: 'idle' }); setSeries({ status: 'idle' });
    setNewProjectId(settings.project.id); setShowCreate(false);
    onNavigate?.('settings');
    return true;
  }, [onNavigate, addProject, activeProjectId, confirmDraftExit]);
  const schemaVersionChanged = useCallback((version: number) => { setVersionInput(String(version)); setSetupRefreshTick(tick => tick + 1); }, [setVersionInput]);
  const connected = useCallback((login: BrowserLogin) => {
    clientRef.current?.destroy();
    setUnauthorizedClient(null);
    resetProjects();
    setToken(''); setProjectId(null); setSelectedEvent(null); setGrouping(null);
    setMain({ status: 'idle' }); setSeries({ status: 'idle' });
    setCustomRange(null);
    setSession({ login, basePath: API_BASE_PATH });
    setShowCreate(false); setNewProjectId(null);
  }, [resetProjects]);

  function connect() {
    const resolved = resolveApiEndpoint(endpoint, currentOrigin);
    if ('error' in resolved) { setEndpointError(resolved.error); return; }
    resetProjects();
    setEndpointError(null);

    setMain({ status: 'idle' });
    setSeries({ status: 'idle' });
    setCustomRange(null);
    setCompare(false); setComparison({ status: 'idle' });
    setProjectId(null);
    setSelectedEvent(null);
    setGrouping(null);
    setSession({ token, basePath: resolved.basePath });
    setShowCreate(false); setNewProjectId(null);
    setToken('');
  }
  function switchProject(next: string | null, project?: Project) {
    if (next === projectId || !confirmDraftExit()) return;
    if (project) rememberProject(project);
    setProjectId(next); setSelectedEvent(null); setGrouping(null);
  }
  function disconnect() {
    if (!confirmDraftExit(true)) return;
    resetProjects(true);
    client?.destroy();
    setUnauthorizedClient(null);
    setSession(null);
    setCustomRange(null);
    setCompare(false); setComparison({ status: 'idle' });
    setToken('');

    setMain({ status: 'idle' });
    setSeries({ status: 'idle' });
    setProjectId(null);
    setSelectedEvent(null);
    setGrouping(null);
    setQuery('');
    setEndpointError(null);
    setRefreshTick(0);
    setShowCreate(false); setNewProjectId(null); setSetupRefreshTick(0);
  }

  useEffect(() => () => { clientRef.current?.destroy(); }, []);

  useEffect(() => {
    if (projects.status !== 'ready' || !projects.data) return;
    if (projectId && projects.data.some(item => item.id === projectId)) return;
    setProjectId(projects.data[0]?.id ?? null);
  }, [projects, projectId]);

  useEffect(() => {
    onActiveProjectChange(activeProject ? { name: activeProject.name, timeZone: activeProject.timeZone } : null);
  }, [activeProject, onActiveProjectChange]);

  const mainData = currentMain?.status === 'ready' ? currentMain.data : undefined;
  const comparisonAvailable = view !== 'goals' || !!mainData?.registry.workflows.length || !!mainData?.registry.funnels?.length;
  const aggregateComparisonAvailable = view !== 'goals' || !!mainData?.registry.workflows.length;
  const comparisonError = mainData && projectToday ? comparisonRangeError(mainData.range, projectToday) : null;
  const propertyComparison = useEventPropertyComparison(client, analysisRegistry, seriesData,
    compare && view === 'events' && !!groupBy && !comparisonError && !!seriesData, seriesKey);
  const comparisonKey = JSON.stringify([mainKey, comparisonRetry]);
  const [comparison, setComparison] = usePeriodComparison({ client, compare, aggregateComparisonAvailable, view, mainData, comparisonError, comparisonKey, source });

  useEffect(() => {
    setSettingsRegistry(null);
    if (view !== 'settings' || !client || !activeProjectId || !validVersion) return;
    const controller = new AbortController();
    client.getSchema(activeProjectId, version, { signal: controller.signal })
      .then(schema => { if (!controller.signal.aborted) setSettingsRegistry(schema); })
      .catch(() => { /* Settings remain independent of optional schema definitions. */ });
    return () => controller.abort();
  }, [view, client, activeProjectId, version, validVersion, settingsRefreshTick, setupRefreshTick]);

  if (!client) {
    return <div className="login-workspace"><div className="login-frame">
    <div className="login-brand"><img src="/assets/tallyfin-fin.png" alt="" width="40" height="30" /><span>Tallyfin</span></div>
    <div className="login-card">
    <DeferredPanel label={t('workspace:login')}><OidcLogin onConnected={connected} standalone /></DeferredPanel>
    <details className="manual-connection login-manual"><summary>{t('workspace:manualConnection')}<CaretDown size={16} aria-hidden="true" /></summary><section className="login-manual-body">
      <h2>{t('workspace:apiConnection')}</h2>
      <p className="context-note">{t('workspace:connectionHelp', { path: API_BASE_PATH })}</p>
      <form className="settings-form" onSubmit={event => { event.preventDefault(); connect(); }}>
        <div className="login-field"><label className="field-label" htmlFor="api-endpoint">{t('workspace:endpoint')}</label>
        <input id="api-endpoint" className="text-input" value={endpoint} placeholder={`${currentOrigin}${API_BASE_PATH}`} onChange={event => { setEndpoint(event.target.value); setEndpointError(null); }} /></div>
        <div className="login-field"><label className="field-label" htmlFor="api-token">{t('workspace:bearerToken')}</label>
        <input id="api-token" className="text-input" type="password" autoComplete="off" value={token} placeholder={t('workspace:tokenPlaceholder')} onChange={event => setToken(event.target.value)} /></div>
        <p className="context-note">{t('workspace:tokenHelp')}</p>
        {endpointError && <p className="form-error" role="alert">{messageText(endpointError)}</p>}
        <div className="form-actions"><button className="primary-button" type="submit"><PlugsConnected size={22} weight="fill" />{t('workspace:connect')}</button></div>
      </form>
    </section></details></div></div></div>;
  }

  const data = dateError ? null : mainData ?? null;
  const currentComparison = comparison.key === comparisonKey ? comparison : null;
  const range = data?.range ?? null;
  const registry = data?.registry ?? null;
  const primary = data?.workflows[0] ?? null;
  const startDefinition = data && primary ? data.registry.events.find(item => item.name === primary.definition.startEvent) ?? null : null;
  const successDefinition = data && primary ? data.registry.events.find(item => item.name === primary.definition.successEvent) ?? null : null;
  const { rows: eventRows, filtered: filteredEvents } = dashboardEvents(registry, data?.summary ?? null, source, query);
  const seriesRecords: DailyRecord[] = seriesData ? seriesData.days.map(day => ({ date: day.date, events: { [seriesData.eventName]: day.count } })) : [];
  const startLabel = startDefinition?.label ?? t('workspace:startAttempt');
  const successLabel = successDefinition?.label ?? t('workspace:successAttempt');
  const currentWorkflowDetails = view === 'goals' ? Object.values(workflowDetails).filter(detail => detail.context === mainKey && detail.groupBy) : [];
  const { input: exportInput, unavailable: exportUnavailable } = dashboardExport({ data, validVersion, view, source, query, compare,
    comparison: currentComparison, comparisonError, selectedEvent, analysisEvent, seriesData, groupBy,
    propertyComparison: propertyComparison.state, workflowDetails: currentWorkflowDetails });

  const connectionControls = <>
      <label className="api-field"><span>{t('admin:schemaVersion')}</span><input className="text-input" inputMode="numeric" pattern="[0-9]*" aria-label={t('admin:schemaVersion')} value={versionInput} onChange={event => { setVersionInput(event.target.value); setGrouping(null); }} /></label>
      <label className="comparison-toggle"><input type="checkbox" checked={automaticVersion} disabled={!projectId || versionLoading}
        onChange={event => { if (event.target.checked) selectAutomatic(); else setVersionInput(versionInput); setGrouping(null); }} />{t('admin:autoSchema')}</label>
      <button className="secondary-button" type="button" onClick={retry}>{t('admin:refresh')}</button>
      <button className="primary-button" type="button" aria-expanded={showCreate} aria-controls="project-create-heading" disabled={showCreate} onClick={() => setShowCreate(true)}>{t('admin:addProject')}</button>
      {session?.login?.passwordChangeUrl && <a className="secondary-button" href={session.login.passwordChangeUrl} target="_blank" rel="noopener noreferrer">{t('admin:changePassword')}<span className="sr-only"> {t('admin:newTab')}</span></a>}
      <button className="secondary-button" type="button" onClick={disconnect}>{t('admin:disconnect')}</button>
      </>;

  const projectControls = <div className={`toolbar api-toolbar${compactWorkspace ? ' events-connection-bar' : ''}`}>
      <ProjectPicker compact={compactWorkspace} client={client} projects={projects.data ?? []} active={activeProject} enabled={projects.status === 'ready'} refreshTick={refreshTick}
        hasMore={!!nextCursor} loadingMore={more} onLoadMore={loadMore} onSelect={project => switchProject(project.id, project)} />
      {compactWorkspace ? <details className="events-advanced"><summary title={t('admin:connectionSettings')}><Gear size={18} aria-hidden="true" /><span className="connection-settings-label">{t('admin:connectionSettings')}</span></summary><div className="events-advanced-panel"><div className="toolbar">{connectionControls}</div>{view !== 'settings' && <LiveIdentity client={client} />}</div></details> : connectionControls}
    </div>;
  return <>
    {unauthorizedClient === client && <>
      <p className="notice" role="alert">{t('workspace:sessionExpired')}</p>
      <DeferredPanel label={t('workspace:adminLogin')}><OidcLogin onConnected={connected} onBeforeLogin={() => {
        if (!confirmDraftExit(true)) return false;
        client.destroy();
        return true;
      }} /></DeferredPanel>
    </>}
    {compactWorkspace && headerHost ? createPortal(projectControls, headerHost) : projectControls}
    {view !== 'settings' && customPeriod && currentRange && projectToday && <DateRangePicker
      key={JSON.stringify([dateScope, currentRange.from, currentRange.to])} range={currentRange} today={projectToday} timeZone={activeTimeZone!}
      onApply={range => setCustomRange({ scope: dateScope, range })} />}
    {view !== 'settings' && dateError && <p className="form-error" role="alert">{messageText(dateError)}</p>}
    {!compactWorkspace && <><p className="context-note">{t('workspace:apiConnection')} · {range ? rangeLabel(range.from, range.to) : '—'} · {activeTimeZone ?? '—'} · {t('workspace:tokenMemory')}</p><LiveIdentity client={client} /></>}

    <div className={view === 'overview' ? 'overview-toolbar events-actions' : analysisWorkspace ? 'events-actions' : undefined}>
    {view === 'overview' && <div className="event-source-switch" role="group" aria-label={t('admin:sourceGroup')}>{(['browser', 'server'] as const).map(value => <button type="button" key={value} aria-pressed={source === value} onClick={() => { setSelectedSource(value); setSelectedEvent(null); setGrouping(null); }}>{value === 'browser' ? <Desktop size={17} /> : <Database size={17} />}{t(value === 'browser' ? 'admin:browserEvents' : 'admin:serverEvents')}</button>)}</div>}
    {(analysisWorkspace || view === 'overview') && comparisonAvailable && <label className="comparison-toggle"><input type="checkbox" checked={compare} onChange={event => setCompare(event.target.checked)} />{view === 'goals' ? t('workspace:goalComparison') : t('admin:comparePrevious')}</label>}
    {view !== 'settings' && range?.to === projectToday && <p className="context-note">{t('admin:todayAggregating')}{compare && ` ${t('admin:todayComparedNotice')}`}</p>}
    {view !== 'settings' && (view !== 'goals' || !!data?.registry.workflows.length) && <CsvDownload compact={analysisWorkspace || view === 'overview'} key={JSON.stringify([mainKey, comparisonKey, compare, query, selectedEvent, groupBy, seriesKey, propertyComparison.state?.key, propertyComparison.state?.status, currentWorkflowDetails.map(detail => [detail.groupBy, detail.status, detail.comparisonStatus])])} input={exportInput} unavailable={exportUnavailable} buttonLabel={view === 'goals' ? t('workspace:workflowCsv') : undefined} />}
    </div>
    {showCreate && <DeferredPanel label={t('workspace:createProject')}><LiveProjectCreate client={client} onCreated={projectCreated} onClose={() => setShowCreate(false)} registerDraft={registerDraft} /></DeferredPanel>}
    {pageError && <p className="form-error" role="alert">{messageText(pageError)}</p>}
    {projects.status === 'loading' && <section className="state-panel" role="status" aria-busy="true"><h2>{t('workspace:projectsLoading')}</h2></section>}
    {projects.status === 'error' && projects.error && <ErrorPanel error={projects.error} onRetry={retry} />}
    {!showCreate && projects.status === 'ready' && projects.data?.length === 0 && <section className="state-panel" role="status"><h2>{t('workspace:noProjects')}</h2><p>{t('workspace:noProjectsHelp')}</p></section>}
    {settingsProjectId && <div hidden={!settingsVisible} inert={!settingsVisible}><DeferredPanel key={settingsProjectId} label={t('workspace:projectSettings')}>
      <LiveSettingsWorkspace client={client} projectId={settingsProjectId} version={validVersion ? version : null}
        registry={settingsRegistry?.project.id === settingsProjectId ? settingsRegistry : null} newlyCreated={newProjectId === settingsProjectId}
        refreshTick={settingsRefreshTick} setupRefreshTick={setupRefreshTick} diagnosticsRevision={diagnosticsRevision}
        onSaved={settingsSaved} onAccessLost={retry} onVersionChange={schemaVersionChanged} registerDraft={registerDraft} />
    </DeferredPanel></div>}
    {versionLoading && <p role="status">{t('workspace:schemaLoading')}</p>}
    {versionError && <ErrorPanel error={versionError} onRetry={retry} />}
    {view !== 'settings' && !versionLoading && !versionError && !validVersion && <section className="state-panel" role="status"><WarningCircle size={32} /><h2>{t('workspace:schemaCheck')}</h2><p>{versionText.length === 0 ? t('workspace:schemaRequired') : t('workspace:schemaRange')}</p></section>}
    {view !== 'settings' && validVersion && currentMain?.status === 'loading' && <section className="state-panel" role="status" aria-busy="true"><h2>{t('workspace:apiLoading')}</h2><p>{t('workspace:apiLoadingHelp')}</p></section>}
    {view !== 'settings' && validVersion && currentMain?.status === 'error' && currentMain.error && <ErrorPanel error={currentMain.error} onRetry={retry} />}
    {view !== 'settings' && deniedRead && <ErrorPanel error={deniedRead} onRetry={retry} />}
    {view !== 'settings' && validVersion && data && registry && <>
      {compare && comparisonAvailable && comparisonError && <p className="notice" role="status">{messageText(comparisonError)} { t('workspace:comparisonUnavailable') }</p>}
      {compare && aggregateComparisonAvailable && !comparisonError && <>
        {(!currentComparison || currentComparison.status === 'loading') && <p className="context-note" role="status">{t('workspace:previousLoading')}</p>}
        {currentComparison?.status === 'error' && currentComparison.error && <section className="state-panel" role="alert"><h2>{t('workspace:previousFailed')}</h2><p>{describeError(currentComparison.error, t, messageText).detail} { t('workspace:currentAvailable') }</p><button className="secondary-button" type="button" onClick={() => setComparisonRetry(tick => tick + 1)}>{t('workspace:comparisonRetry')}</button></section>}
        {view === 'overview' && currentComparison?.status === 'ready' && currentComparison.data && <PeriodComparison current={data} previous={currentComparison.data} view={view} />}
      </>}
      {view === 'overview' && <OverviewWorkspace source={source} totalEvents={data.summary.totalEvents} rows={eventRows} primary={primary}
        startLabel={startLabel} successLabel={successLabel} onNavigate={onNavigate}
        previousTotal={compare && !comparisonError && currentComparison?.status === 'ready' ? currentComparison.data?.summary.totalEvents : undefined} />}
      {view === 'events' && <EventWorkspace rows={eventRows} filtered={filteredEvents} source={source} query={query} selectedEvent={selectedEvent} compare={compare}
        previous={compare && !comparisonError && currentComparison?.status === 'ready' ? currentComparison.data?.summary ?? null : null}
        onQuery={setQuery} onSource={next => { setSelectedSource(next); setSelectedEvent(null); setGrouping(null); }}
        onSelect={name => { setSelectedEvent(name); setGrouping(null); }}>
        {selectedEvent && <section className="event-detail">
          <div className="section-header"><h3>{t('workspace:dailyTrend')}</h3><button className="text-button" type="button" onClick={() => { setSelectedEvent(null); setGrouping(null); }}>{t('workspace:closeDetail')}</button></div>
          {analysisEvent && (!currentSeries || currentSeries.status === 'loading') && <p className="context-note" role="status">{t('workspace:dailyLoading')}</p>}
          {currentSeries?.status === 'error' && currentSeries.error && <ErrorPanel error={currentSeries.error} onRetry={retry} />}
          {seriesData && <Trend records={seriesRecords} event={seriesData.eventName} />}
          <div className="event-detail-tabs" role="group" aria-label={t('workspace:detailView')}>
            <button type="button" aria-pressed={detailTab === 'properties'} onClick={() => setDetailTab('properties')}>{t('workspace:properties')}</button>
            <button type="button" aria-pressed={detailTab === 'daily'} onClick={() => setDetailTab('daily')}>{t('workspace:dailyData')}</button>
          </div>
          {detailTab === 'daily' ? <div className="table-scroll" tabIndex={0} aria-label={t('workspace:selectedEventDaily')}><table className="event-table event-daily-table">
            <thead><tr><th scope="col">{t('workspace:date')}</th><th scope="col" className="number-cell">{t('workspace:count')}</th></tr></thead><tbody>{seriesData?.days.map(day => <tr key={day.date}><th scope="row">{day.date}</th><td className="number-cell">{formatCount(day.count)}</td></tr>)}</tbody>
          </table></div> : <>
          <label className="api-field property-grouping"><span>{t('workspace:groupBy')}</span><div className="project-select-wrap"><select className="text-input settings-select" aria-label={t('workspace:groupBy')} value={groupBy} disabled={!propertyNames.length}
            onChange={event => setGrouping(analysisRegistry && analysisEvent && event.target.value ? { context: eventContext(analysisRegistry, analysisEvent), property: event.target.value } : null)} aria-describedby="event-grouping-help">
            <option value="">{t('workspace:totalCount')}</option>{propertyNames.map(name => <option key={name} value={name}>{name}</option>)}</select><CaretDown size={16} aria-hidden="true" /></div></label>
          <p className="context-note" id="event-grouping-help">{!analysisEvent ? t('workspace:registeredOnly') : !propertyNames.length ? t('workspace:noProperties') : groupBy ? t('workspace:propertyValues', { property: groupBy, purpose: analysisEvent.properties[groupBy].purpose }) : t('workspace:groupHelp')}</p>
          {seriesData && <>
            {currentSeries?.analysis && <EventPropertyBreakdown key={`${seriesKey}`} analysis={currentSeries.analysis} propertyName={groupBy} />}
            {currentSeries?.analysis && compare && !comparisonError && <>
              {propertyComparison.state?.status === 'loading' && <p role="status">{t('workspace:previousPropertiesLoading')}</p>}
              {propertyComparison.state?.status === 'error' && <div role="alert"><p>{t('workspace:previousPropertiesFailed')}</p>
                <button className="secondary-button" type="button" onClick={propertyComparison.retry}>{t('workspace:propertiesRetry')}</button></div>}
              {propertyComparison.state?.status === 'ready' && propertyComparison.state.series && propertyComparison.state.analysis &&
                <EventPropertyComparison current={seriesData} previous={propertyComparison.state.series} analysis={propertyComparison.state.analysis} />}
            </>}
          </>}
          </>}
          <p className="event-inspector-meta context-note">{t('workspace:schemaMeta', { version: registry.schemaVersion, source: t(source === 'browser' ? 'admin:browserEvents' : 'admin:serverEvents'), status: t(registry.schemaStatus === 'retired' ? 'workspace:retired' : 'workspace:active') })}</p>
        </section>}
      </EventWorkspace>}
      {currentComparison?.data?.workflowErrors?.length ? <p role="alert">{t('workspace:partialWorkflows')} <button className="secondary-button" onClick={() => setComparisonRetry(tick => tick + 1)}>{t('workspace:comparisonRetry')}</button></p> : null}
      {view === 'goals' && <DeferredPanel key={activeProjectId} label={t('workspace:goals')}><LiveGoals client={client} registry={registry} workflows={data.workflows} workflowErrors={data.workflowErrors ?? []} onRecovered={load => setMain(previous => {
        if (previous.key !== mainKey || previous.status !== 'ready' || !previous.data) return previous;
        return { ...previous, data: { ...previous.data, ...recoverWorkflow(previous.data, previous.data.registry, load) } };
      })} range={data.range}
        periodComparison={currentComparison ?? undefined}
        previous={compare && !comparisonError ? previousRange(data.range) : null} compare={compare} comparisonError={comparisonError} context={mainKey} onState={workflowStateChanged} /></DeferredPanel>}

    </>}
    {view === 'overview' && projects.status === 'ready' && !!projects.data?.length && <DeferredPanel label={t('workspace:services')}><ProjectOverview client={client} projects={projects.data} source={source} onSelectProject={switchProject} activeProjectId={activeProject?.id} hasMore={!!nextCursor} onLoadMore={loadMore} loadingMore={more} /></DeferredPanel>}
  </>;
}
