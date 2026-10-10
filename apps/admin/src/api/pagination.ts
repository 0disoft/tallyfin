// Guard for paginated loads so an aborted or superseded session never merges a
// stale page into the current list.

export function shouldApplyPage(guard: { generation: number; current: number; aborted: boolean }): boolean {
  return !guard.aborted && guard.generation === guard.current;
}

export function appendPage<T>(items: T[], page: { data: T[]; page: { nextCursor: string | null } }): { items: T[]; nextCursor: string | null } {
  return { items: [...items, ...page.data], nextCursor: page.page.nextCursor };
}
