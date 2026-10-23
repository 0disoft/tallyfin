import { SCHEMA_DRAFT_FILE_LIMIT } from './schema-draft-file.ts';

export const SCHEMA_DRAFT_READ_TIMEOUT_MS = 10_000;
type ReaderOptions = { signal?: AbortSignal; createReader?: () => FileReader; timeoutMs?: number };

/** Own one local read. Never accept lossy text decoding or leave a reader/timer alive after cancellation. */
export function readSchemaDraftFile(file: Blob, { signal, createReader = () => new FileReader(), timeoutMs = SCHEMA_DRAFT_READ_TIMEOUT_MS }: ReaderOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    if (file.size > SCHEMA_DRAFT_FILE_LIMIT) { reject(Error('초안 파일은 128KiB 이하로 선택해 주세요.')); return; }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) { reject(Error('파일 읽기 제한 시간을 확인해 주세요.')); return; }
    const reader = createReader();
    let settled = false, timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: { text: string } | { error: unknown }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reader.onload = reader.onerror = reader.onabort = null;
      try { if (reader.readyState === 1) reader.abort(); }
      catch { /* Cleanup cannot replace the read's result or cancellation reason. */ }
      if ('text' in result) resolve(result.text); else reject(result.error);
    };
    const abort = () => finish({ error: signal!.reason });
    reader.onload = () => {
      try {
        if (!(reader.result instanceof ArrayBuffer) || reader.result.byteLength > SCHEMA_DRAFT_FILE_LIMIT)
          throw Error('초안 파일은 128KiB 이하의 UTF-8 파일이어야 해요.');
        const text = new TextDecoder('utf-8', { fatal: true }).decode(reader.result);
        finish({ text });
      } catch (cause) { finish({ error: Error('초안 파일을 UTF-8로 읽지 못했어요. UTF-8로 저장한 파일을 선택해 주세요.', { cause }) }); }
    };
    reader.onerror = () => finish({ error: Error('초안 파일을 읽지 못했어요. 다시 선택해 주세요.', { cause: reader.error }) });
    reader.onabort = () => finish({ error: Error('초안 파일 읽기가 중단됐어요. 다시 선택해 주세요.') });
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish({ error: Error('파일 읽기 시간이 길어졌어요. 다시 선택해 주세요.') }), timeoutMs);
    try { reader.readAsArrayBuffer(file); }
    catch (cause) { finish({ error: Error('초안 파일을 읽지 못했어요. 다시 선택해 주세요.', { cause }) }); }
  });
}
