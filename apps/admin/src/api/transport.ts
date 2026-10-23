import { ApiError, KIND_MESSAGE, STATUS_KIND, responseApiError } from './api-error.ts';
import { awaitRequest } from './request-lifecycle.ts';
import { readResponseJson } from './response-body.ts';
import { createReadScheduler, type ReadLease } from './read-scheduler.ts';

export const API_BASE_PATH = '/v1';

export type AdminTransportOptions = { token?: string; getBearer?: () => Promise<string>; onDestroy?: () => void; basePath?: string; fetchImpl?: FetchLike; requestTimeoutMs?: number; maxConcurrentReads?: number;
    onAnalyticsAccessDenied?: (projectId: string, error: ApiError) => void };
export type FetchOption = {
  method?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  credentials?: 'omit';
  cache?: 'no-store';
  referrerPolicy?: 'no-referrer';
  redirect?: 'error';
  body?: string;
};

type FetchResponse = {
  ok: boolean; status: number; json: () => Promise<unknown>;
  body?: ReadableStream<Uint8Array> | null;
};

export type FetchLike = (
  input: string,
  init?: FetchOption,
) => Promise<FetchResponse>;

async function defaultFetch(input: string, init?: FetchOption): Promise<FetchResponse> {
  // Invoke fetch as a property of globalThis so the receiver is the global
  // object, not this transport instance (browsers reject that with
  // "Illegal invocation").
  const response = await globalThis.fetch(input, init as RequestInit);
  return { ok: response.ok, status: response.status, body: response.body, json: () => readResponseJson(response, init?.signal) };
}

export class AdminTransport {
  #token = '';
  #basePath: string;
  #fetch: FetchLike;
  #controllers = new Set<AbortController>();
  #destroyed = false;
  #getBearer: (() => Promise<string>) | undefined;
  #onDestroy: (() => void) | undefined;
  #requestTimeoutMs: number;
  #readSlot: ReturnType<typeof createReadScheduler>;
  #onAnalyticsAccessDenied: ((projectId: string, error: ApiError) => void) | undefined;

  constructor(options: AdminTransportOptions = {}) {
    const basePath = options.basePath ?? API_BASE_PATH;
    if (basePath !== API_BASE_PATH) {
      throw new ApiError('invalid_request', `같은 출처의 ${API_BASE_PATH} 경로만 사용할 수 있어요.`);
    }
    const requestTimeoutMs = options.requestTimeoutMs ?? 15000;
    if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 10 || requestTimeoutMs > 120000) {
      throw new ApiError('invalid_request', '요청 대기 시간은 10~120000밀리초의 정수여야 해요.');
    }
    this.#requestTimeoutMs = requestTimeoutMs;
    this.#readSlot = createReadScheduler(options.maxConcurrentReads);
    this.#onAnalyticsAccessDenied = options.onAnalyticsAccessDenied;
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
    return '[AdminTransport]';
  }

  toJSON(): string {
    return '[AdminTransport]';
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#token = '';
    this.#destroyed = true;
    for (const controller of this.#controllers) controller.abort();
    this.#controllers.clear();
    this.#getBearer = undefined;
    const onDestroy = this.#onDestroy;
    this.#onDestroy = undefined;
    this.#onAnalyticsAccessDenied = undefined;
    onDestroy?.();
  }

  notifyAccessDenied(projectId: string, error: ApiError) {
    try { this.#onAnalyticsAccessDenied?.(projectId, error); }
    catch { /* An observer cannot replace a confirmed server result. */ }
  }

  async request(
    path: string,
    params: Record<string, string | number | undefined> = {},
    signal?: AbortSignal,
    body?: string,
    method?: 'POST' | 'PUT' | 'DELETE',
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
    const forward = () => controller.abort(signal?.reason);
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener('abort', forward, { once: true });
    }
    this.#controllers.add(controller);
    const deadline = performance.now() + this.#requestTimeoutMs;
    // A blocked event loop can settle a credential/body promise before its timer runs.
    const enforceDeadline = () => {
      if (!controller.signal.aborted && performance.now() >= deadline)
        controller.abort(new ApiError('timeout', KIND_MESSAGE.timeout));
    };
    const checkRequest = () => { enforceDeadline(); controller.signal.throwIfAborted(); };
    const timeout = setTimeout(() => controller.abort(new ApiError('timeout', KIND_MESSAGE.timeout)), this.#requestTimeoutMs);
    let observedStatus: number | undefined;
    let response: FetchResponse | undefined, discarded = false;
    const discardResponse = () => {
      if (discarded || !response?.body) return;
      discarded = true;
      try { void response.body.cancel().catch(() => {}); } catch { /* Cleanup cannot replace or delay the result. */ }
    };
    let lease: ReadLease | undefined;
    const track = <T>(operation: () => Promise<T>) => lease ? lease.track(operation) : operation();
    let notified = false;
    const notifyDenial = (error: ApiError) => {
      // Owner-only settings/grant failures do not revoke reader access to analytics.
      const match = body === undefined && !method && path.match(/^\/projects\/([a-z][a-z0-9-]{0,47})\/(?:schemas\/[0-9]+|summary|(?:events|workflows|funnels)\/[^/]+\/(?:daily|breakdown))$/);
      const targets = path === '/overview' && typeof params.projectIds === 'string' ? params.projectIds.split(',') : match ? [match[1]!] : [];
      if (!targets.length || notified || signal?.aborted || this.#destroyed) return;
      notified = true;
      for (const id of targets) this.notifyAccessDenied(id, error);
    };
    try {
      checkRequest();
      if (body === undefined && !method) {
        try {
          const slot = this.#readSlot(controller.signal);
          lease = slot instanceof Promise ? await slot : slot;
        }
        catch (cause) { checkRequest(); throw new ApiError('network', KIND_MESSAGE.network, { cause }); }
        checkRequest();
      }
      let bearer = this.#token;
      if (this.#getBearer) {
        try {
          const getBearer = this.#getBearer;
          // Cancelling this request must not cancel a refresh shared by others.
          bearer = await awaitRequest(controller.signal, () => Promise.resolve().then(getBearer));
          if (!bearer) throw new Error();
        }
        catch (cause) {
          checkRequest();
          throw new ApiError('unauthorized', KIND_MESSAGE.unauthorized, { status: 401, cause });
        }
      }
      checkRequest();
      if (bearer) headers.Authorization = `Bearer ${bearer}`;
      let received: FetchResponse;
      try {
        received = await awaitRequest(controller.signal, () => track(() => this.#fetch(url, {
          method: method ?? (body === undefined ? 'GET' : 'PATCH'),
          ...(body === undefined ? {} : { body }),
          headers,
          signal: controller.signal,
          credentials: 'omit',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
          // An API redirect must not replay credentials or a mutation at another route.
          redirect: 'error',
        }).then(value => {
          response = value;
          // A transport can ignore abort and settle after this request's finally.
          if (controller.signal.aborted) discardResponse();
          return value;
        })));
      } catch (error) {
        if (controller.signal.aborted || (error as { name?: string })?.name === 'AbortError') throw error;
        throw new ApiError('network', KIND_MESSAGE.network, { cause: error });
      }
      observedStatus = received.status;
      checkRequest();
      // The status alone confirms denial; do not retain data while its body stalls.
      if (observedStatus === 401 || observedStatus === 403) {
        const kind = STATUS_KIND[observedStatus]!;
        notifyDenial(new ApiError(kind, KIND_MESSAGE[kind], { status: observedStatus }));
      }
      if (!received.ok) throw await awaitRequest(controller.signal, () => track(() => responseApiError(received)));
      try {
        const result = await awaitRequest(controller.signal, () => track(() => received.json()));
        checkRequest();
        return result;
      } catch (error) {
        if (controller.signal.aborted || (error as { name?: string })?.name === 'AbortError') throw error;
        throw new ApiError('contract', 'API 응답을 JSON으로 읽지 못했어요.', { cause: error });
      }
    } catch (error) {
      enforceDeadline();
      // A stalled error body must not turn an observed access denial into a
      // recoverable network error that leaves privileged data on screen.
      if (controller.signal.reason instanceof ApiError && controller.signal.reason.kind === 'timeout' &&
        (observedStatus === 401 || observedStatus === 403)) {
        const kind = STATUS_KIND[observedStatus]!;
        const denial = new ApiError(kind, KIND_MESSAGE[kind], { status: observedStatus });
        notifyDenial(denial);
        throw denial;
      }
      controller.signal.throwIfAborted();
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) notifyDenial(error);
      throw error;
    } finally {
      discardResponse();
      lease?.close();
      clearTimeout(timeout);
      // Keep the controller registered until the body is read so destroy()
      // can abort an in-flight body stream too.
      this.#controllers.delete(controller);
      signal?.removeEventListener('abort', forward);
    }
  }

}
