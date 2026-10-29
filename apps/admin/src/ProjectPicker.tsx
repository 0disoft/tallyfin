import { useI18n } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { CaretDown, MagnifyingGlass } from '@phosphor-icons/react';
import { MAX_PROJECT_SEARCH_CHARS, type ApiClient } from './api/client';
import { ProjectSearch, type ProjectSearchState } from './api/project-search';
import type { Project } from './api/types';
import useHeaderMenu from './useHeaderMenu';

export default function ProjectPicker({ client, projects, active, enabled, refreshTick, hasMore, loadingMore, onLoadMore, onSelect, compact = false }: {
  client: ApiClient; projects: Project[]; active: Project | null; enabled: boolean; refreshTick: number;
  hasMore: boolean; loadingMore: boolean; onLoadMore: () => void; onSelect: (project: Project) => void;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const menuRef = useHeaderMenu(compact);
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
  const searchField = <label className="api-field"><span>{t('admin:searchProjects')}</span><input className="text-input" type="search" aria-label={t('admin:searchProjects')} placeholder={t('admin:nameOrId')} maxLength={MAX_PROJECT_SEARCH_CHARS}
      value={input} disabled={!enabled} onChange={event => change(event.target.value)} aria-describedby="project-search-status" /></label>;
  return <>
    {compact ? <details className="events-project-search" ref={menuRef} data-header-menu><summary><MagnifyingGlass size={16} /><span>{t('admin:searchProjects')}</span></summary>{searchField}</details> : searchField}
    <label className="api-field"><span>{t('admin:project')}</span><div className="project-select-wrap"><select aria-label={t('admin:selectProject')} value={active?.id ?? ''}
      onChange={event => { const project = options.find(item => item.id === event.target.value); if (project) onSelect(project); }} disabled={!enabled || !options.length}>
      {!active && <option value="">{t('admin:selectProjectPlaceholder')}</option>}
      {options.map(item => <option key={item.id} value={item.id}>{item.name} ({item.id}){pinned?.id === item.id ? ` · ${t('admin:currentSelection')}` : ''}</option>)}
    </select><CaretDown size={16} aria-hidden="true" /></div></label>
    {(filtering ? state.nextCursor : hasMore) && <button className="secondary-button" type="button" disabled={!enabled || (filtering ? state.more : loadingMore)}
      onClick={() => { if (filtering) void search?.next(); else onLoadMore(); }}>{(filtering ? state.more : loadingMore) ? t('admin:loadingMore') : filtering ? t('admin:loadMoreResults') : t('admin:loadMoreProjects')}</button>}
    <span id="project-search-status" className="context-note" role="status" aria-live="polite">{filtering && enabled
      ? state.phase === 'loading' ? t('admin:searchingProjects') : state.phase === 'ready'
        ? `${t('admin:searchResultCount', { count: state.items.length })}${state.nextCursor ? ` · ${t('admin:moreResults')}` : ''}${!state.items.length && active ? ` · ${t('admin:selectionRetained')}` : ''}` : '' : ''}</span>
    {filtering && state.message && <span className="form-error" role="alert">{state.message} <button className="secondary-button" type="button" onClick={() => { void search?.retry(); }}>{t('admin:retrySearch')}</button></span>}
  </>;
}
