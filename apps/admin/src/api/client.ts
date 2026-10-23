// Endpoint contracts and response identity checks. The owned transport keeps
// credentials private and owns request deadlines, cancellation and cleanup.

import type {
  EventSeriesResponse,
  EventSource,
  ProjectPage,
  ProjectGrantPage,
  ProjectPublisherPage,
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
import { definitionHash, parsePublishedSchema, parseSchemaPage, parseSchemaValidation, schemaDefinitions } from './schema-contract.ts';
import type { PublishedSchema, SchemaDraft, SchemaPage, SchemaPublication, SchemaValidation } from './schema-contract.ts';
import { creationHash, parseCreatedProject } from './project-creation.ts';
import type { CreatedProject, ProjectCreation } from './project-creation.ts';
import { parseRejectionResponse, type RejectionResponse } from './rejection-diagnostics.ts';
import { parseProjectGrantPage, parseGrantChangeInput, parseGrantMutationResult } from './grants-contract.ts';
import type { GrantChange, GrantMutationResult } from './grants-contract.ts';
import { parseProjectPublisherPage, parsePublisherMutationResult, parsePublisherRequest, publisherAfter, publisherCursor } from './publishers-contract.ts';
import type { PublisherMutationResult, PublisherRequest } from './publishers-contract.ts';
import { changeCursor, parseAdminChangePage, type AdminChangePage } from './admin-changes-contract.ts';
import { parseFunnelResponse, type FunnelResponse } from './funnel-contract.ts';
import { parseFunnelBreakdown, type FunnelBreakdown } from './funnel-breakdown.ts';
import { parseAdminIdentity, type AdminIdentity } from './admin-identity-contract.ts';
import { parseAdminHealth, type AdminHealth } from './admin-health-contract.ts';
import { parseOverview, validateOverviewIds } from './overview-contract.ts';
import type { OverviewResponse } from './overview-contract.ts';
import { ApiError, KIND_MESSAGE } from './api-error.ts';
import { API_BASE_PATH, AdminTransport, type AdminTransportOptions } from './transport.ts';
import { parseDraftSnapshot, validateDraftInput, type SaveDraft, type DraftSnapshot } from './saved-draft-contract.ts';
export { ApiError, type ApiErrorKind } from './api-error.ts';
export { API_BASE_PATH, type FetchLike, type FetchOption } from './transport.ts';

export const MAX_PAGE_LIMIT = 100;
export const DEFAULT_PAGE_LIMIT = 25;
export const MAX_PROJECT_SEARCH_CHARS = 80;

export const CROSS_ORIGIN_NOTICE =
  '이 프로토타입은 같은 출처(same-origin)에만 연결해요. 다른 출처는 이번 범위가 아니라 연결하지 않아요. ' +
  '교차 출처 연결에는 HTTPS와 서버 측 명시적 CORS 허용이 필요하고, 로컬 개발에서만 http://localhost 예외를 둘 수 있어요.';

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

export class ApiClient {
  async getSchemaDraft(projectId: string, options: { signal?: AbortSignal } = {}): Promise<DraftSnapshot> {
    const result = this.#parse(await this.#request(`/projects/${encodeURIComponent(projectId)}/schemas/draft`, {}, options.signal), parseDraftSnapshot);
    if (result.projectId !== projectId) throw new ApiError('contract', '서버 초안 프로젝트가 요청과 달라요.');
    return result;
  }
  async saveSchemaDraft(projectId: string, input: SaveDraft, options: { signal?: AbortSignal } = {}): Promise<DraftSnapshot> {
    try { validateDraftInput(projectId, input); }
    catch { throw new ApiError('invalid_request', '초안 파일 예산 128KiB와 버전 입력 32자 한도를 확인해 주세요.'); }
    const body = JSON.stringify(input), submitted = JSON.parse(body) as SaveDraft;
    const result = this.#parse(await this.#request(`/projects/${encodeURIComponent(projectId)}/schemas/draft`, {}, options.signal, body, 'PUT'), parseDraftSnapshot);
    if (result.projectId !== projectId || !result.draft || result.draft.draftText !== submitted.draftText || result.draft.targetVersion !== submitted.targetVersion || result.draft.revision === submitted.expectedRevision)
      throw new ApiError('contract', '서버 초안 저장 결과가 요청과 달라요. 최신 상태를 확인해 주세요.');
    return result;
  }
  #transport: AdminTransport;
  constructor(options: AdminTransportOptions = {}) { this.#transport = new AdminTransport(options); }
  get hasToken(): boolean { return this.#transport.hasToken; }
  toString(): string { return '[ApiClient]'; }
  toJSON(): string { return '[ApiClient]'; }
  destroy(): void { this.#transport.destroy(); }
  async getIdentity(options: { signal?: AbortSignal } = {}): Promise<AdminIdentity> {
    return this.#parse(await this.#request('/identity', {}, options.signal), parseAdminIdentity);
  }

  async getHealth(options: { signal?: AbortSignal } = {}): Promise<AdminHealth> {
    return this.#parse(await this.#request('/health', {}, options.signal), parseAdminHealth);
  }

  async listProjects(options: { limit?: number; cursor?: string | null; q?: string; signal?: AbortSignal } = {}): Promise<ProjectPage> {
    if (options.q !== undefined && (typeof options.q !== 'string' || options.q.length > MAX_PROJECT_SEARCH_CHARS || /[\x00-\x1f\x7f]/.test(options.q)))
      throw new ApiError('invalid_request', '프로젝트 검색어는 제어 문자 없이 80자 이내로 입력해 주세요.');
    const params = { limit: clampLimit(options.limit), cursor: options.cursor ?? undefined, q: options.q?.trim() || undefined };
    return this.#parse(await this.#request('/projects', params, options.signal), parseProjectPage);
  }

  async getProjectOverview(ids: readonly string[], source: EventSource, options: { signal?: AbortSignal } = {}): Promise<OverviewResponse> {
    ids = [...ids];
    validateOverviewIds(ids);
    if (!['browser', 'server'].includes(source)) throw new ApiError('invalid_request', KIND_MESSAGE.invalid_request);
    const result = this.#parse(await this.#request('/overview', { projectIds: ids.join(','), source }, options.signal), parseOverview);
    if (result.source !== source || result.data.length !== ids.length || result.data.some((row, i) => row.projectId !== ids[i]))
      throw new ApiError('contract', '통합 현황의 프로젝트나 출처가 요청과 달라요.');
    for (const row of result.data) if (row.accessDenied) {
      this.#transport.notifyAccessDenied(row.projectId, new ApiError('forbidden', KIND_MESSAGE.forbidden, { status: 403 }));
    }
    return result;
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

  async listGrants(projectId: string, options: { limit?: number; cursor?: string | null; signal?: AbortSignal } = {}): Promise<ProjectGrantPage> {
    const limit = clampLimit(options.limit), cursor = options.cursor || undefined;
    if (cursor && (cursor.length > 12288 || !/^[A-Za-z0-9_-]+$/.test(cursor))) throw new ApiError('invalid_request', '페이지 위치를 확인해 주세요.');
    const result = this.#parse(await this.#request(`/projects/${encodeURIComponent(projectId)}/grants`, { limit, cursor }, options.signal), parseProjectGrantPage);
    if (result.projectId !== projectId || result.page.limit !== limit || (cursor && result.page.nextCursor === cursor))
      throw new ApiError('contract', '권한 목록의 프로젝트나 페이지가 요청과 달라요.');
    return result;
  }

  async listChanges(projectId: string, options: { limit?: number; cursor?: string | null; signal?: AbortSignal } = {}): Promise<AdminChangePage> {
    const limit = clampLimit(options.limit), cursor = options.cursor || undefined;
    let before: [number, string] | null;
    try {
      if (!/^[a-z][a-z0-9-]{0,47}$/.test(projectId)) throw Error();
      before = changeCursor(projectId, cursor ?? null);
    } catch { throw new ApiError('invalid_request', '프로젝트와 페이지 위치를 확인해 주세요.'); }
    const result = this.#parse(await this.#request(`/projects/${encodeURIComponent(projectId)}/changes`, { limit, cursor }, options.signal), parseAdminChangePage);
    if (result.projectId !== projectId || result.page.limit !== limit || cursor && result.page.nextCursor === cursor ||
      before && result.data.some(row => !(Date.parse(row.occurredAt) < before[0] || Date.parse(row.occurredAt) === before[0] && row.id < before[1])))
      throw new ApiError('contract', '변경 이력의 프로젝트나 페이지가 요청과 달라요.');
    return result;
  }

  /** Owner-only publisher list. Publisher permission never grants administrator access. */
  async listPublishers(projectId: string, options: { limit?: number; cursor?: string | null; signal?: AbortSignal } = {}): Promise<ProjectPublisherPage> {
    const limit = clampLimit(options.limit), cursor = options.cursor || undefined;
    let after: [string, string] | null;
    try {
      if (!/^[a-z][a-z0-9-]{0,47}$/.test(projectId)) throw Error();
      after = publisherCursor(projectId, cursor ?? null);
    } catch { throw new ApiError('invalid_request', '프로젝트와 페이지 위치를 확인해 주세요.'); }
    const result = this.#parse(await this.#request(`/projects/${encodeURIComponent(projectId)}/publishers`, { limit, cursor }, options.signal), parseProjectPublisherPage);
    if (result.projectId !== projectId || result.page.limit !== limit || cursor && result.page.nextCursor === cursor ||
      after && result.data.some(row => !publisherAfter(row, after)))
      throw new ApiError('contract', '발행자 목록의 프로젝트나 페이지가 요청과 달라요.');
    return result;
  }

  async changePublisher(projectId: string, input: PublisherRequest, options: { signal?: AbortSignal } = {}): Promise<PublisherMutationResult> {
    let request: PublisherRequest;
    try { request = parsePublisherRequest(input); }
    catch { throw new ApiError('invalid_request', '발급자·계정 식별자와 발행 권한 상태를 확인해 주세요.'); }
    if (!/^[a-z][a-z0-9-]{0,47}$/.test(projectId)) throw new ApiError('invalid_request', '프로젝트 ID를 확인해 주세요.');
    const { issuer, subject } = request;
    const body = JSON.stringify(request.granted ? { issuer, subject } : { issuer, subject, expectedGrantId: request.expectedGrantId });
    if (new TextEncoder().encode(body).byteLength > 16384) throw new ApiError('invalid_request', '발행 권한 요청은 16KiB 이하여야 해요.');
    const result = this.#parse(await this.#request(`/projects/${encodeURIComponent(projectId)}/publishers`, {}, options.signal,
      body, request.granted ? 'PUT' : 'DELETE'), parsePublisherMutationResult);
    if (result.projectId !== projectId || result.issuer !== issuer || result.subject !== subject || result.granted !== request.granted)
      throw new ApiError('contract', '발행 권한 응답이 요청한 계정·프로젝트·상태와 달라요.');
    return result;
  }

  async changeGrant(projectId: string, input: GrantChange, options: { signal?: AbortSignal } = {}): Promise<GrantMutationResult> {
    let change: GrantChange;
    try { change = parseGrantChangeInput(input); }
    catch { throw new ApiError('invalid_request', '발급자·계정 식별자와 권한을 확인해 주세요.'); }
    if (!/^[a-z][a-z0-9-]{0,47}$/.test(projectId)) throw new ApiError('invalid_request', '프로젝트 ID를 확인해 주세요.');
    const { issuer, subject, role, expectedRole, expectedRevision } = change;
    const body = JSON.stringify(role === null ? { issuer, subject, expectedRole, ...(expectedRevision !== undefined ? { expectedRevision } : {}) } : change);
    if (new TextEncoder().encode(body).byteLength > 16384) throw new ApiError('invalid_request', '권한 요청은 16KiB 이하여야 해요.');
    const result = this.#parse(await this.#request(`/projects/${encodeURIComponent(projectId)}/grants`, {}, options.signal,
      body, role === null ? 'DELETE' : 'PUT'), parseGrantMutationResult);
    if (result.projectId !== projectId || result.issuer !== issuer || result.subject !== subject || result.role !== role)
      throw new ApiError('contract', '권한 변경 응답이 요청한 계정·프로젝트·역할과 달라요.');
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
    const hash = await definitionHash(schemaDefinitions(input));
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

  async getCollectionRejections(projectId: string,
    options: { from: string; to: string; signal?: AbortSignal }): Promise<RejectionResponse> {
    const response = this.#parse(await this.#request(`/projects/${encodeURIComponent(projectId)}/collection/rejections`,
      { from: options.from, to: options.to }, options.signal), parseRejectionResponse);
    if (response.meta.projectId !== projectId || response.meta.from !== options.from || response.meta.to !== options.to)
      throw new ApiError('contract', '거부 집계의 프로젝트·기간이 요청과 달라요.');
    return response;
  }

  async getSummary(
    projectId: string,
    options: { schemaVersion: number; from: string; to: string; source?: EventSource; signal?: AbortSignal },
  ): Promise<SummaryResponse> {
    const version = this.#version(options.schemaVersion);
    const source = this.#source(options.source);
    const params = { schemaVersion: version, from: options.from, to: options.to, source: options.source };
    const path = `/projects/${encodeURIComponent(projectId)}/summary`;
    const response = this.#parse(await this.#request(path, params, options.signal), parseSummaryResponse);
    this.#assertMeta(response.meta, { projectId, schemaVersion: version, from: options.from, to: options.to, source });
    return response;
  }

  async getEventDaily(
    projectId: string,
    eventName: string,
    options: { schemaVersion: number; from: string; to: string; source?: EventSource; groupBy?: string; signal?: AbortSignal },
  ): Promise<EventSeriesResponse> {
    const version = this.#version(options.schemaVersion);
    const source = this.#source(options.source);
    const params = {
      schemaVersion: version,
      from: options.from,
      to: options.to,
      groupBy: options.groupBy ? options.groupBy : undefined,
      source: options.source,
    };
    const path = `/projects/${encodeURIComponent(projectId)}/events/${encodeURIComponent(eventName)}/daily`;
    const response = this.#parse(await this.#request(path, params, options.signal), parseEventSeriesResponse);
    this.#assertMeta(response.meta, { projectId, schemaVersion: version, from: options.from, to: options.to, source });
    if (response.eventName !== eventName) throw new ApiError('contract', '응답 이벤트가 요청과 달라요.');
    if ((response.groupBy ?? null) !== (options.groupBy ?? null)) {
      throw new ApiError('contract', '응답 groupBy가 요청과 달라요.');
    }
    return response;
  }

  async getFunnelDaily(projectId: string, funnelId: string,
    options: { schemaVersion: number; from: string; to: string; signal?: AbortSignal }): Promise<FunnelResponse> {
    const version = this.#version(options.schemaVersion);
    const response = this.#parse(await this.#request(`/projects/${encodeURIComponent(projectId)}/funnels/${encodeURIComponent(funnelId)}/daily`,
      { schemaVersion: version, from: options.from, to: options.to }, options.signal), parseFunnelResponse);
    if (response.meta.projectId !== projectId || response.meta.schemaVersion !== version || response.funnelId !== funnelId ||
      response.meta.from !== options.from || response.meta.to !== options.to) throw new ApiError('contract', '퍼널 응답의 프로젝트·버전·기간이 요청과 달라요.');
    return response;
  }

  async getFunnelBreakdown(projectId: string, funnelId: string,
    options: { schemaVersion: number; from: string; to: string; groupBy: string; signal?: AbortSignal }): Promise<FunnelBreakdown> {
    const version = this.#version(options.schemaVersion);
    if (!/^[a-z][a-z0-9_]{0,47}$/.test(options.groupBy)) throw new ApiError('invalid_request', '등록된 퍼널 분류를 선택해 주세요.');
    const result = this.#parse(await this.#request(`/projects/${encodeURIComponent(projectId)}/funnels/${encodeURIComponent(funnelId)}/breakdown`,
      { schemaVersion: version, from: options.from, to: options.to, groupBy: options.groupBy }, options.signal), parseFunnelBreakdown);
    if (result.meta.projectId !== projectId || result.meta.schemaVersion !== version || result.meta.from !== options.from ||
      result.meta.to !== options.to || result.funnelId !== funnelId || result.groupBy !== options.groupBy)
      throw new ApiError('contract', '퍼널 분류 응답이 요청한 프로젝트·버전·기간·분류와 달라요.');
    return result;
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

  #source(source?: EventSource): EventSource {
    if (source !== undefined && source !== 'browser' && source !== 'server') throw new ApiError('invalid_request', '발행 출처를 확인해 주세요.');
    return source ?? 'browser';
  }
  #assertMeta(meta: QueryMeta, expected: { projectId: string; schemaVersion: number; from: string; to: string; source?: EventSource }): void {
    if (
      meta.projectId !== expected.projectId ||
      meta.schemaVersion !== expected.schemaVersion ||
      meta.from !== expected.from ||
      meta.to !== expected.to || meta.source !== (expected.source ?? 'browser')
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

  #request(...args: Parameters<AdminTransport['request']>): Promise<unknown> { return this.#transport.request(...args); }
}
