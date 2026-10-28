import useSchemaVersion from './useSchemaVersion';
import useProjectPages from './useProjectPages';
import ProjectPicker from './ProjectPicker';
import { useMainAnalysis, usePeriodComparison, useEventSeries } from './useAnalysis';
import { lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BrowserLogin } from './auth/client';
import { CaretDown, Desktop, Database, PlugsConnected, WarningCircle } from '@phosphor-icons/react';
import EventWorkspace from './EventWorkspace';
import { createPortal } from 'react-dom';
import { Trend } from './Dashboard';
import DeferredPanel from './DeferredPanel';
import { sourceLabel } from './SourceEventTable';
import OverviewWorkspace from './OverviewWorkspace';
import DateRangePicker from './DateRangePicker';
import LiveIdentity from './LiveIdentity';
import { formatCount, type DailyRecord, type Period, type View } from './data';
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

function describeError(error: ApiError): { title: string; detail: string } {
  switch (error.kind) {
    case 'unauthorized':
      return { title: '인증이 필요해요', detail: '화면 위쪽의 관리자 로그인 버튼으로 다시 로그인해 주세요.' };
    case 'forbidden':
      return { title: '이 프로젝트를 볼 권한이 없어요', detail: '서버에서 이 프로젝트에 대한 관리자 grant를 확인해 주세요.' };
    case 'not_found':
      return { title: '프로젝트나 스키마 버전을 찾지 못했어요', detail: '프로젝트 ID와 스키마 버전을 확인해 주세요.' };
    case 'invalid_request':
      return { title: '요청 범위가 계약과 맞지 않아요', detail: '스키마 버전과 기간(최대 31일)을 확인해 주세요.' };
    case 'storage_unavailable':
      return { title: '저장소를 사용할 수 없어요', detail: '서버가 0으로 채운 응답을 주지 않아요. 잠시 후 다시 시도해 주세요.' };
    case 'contract':
      return { title: '응답이 계약과 맞지 않아요', detail: '값을 임의로 0으로 채우지 않고 그대로 멈췄어요. 응답을 확인해 주세요.' };
    case 'network':
      return { title: 'API 서버에 연결하지 못했어요', detail: `같은 출처 ${API_BASE_PATH} 경로가 열려 있는지 확인해 주세요.` };
    case 'timeout':
      return { title: '요청 대기 시간이 지났어요', detail: error.message };
    default:
      return { title: '요청이 실패했어요', detail: `HTTP ${error.status} 응답이에요.` };
  }
}

function ErrorPanel({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  const { title, detail } = describeError(error);
  return <section className="state-panel" role="alert"><WarningCircle size={32} /><h2>{title}</h2><p>{detail}</p><div className="state-actions"><button className="secondary-button" type="button" onClick={onRetry}>다시 시도</button></div>{error.requestId && <p className="context-note">requestId: {error.requestId}</p>}</section>;
}

export function LiveDashboard({ view, period, customPeriod, onActiveProjectChange, onNavigate, registerExitCheck, headerHost }: { view: View; period: Period; customPeriod: boolean; onActiveProjectChange: (info: ActiveProject | null) => void; onNavigate?: (view: View) => void; registerExitCheck?: (check: () => boolean) => () => void; headerHost?: HTMLElement | null }) {
  const currentOrigin = useMemo(() => window.location.origin, []);
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
    window.confirm('저장하지 않은 입력이나 확인하지 못한 저장 결과가 있어요. 초안을 버리고 계속할까요? 이미 서버에 저장된 값은 되돌리지 않아요.'), includeConnection),
  [client, projectId, draftExit]);
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
    return <>
    <DeferredPanel label="로그인"><OidcLogin onConnected={connected} /></DeferredPanel>
    <details className="manual-connection"><summary>관리자 토큰으로 직접 연결</summary><section className="settings-section">
      <h2>API 연결</h2>
      <p className="context-note">같은 출처의 관리자 API에 연결해요. 프로젝트 설정은 소유자만 저장할 수 있어요. 기본 엔드포인트는 현재 출처의 {API_BASE_PATH}예요. 다른 출처는 이번 범위가 아니라 연결하지 않아요.</p>
      <form className="settings-form" onSubmit={event => { event.preventDefault(); connect(); }}>
        <label className="field-label" htmlFor="api-endpoint">엔드포인트</label>
        <input id="api-endpoint" className="text-input" value={endpoint} placeholder={`${currentOrigin}${API_BASE_PATH}`} onChange={event => { setEndpoint(event.target.value); setEndpointError(null); }} />
        <label className="field-label" htmlFor="api-token">관리자 bearer 토큰</label>
        <input id="api-token" className="text-input" type="password" autoComplete="off" value={token} placeholder="토큰은 이 탭 메모리에만 보관" onChange={event => setToken(event.target.value)} />
        <p className="context-note">토큰은 메모리에만 두고 localStorage·sessionStorage·쿠키·쿼리·로그에 저장하지 않아요. 새로고침하면 사라져요.</p>
        {endpointError && <p className="form-error" role="alert">{endpointError}</p>}
        <div className="form-actions"><button className="primary-button" type="submit"><PlugsConnected size={22} weight="fill" />연결</button></div>
      </form>
    </section></details></>;
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
  const startLabel = startDefinition?.label ?? '시작 시도';
  const successLabel = successDefinition?.label ?? '성공 시도';
  const currentWorkflowDetails = view === 'goals' ? Object.values(workflowDetails).filter(detail => detail.context === mainKey && detail.groupBy) : [];
  const { input: exportInput, unavailable: exportUnavailable } = dashboardExport({ data, validVersion, view, source, query, compare,
    comparison: currentComparison, comparisonError, selectedEvent, analysisEvent, seriesData, groupBy,
    propertyComparison: propertyComparison.state, workflowDetails: currentWorkflowDetails });

  const connectionControls = <>
      <label className="api-field"><span>스키마 버전</span><input className="text-input" inputMode="numeric" pattern="[0-9]*" aria-label="스키마 버전" value={versionInput} onChange={event => { setVersionInput(event.target.value); setGrouping(null); }} /></label>
      <label className="comparison-toggle"><input type="checkbox" checked={automaticVersion} disabled={!projectId || versionLoading}
        onChange={event => { if (event.target.checked) selectAutomatic(); else setVersionInput(versionInput); setGrouping(null); }} />스키마 자동 선택</label>
      <button className="secondary-button" type="button" onClick={retry}>새로고침</button>
      <button className="primary-button" type="button" aria-expanded={showCreate} aria-controls="project-create-heading" disabled={showCreate} onClick={() => setShowCreate(true)}>프로젝트 추가</button>
      {session?.login?.passwordChangeUrl && <a className="secondary-button" href={session.login.passwordChangeUrl} target="_blank" rel="noopener noreferrer">비밀번호 변경<span className="sr-only"> (새 탭)</span></a>}
      <button className="secondary-button" type="button" onClick={disconnect}>연결 끊기</button>
      </>;

  const projectControls = <div className={`toolbar api-toolbar${compactWorkspace ? ' events-connection-bar' : ''}`}>
      <ProjectPicker compact={compactWorkspace} client={client} projects={projects.data ?? []} active={activeProject} enabled={projects.status === 'ready'} refreshTick={refreshTick}
        hasMore={!!nextCursor} loadingMore={more} onLoadMore={loadMore} onSelect={project => switchProject(project.id, project)} />
      {compactWorkspace ? <details className="events-advanced"><summary>연결 설정<CaretDown size={14} /></summary><div className="toolbar">{connectionControls}</div>{view !== 'settings' && <LiveIdentity client={client} />}</details> : connectionControls}
    </div>;
  return <>
    {unauthorizedClient === client && <>
      <p className="notice" role="alert">관리자 인증이 만료되었거나 유효하지 않아요. 다시 로그인해 주세요.</p>
      <DeferredPanel label="관리자 로그인"><OidcLogin onConnected={connected} onBeforeLogin={() => {
        if (!confirmDraftExit(true)) return false;
        client.destroy();
        return true;
      }} /></DeferredPanel>
    </>}
    {compactWorkspace && headerHost ? createPortal(projectControls, headerHost) : projectControls}
    {view !== 'settings' && customPeriod && currentRange && projectToday && <DateRangePicker
      key={JSON.stringify([dateScope, currentRange.from, currentRange.to])} range={currentRange} today={projectToday} timeZone={activeTimeZone!}
      onApply={range => setCustomRange({ scope: dateScope, range })} />}
    {view !== 'settings' && dateError && <p className="form-error" role="alert">{dateError}</p>}
    {!compactWorkspace && <><p className="context-note">API 연결 · {range ? rangeLabel(range.from, range.to) : '—'} · {activeTimeZone ?? '—'} · 토큰은 메모리에만</p><LiveIdentity client={client} /></>}

    <div className={view === 'overview' ? 'overview-toolbar events-actions' : analysisWorkspace ? 'events-actions' : undefined}>
    {view === 'overview' && <div className="event-source-switch" role="group" aria-label="발행 출처">{(['browser', 'server'] as const).map(value => <button type="button" key={value} aria-pressed={source === value} onClick={() => { setSelectedSource(value); setSelectedEvent(null); setGrouping(null); }}>{value === 'browser' ? <Desktop size={17} /> : <Database size={17} />}{value === 'browser' ? '브라우저 이벤트' : '서버 이벤트'}</button>)}</div>}
    {(analysisWorkspace || view === 'overview') && comparisonAvailable && <label className="comparison-toggle"><input type="checkbox" checked={compare} onChange={event => setCompare(event.target.checked)} />{view === 'goals' ? '작업 흐름·퍼널 기간 비교' : '직전 기간과 비교'}</label>}
    {view !== 'settings' && range?.to === projectToday && <p className="context-note">오늘은 집계 중이에요.{compare && ' 직전 같은 일수의 기간과 비교하므로 오늘의 남은 시간은 반영되지 않아요.'}</p>}
    {view !== 'settings' && (view !== 'goals' || !!data?.registry.workflows.length) && <CsvDownload compact={analysisWorkspace || view === 'overview'} key={JSON.stringify([mainKey, comparisonKey, compare, query, selectedEvent, groupBy, seriesKey, propertyComparison.state?.key, propertyComparison.state?.status, currentWorkflowDetails.map(detail => [detail.groupBy, detail.status, detail.comparisonStatus])])} input={exportInput} unavailable={exportUnavailable} buttonLabel={view === 'goals' ? '작업 흐름 CSV 내려받기' : undefined} />}
    </div>
    {showCreate && <DeferredPanel label="프로젝트 생성"><LiveProjectCreate client={client} onCreated={projectCreated} onClose={() => setShowCreate(false)} registerDraft={registerDraft} /></DeferredPanel>}
    {pageError && <p className="form-error" role="alert">{pageError}</p>}
    {projects.status === 'loading' && <section className="state-panel" role="status" aria-busy="true"><h2>프로젝트 목록을 확인하는 중이에요</h2></section>}
    {projects.status === 'error' && projects.error && <ErrorPanel error={projects.error} onRetry={retry} />}
    {!showCreate && projects.status === 'ready' && projects.data?.length === 0 && <section className="state-panel" role="status"><h2>접근 가능한 프로젝트가 없어요</h2><p>생성 권한이 있다면 프로젝트 추가로 시작할 수 있어요. 기존 프로젝트를 조회하려면 운영자에게 해당 프로젝트 권한을 확인해 주세요.</p></section>}
    {settingsProjectId && <div hidden={!settingsVisible} inert={!settingsVisible}><DeferredPanel key={settingsProjectId} label="프로젝트 설정">
      <LiveSettingsWorkspace client={client} projectId={settingsProjectId} version={validVersion ? version : null}
        registry={settingsRegistry?.project.id === settingsProjectId ? settingsRegistry : null} newlyCreated={newProjectId === settingsProjectId}
        refreshTick={settingsRefreshTick} setupRefreshTick={setupRefreshTick} diagnosticsRevision={diagnosticsRevision}
        onSaved={settingsSaved} onAccessLost={retry} onVersionChange={schemaVersionChanged} registerDraft={registerDraft} />
    </DeferredPanel></div>}
    {versionLoading && <p role="status">최신 활성 스키마를 확인하고 있어요.</p>}
    {versionError && <ErrorPanel error={versionError} onRetry={retry} />}
    {view !== 'settings' && !versionLoading && !versionError && !validVersion && <section className="state-panel" role="status"><WarningCircle size={32} /><h2>스키마 버전을 확인해 주세요</h2><p>{versionText.length === 0 ? '조회할 스키마 버전을 입력해 주세요.' : '1 이상 2147483647 이하의 정수만 조회해요. 앞뒤 문자는 허용하지 않아요.'}</p></section>}
    {view !== 'settings' && validVersion && currentMain?.status === 'loading' && <section className="state-panel" role="status" aria-busy="true"><h2>API에서 조회하는 중이에요</h2><p>등록 정의와 집계를 서버에서 직접 가져와요.</p></section>}
    {view !== 'settings' && validVersion && currentMain?.status === 'error' && currentMain.error && <ErrorPanel error={currentMain.error} onRetry={retry} />}
    {view !== 'settings' && deniedRead && <ErrorPanel error={deniedRead} onRetry={retry} />}
    {view !== 'settings' && validVersion && data && registry && <>
      {compare && comparisonAvailable && comparisonError && <p className="notice" role="status">{comparisonError} 비교를 끄면 현재 기간 CSV도 내려받을 수 있어요.</p>}
      {compare && aggregateComparisonAvailable && !comparisonError && <>
        {(!currentComparison || currentComparison.status === 'loading') && <p className="context-note" role="status">직전 기간을 조회하는 중이에요.</p>}
        {currentComparison?.status === 'error' && currentComparison.error && <section className="state-panel" role="alert"><h2>직전 기간 비교를 불러오지 못했어요</h2><p>{describeError(currentComparison.error).detail} 현재 기간 결과는 아래에서 확인할 수 있어요.</p><button className="secondary-button" type="button" onClick={() => setComparisonRetry(tick => tick + 1)}>비교 다시 시도</button></section>}
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
          <div className="section-header"><h3>일별 발생 추이</h3><button className="text-button" type="button" onClick={() => { setSelectedEvent(null); setGrouping(null); }}>상세 닫기</button></div>
          {analysisEvent && (!currentSeries || currentSeries.status === 'loading') && <p className="context-note" role="status">일별 시계열을 조회하는 중이에요.</p>}
          {currentSeries?.status === 'error' && currentSeries.error && <ErrorPanel error={currentSeries.error} onRetry={retry} />}
          {seriesData && <Trend records={seriesRecords} event={seriesData.eventName} />}
          <div className="event-detail-tabs" role="group" aria-label="상세 보기">
            <button type="button" aria-pressed={detailTab === 'properties'} onClick={() => setDetailTab('properties')}>속성별 분석</button>
            <button type="button" aria-pressed={detailTab === 'daily'} onClick={() => setDetailTab('daily')}>일별 데이터</button>
          </div>
          {detailTab === 'daily' ? <div className="table-scroll" tabIndex={0} aria-label="선택 이벤트 일별 데이터"><table className="event-table event-daily-table">
            <thead><tr><th scope="col">날짜</th><th scope="col" className="number-cell">건수</th></tr></thead><tbody>{seriesData?.days.map(day => <tr key={day.date}><th scope="row">{day.date}</th><td className="number-cell">{formatCount(day.count)}</td></tr>)}</tbody>
          </table></div> : <>
          <label className="api-field property-grouping"><span>분류 기준</span><div className="project-select-wrap"><select className="text-input settings-select" aria-label="분류 기준" value={groupBy} disabled={!propertyNames.length}
            onChange={event => setGrouping(analysisRegistry && analysisEvent && event.target.value ? { context: eventContext(analysisRegistry, analysisEvent), property: event.target.value } : null)} aria-describedby="event-grouping-help">
            <option value="">전체 건수</option>{propertyNames.map(name => <option key={name} value={name}>{name}</option>)}</select><CaretDown size={16} aria-hidden="true" /></div></label>
          <p className="context-note" id="event-grouping-help">{!analysisEvent ? '이 스키마에 등록된 선택 출처의 이벤트만 분석할 수 있어요.' : !propertyNames.length ? '등록된 속성이 없어 일별 전체 건수만 보여줘요.' : groupBy ? `${groupBy} 값별로 나눠 봐요. ${analysisEvent.properties[groupBy].purpose}` : '분류 기준을 고르면 속성 값별 건수·비중·추이를 볼 수 있어요.'}</p>
          {seriesData && <>
            {currentSeries?.analysis && <EventPropertyBreakdown key={`${seriesKey}`} analysis={currentSeries.analysis} propertyName={groupBy} />}
            {currentSeries?.analysis && compare && !comparisonError && <>
              {propertyComparison.state?.status === 'loading' && <p role="status">직전 기간 이벤트 속성을 조회하는 중이에요.</p>}
              {propertyComparison.state?.status === 'error' && <div role="alert"><p>직전 기간 이벤트 속성을 불러오지 못했어요. 현재 기간 결과는 유지돼요.</p>
                <button className="secondary-button" type="button" onClick={propertyComparison.retry}>이벤트 속성별 비교 다시 시도</button></div>}
              {propertyComparison.state?.status === 'ready' && propertyComparison.state.series && propertyComparison.state.analysis &&
                <EventPropertyComparison current={seriesData} previous={propertyComparison.state.series} analysis={propertyComparison.state.analysis} />}
            </>}
          </>}
          </>}
          <p className="event-inspector-meta context-note">스키마 v{registry.schemaVersion} · {sourceLabel(source)} · {registry.schemaStatus === 'retired' ? '사용 중지(retired)' : '운영 중(active)'}</p>
        </section>}
      </EventWorkspace>}
      {currentComparison?.data?.workflowErrors?.length ? <p role="alert">직전 기간의 일부 작업 흐름을 불러오지 못했어요. 확인할 수 없는 비교 값은 비워 두며 전체 CSV는 잠겨 있어요. <button className="secondary-button" onClick={() => setComparisonRetry(tick => tick + 1)}>비교 다시 시도</button></p> : null}
      {view === 'goals' && <DeferredPanel key={activeProjectId} label="목표"><LiveGoals client={client} registry={registry} workflows={data.workflows} workflowErrors={data.workflowErrors ?? []} onRecovered={load => setMain(previous => {
        if (previous.key !== mainKey || previous.status !== 'ready' || !previous.data) return previous;
        return { ...previous, data: { ...previous.data, ...recoverWorkflow(previous.data, previous.data.registry, load) } };
      })} range={data.range}
        periodComparison={currentComparison ?? undefined}
        previous={compare && !comparisonError ? previousRange(data.range) : null} compare={compare} comparisonError={comparisonError} context={mainKey} onState={workflowStateChanged} /></DeferredPanel>}

    </>}
    {view === 'overview' && projects.status === 'ready' && !!projects.data?.length && <DeferredPanel label="서비스 통합 현황"><ProjectOverview client={client} projects={projects.data} source={source} onSelectProject={switchProject} activeProjectId={activeProject?.id} hasMore={!!nextCursor} onLoadMore={loadMore} loadingMore={more} /></DeferredPanel>}
  </>;
}
