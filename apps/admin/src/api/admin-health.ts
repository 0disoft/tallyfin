import { ApiError, type ApiClient } from './client.ts';
import { parseAdminHealth } from './admin-health-contract.ts';

export type HealthState = { phase: 'idle' | 'loading' | 'ready' | 'error'; checkedAt: string | null; message: string | null };
export const HEALTH_IDLE: HealthState = { phase: 'idle', checkedAt: null, message: null };
function failure(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.kind === 'unauthorized' || error.kind === 'forbidden') return '관리자 인증과 접근 권한을 확인해 주세요.';
    if (error.kind === 'storage_unavailable') return '저장소 읽기를 확인하지 못했어요. 서버 연결과 검사 설정을 확인해 주세요.';
    if (error.kind === 'not_found') return '이 서버에는 읽기 검사 경로가 없어요. 서버 버전을 확인해 주세요.';
    if (error.kind === 'contract') return '읽기 검사 응답이 예상한 형식과 달라요. 서버 버전을 확인해 주세요.';
  }
  return '저장소 읽기를 확인하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.';
}

/** Explicit checks only; results are cleared before every request and after closing or disposal. */
export class HealthReader {
  #client: Pick<ApiClient, 'getHealth'>;
  #change: (state: HealthState) => void;
  #state = HEALTH_IDLE;
  #controller: AbortController | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #generation = 0;
  #destroyed = false;
  #timeoutMs: number;
  constructor(client: Pick<ApiClient, 'getHealth'>, change: (state: HealthState) => void, timeoutMs = 5000) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) throw Error('invalid-health-timeout');
    this.#client = client; this.#change = change; this.#timeoutMs = timeoutMs;
  }
  get state() { return this.#state; }
  #set(value: HealthState) { this.#state = value; this.#change(value); }
  #stop() { if (this.#timer !== null) clearTimeout(this.#timer); this.#timer = null; this.#controller?.abort(); this.#controller = null; }
  async open() {
    if (this.#destroyed || this.#state.phase === 'loading') return;
    const generation = ++this.#generation;
    const controller = new AbortController(); this.#controller = controller;
    this.#set({ phase: 'loading', checkedAt: null, message: null });
    this.#timer = setTimeout(() => {
      if (this.#destroyed || generation !== this.#generation) return;
      this.#generation++; this.#stop();
      this.#set({ phase: 'error', checkedAt: null, message: '응답을 기다리는 시간이 길어졌어요. 연결 상태를 확인하고 다시 시도해 주세요.' });
    }, this.#timeoutMs);
    try {
      parseAdminHealth(await this.#client.getHealth({ signal: controller.signal }));
      if (!this.#destroyed && !controller.signal.aborted && generation === this.#generation)
        this.#set({ phase: 'ready', checkedAt: new Date().toISOString(), message: null });
    } catch (error) {
      if (!this.#destroyed && !controller.signal.aborted && generation === this.#generation)
        this.#set({ phase: 'error', checkedAt: null, message: failure(error) });
    } finally {
      if (this.#controller === controller) { if (this.#timer !== null) clearTimeout(this.#timer); this.#timer = null; this.#controller = null; }
    }
  }
  close() { if (this.#destroyed) return; this.#generation++; this.#stop(); this.#set(HEALTH_IDLE); }
  destroy() { this.#destroyed = true; this.#generation++; this.#stop(); this.#state = HEALTH_IDLE; }
}
