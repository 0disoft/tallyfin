import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_PAGE_LIMIT, type ApiClient } from './api/client';
import { toApiError, type Load } from './api/load-state';
import { appendPage, shouldApplyPage } from './api/pagination';
import type { Project } from './api/types';

/** Owns list requests, pagination and the generation that invalidates late pages. */
export default function useProjectPages(client: ApiClient | null, refreshTick: number) {
  const [more, setMore] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Load<Project[]>>({ status: 'idle' });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const sessionRef = useRef(0);
  const moreControllerRef = useRef<AbortController | null>(null);
  const projectsControllerRef = useRef<AbortController | null>(null);
  const cancelMore = useCallback(() => {
    moreControllerRef.current?.abort();
    moreControllerRef.current = null;
    setMore(false);
  }, []);
  const invalidatePages = useCallback(() => {
    sessionRef.current += 1;
    projectsControllerRef.current?.abort(); cancelMore();
    setNextCursor(null);
  }, [cancelMore]);
  const resetProjects = useCallback((clearError = false) => {
    invalidatePages(); setProjects({ status: 'idle' });
    if (clearError) setPageError(null);
  }, [invalidatePages]);
  const updateProject = useCallback((project: Project) => {
    setProjects(previous => previous.data ? { ...previous, data: previous.data.map(item => item.id === project.id ? project : item) } : previous);
  }, []);
  const addProject = useCallback((project: Project) => {
    invalidatePages();
    setProjects(previous => ({ status: 'ready', data: [...(previous.data ?? []).filter(p => p.id !== project.id), project].sort((a, b) => a.id.localeCompare(b.id)) }));
    setPageError(null);
  }, [invalidatePages]);

  useEffect(() => {
    if (!client) return;
    cancelMore();
    setNextCursor(null);
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
  }, [client, refreshTick, cancelMore]);

  async function loadMore() {
    if (!client || projects.status !== 'ready' || !nextCursor || more || moreControllerRef.current) return;
    const generation = sessionRef.current;
    const controller = new AbortController();
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
      if (moreControllerRef.current === controller) {
        moreControllerRef.current = null;
        if (generation === sessionRef.current) setMore(false);
      }
    }
  }
  return { projects, nextCursor, more, pageError, loadMore, invalidatePages, resetProjects, updateProject, addProject };
}
