/** Owns one current workspace check without copying its state or credentials. */
export class WorkspaceExit {
  #entry: { check: () => boolean } | null = null;

  register(check: () => boolean): () => void {
    const entry = { check };
    this.#entry = entry;
    return () => { if (this.#entry === entry) this.#entry = null; };
  }

  canLeave(): boolean { return this.#entry?.check() ?? true; }
}
