// Guard for paginated loads so an aborted or superseded session never merges a
// stale page into the current list.

export function shouldApplyPage(guard: { generation: number; current: number; aborted: boolean }): boolean {
  return !guard.aborted && guard.generation === guard.current;
}

export function appendPage<T extends { id: string }>(items: T[], page: { data: T[]; page: { nextCursor: string | null } }): { items: T[]; nextCursor: string | null } {
  // A newly created project may already be present before its server page arrives.
  const byId = new Map(items.map(item => [item.id, item]));
  for (const item of page.data) byId.set(item.id, item);
  const merged = [...byId.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return { items: merged, nextCursor: page.page.nextCursor };
}
