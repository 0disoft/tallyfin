import { REPORT_BYTE_LIMIT, type ObservationReport } from './observation-report.ts';

export type ReportState = { phase: 'idle' | 'loading' | 'ready' | 'error'; report: ObservationReport | null; message: string | null };
export const REPORT_IDLE: ReportState = { phase: 'idle', report: null, message: null };
type ReportWorker = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror'>;
export class ReportReader {
  #worker: ReportWorker | null = null; #timer: ReturnType<typeof setTimeout> | null = null;
  #generation = 0; #destroyed = false; #state = REPORT_IDLE;
  #change: (state: ReportState) => void; #createWorker: () => ReportWorker; #timeout: number;
  constructor(change: (state: ReportState) => void,
    createWorker: () => ReportWorker = () => new Worker(new URL('./observation-worker.ts', import.meta.url), { type: 'module' }),
    timeout = 10000) {
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 10000) throw Error('invalid-report-timeout');
    this.#change = change; this.#createWorker = createWorker; this.#timeout = timeout;
  }
  get state() { return this.#state; }
  #set(state: ReportState) { this.#state = state; this.#change(state); }
  #stop() { if (this.#timer !== null) clearTimeout(this.#timer); this.#timer = null; this.#worker?.terminate(); this.#worker = null; }
  read(file: Pick<File, 'size'>) {
    if (this.#destroyed) return;
    const generation = ++this.#generation; this.#stop();
    const fail = (message: string) => {
      if (generation !== this.#generation || this.#destroyed) return;
      this.#generation++; this.#stop(); this.#set({ phase: 'error', report: null, message });
    };
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > REPORT_BYTE_LIMIT) {
      fail('보고서 파일은 8MiB 이하로 선택해 주세요.'); return;
    }
    this.#set({ phase: 'loading', report: null, message: null });
    try {
      const worker = this.#createWorker(); this.#worker = worker;
      worker.onmessage = event => {
        if (generation !== this.#generation || this.#destroyed) return;
        if (event.data?.ok !== true || !event.data.report) {
          fail('logs:summary가 만든 v2 JSON 보고서를 선택해 주세요. 파일 형식이나 집계 합계를 확인할 수 없어요.'); return;
        }
        this.#generation++; this.#stop(); this.#set({ phase: 'ready', report: event.data.report as ObservationReport, message: null });
      };
      worker.onerror = event => { event.preventDefault(); fail('보고서를 읽지 못했어요. 파일을 다시 선택해 주세요.'); };
      this.#timer = setTimeout(() => fail('보고서를 읽는 시간이 길어졌어요. 파일을 다시 선택해 주세요.'), this.#timeout);
      worker.postMessage(file);
    } catch { fail('보고서를 읽지 못했어요. 이 브라우저의 파일 처리 지원을 확인해 주세요.'); }
  }
  close() { if (this.#destroyed) return; this.#generation++; this.#stop(); this.#set(REPORT_IDLE); }
  destroy() { this.#destroyed = true; this.#generation++; this.#stop(); this.#state = REPORT_IDLE; }
}
