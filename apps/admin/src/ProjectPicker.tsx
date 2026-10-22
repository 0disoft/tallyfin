import { useEffect, useRef, useState } from 'react';
import { CaretDown } from '@phosphor-icons/react';
import { MAX_PROJECT_SEARCH_CHARS, type ApiClient } from './api/client';
import { ProjectSearch, type ProjectSearchState } from './api/project-search';
import type { Project } from './api/types';

export default function ProjectPicker({ client, projects, active, enabled, refreshTick, hasMore, loadingMore, onLoadMore, onSelect }: {
  client: ApiClient; projects: Project[]; active: Project | null; enabled: boolean; refreshTick: number;
  hasMore: boolean; loadingMore: boolean; onLoadMore: () => void; onSelect: (project: Project) => void;
}) {
  const [search, setSearch] = useState<ProjectSearch | null>(null);
  const [state, setState] = useState<ProjectSearchState>({ query: '', phase: 'idle', items: [], nextCursor: null, more: false, message: null });
  const [input, setInput] = useState('');
  const inputRef = useRef('');
  useEffect(() => {
    const controller = new ProjectSearch(client);
    setSearch(controller);
    const unsubscribe = controller.subscribe(setState);
    return () => { unsubscribe(); controller.destroy(); };
  }, [client]);
  useEffect(() => { search?.search(enabled ? inputRef.current : ''); }, [search, enabled, refreshTick]);
  const filtering = !!input.trim();
  const matches = filtering ? state.phase === 'ready' ? state.items : [] : projects;
  const pinned = active && !matches.some(item => item.id === active.id) ? active : null;
  const options = pinned ? [pinned, ...matches] : matches;
  const change = (value: string) => { inputRef.current = value; setInput(value); search?.search(value); };
  return <>
    <label className="api-field"><span>프로젝트 검색</span><input className="text-input" type="search" aria-label="프로젝트 검색" placeholder="이름 또는 ID" maxLength={MAX_PROJECT_SEARCH_CHARS}
      value={input} disabled={!enabled} onChange={event => change(event.target.value)} aria-describedby="project-search-status" /></label>
    <label className="api-field"><span>프로젝트</span><div className="project-select-wrap"><select aria-label="프로젝트 선택" value={active?.id ?? ''}
      onChange={event => { const project = options.find(item => item.id === event.target.value); if (project) onSelect(project); }} disabled={!enabled || !options.length}>
      {!active && <option value="">프로젝트를 선택하세요</option>}
      {options.map(item => <option key={item.id} value={item.id}>{item.name} ({item.id}){pinned?.id === item.id ? ' · 현재 선택' : ''}</option>)}
    </select><CaretDown size={16} aria-hidden="true" /></div></label>
    {(filtering ? state.nextCursor : hasMore) && <button className="secondary-button" type="button" disabled={!enabled || (filtering ? state.more : loadingMore)}
      onClick={() => { if (filtering) void search?.next(); else onLoadMore(); }}>{(filtering ? state.more : loadingMore) ? '불러오는 중…' : filtering ? '검색 결과 더 불러오기' : '프로젝트 더 불러오기'}</button>}
    <span id="project-search-status" className="context-note" role="status" aria-live="polite">{filtering && enabled
      ? state.phase === 'loading' ? '프로젝트를 검색하는 중이에요.' : state.phase === 'ready'
        ? `검색 결과 ${state.items.length}개${state.nextCursor ? ' · 다음 결과 있음' : ''}${!state.items.length && active ? ' · 현재 선택은 유지해요.' : ''}` : '' : ''}</span>
    {filtering && state.message && <span className="form-error" role="alert">{state.message} <button className="secondary-button" type="button" onClick={() => { void search?.retry(); }}>검색 다시 시도</button></span>}
  </>;
}
