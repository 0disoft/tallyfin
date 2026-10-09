// Same-origin administration API client. The bearer token lives only in this
// instance's private field: it is never written to storage, cookies, the query
// string, request bodies, logs, or serialized output. Server error text is not
// surfaced; only a fixed message plus the request id.

import type {
  EventSeriesResponse,
  ProjectPage,
  ProjectSettings,
  ProjectSettingsUpdate,
  QueryMeta,
  Registry,
  SummaryResponse,
  WorkflowResponse,
  WorkflowBreakdownResponse,
} from './types.ts';
import {
  ContractError,
  parseEventSeriesResponse,
  parseProjectPage,
  parseProjectSettings,
  parseRegistry,
  parseSummaryResponse,
  parseWorkflowBreakdownResponse,
  parseWorkflowResponse,
} from './validate.ts';
import { definitionHash, parsePublishedSchema, parseSchemaPage, parseSchemaValidation } from './schema-contract.ts';
import type { PublishedSchema, SchemaDraft, SchemaPage, SchemaPublication, SchemaValidation } from './schema-contract.ts';
import { creationHash, parseCreatedProject } from './project-creation.ts';
import type { CreatedProject, ProjectCreation } from './project-creation.ts';

export const API_BASE_PATH = '/v1';
export const MAX_PAGE_LIMIT = 100;
export const DEFAULT_PAGE_LIMIT = 25;

export const CROSS_ORIGIN_NOTICE =
  '이 프로토타입은 같은 출처(same-origin)에만 연결해요. 다른 출처는 이번 범위가 아니라 연결하지 않아요. ' +
  '교차 출처 연결에는 HTTPS와 서버 측 명시적 CORS 허용이 필요하고, 로컬 개발에서만 http://localhost 예외를 둘 수 있어요.';

export type ApiErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'invalid_request'
  | 'storage_unavailable'
  | 'settings_conflict'
  | 'schema_conflict'
  | 'project_conflict'
  | 'project_limit_reached'
  | 'http'
  | 'network'
  | 'contract';

export class ApiError extends Error {
  kind: ApiErrorKind;
  status: number;
  code: string | null;
  requestId: string | null;
  constructor(kind: ApiErrorKind, message: string, details: { status?: number; code?: string | null; requestId?: string | null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = details.status ?? 0;
    this.code = details.code ?? null;
    this.requestId = details.requestId ?? null;
  }
}

const KIND_MESSAGE: Record<ApiErrorKind, string> = {
  unauthorized: '관리자 인증이 필요해요. (HTTP 401)',
  forbidden: '이 프로젝트에 대한 권한이 없어요. (HTTP 403)',
  not_found: '프로젝트나 스키마를 찾지 못했어요. (HTTP 404)',
  invalid_request: '요청 범위가 계약과 맞지 않아요. (HTTP 400)',
  storage_unavailable: '저장소를 사용할 수 없어요. (HTTP 503)',
  settings_conflict: '다른 변경 사항이 있어요. 최신 설정을 확인해 주세요. (HTTP 409)',
  schema_conflict: '발행된 스키마가 바뀌었어요. 최신 버전을 확인해 주세요. (HTTP 409)',
  project_conflict: '이미 사용 중이거나 다른 내용으로 생성된 프로젝트 ID예요. (HTTP 409)',
  project_limit_reached: '프로젝트 생성 개수 한도에 도달했어요. 운영자에게 한도를 확인해 주세요. (HTTP 409)',
  http: '요청이 실패했어요.',
  network: 'API 서버에 연결하지 못했어요.',
  contract: 'API 응답이 계약과 맞지 않아요.',
};

const STATUS_KIND: Record<number, ApiErrorKind> = {
  400: 'invalid_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  503: 'storage_unavailable',
  409: 'settings_conflict',
};

export function clampLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_PAGE_LIMIT;
  return Math.min(MAX_PAGE_LIMIT, Math.max(1, Math.floor(limit)));
}

export function resolveApiEndpoint(input: string, currentOrigin: string): { basePath: string } | { error: string } {
  const value = input.trim();
  if (!value || value === '/' || value === API_BASE_PATH) return { basePath: API_BASE_PATH };
  let url: URL;
  try {
    url = new URL(value, currentOrigin);
  } catch {
    return { error: '연결 주소 형식을 확인해 주세요.' };
  }
  if (url.username || url.password) return { error: '주소에 자격 증명(userinfo)을 넣을 수 없어요.' };
  if (url.search || url.hash) return { error: '주소에 쿼리나 해시를 넣을 수 없어요.' };
  if (url.origin !== currentOrigin) return { error: CROSS_ORIGIN_NOTICE };
  if (url.pathname && url.pathname !== '/' && url.pathname !== API_BASE_PATH) {
    return { error: `같은 출처의 ${API_BASE_PATH} 경로만 사용할 수 있어요.` };
  }
  return { basePath: API_BASE_PATH };
}

export type FetchOption = {
  method?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  credentials?: 'omit';
  cache?: 'no-store';
  referrerPolicy?: 'no-referrer';
  body?: string;
};

export type FetchLike = (
  input: string,
  init?: FetchOption,
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

function defaultFetch(input: string, init?: FetchOption): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> {
  // Invoke fetch as a property of globalThis so the receiver is the global
  // object, not this ApiClient instance (browsers reject that with
  // "Illegal invocation").
  return globalThis.fetch(input, init as RequestInit) as unknown as Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
}

export class ApiClient {
  #token = '';
  #basePath: string;
  #fetch: FetchLike;
  #controllers = new Set<AbortController>();
  #destroyed = false;
  #getBearer: (() => Promise<string>) | undefined;
  #onDestroy: (() => void) | undefined;

  constructor(options: { token?: string; getBearer?: () => Promise<string>; onDestroy?: () => void; basePath?: string; fetchImpl?: FetchLike } = {}) {
    const basePath = options.basePath ?? API_BASE_PATH;
    if (basePath !== API_BASE_PATH) {
      throw new ApiError('invalid_request', `같은 출처의 ${API_BASE_PATH} 경로만 사용할 수 있어요.`);
    }
    this.#token = options.token ?? '';
    this.#getBearer = options.getBearer;
    this.#onDestroy = options.onDestroy;
    this.#basePath = basePath;
    this.#fetch = options.fetchImpl ?? defaultFetch;
  }

  get hasToken(): boolean {
    return this.#token.length > 0 || this.#getBearer !== undefined;
  }

  toString(): string {
    return '[ApiClient]';
  }

  toJSON(): string {
    return '[ApiClient]';
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#token = '';
    this.#destroyed = true;
    for (const controller of this.#controllers) controller.abort();
    this.#controllers.clear();
    this.#getBearer = undefined;
    this.#onDestroy?.();
    this.#onDestroy = undefined;
  }

  async listProjects(options: { limit?: number; cursor?: string | null; signal?: AbortSignal } = {}): Promise<ProjectPage> {
    const params = { limit: clampLimit(options.limit), cursor: options.cursor ?? undefined };
    return this.#parse(await this.#request('/projects', params, options.signal), parseProjectPage);
  }

  async getSchema(projectId: string, schemaVersion: number, options: { signal?: AbortSignal } = {}): Promise<Registry> {
    const version = this.#version(schemaVersion);
    const path = `/projects/${encodeURIComponent(projectId)}/schemas/${version}`;
    const registry = this.#parse(await this.#request(path, {}, options.signal), parseRegistry);
    if (registry.project.id !== projectId || registry.schemaVersion !== version) {
      throw new ApiError('contract', '응답이 요청한 프로젝트나 스키마 버전과 맞지 않아요.');
    }
    return registry;
  }

  async createProject(input: ProjectCreation, options: { signal?: AbortSignal } = {}): Promise<CreatedProject> {
    const body = JSON.stringify(input);
    if (new TextEncoder().encode(body).length > 16384) throw new ApiError('invalid_request', '생성 요청은 16KiB 이하여야 해요.');
    const hash = await creationHash(input);
    const result = this.#parse(await this.#request('/projects', {}, options.signal, body, 'POST'), parseCreatedProject);
    if (result.projectId !== input.id || result.creationHash !== hash) throw new ApiError('contract', '생성 응답이 요청한 프로젝트·내용과 달라요.');
    return result;
  }

  async getSettings(projectId: string, options: { signal?: AbortSignal } = {}): Promise<ProjectSettings> {
    const result = this.#parse(await this.#request(`/projects/${encodeURIComponent(projectId)}`, {}, options.signal), parseProjectSettings);
    if (result.project.id !== projectId) throw new ApiError('contract', '응답 프로젝트가 요청과 달라요.');
    return result;
  }

  async listSchemas(projectId: string, options: { limit?: number; beforeVersion?: number | null; signal?: AbortSignal } = {}): Promise<SchemaPage> {
    const limit = clampLimit(options.limit), beforeVersion = options.beforeVersion == null ? undefined : this.#version(options.beforeVersion);
    const result = this.#parse(await this.#request(`/projects/${encodeURIComponent(projectId)}/schemas`, { limit, beforeVersion }, options.signal), parseSchemaPage);
    if (result.projectId !== projectId || result.page.limit !== limit || (beforeVersion !== undefined && result.data.some(r => r.schemaVersion >= beforeVersion)))
      throw new ApiError('contract', '스키마 목록이 요청과 맞지 않아요.');
    return result;
  }

  async validateSchema(projectId: string, draft: SchemaDraft, options: { signal?: AbortSignal } = {}): Promise<SchemaValidation> {
    const body = JSON.stringify(draft);
    if (new TextEncoder().encode(body).byteLength > 32768) throw new ApiError('invalid_request', '정의는 32KiB 이하여야 해요.');
    return this.#parse(await this.#request(`/projects/${encodeURIComponent(projectId)}/schemas/validate`, {}, options.signal, body, 'POST'), parseSchemaValidation);
  }

  async publishSchema(projectId: string, schemaVersion: number, input: SchemaPublication, options: { signal?: AbortSignal } = {}): Promise<PublishedSchema> {
    const version = this.#version(schemaVersion), body = JSON.stringify(input);
    if (new TextEncoder().encode(body).byteLength > 33792) throw new ApiError('invalid_request', '발행 요청이 너무 커요.');
    const hash = await definitionHash({ events: input.events, workflows: input.workflows });
    const result = this.#parse(await this.#request(`/projects/${encodeURIComponent(projectId)}/schemas/${version}`, {}, options.signal, body, 'PUT'), parsePublishedSchema);
    if (result.projectId !== projectId || result.schemaVersion !== version || result.definitionHash !== hash)
      throw new ApiError('contract', '발행 응답이 요청한 정의·프로젝트·버전과 맞지 않아요.');
    return result;
  }

  async updateSettings(projectId: string, update: ProjectSettingsUpdate, options: { signal?: AbortSignal } = {}): Promise<ProjectSettings> {
    const body = JSON.stringify(update);
    if (new TextEncoder().encode(body).byteLength > 16 * 1024) throw new ApiError('invalid_request', '설정 요청이 너무 커요.');
    const result = this.#parse(await this.#request(`/projects/${encodeURIComponent(projectId)}`, {}, options.signal, body), parseProjectSettings);
    if (result.project.id !== projectId || !result.canEdit) throw new ApiError('contract', '저장 응답이 요청과 맞지 않아요.');
    if ((update.name !== undefined && result.project.name !== update.name) ||
      (update.status !== undefined && result.project.status !== update.status) ||
      (update.allowedOrigins !== undefined && JSON.stringify(result.allowedOrigins) !== JSON.stringify(update.allowedOrigins)) ||
      Object.entries(update.limits ?? {}).some(([key, value]) => result.limits[key as keyof typeof result.limits] !== value))
      throw new ApiError('contract', '저장 응답에 변경한 값이 반영되지 않았어요.');
    return result;
  }

  async getSummary(
    projectId: string,
    options: { schemaVersion: number; from: string; to: string; signal?: AbortSignal },
  ): Promise<SummaryResponse> {
    const version = this.#version(options.schemaVersion);
    const params = { schemaVersion: version, from: options.from, to: options.to };
    const path = `/projects/${encodeURIComponent(projectId)}/summary`;
    const response = this.#parse(await this.#request(path, params, options.signal), parseSummaryResponse);
    this.#assertMeta(response.meta, { projectId, schemaVersion: version, from: options.from, to: options.to });
    return response;
  }

  async getEventDaily(
    projectId: string,
    eventName: string,
    options: { schemaVersion: number; from: string; to: string; groupBy?: string; signal?: AbortSignal },
  ): Promise<EventSeriesResponse> {
    const version = this.#version(options.schemaVersion);
    const params = {
      schemaVersion: version,
      from: options.from,
      to: options.to,
      groupBy: options.groupBy ? options.groupBy : undefined,
    };
    const path = `/projects/${encodeURIComponent(projectId)}/events/${encodeURIComponent(eventName)}/daily`;
    const response = this.#parse(await this.#request(path, params, options.signal), parseEventSeriesResponse);
    this.#assertMeta(response.meta, { projectId, schemaVersion: version, from: options.from, to: options.to });
    if (response.eventName !== eventName) throw new ApiError('contract', '응답 이벤트가 요청과 달라요.');
    if ((response.groupBy ?? null) !== (options.groupBy ?? null)) {
      throw new ApiError('contract', '응답 groupBy가 요청과 달라요.');
    }
    return response;
  }

  async getWorkflowDaily(
    projectId: string,
    workflowId: string,
    options: { schemaVersion: number; from: string; to: string; signal?: AbortSignal },
  ): Promise<WorkflowResponse> {
    const version = this.#version(options.schemaVersion);
    const params = { schemaVersion: version, from: options.from, to: options.to };
    const path = `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(workflowId)}/daily`;
    const response = this.#parse(await this.#request(path, params, options.signal), parseWorkflowResponse);
    this.#assertMeta(response.meta, { projectId, schemaVersion: version, from: options.from, to: options.to });
    if (response.workflowId !== workflowId) throw new ApiError('contract', '응답 작업 흐름이 요청과 달라요.');
    return response;
  }

  async getWorkflowBreakdown(projectId: string, workflowId: string,
    options: { schemaVersion: number; from: string; to: string; groupBy: string; signal?: AbortSignal }): Promise<WorkflowBreakdownResponse> {
    const version = this.#version(options.schemaVersion);
    const result = this.#parse(await this.#request(`/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(workflowId)}/breakdown`,
      { schemaVersion: version, from: options.from, to: options.to, groupBy: options.groupBy }, options.signal), parseWorkflowBreakdownResponse);
    this.#assertMeta(result.meta, { projectId, schemaVersion: version, from: options.from, to: options.to });
    if (result.workflowId !== workflowId || result.groupBy !== options.groupBy) throw new ApiError('contract', '흐름이나 분류 기준이 요청과 달라요.');
    return result;
  }
  #version(schemaVersion: number): number {
    if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > 2147483647) {
      throw new ApiError('invalid_request', '스키마 버전을 1 이상의 정수로 입력해 주세요.');
    }
    return schemaVersion;
  }

  #assertMeta(meta: QueryMeta, expected: { projectId: string; schemaVersion: number; from: string; to: string }): void {
    if (
      meta.projectId !== expected.projectId ||
      meta.schemaVersion !== expected.schemaVersion ||
      meta.from !== expected.from ||
      meta.to !== expected.to
    ) {
      throw new ApiError('contract', '응답이 요청한 프로젝트·버전·기간과 맞지 않아요.');
    }
  }

  #parse<T>(body: unknown, parser: (value: unknown) => T): T {
    try {
      return parser(body);
    } catch (error) {
      if (error instanceof ContractError) {
        throw new ApiError('contract', `API 응답이 계약 형식과 달라요. (${error.message})`);
      }
      throw error;
    }
  }

  async #request(
    path: string,
    params: Record<string, string | number | undefined> = {},
    signal?: AbortSignal,
    body?: string,
    method?: 'POST' | 'PUT',
  ): Promise<unknown> {
    if (this.#destroyed) throw new ApiError('network', KIND_MESSAGE.network);
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) query.set(key, String(value));
    }
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    const url = `${this.#basePath}${path}${suffix}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const controller = new AbortController();
    const forward = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', forward, { once: true });
    }
    this.#controllers.add(controller);
    try {
      controller.signal.throwIfAborted();
      let bearer = this.#token;
      if (this.#getBearer) {
        try {
          const getBearer = this.#getBearer;
          bearer = await new Promise<string>((resolve, reject) => {
            const aborted = () => reject(controller.signal.reason);
            controller.signal.addEventListener('abort', aborted, { once: true });
            // Cancelling this request must not cancel a refresh shared by others.
            Promise.resolve().then(getBearer).then(resolve, reject).finally(() => {
              controller.signal.removeEventListener('abort', aborted);
            });
          });
          if (!bearer) throw new Error();
        }
        catch {
          controller.signal.throwIfAborted();
          throw new ApiError('unauthorized', KIND_MESSAGE.unauthorized, { status: 401 });
        }
      }
      controller.signal.throwIfAborted();
      if (bearer) headers.Authorization = `Bearer ${bearer}`;
      let response: { ok: boolean; status: number; json: () => Promise<unknown> };
      try {
        response = await this.#fetch(url, {
          method: method ?? (body === undefined ? 'GET' : 'PATCH'),
          ...(body === undefined ? {} : { body }),
          headers,
          signal: controller.signal,
          credentials: 'omit',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
        });
      } catch (error) {
        if (controller.signal.aborted || (error as { name?: string })?.name === 'AbortError') throw error;
        throw new ApiError('network', KIND_MESSAGE.network);
      }
      if (!response.ok) throw await this.#toApiError(response);
      try {
        return await response.json();
      } catch (error) {
        if (controller.signal.aborted || (error as { name?: string })?.name === 'AbortError') throw error;
        throw new ApiError('contract', 'API 응답을 JSON으로 읽지 못했어요.');
      }
    } finally {
      // Keep the controller registered until the body is read so destroy()
      // can abort an in-flight body stream too.
      this.#controllers.delete(controller);
      signal?.removeEventListener('abort', forward);
    }
  }

  async #toApiError(response: { status: number; json: () => Promise<unknown> }): Promise<ApiError> {
    let code: string | null = null;
    let requestId: string | null = null;
    try {
      const body = (await response.json()) as { error?: { code?: unknown; requestId?: unknown } } | null;
      const detail = body?.error;
      if (detail && typeof detail === 'object') {
        if (typeof detail.code === 'string' && detail.code.length <= 64) code = detail.code;
        if (typeof detail.requestId === 'string' && detail.requestId.length <= 64) requestId = detail.requestId;
      }
    } catch {
      // Body is not JSON; keep the fixed status-based message.
    }
    const kind = response.status === 409 && code && ['schema_conflict', 'project_conflict', 'project_limit_reached'].includes(code)
      ? code as ApiErrorKind : STATUS_KIND[response.status] ?? 'http';
    const message = kind === 'http' ? `요청이 실패했어요. (HTTP ${response.status})` : KIND_MESSAGE[kind];
    return new ApiError(kind, message, { status: response.status, code, requestId });
  }
}
