import { lazy, useCallback, useEffect, useRef, useState } from 'react';
import { CalendarBlank, CaretDown, ChartBar, FileText, FolderSimple, Gear, House, Leaf, List, Target, WarningCircle, X } from '@phosphor-icons/react';
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/noto-sans-kr/wght.css';
import { dateAt, getRecords, periodLabel, projects, summarize, type DisplayState, type Period, type ProjectId, type View } from './data';
import { EventAnalysis, Goals, Overview } from './Dashboard';
import Settings from './Settings';
import DeferredPanel from './DeferredPanel';
import './styles.css';
import { initialCallback } from './auth/bootstrap';

const navigation = [
  { id: 'overview' as const, title: '개요', icon: House },
  { id: 'events' as const, title: '이벤트 분석', icon: ChartBar },
  { id: 'goals' as const, title: '목표', icon: Target },
  { id: 'settings' as const, title: '설정', icon: Gear },
];
const titles = { overview: '프로젝트 개요', events: '이벤트 분석', goals: '목표', settings: '프로젝트 설정' };
const stateLabels: Record<DisplayState, string> = { normal: '기본', loading: '로딩', empty: '데이터 없음', error: '조회 실패', stale: '오래된 데이터', unauthorized: '권한 없음' };
type Mode = 'sample' | 'api';
const LiveDashboard = lazy(() => import('./LiveDashboard').then(module => ({ default: module.LiveDashboard })));

export function App({ demo = false }: { demo?: boolean }) {
  const [mode, setMode] = useState<Mode>(() => initialCallback() || !demo ? 'api' : 'sample');
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
  function closeDrawer() { setDrawerOpen(false); menuRef.current?.focus(); }

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">본문으로 이동</a>
    {mobile && drawerOpen && <button className="drawer-overlay" type="button" aria-label="탐색 메뉴 닫기" onClick={closeDrawer} />}
    <aside ref={drawerRef} className={`sidebar${drawerOpen ? ' open' : ''}`} aria-label="프로젝트와 탐색" inert={mobile && !drawerOpen} role={mobile && drawerOpen ? 'dialog' : undefined} aria-modal={mobile && drawerOpen || undefined}>
      <div className="brand"><img src="/assets/tallyfin-fin.png" alt="" width="40" height="30" /><span>Tallyfin</span>{mobile && <button type="button" className="mobile-close" aria-label="메뉴 닫기" onClick={closeDrawer}><X size={24} /></button>}</div>
      {mode === 'sample' ? <>
        <div className="project-switcher"><label htmlFor="project-switch">프로젝트</label><div className="project-select-wrap"><FolderSimple size={24} color="#155EEF" /><select id="project-switch" aria-label="프로젝트 선택" value={projectId} onChange={event => switchProject(event.target.value as ProjectId)}>{projects.map(item => <option key={item.id} value={item.id}>{names[item.id]}</option>)}</select><CaretDown size={16} /></div></div>
        <div className="project-list">{projects.filter(item => item.id !== projectId).map(item => { const Icon = item.id === 'orchid' ? Leaf : item.id === 'sembom' ? FileText : FolderSimple; return <button key={item.id} type="button" className="project-button" onClick={() => switchProject(item.id)}><Icon size={23} /><span>{names[item.id]}</span></button>; })}</div>
      </> : <p className="context-note sidebar-note">API 연결 모드예요. 서버가 준 프로젝트는 본문 도구 모음에서 골라요.</p>}
      <nav className="nav-list" aria-label="주요 탐색">{navigation.map(item => <button key={item.id} type="button" className={`nav-button${view === item.id ? ' active' : ''}`} aria-current={view === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><item.icon size={25} weight={view === item.id ? 'fill' : 'regular'} /><span>{item.title}</span></button>)}</nav>
      <div className="sidebar-footer"><p>개인정보를 지키는<br />더 나은 제품을 위해<br />Tallyfin</p><span className="sample-badge">{mode === 'api' ? 'API 연결' : '샘플 데이터'}</span></div>
    </aside>
    <main ref={mainRef} id="main-content" className="workspace" tabIndex={-1} inert={mobile && drawerOpen}>
      <div className="mobile-bar"><button ref={menuRef} type="button" className="menu-trigger" aria-label="탐색 메뉴 열기" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}><List size={25} /></button><span>Tallyfin</span><span className="sample-badge">{mode === 'api' ? 'API' : '샘플'}</span></div>
      <header className="page-header"><div className="title-group"><h1>{titles[view]}</h1><div className="project-subtitle">{mode === 'api' ? (liveProject?.name ?? '—') : names[projectId]}</div></div><div className="header-controls">{demo && <div className="mode-switch" role="group" aria-label="데이터 모드"><button type="button" className={mode === 'sample' ? 'active' : ''} aria-pressed={mode === 'sample'} onClick={() => setMode('sample')}>Sample</button><button type="button" className={mode === 'api' ? 'active' : ''} aria-pressed={mode === 'api'} onClick={() => setMode('api')}>API 연결</button></div>}<div className="period-control"><CalendarBlank size={22} /><label className="sr-only" htmlFor="period">조회 기간</label><select id="period" value={mode === 'api' && customPeriod ? 'custom' : period} onChange={event => { const custom = event.target.value === 'custom'; setCustomPeriod(custom); if (!custom) setPeriod(Number(event.target.value) as Period); }}>{([7, 14, 30] as const).map(days => <option key={days} value={days}>{mode === 'api' ? `최근 ${days}일` : periodLabel(days)}</option>)}{mode === 'api' && <option value="custom">직접 선택</option>}</select><CaretDown size={16} /></div><span className="timezone">{mode === 'api' ? (liveProject?.timeZone ?? '—') : 'Asia/Seoul (KST)'}</span></div></header>
      {mode === 'sample' && <p className="context-note" role="status">샘플 데이터로 체험 중이에요. 변경은 이 화면에서만 적용돼요. <a href="/">관리자 로그인으로 돌아가기</a></p>}
      <div className="view-content" key={mode === 'api' ? 'api-workspace' : `${projectId}-${view}`}>
        {mode === 'api' ? <DeferredPanel label="API 관리"><LiveDashboard view={view} period={period} customPeriod={customPeriod} onActiveProjectChange={setLiveProjectLabel} onNavigate={navigate} /></DeferredPanel> : displayState === 'unauthorized' ? <section className="state-panel" role="status"><WarningCircle size={32} /><h2>이 프로젝트를 볼 권한이 없어요</h2><p>관리자에게 프로젝트 접근 권한을 확인해 주세요.</p><button className="secondary-button" onClick={() => setDisplayState('normal')}>샘플 화면으로 돌아가기</button></section> : displayState === 'error' ? <section className="state-panel" role="alert"><WarningCircle size={32} /><h2>데이터를 불러오지 못했어요</h2><p>잠시 후 다시 시도해 주세요.</p><button className="primary-button" onClick={() => setDisplayState('normal')}>다시 시도</button></section> : displayState === 'loading' ? <section className="state-panel" role="status" aria-busy="true"><h2>데이터를 불러오는 중이에요</h2><p>선택한 프로젝트의 집계를 준비하고 있어요.</p><button className="secondary-button" onClick={() => setDisplayState('normal')}>샘플 로딩 완료</button></section> : <>
          {displayState === 'stale' && <p className="notice" role="status"><WarningCircle size={20} />오래된 샘플 데이터예요. 마지막 집계: {dateAt(-1)} 23:00 KST <button className="text-button" onClick={() => setDisplayState('normal')}>새로고침</button></p>}
          {displayState === 'empty' && <p className="notice" role="status">선택한 기간에 기록된 이벤트가 없어요. 완료율을 계산할 수 없어요.</p>}
          {view === 'overview' && <Overview project={project} records={records} summary={summary} onAnalyze={() => navigate('events')} />}
          {view === 'events' && <EventAnalysis project={project} records={records} summary={summary} />}
          {view === 'goals' && <Goals project={project} records={records} summary={summary} />}
          {view === 'settings' && <Settings project={project} displayName={names[projectId]} onSave={name => setNames(previous => ({ ...previous, [projectId]: name }))} onReset={() => setNames(previous => ({ ...previous, [projectId]: project.name }))} />}
        </>}
      </div>
      <footer className="prototype-footer">{mode === 'api' ? <p className="context-note">API 연결 · 같은 출처 /v1 · 토큰은 메모리에만 · 프로젝트 권한은 서버에서 확인</p> : <><p className="context-note">샘플 데이터 · Asia/Seoul 일별 집계 · 실제 수집 연결 전</p><details className="diagnostics"><summary>화면 상태 확인</summary><label htmlFor="display-state">샘플 조회 상태</label><select id="display-state" value={displayState} onChange={event => setDisplayState(event.target.value as DisplayState)}>{Object.entries(stateLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></details></>}</footer>
    </main>
  </div>;
}
