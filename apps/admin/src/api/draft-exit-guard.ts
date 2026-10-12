export type DraftExitRegistration<T> = (scope: T, projectId: string, check: () => boolean) => () => void;

/** Keeps live checks, never draft values, for one dashboard lifetime. */
export class DraftExitGuard<T> {
  #checks = new Set<{ scope: T; projectId: string; check: () => boolean }>();

  register(scope: T, projectId: string, check: () => boolean): () => void {
    const entry = { scope, projectId, check };
    this.#checks.add(entry);
    return () => { this.#checks.delete(entry); };
  }

  canLeave(scope: T, projectId: string | null, confirm: () => boolean): boolean {
    const dirty = [...this.#checks].some(entry => entry.scope === scope &&
      entry.projectId === projectId && entry.check());
    return !dirty || confirm();
  }
}
