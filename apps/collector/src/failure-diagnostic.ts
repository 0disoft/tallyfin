export type FailureStage = 'routing' | 'administrator' | 'publisher' | 'admission' | 'project' | 'registry' | 'preparation' | 'commit';
export type FailureKind = 'capacity' | 'deadline' | 'cancelled' | 'revision_conflict' | 'database_busy' |
  'database_reset' | 'database_overloaded' | 'platform_limit' | 'constraint' | 'transport' | 'unknown';
export interface FailureDiagnostic { requestId: string; stage: FailureStage; kind: FailureKind }

/** Classify locally; never export exception text, SQL, cause objects or request data. */
export function failureKind(error: unknown): FailureKind {
  const seen = new Set<unknown>();
  for (let depth = 0; error instanceof Error && depth < 6 && !seen.has(error); depth++) {
    seen.add(error);
    const message = error.message;
    if (message === 'Database capacity exceeded') return 'capacity';
    if (error.name === 'TimeoutError') return 'deadline';
    if (error.name === 'AbortError') return 'cancelled';
    if (message.includes('tallyfin_ingest_revision')) return 'revision_conflict';
    if (/SQLITE_BUSY|SQLITE_LOCKED/i.test(message)) return 'database_busy';
    if (/D1.*reset|database.*reset/i.test(message)) return 'database_reset';
    if (/overloaded|too many requests queued/i.test(message)) return 'database_overloaded';
    if (/too many (?:API requests|subrequests)|CPU time limit|memory limit/i.test(message)) return 'platform_limit';
    if (/SQLITE_CONSTRAINT|constraint failed/i.test(message)) return 'constraint';
    if (/network connection lost|connection reset|network error|fetch failed/i.test(message)) return 'transport';
    error = error.cause;
  }
  return 'unknown';
}
