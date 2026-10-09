import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BrowserLogin } from './auth/client';
import { ArrowRight, CaretDown, ChartBar, Circle, MagnifyingGlass, PlugsConnected, WarningCircle } from '@phosphor-icons/react';
import { Trend } from './Dashboard';
import LiveSettings from './LiveSettings';
import LiveSchemas from './LiveSchemas';
import LiveProjectCreate from './LiveProjectCreate';
import LiveSdkSetup from './LiveSdkSetup';
import { formatCount, formatRate, type DailyRecord, type Period, type View } from './data';
import { API_BASE_PATH, ApiClient, ApiError, DEFAULT_PAGE_LIMIT, resolveApiEndpoint } from './api/client';
import { missingBrowserEvents } from './api/coverage';
import EventPropertyBreakdown from './EventPropertyBreakdown';
import { analyzeEventSeries, eventContext, eventPropertyNames, selectedGrouping } from './api/event-analysis';
import type { EventGrouping, PropertyAnalysis } from './api/event-analysis';
import { appendPage, shouldApplyPage } from './api/pagination';
import { periodRange, rangeLabel, todayInZone } from './api/dates';
import type { EventDefinition, EventSeriesResponse, Project, ProjectSettings, Registry, SummaryResponse, WorkflowDefinition, WorkflowResponse } from './api/types';

type Load<T> = { status: 'idle' | 'loading' | 'ready' | 'error'; data?: T; error?: ApiError };
type WorkflowLoad = { definition: WorkflowDefinition; response: WorkflowResponse };
type MainData = { registry: Registry; summary: SummaryResponse; workflows: WorkflowLoad[]; range: { from: string; to: string } };
type EventRow = { definition: EventDefinition; source: 'browser' | 'server' | null; count: number | null };
type ActiveProject = { name: string; timeZone: string };
type Session = { basePath: string; token?: string; login?: BrowserLogin };
const OidcLogin = lazy(() => import('./auth/OidcLogin'));

const MAX_SCHEMA_VERSION = 2147483647;

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof Error) return new ApiError('contract', error.message);
  return new ApiError('network', '알 수 없는 오류가 발생했어요.');
}

function describeError(error: ApiError): { title: string; detail: string } {
  switch (error.kind) {
    case 'unauthorized':
      return { title: '인증이 필요해요', detail: '연결을 끊고 다시 로그인해 주세요. 관리자 토큰으로 직접 연결할 수도 있어요.' };
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
    default:
      return { title: '요청이 실패했어요', detail: `HTTP ${error.status} 응답이에요.` };
  }
}

function ErrorPanel({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  const { title, detail } = describeError(error);
  return <section className="state-panel" role="alert"><WarningCircle size={32} /><h2>{title}</h2><p>{detail}</p><div className="state-actions"><button className="secondary-button" type="button" onClick={onRetry}>다시 시도</button></div>{error.requestId && <p className="context-note">requestId: {error.requestId}</p>}</section>;
}

function workflowRecords(load: WorkflowLoad): DailyRecord[] {
  const { definition, response } = load;
  return response.days.map(day => ({
    date: day.date,
    events: {
      [definition.startEvent]: day.startedAttempts,
      [definition.successEvent]: day.succeededAttempts,
    },
  }));
}

export function LiveDashboard({ view, period, onActiveProjectChange, onNavigate }: { view: View; period: Period; onActiveProjectChange: (info: ActiveProject | null) => void; onNavigate?: (view: View) => void }) {
  const currentOrigin = useMemo(() => window.location.origin, []);
  const [session, setSession] = useState<Session | null>(null);
  const [token, setToken] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [endpointError, setEndpointError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [versionInput, setVersionInput] = useState('1');
  const [grouping, setGrouping] = useState<EventGrouping>(null);
  const [query, setQuery] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [settingsRefreshTick, setSettingsRefreshTick] = useState(0);
  const [settingsRegistry, setSettingsRegistry] = useState<Registry | null>(null);
  const [more, setMore] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newProjectId, setNewProjectId] = useState<string | null>(null);
  const [setupRefreshTick, setSetupRefreshTick] = useState(0);
  const [projects, setProjects] = useState<Load<Project[]>>({ status: 'idle' });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [main, setMain] = useState<Load<MainData>>({ status: 'idle' });
  const [series, setSeries] = useState<Load<EventSeriesResponse> & { key?: string; analysis?: PropertyAnalysis | null }>({ status: 'idle' });

  const client = useMemo(() => (session ? new ApiClient({ basePath: session.basePath,
    ...(session.login ? { getBearer: () => session.login!.getAccessToken(), onDestroy: () => session.login!.destroy() } : { token: session.token ?? '' }),
  }) : null), [session]);
  const sessionRef = useRef(0);
  const clientRef = useRef<ApiClient | null>(null);
  const moreControllerRef = useRef<AbortController | null>(null);
  const projectsControllerRef = useRef<AbortController | null>(null);
  clientRef.current = client;

  const versionText = versionInput.trim();
  const version = /^[0-9]+$/.test(versionText) ? Number(versionText) : Number.NaN;
  const validVersion = Number.isInteger(version) && version >= 1 && version <= MAX_SCHEMA_VERSION;
  const activeProject = projects.data?.find(item => item.id === projectId) ?? null;
  const activeProjectId = activeProject?.id ?? null;
  const activeTimeZone = activeProject?.timeZone ?? null;
  const currentRange = activeTimeZone ? periodRange(todayInZone(activeTimeZone), period) : null;
  const analysisRegistry = main.status === 'ready' && main.data?.registry.project.id === activeProjectId &&
    main.data.registry.schemaVersion === version && main.data.range.from === currentRange?.from && main.data.range.to === currentRange?.to
    ? main.data.registry : null;
  const analysisEvent = analysisRegistry?.events.find(event => event.name === selectedEvent && event.source === 'browser') ?? null;
  const groupBy = analysisRegistry && analysisEvent ? selectedGrouping(analysisRegistry, analysisEvent, grouping) : '';
  const propertyNames = eventPropertyNames(analysisEvent);
  const seriesKey = analysisRegistry && analysisEvent && currentRange
    ? JSON.stringify([eventContext(analysisRegistry, analysisEvent), groupBy, currentRange.from, currentRange.to, refreshTick]) : null;
  const retry = useCallback(() => {
    if (view === 'settings') setSettingsRefreshTick(tick => tick + 1);
    else setRefreshTick(tick => tick + 1);
  }, [view]);
  const settingsSaved = useCallback((settings: ProjectSettings) => {
    setProjects(previous => previous.data ? { ...previous, data: previous.data.map(project => project.id === settings.project.id ? settings.project : project) } : previous);
  }, []);
  const projectCreated = useCallback((settings: ProjectSettings) => {
    sessionRef.current += 1;
    projectsControllerRef.current?.abort(); moreControllerRef.current?.abort(); setMore(false);
    setProjects(previous => ({ status: 'ready', data: [...(previous.data ?? []).filter(p => p.id !== settings.project.id), settings.project].sort((a, b) => a.id.localeCompare(b.id)) }));
    setProjectId(settings.project.id); setVersionInput('1'); setSelectedEvent(null); setGrouping(null); setMain({ status: 'idle' }); setSeries({ status: 'idle' });
    setNewProjectId(settings.project.id); setShowCreate(false); setPageError(null);
    onNavigate?.('settings');
  }, [onNavigate]);
  const schemaVersionChanged = useCallback((version: number) => { setVersionInput(String(version)); setSetupRefreshTick(tick => tick + 1); }, []);
  const connected = useCallback((login: BrowserLogin) => {
    sessionRef.current += 1;
    setToken(''); setProjectId(null); setSelectedEvent(null); setGrouping(null); setProjects({ status: 'idle' });
    setMain({ status: 'idle' }); setSeries({ status: 'idle' });
    setSession({ login, basePath: API_BASE_PATH });
    setShowCreate(false); setNewProjectId(null);
  }, []);

  function connect() {
    const resolved = resolveApiEndpoint(endpoint, currentOrigin);
    if ('error' in resolved) { setEndpointError(resolved.error); return; }
    sessionRef.current += 1;
    setEndpointError(null);
    setProjects({ status: 'idle' });
    setNextCursor(null);
    setMain({ status: 'idle' });
    setSeries({ status: 'idle' });
    setProjectId(null);
    setSelectedEvent(null);
    setGrouping(null);
    setSession({ token, basePath: resolved.basePath });
    setShowCreate(false); setNewProjectId(null);
    setToken('');
  }
  function disconnect() {
    sessionRef.current += 1;
    moreControllerRef.current?.abort();
    moreControllerRef.current = null;
    setMore(false);
    client?.destroy();
    setSession(null);
    setToken('');
    setProjects({ status: 'idle' });
    setNextCursor(null);
    setMain({ status: 'idle' });
    setSeries({ status: 'idle' });
    setProjectId(null);
    setSelectedEvent(null);
    setGrouping(null);
    setQuery('');
    setPageError(null);
    setEndpointError(null);
    setRefreshTick(0);
    setShowCreate(false); setNewProjectId(null); setSetupRefreshTick(0);
  }

  useEffect(() => () => { clientRef.current?.destroy(); }, []);

  useEffect(() => {
    if (!client) return;
    const controller = new AbortController();
    setProjects({ status: 'loading' });
    projectsControllerRef.current = controller;
    setPageError(null);
    client.listProjects({ limit: DEFAULT_PAGE_LIMIT, signal: controller.signal })
      .then(page => {
        if (controller.signal.aborted) return;
        setProjects({ status: 'ready', data: page.data });
        setNextCursor(page.page.nextCursor);
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        setProjects({ status: 'error', error: toApiError(error) });
      });
    return () => controller.abort();
  }, [client, refreshTick]);

  useEffect(() => {
    if (projects.status !== 'ready' || !projects.data) return;
    if (projectId && projects.data.some(item => item.id === projectId)) return;
    setProjectId(projects.data[0]?.id ?? null);
  }, [projects, projectId]);

  useEffect(() => {
    onActiveProjectChange(activeProject ? { name: activeProject.name, timeZone: activeProject.timeZone } : null);
  }, [activeProject, onActiveProjectChange]);

  useEffect(() => {
    if (view === 'settings' || !client || !activeProjectId || !activeTimeZone || !validVersion) { setMain({ status: 'idle' }); return; }
    const controller = new AbortController();
    setMain({ status: 'loading' });
    const range = periodRange(todayInZone(activeTimeZone), period);
    (async () => {
      try {
        const registry = await client.getSchema(activeProjectId, version, { signal: controller.signal });
        const summary = await client.getSummary(activeProjectId, { schemaVersion: version, from: range.from, to: range.to, signal: controller.signal });
        const missing = missingBrowserEvents(registry, summary);
        if (missing.length > 0) {
          throw new ApiError('contract', `집계 응답에 등록된 브라우저 이벤트가 빠져 있어요: ${missing.join(', ')}`);
        }
        const workflows = await Promise.all(registry.workflows.map(async definition => ({
          definition,
          response: await client.getWorkflowDaily(activeProjectId, definition.id, { schemaVersion: version, from: range.from, to: range.to, signal: controller.signal }),
        })));
        if (controller.signal.aborted) return;
        setMain({ status: 'ready', data: { registry, summary, workflows, range } });
      } catch (error) {
        if (controller.signal.aborted) return;
        setMain({ status: 'error', error: toApiError(error) });
      }
    })();
    return () => controller.abort();
  }, [client, activeProjectId, activeTimeZone, version, validVersion, period, refreshTick, view]);

  useEffect(() => {
    if (view !== 'events' || !client || !analysisEvent || !analysisRegistry || !currentRange || !seriesKey) { setSeries({ status: 'idle' }); return; }
    const controller = new AbortController();
    setSeries({ status: 'loading', key: seriesKey });
    client.getEventDaily(analysisRegistry.project.id, analysisEvent.name, { schemaVersion: version, from: currentRange.from, to: currentRange.to, groupBy: groupBy || undefined, signal: controller.signal })
      .then(next => {
        if (controller.signal.aborted) return;
        const analysis = analyzeEventSeries(next, analysisEvent);
        setSeries({ status: 'ready', key: seriesKey, data: next, analysis });
      })
      .catch(error => { if (!controller.signal.aborted) setSeries({ status: 'error', key: seriesKey, error: toApiError(error) }); });
    return () => controller.abort();
  }, [client, analysisRegistry, analysisEvent, currentRange?.from, currentRange?.to, seriesKey, groupBy, version, view]);

  useEffect(() => {
    setSettingsRegistry(null);
    if (view !== 'settings' || !client || !activeProjectId || !validVersion) return;
    const controller = new AbortController();
    client.getSchema(activeProjectId, version, { signal: controller.signal })
      .then(schema => { if (!controller.signal.aborted) setSettingsRegistry(schema); })
      .catch(() => { /* Settings remain independent of optional schema definitions. */ });
    return () => controller.abort();
  }, [view, client, activeProjectId, version, validVersion, settingsRefreshTick]);

  async function loadMore() {
    if (!client || !nextCursor || more) return;
    const generation = sessionRef.current;
    const controller = new AbortController();
    moreControllerRef.current?.abort();
    moreControllerRef.current = controller;
    setMore(true);
    setPageError(null);
    try {
      const page = await client.listProjects({ limit: DEFAULT_PAGE_LIMIT, cursor: nextCursor, signal: controller.signal });
      if (!shouldApplyPage({ generation, current: sessionRef.current, aborted: controller.signal.aborted })) return;
      setProjects(previous => previous.status === 'ready' && previous.data
        ? { status: 'ready', data: appendPage(previous.data, page).items }
        : { status: 'ready', data: page.data });
      setNextCursor(page.page.nextCursor);
    } catch (error) {
      if (generation !== sessionRef.current || controller.signal.aborted) return;
      setPageError(toApiError(error).message);
    } finally {
      if (moreControllerRef.current === controller) moreControllerRef.current = null;
      if (generation === sessionRef.current) setMore(false);
    }
  }

  if (!client) {
    return <>
    <Suspense fallback={<p className="context-note" role="status">로그인 화면을 준비하고 있어요.</p>}><OidcLogin onConnected={connected} /></Suspense>
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

  const data = main.status === 'ready' ? main.data ?? null : null;
  const range = data?.range ?? null;
  const registry = data?.registry ?? null;
  const primary = data?.workflows[0] ?? null;
  const startDefinition = data && primary ? data.registry.events.find(item => item.name === primary.definition.startEvent) ?? null : null;
  const successDefinition = data && primary ? data.registry.events.find(item => item.name === primary.definition.successEvent) ?? null : null;
  const summaryCounts = new Map((data?.summary.events ?? []).map(item => [item.name, item.count]));
  const registeredEvents: EventRow[] = registry ? registry.events.map(definition => ({
    definition,
    source: definition.source,
    count: definition.source === 'browser' ? summaryCounts.get(definition.name) ?? null : null,
  })) : [];
  const unknownEvents: EventRow[] = data && registry
    ? data.summary.events.filter(item => !registry.events.some(definition => definition.name === item.name))
      .map(item => ({ definition: { name: item.name, label: '등록에 없음', source: 'browser', properties: {} }, source: null, count: item.count }))
    : [];
  const eventRows = [...registeredEvents, ...unknownEvents];
  const browserCount = registeredEvents.filter(row => row.definition.source === 'browser').length;
  const serverCount = registeredEvents.filter(row => row.definition.source === 'server').length;
  const filteredEvents = eventRows.filter(item => `${item.definition.name} ${item.definition.label}`.toLowerCase().includes(query.trim().toLowerCase()));
  const currentSeries = seriesKey && series.key === seriesKey ? series : null;
  const seriesData = currentSeries?.status === 'ready' ? currentSeries.data ?? null : null;
  const seriesRecords: DailyRecord[] = seriesData ? seriesData.days.map(day => ({ date: day.date, events: { [seriesData.eventName]: day.count } })) : [];
  const startLabel = startDefinition?.label ?? '시작 시도';
  const successLabel = successDefinition?.label ?? '성공 시도';

  function countCell(row: EventRow) {
    if (row.count !== null) return formatCount(row.count);
    return row.definition.source === 'server' ? '수집 미지원' : '—';
  }

  return <>
    <div className="toolbar api-toolbar">
      <label className="api-field"><span>프로젝트</span><div className="project-select-wrap"><select aria-label="프로젝트 선택" value={projectId ?? ''} onChange={event => { setProjectId(event.target.value || null); setSelectedEvent(null); setGrouping(null); }} disabled={projects.status !== 'ready' || !projects.data?.length}>{(projects.data ?? []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><CaretDown size={16} /></div></label>
      <label className="api-field"><span>스키마 버전</span><input className="text-input" inputMode="numeric" pattern="[0-9]*" aria-label="스키마 버전" value={versionInput} onChange={event => { setVersionInput(event.target.value); setGrouping(null); }} /></label>
      <button className="secondary-button" type="button" onClick={retry}>새로고침</button>
      <button className="primary-button" type="button" aria-expanded={showCreate} aria-controls="project-create-heading" disabled={showCreate} onClick={() => setShowCreate(true)}>프로젝트 추가</button>
      {nextCursor && <button className="secondary-button" type="button" onClick={loadMore} disabled={more}>{more ? '불러오는 중…' : '프로젝트 더 불러오기'}</button>}
      <button className="secondary-button" type="button" onClick={disconnect}>연결 끊기</button>
    </div>
    <p className="context-note">API 연결 · {range ? rangeLabel(range.from, range.to) : '—'} · {activeTimeZone ?? '—'} · 토큰은 메모리에만</p>
    {showCreate && <LiveProjectCreate client={client} onCreated={projectCreated} onClose={() => setShowCreate(false)} />}
    {pageError && <p className="form-error" role="alert">{pageError}</p>}
    {projects.status === 'error' && projects.error && <ErrorPanel error={projects.error} onRetry={retry} />}
    {!showCreate && projects.status === 'ready' && projects.data?.length === 0 && <section className="state-panel" role="status"><h2>접근 가능한 프로젝트가 없어요</h2><p>생성 권한이 있다면 프로젝트 추가로 시작할 수 있어요. 기존 프로젝트를 조회하려면 운영자에게 해당 프로젝트 권한을 확인해 주세요.</p></section>}
    {view === 'settings' && activeProjectId && <>
      {newProjectId === activeProjectId && <section className="project-onboarding" aria-label="새 프로젝트 연결" role="status">
        <h2>프로젝트 생성을 확인했어요</h2><ol className="setup-steps"><li>1 프로젝트 완료</li><li aria-current={settingsRegistry ? undefined : 'step'}>2 이벤트 스키마</li><li aria-current={settingsRegistry ? 'step' : undefined}>3 SDK 연결</li></ol>
        <p>먼저 이벤트 스키마를 검증·발행한 뒤 SDK를 연결하세요.</p><a href="#schema-heading">이벤트 스키마로 이동</a> · <a href="#sdk-setup">SDK 연결 안내</a>
      </section>}
      <LiveSettings key={activeProjectId} client={client} projectId={activeProjectId} onSaved={settingsSaved} refreshTick={settingsRefreshTick} registry={settingsRegistry?.project.id === activeProjectId ? settingsRegistry : null} />
      <LiveSchemas key={`schemas-${activeProjectId}`} client={client} projectId={activeProjectId} refreshTick={settingsRefreshTick} onVersionChange={schemaVersionChanged} />
      <LiveSdkSetup key={`setup-${activeProjectId}`} client={client} projectId={activeProjectId} refreshTick={setupRefreshTick + settingsRefreshTick} />
    </>}
    {view !== 'settings' && !validVersion && <section className="state-panel" role="status"><WarningCircle size={32} /><h2>스키마 버전을 확인해 주세요</h2><p>{versionText.length === 0 ? '조회할 스키마 버전을 입력해 주세요.' : '1 이상 2147483647 이하의 정수만 조회해요. 앞뒤 문자는 허용하지 않아요.'}</p></section>}
    {view !== 'settings' && validVersion && main.status === 'loading' && <section className="state-panel" role="status" aria-busy="true"><h2>API에서 조회하는 중이에요</h2><p>등록 정의와 집계를 서버에서 직접 가져와요.</p></section>}
    {view !== 'settings' && validVersion && main.status === 'error' && main.error && <ErrorPanel error={main.error} onRetry={retry} />}
    {view !== 'settings' && validVersion && data && registry && <>
      {view === 'overview' && <>
        <section className="metric-grid" aria-label="주요 지표">
          {([
            ['수집 이벤트', formatCount(data.summary.totalEvents)],
            [startLabel, primary ? formatCount(primary.response.summary.startedAttempts) : '—'],
            [successLabel, primary ? formatCount(primary.response.summary.succeededAttempts) : '—'],
            ['완료율', primary ? formatRate(primary.response.summary.completionRate) : '—'],
          ] as const).map(([label, value], index) => <div className="metric" key={label}><div className="metric-label">{label}</div><div className="metric-value">{value}</div>{index === 3 && primary && <div className="metric-detail">{formatCount(primary.response.summary.succeededAttempts)} / {formatCount(primary.response.summary.startedAttempts)}</div>}</div>)}
        </section>
        {data.summary.totalEvents === 0 && <p className="notice" role="status">선택한 기간에 수신된 이벤트가 없어요. 완료율을 계산할 수 없어요.</p>}
        {primary ? <section className="trend-section"><div className="section-header"><h2>{primary.definition.label} 일별 시작 시도</h2>{onNavigate && <button type="button" className="primary-button" onClick={() => onNavigate('events')}><ChartBar size={22} weight="fill" />이벤트 분석으로 이동</button>}</div><div className="legend"><Circle size={12} weight="fill" color="#155EEF" />시작 시도</div><Trend records={workflowRecords(primary)} event={primary.definition.startEvent} /></section>
          : <section className="table-section"><h2>작업 흐름 없음</h2><p className="context-note">등록된 작업 흐름이 없어 완료율을 계산할 수 없어요.</p></section>}
        <section className="table-section"><h2>등록 이벤트 집계</h2><p className="context-note">브라우저 이벤트 {browserCount}개 · 서버 이벤트 {serverCount}개. 서버 이벤트는 이 계약에 집계 경로가 없어 값을 표시하지 않아요.</p><div className="table-scroll" tabIndex={0} aria-label="등록 이벤트 집계"><table className="event-table"><caption className="sr-only">등록된 이벤트별 수신 건수(관찰된 값)</caption><thead><tr><th scope="col">이벤트</th><th scope="col">발행 출처</th><th scope="col" className="number-cell">건수</th></tr></thead><tbody>{eventRows.map(row => <tr key={row.definition.name}><th scope="row" className="event-name">{row.definition.name}<div className="event-label">{row.definition.label}</div></th><td>{row.source ?? '—'}</td><td className="number-cell">{countCell(row)}</td></tr>)}</tbody></table></div></section>
      </>}
      {view === 'events' && <>
        <div className="toolbar">
          <label className="search-control"><MagnifyingGlass size={20} /><span className="sr-only">이벤트 검색</span><input type="search" placeholder="이벤트 이름 검색" value={query} onChange={event => setQuery(event.target.value)} /></label>
          <span className="context-note">이벤트를 선택하면 등록된 속성별로 나눠 볼 수 있어요.</span>
          <span className="context-note">스키마 v{registry.schemaVersion} · 브라우저 {browserCount}개 · {registry.schemaStatus === 'retired' ? '사용 중지(retired)' : '운영 중(active)'}</span>
        </div>
        <div className="table-scroll" tabIndex={0} aria-label="등록 이벤트 표"><table className="event-table"><caption className="sr-only">선택 기간의 등록 이벤트 수신 건수</caption><thead><tr><th scope="col">이벤트</th><th scope="col">발행 출처</th><th scope="col" className="number-cell">건수</th></tr></thead><tbody>{filteredEvents.map(row => <tr key={row.definition.name}><th scope="row">{row.definition.source === 'browser' ? <button className="text-button event-name" type="button" aria-pressed={selectedEvent === row.definition.name} onClick={() => { setSelectedEvent(row.definition.name); setGrouping(null); }}>{row.definition.name}<ArrowRight size={16} /></button> : <span className="event-name">{row.definition.name}</span>}<div className="event-label">{row.definition.label}</div></th><td>{row.source ?? '—'}</td><td className="number-cell">{countCell(row)}</td></tr>)}</tbody><tfoot><tr><th scope="row" colSpan={2}>표시된 브라우저 이벤트 합계</th><td className="number-cell">{formatCount(filteredEvents.reduce((total, row) => total + (row.count ?? 0), 0))}</td></tr></tfoot></table></div>
        {filteredEvents.length === 0 && <div className="state-panel" role="status"><h2>검색 결과가 없어요</h2><button className="secondary-button" type="button" onClick={() => setQuery('')}>검색 초기화</button></div>}
        {selectedEvent && <section className="event-detail">
          <div className="section-header"><h2>{selectedEvent} 일별 건수</h2><button className="text-button" type="button" onClick={() => { setSelectedEvent(null); setGrouping(null); }}>상세 닫기</button></div>
          <label className="api-field property-grouping"><span>분류 기준</span><div className="project-select-wrap"><select className="text-input settings-select" aria-label="분류 기준" value={groupBy} disabled={!propertyNames.length}
            onChange={event => setGrouping(analysisRegistry && analysisEvent && event.target.value ? { context: eventContext(analysisRegistry, analysisEvent), property: event.target.value } : null)} aria-describedby="event-grouping-help">
            <option value="">전체 건수</option>{propertyNames.map(name => <option key={name} value={name}>{name}</option>)}</select><CaretDown size={16} aria-hidden="true" /></div></label>
          <p className="context-note" id="event-grouping-help">{!analysisEvent ? '이 스키마에 등록된 브라우저 이벤트만 분석할 수 있어요.' : !propertyNames.length ? '등록된 속성이 없어 일별 전체 건수만 보여줘요.' : groupBy ? `${groupBy} 값별로 나눠 봐요. ${analysisEvent.properties[groupBy].purpose}` : '분류 기준을 고르면 속성 값별 건수·비중·추이를 볼 수 있어요.'}</p>
          {analysisEvent && (!currentSeries || currentSeries.status === 'loading') && <p className="context-note" role="status">일별 시계열을 조회하는 중이에요.</p>}
          {currentSeries?.status === 'error' && currentSeries.error && <ErrorPanel error={currentSeries.error} onRetry={retry} />}
          {seriesData && <><Trend records={seriesRecords} event={seriesData.eventName} />
            {currentSeries?.analysis && <EventPropertyBreakdown key={`${seriesKey}`} analysis={currentSeries.analysis} propertyName={groupBy} />}
          </>}
        </section>}
      </>}
      {view === 'goals' && (data.workflows.length === 0
        ? <section className="state-panel" role="status"><h2>등록된 작업 흐름이 없어요</h2><p>이 스키마에는 완료율을 계산할 작업 흐름 정의가 없어요.</p></section>
        : data.workflows.map(load => <section className="goal-section" key={load.definition.id}>
          <div className="goal-header"><div><h2>{load.definition.label}</h2><p className="context-note">시작일 기준 코호트({load.response.cohortBasis}) · 정의 v{registry.schemaVersion}</p></div><div className="goal-ratio"><strong>{formatRate(load.response.summary.completionRate)}</strong><span>{formatCount(load.response.summary.succeededAttempts)} / {formatCount(load.response.summary.startedAttempts)}</span></div></div>
          {load.response.summary.completionRate !== null && <progress className="goal-track" max={100} value={load.response.summary.completionRate} aria-label={`${load.definition.label} 완료율`} />}
          <dl className="definition-list">
            <div><dt>시작</dt><dd>{load.definition.startEvent}<span>{formatCount(load.response.summary.startedAttempts)}건</span></dd></div>
            <div><dt>성공</dt><dd>{load.definition.successEvent}<span>{formatCount(load.response.summary.succeededAttempts)}건</span></dd></div>
            <div><dt>실패</dt><dd>{load.definition.failureEvent ?? '등록 안 됨'}<span>{load.response.summary.failedAttempts === null ? '—' : `${formatCount(load.response.summary.failedAttempts)}건`}</span></dd></div>
            <div><dt>대기</dt><dd>pending<span>{formatCount(load.response.summary.pendingAttempts)}건</span></dd></div>
          </dl>
          <p className="context-note">완료율과 시도 수는 작업 흐름 응답에서 그대로 가져와요. 이벤트 총수로 완료율을 추론하지 않아요.</p>
        </section>))}

    </>}
  </>;
}
