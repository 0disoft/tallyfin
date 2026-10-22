export type Value = string | boolean | number;
export type Properties = Readonly<Record<string, Value>>;
/** Compact build-time projection of a reviewed registry. No labels, purposes or server definitions. */
export type Rule = readonly ['boolean', boolean] | readonly ['enum', boolean, readonly string[]] |
  readonly ['integer', boolean, number, number];
export interface BrowserSchema {
  version: number;
  events: Readonly<Record<string, Readonly<Record<string, Rule>>>>;
  workflows: Readonly<Record<string, { start: string; success: string; failure?: string; dimensions: readonly string[] }>>;
}
export interface BrowserOptions { endpoint: string; schema: BrowserSchema; allowLocalHttp?: boolean; enabled?: boolean }
export interface AttemptHandle {
  succeed(properties?: Properties): boolean;
  fail(properties?: Properties): boolean;
  cancel(): void;
}
export interface BrowserClient {
  track(name: string, properties?: Properties): boolean;
  start(workflow: string, properties?: Properties): AttemptHandle | undefined;
  /** Schedule delivery without making the caller await network I/O. */
  flush(): void;
  /** Drop in-memory events, abort pending I/O and remove the visibility listener. */
  destroy(): void;
  /** Queue depth, including in-flight/retry events; never a delivered-event count. */
  readonly pending: number;
}
/** Optional host port used for deterministic tests or explicit browser adapters. */
export interface BrowserPlatform {
  now(): number;
  /** Elapsed time for retry budgets. Legacy hosts may omit this and retain their now() clock. */
  monotonicNow?(): number;
  /** Retry jitter sample in [0,1). Legacy injected hosts default to zero jitter. */
  random?(): number;
  uuid(): string;
  timer(callback: () => void, milliseconds: number): () => void;
  send(endpoint: string, body: string, signal: AbortSignal): Promise<{ status: number; retryAfter: string | null }>;
  beacon?(endpoint: string, body: string): boolean;
  onHidden?(callback: () => void): () => void;
}
