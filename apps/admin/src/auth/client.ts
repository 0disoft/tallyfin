import * as oauth from 'oauth4webapi';
import { secureEndpoint, type LoginConfig } from './config.ts';
import { awaitRequest } from '../api/request-lifecycle.ts';

export const TRANSACTION_KEY = 'tallyfin.oidc.transaction.v1';
const TRANSACTION_TTL = 10 * 60 * 1000;
const REQUEST_TIMEOUT = 10000;
const BODY_LIMIT = 65536;
interface Transaction { state: string; nonce: string; verifier: string; createdAt: number; config: string }
export interface LoginStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
interface Tokens { access: string; refresh?: string; expiresAt: number; refreshAt: number; subject: string }

export class LoginError extends Error {
  constructor(options?: ErrorOptions) { super('로그인을 완료하지 못했어요. 제공자 설정을 확인한 뒤 다시 로그인해 주세요.', options); this.name = 'LoginError'; }
}

/** Public-client OIDC: tokens never enter browser storage, URLs, or serialized objects. */
export class BrowserLogin {
  #config: LoginConfig;
  #fingerprint: string;
  #client: oauth.Client;
  #storage: LoginStorage;
  #fetch: typeof fetch;
  #abort = new AbortController();
  #server?: oauth.AuthorizationServer;
  #discovery?: Promise<oauth.AuthorizationServer>;
  #callback?: Promise<void>;
  #refreshing?: Promise<void>;
  #tokens?: Tokens;
  #jwks: oauth.JWKSCacheInput = {};
  #destroyed = false;

  constructor(config: LoginConfig, storage: LoginStorage, fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init)) {
    secureEndpoint(config.issuer);
    this.#config = { ...config };
    this.#fingerprint = JSON.stringify(config);
    this.#client = { client_id: config.clientId, id_token_signed_response_alg: config.idTokenAlgorithm };
    this.#storage = storage;
    this.#fetch = fetchImpl;
  }
  get destroyed(): boolean { return this.#destroyed; }
  toJSON(): string { return '[BrowserLogin]'; }
  toString(): string { return '[BrowserLogin]'; }

  async begin(): Promise<string> {
    try {
      this.#assertActive();
      const server = await this.#metadata();
      const verifier = oauth.generateRandomCodeVerifier();
      const state = oauth.generateRandomState();
      const nonce = oauth.generateRandomNonce();
      const challenge = await oauth.calculatePKCECodeChallenge(verifier);
      this.#assertActive();
      const url = new URL(server.authorization_endpoint!);
      for (const [name, value] of Object.entries({ client_id: this.#client.client_id, redirect_uri: this.#config.redirectUri,
        response_type: 'code', response_mode: 'query', scope: this.#config.scope, state, nonce,
        code_challenge: challenge, code_challenge_method: 'S256', ...(this.#config.resource ? { resource: this.#config.resource } : {}) }))
        url.searchParams.set(name, value);
      // This is the sole storage write: one-use verifier/state/nonce, never tokens.
      this.#storage.setItem(TRANSACTION_KEY, JSON.stringify({ state, nonce, verifier, createdAt: Date.now(), config: this.#fingerprint }));
      return url.href;
    } catch (cause) { throw new LoginError({ cause }); }
  }

  /** Single-flight avoids replaying the authorization code in React StrictMode. */
  complete(callback: URL): Promise<void> {
    return this.#callback ??= this.#complete(callback);
  }
  async #complete(callback: URL): Promise<void> {
    try {
      this.#assertActive();
      const raw = this.#storage.getItem(TRANSACTION_KEY);
      this.#storage.removeItem(TRANSACTION_KEY); // Consume before any await or network operation.
      if (!raw || raw.length > 8192) throw new LoginError();
      const tx: Transaction = JSON.parse(raw);
      const expected = new URL(this.#config.redirectUri);
      if (callback.origin !== expected.origin || callback.pathname !== expected.pathname || callback.hash ||
        tx.config !== this.#fingerprint || !Number.isFinite(tx.createdAt) || Date.now() < tx.createdAt ||
        Date.now() - tx.createdAt > TRANSACTION_TTL ||
        ![tx.state, tx.nonce, tx.verifier].every(value => typeof value === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(value)))
        throw new LoginError();
      const server = await this.#metadata();
      const params = oauth.validateAuthResponse(server, this.#client, callback, tx.state);
      const response = await oauth.authorizationCodeGrantRequest(server, this.#client, oauth.None(), params,
        this.#config.redirectUri, tx.verifier, this.#requestOptions());
      const result = await oauth.processAuthorizationCodeResponse(server, this.#client, response,
        { expectedNonce: tx.nonce, requireIdToken: true });
      await oauth.validateApplicationLevelSignature(server, response, this.#signatureOptions());
      const subject = oauth.getValidatedIdTokenClaims(result)?.sub;
      if (!subject) throw new LoginError();
      this.#assertActive();
      this.#accept(result, subject);
    } catch (cause) { this.#tokens = undefined; throw new LoginError({ cause }); }
  }

  async getAccessToken(): Promise<string> {
    try {
      this.#assertActive();
      if (!this.#tokens) throw new LoginError();
      if (Date.now() >= this.#tokens.refreshAt) {
        if (!this.#tokens.refresh) {
          if (Date.now() >= this.#tokens.expiresAt) throw new LoginError();
        } else {
          if (!this.#refreshing) this.#refreshing = this.#refresh().finally(() => { this.#refreshing = undefined; });
          await this.#refreshing;
        }
      }
      this.#assertActive();
      if (!this.#tokens || Date.now() >= this.#tokens.expiresAt) throw new LoginError();
      return this.#tokens.access;
    } catch (cause) { this.#tokens = undefined; throw new LoginError({ cause }); }
  }

  async #refresh(): Promise<void> {
    const previous = this.#tokens!;
    const server = await this.#metadata();
    const response = await oauth.refreshTokenGrantRequest(server, this.#client, oauth.None(), previous.refresh!, this.#requestOptions());
    const result = await oauth.processRefreshTokenResponse(server, this.#client, response);
    // Browser refresh tokens must rotate; a failed/ambiguous refresh is never replayed.
    if (!result.refresh_token || result.refresh_token === previous.refresh) throw new LoginError();
    if (result.id_token) {
      await oauth.validateApplicationLevelSignature(server, response, this.#signatureOptions());
      if (oauth.getValidatedIdTokenClaims(result)?.sub !== previous.subject) throw new LoginError();
    }
    this.#assertActive();
    this.#accept(result, previous.subject);
  }
  #accept(result: oauth.TokenEndpointResponse, subject: string): void {
    if (result.token_type !== 'bearer' || !result.access_token || result.access_token.length > 8185 ||
      typeof result.expires_in !== 'number' || !Number.isFinite(result.expires_in) || result.expires_in <= 0 || result.expires_in > 86400 ||
      (result.refresh_token !== undefined && (!result.refresh_token || result.refresh_token.length > 8192))) throw new LoginError();
    const ttl = result.expires_in * 1000;
    this.#tokens = { access: result.access_token, expiresAt: Date.now() + ttl, refreshAt: Date.now() + ttl - Math.min(30000, ttl / 10),
      subject, ...(result.refresh_token ? { refresh: result.refresh_token } : {}) };
  }
  destroy(): void {
    this.#destroyed = true;
    this.#abort.abort();
    this.#tokens = undefined;
    this.#jwks = {};
    try { this.#storage.removeItem(TRANSACTION_KEY); } catch { /* Tokens are already cleared. */ }
  }
  #assertActive(): void { if (this.#destroyed) throw new LoginError(); }
  #requestOptions(): oauth.TokenEndpointRequestOptions {
    return { signal: this.#abort.signal, [oauth.customFetch]: this.#transport,
      ...(this.#config.resource ? { additionalParameters: { resource: this.#config.resource } } : {}) };
  }
  #signatureOptions(): oauth.ValidateSignatureOptions {
    return { signal: this.#abort.signal, [oauth.customFetch]: this.#transport, [oauth.jwksCache]: this.#jwks };
  }
  #metadata(): Promise<oauth.AuthorizationServer> {
    return this.#discovery ??= (async () => {
      const response = await oauth.discoveryRequest(new URL(this.#config.issuer),
        { signal: this.#abort.signal, [oauth.customFetch]: this.#transport });
      const server = await oauth.processDiscoveryResponse(new URL(this.#config.issuer), response);
      for (const endpoint of [server.authorization_endpoint, server.token_endpoint, server.jwks_uri]) {
        if (!endpoint) throw new LoginError();
        secureEndpoint(endpoint);
      }
      if (!server.code_challenge_methods_supported?.includes('S256')) throw new LoginError();
      this.#assertActive();
      this.#server = server;
      return server;
    })().catch(cause => { this.#discovery = undefined; throw new LoginError({ cause }); });
  }
  #transport: typeof fetch = async (input, init) => {
    secureEndpoint(String(input));
    const signal = AbortSignal.any([this.#abort.signal, AbortSignal.timeout(REQUEST_TIMEOUT), ...(init?.signal ? [init.signal] : [])]);
    const response = await awaitRequest(signal, async () => {
      const value = await this.#fetch(input, { ...init, signal, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
      if (signal.aborted) { discard(value.body); signal.throwIfAborted(); }
      return value;
    });
    if (!response.body) return response;
    const reader = response.body.getReader();
    const cancel = () => { try { void reader.cancel().catch(() => {}); } catch { /* Cleanup cannot replace the login result. */ } };
    signal.addEventListener('abort', cancel, { once: true });
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      signal.throwIfAborted();
      while (true) {
        const { done, value } = await awaitRequest(signal, () => reader.read());
        signal.throwIfAborted();
        if (done) break;
        size += value.length;
        if (size > BODY_LIMIT) throw new LoginError();
        chunks.push(value);
      }
      const body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
      return new Response(body, { status: response.status, headers: response.headers });
    } finally { signal.removeEventListener('abort', cancel); cancel(); reader.releaseLock(); }
  };
}

function discard(body: ReadableStream<Uint8Array> | null): void {
  try { void body?.cancel().catch(() => {}); } catch { /* Late responses have no remaining consumer. */ }
}
