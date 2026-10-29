import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { CalendarBlank, CaretDown, ChartBar, Gear, House, List, Target, WarningCircle, X } from '@phosphor-icons/react';
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/noto-sans/wght.css';
import '@fontsource-variable/noto-sans-kr/wght.css';
import { dateAt, getRecords, projects, summarize, type DisplayState, type Period, type ProjectId, type View } from './data';
import DeferredPanel from './DeferredPanel';
import './styles.css';
import { loadWorkspaceCatalogs, useI18n } from './i18n';
import LanguageControl from './i18n/LanguageControl';
import { initialCallback } from './auth/bootstrap';
import { WorkspaceExit } from './api/workspace-exit';

const navigation = [
  { id: 'overview' as const, title: 'navOverview' as const, icon: House },
  { id: 'events' as const, title: 'navEvents' as const, icon: ChartBar },
  { id: 'goals' as const, title: 'navGoals' as const, icon: Target },
  { id: 'settings' as const, title: 'navSettings' as const, icon: Gear },
];
const stateLabels = { normal: 'stateNormal', loading: 'stateLoading', empty: 'stateEmpty', error: 'stateError', stale: 'stateStale', unauthorized: 'stateUnauthorized' } as const;
type Mode = 'sample' | 'api';
const LiveDashboard = lazy(async () => {
  await loadWorkspaceCatalogs();
  return import('./LiveDashboard').then(module => ({ default: module.LiveDashboard }));
});
const Settings = lazy(async () => { await loadWorkspaceCatalogs(); return import('./Settings'); });
const Overview = lazy(async () => { await loadWorkspaceCatalogs(); return import('./Dashboard').then(module => ({ default: module.Overview })); });
const EventAnalysis = lazy(async () => { await loadWorkspaceCatalogs(); return import('./Dashboard').then(module => ({ default: module.EventAnalysis })); });
const Goals = lazy(async () => { await loadWorkspaceCatalogs(); return import('./Dashboard').then(module => ({ default: module.Goals })); });
const SampleProjects = lazy(() => import('./SampleProjects'));

export function App({ demo = false }: { demo?: boolean }) {
  const { t, locale } = useI18n();
  const titles = { overview: t('admin:navOverview'), events: t('admin:navEvents'), goals: t('admin:navGoals'), settings: t('admin:navSettings') };
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = `Tallyfin · ${t(demo ? 'admin:sampleDemoTitle' : 'admin:adminTitle')}`;
  }, [locale, t, demo]);
  const [mode, setMode] = useState<Mode>(() => initialCallback() || !demo ? 'api' : 'sample');
  const [apiExit] = useState(() => new WorkspaceExit());
  const registerApiExit = useCallback((check: () => boolean) => apiExit.register(check), [apiExit]);
  const [liveProject, setLiveProject] = useState<{ name: string; timeZone: string } | null>(null);
  const [projectId, setProjectId] = useState<ProjectId>('modufile');
  const [view, setView] = useState<View>('overview');
  const [period, setPeriod] = useState<Period>(7);
  const [customPeriod, setCustomPeriod] = useState(false);
  const [displayState, setDisplayState] = useState<DisplayState>('normal');
  const [names, setNames] = useState<Record<ProjectId, string>>({ modufile: 'ModuFile', sembom: 'Sembom', orchid: 'Orchid Pass' });
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 800px)').matches);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const [eventHeaderHost, setEventHeaderHost] = useState<HTMLDivElement | null>(null);
  const setLiveProjectLabel = useCallback((info: { name: string; timeZone: string } | null) => setLiveProject(info), []);
  const project = projects.find(candidate => candidate.id === projectId)!;
  const records = displayState === 'empty' ? [] : getRecords(project, period);
  const summary = summarize(project, records);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 800px)');
    const update = () => { setMobile(media.matches); if (!media.matches) setDrawerOpen(false); };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!drawerOpen || !mobile) return;
    const drawer = drawerRef.current;
    const controls = () => Array.from(drawer?.querySelectorAll<HTMLElement>('button:not([disabled]),select,a[href]') ?? []);
    controls()[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setDrawerOpen(false); menuRef.current?.focus(); }
      if (event.key === 'Tab') {
        const focusable = controls(), first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [drawerOpen, mobile]);
  function navigate(next: View) { setView(next); setDrawerOpen(false); mainRef.current?.focus(); }
  function switchProject(next: ProjectId) { setProjectId(next); setDisplayState('normal'); setDrawerOpen(false); mainRef.current?.focus(); }
  function switchMode(next: Mode) {
    if (next === mode || mode === 'api' && !apiExit.canLeave()) return;
    setMode(next);
  }
  function closeDrawer() { setDrawerOpen(false); menuRef.current?.focus(); }

  return <div className={`app-shell${mode === 'api' && (view === 'overview' || view === 'events' || view === 'goals' || view === 'settings') ? ' event-page' : ''}${mode === 'api' && view === 'overview' ? ' overview-page' : ''}${mode === 'api' && view === 'goals' ? ' goal-page' : ''}${mode === 'api' && view === 'settings' ? ' settings-page' : ''}`}>
    <a className="skip-link" href="#main-content">{t('admin:skipLink')}</a>
    {mobile && drawerOpen && <button className="drawer-overlay" type="button" aria-label={t('admin:closeNavigation')} onClick={closeDrawer} />}
    <aside ref={drawerRef} className={`sidebar${drawerOpen ? ' open' : ''}`} aria-label={t('admin:projectNavigation')} inert={mobile && !drawerOpen} role={mobile && drawerOpen ? 'dialog' : undefined} aria-modal={mobile && drawerOpen || undefined}>
      <div className="brand"><img src="/assets/tallyfin-fin.png" alt="" width="40" height="30" /><span>Tallyfin</span>{mobile && <button type="button" className="mobile-close" aria-label={t('admin:closeMenu')} onClick={closeDrawer}><X size={24} /></button>}</div>
      {mode === 'sample' && <Suspense fallback={null}><SampleProjects projectId={projectId} names={names} onSelect={switchProject} /></Suspense>}
      <nav className="nav-list" aria-label={t('admin:mainNavigation')}>{navigation.map(item => <button key={item.id} type="button" className={`nav-button${view === item.id ? ' active' : ''}`} aria-current={view === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><item.icon size={25} weight={view === item.id ? 'fill' : 'regular'} /><span>{t(`admin:${item.title}`)}</span></button>)}</nav>
      <div className="sidebar-footer"><span className="sample-badge">{t(mode === 'api' ? 'admin:apiConnection' : 'admin:sampleData')}</span></div>
    </aside>
    <main ref={mainRef} id="main-content" className="workspace" tabIndex={-1} inert={mobile && drawerOpen}>
      <div className="mobile-bar"><button ref={menuRef} type="button" className="menu-trigger" aria-label={t('admin:openNavigation')} aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}><List size={25} /></button><span>Tallyfin</span><span className="sample-badge">{mode === 'api' ? 'API' : t('admin:sample')}</span></div>
      <header className="page-header"><div className="title-group"><h1>{titles[view]}</h1><div className="project-subtitle">{mode === 'api' ? (liveProject?.name ?? '—') : names[projectId]}</div></div>{mode === 'api' && (view === 'overview' || view === 'events' || view === 'goals' || view === 'settings') && <div className="event-header-context" ref={setEventHeaderHost} />}<div className="header-controls"><LanguageControl />{demo && <div className="mode-switch" role="group" aria-label={t('admin:dataMode')}><button type="button" className={mode === 'sample' ? 'active' : ''} aria-pressed={mode === 'sample'} onClick={() => switchMode('sample')}>Sample</button><button type="button" className={mode === 'api' ? 'active' : ''} aria-pressed={mode === 'api'} onClick={() => switchMode('api')}>{t('admin:apiConnection')}</button></div>}{!(mode === 'api' && view === 'settings') && <><div className="period-control"><CalendarBlank size={22} /><label className="sr-only" htmlFor="period">{t('admin:reportPeriod')}</label><select id="period" value={mode === 'api' && customPeriod ? 'custom' : period} onChange={event => { const custom = event.target.value === 'custom'; setCustomPeriod(custom); if (!custom) setPeriod(Number(event.target.value) as Period); }}>{([7, 14, 30] as const).map(days => <option key={days} value={days}>{t('admin:recentDays', { days })}</option>)}{mode === 'api' && <option value="custom">{t('admin:customRange')}</option>}</select><CaretDown size={16} /></div><span className="timezone">{mode === 'api' ? (liveProject?.timeZone ?? '—') : 'Asia/Seoul (KST)'}</span></>}</div></header>
      {mode === 'sample' && <p className="context-note" role="status">{t('admin:sampleModeNotice')} <a href="/">{t('admin:backToAdminLogin')}</a></p>}
      <div className="view-content" key={mode === 'api' ? 'api-workspace' : `${projectId}-${view}`}>
        {mode === 'api' ? <DeferredPanel label={t('admin:apiManagement')}><LiveDashboard view={view} period={period} customPeriod={customPeriod} onActiveProjectChange={setLiveProjectLabel} onNavigate={navigate} registerExitCheck={registerApiExit} headerHost={eventHeaderHost} /></DeferredPanel> : displayState === 'unauthorized' ? <section className="state-panel" role="status"><WarningCircle size={32} /><h2>{t('admin:unauthorizedTitle')}</h2><p>{t('admin:unauthorizedBody')}</p><button className="secondary-button" onClick={() => setDisplayState('normal')}>{t('admin:backToSample')}</button></section> : displayState === 'error' ? <section className="state-panel" role="alert"><WarningCircle size={32} /><h2>{t('admin:loadErrorTitle')}</h2><p>{t('admin:loadErrorBody')}</p><button className="primary-button" onClick={() => setDisplayState('normal')}>{t('admin:retry')}</button></section> : displayState === 'loading' ? <section className="state-panel" role="status" aria-busy="true"><h2>{t('admin:loadingTitle')}</h2><p>{t('admin:loadingBody')}</p><button className="secondary-button" onClick={() => setDisplayState('normal')}>{t('admin:loadingComplete')}</button></section> : <>
          {displayState === 'stale' && <p className="notice" role="status"><WarningCircle size={20} />{t('admin:staleSampleNotice', { date: dateAt(-1) })} <button className="text-button" onClick={() => setDisplayState('normal')}>{t('admin:refresh')}</button></p>}
          {displayState === 'empty' && <p className="notice" role="status">{t('admin:emptyPeriodNotice')}</p>}
          {view === 'overview' && <DeferredPanel label={t('admin:navOverview')}><Overview project={project} records={records} summary={summary} onAnalyze={() => navigate('events')} /></DeferredPanel>}
          {view === 'events' && <DeferredPanel label={t('admin:navEvents')}><EventAnalysis project={project} records={records} summary={summary} /></DeferredPanel>}
          {view === 'goals' && <DeferredPanel label={t('admin:navGoals')}><Goals project={project} records={records} summary={summary} /></DeferredPanel>}
          {view === 'settings' && <DeferredPanel label={t('admin:navSettings')}><Settings project={project} displayName={names[projectId]} onSave={name => setNames(previous => ({ ...previous, [projectId]: name }))} onReset={() => setNames(previous => ({ ...previous, [projectId]: project.name }))} /></DeferredPanel>}
        </>}
      </div>
      {mode === 'sample' && <footer className="prototype-footer"><details className="diagnostics"><summary>{t('admin:screenState')}</summary><label htmlFor="display-state">{t('admin:sampleState')}</label><select id="display-state" value={displayState} onChange={event => setDisplayState(event.target.value as DisplayState)}>{Object.entries(stateLabels).map(([value, label]) => <option key={value} value={value}>{t(`admin:${label}`)}</option>)}</select></details></footer>}
    </main>
  </div>;
}
