import type { ApiClient } from './client.ts';
import { ApiError } from './api-error.ts';
import { todayInZone } from './dates.ts';
import { assertMeta } from './period-comparison.ts';
import type { EventSource, ProjectSettings, Registry, SummaryResponse } from './types.ts';
import { rejectionRange, type RejectionResponse } from './rejection-diagnostics.ts';

export type DiagnosticRead<T> = { value: T; error?: never } | { value?: never; error: ApiError };
export type CollectionDiagnostics = {
  settings: DiagnosticRead<ProjectSettings>;
  schema: DiagnosticRead<Registry>;
  receipt: DiagnosticRead<SummaryResponse> | null;
  rejections: DiagnosticRead<RejectionResponse>;
};

function errorOf(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError('contract', '수집 상태 응답을 확인할 수 없어요.');
}

async function read<T>(operation: () => Promise<T>): Promise<DiagnosticRead<T>> {
  try { return { value: await operation() }; }
  catch (error) { return { error: errorOf(error) }; }
}

function timestamp(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value)))
    throw new ApiError('contract', '수신 시각이 올바른 UTC 시각이 아니에요.');
  const result = Date.parse(value);
  if (new Date(result).toISOString().slice(0, 19) !== value.slice(0, 19))
    throw new ApiError('contract', '수신 시각의 날짜가 올바르지 않아요.');
  return result;
}

export function validateReceipt(summary: SummaryResponse, schema: Registry, date: string, source: EventSource = 'browser'): SummaryResponse {
  assertMeta(summary.meta, schema, { from: date, to: date }, source);
  timestamp(summary.meta.generatedAt);
  // generatedAt is captured before the DB read; a concurrent receipt may be later.
  if (summary.meta.latestReceivedAt !== null) timestamp(summary.meta.latestReceivedAt);
  const expected = schema.events.filter(event => event.source === source).map(event => event.name);
  if (summary.events.length !== expected.length || new Set(summary.events.map(event => event.name)).size !== expected.length ||
    summary.events.some(event => !expected.includes(event.name) || !Number.isSafeInteger(event.count) || event.count < 0) ||
    !Number.isSafeInteger(summary.totalEvents) || summary.totalEvents < 0 ||
    summary.events.reduce((total, event) => total + event.count, 0) !== summary.totalEvents)
    throw new ApiError('contract', '수집 상태의 이벤트 정의와 합계가 맞지 않아요.');
  return summary;
}

/** Independent explicit reads; no polling, probe event or rejection inference. */
export async function loadCollectionDiagnostics(client: ApiClient, projectId: string, version: number | null,
  signal: AbortSignal, now = new Date(), selectedSource?: EventSource): Promise<CollectionDiagnostics> {
  const [settings, schema, rejections] = await Promise.all([
    read(() => client.getSettings(projectId, { signal })),
    read(() => version === null ? Promise.reject(new ApiError('invalid_request', '유효한 스키마 버전을 입력해 주세요.'))
      : client.getSchema(projectId, version, { signal })),
    read(() => client.getCollectionRejections(projectId, { ...rejectionRange(now), signal })),
  ]);
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  let receipt: CollectionDiagnostics['receipt'] = null;
  if (schema.value) {
    const definition = schema.value;
    receipt = await read(async () => {
      const date = todayInZone(definition.project.timeZone, now);
      const source = selectedSource ?? (definition.events.some(event => event.source === 'browser') ? 'browser' : 'server');
      return validateReceipt(await client.getSummary(projectId, { schemaVersion: definition.schemaVersion, from: date, to: date, signal,
        ...(source === 'browser' ? {} : { source }) }), definition, date, source);
    });
  }
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  return { settings, schema, receipt, rejections };
}

export function originMatch(input: string, allowedOrigins: string[]): 'empty' | 'invalid' | 'allowed' | 'denied' {
  if (!input.trim()) return 'empty';
  try {
    const url = new URL(input.trim());
    if (url.username || url.password || !['https:', 'http:'].includes(url.protocol)) return 'invalid';
    return allowedOrigins.includes(url.origin) ? 'allowed' : 'denied';
  } catch { return 'invalid'; }
}
