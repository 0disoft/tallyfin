import { ObservationSummary, ObservationSummaryError, SUMMARY_LIMITS } from './observation-summary.ts';

export const TAIL_LIMITS = { envelopeBytes: 256 * 1024, depth: 64, envelopes: 50000 } as const;
const whitespace = (char: string) => char === ' ' || char === '\t' || char === '\r' || char === '\n';
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function observed(value: unknown) {
  return object(value) && (value.event === 'http_request' || value.code === 'retention_cleanup' || value.code === 'retention_cleanup_failed');
}
function invalid(): never { throw new ObservationSummaryError('invalid_log'); }
function limit(): never { throw new ObservationSummaryError('input_limit'); }

/** Frame whitespace-separated JSON objects, including Wrangler's multi-line output.
 * JSON.parse validates the complete frame; strings/escapes cannot close a frame.
 * No envelope metadata reaches the app summary or its serialized report.
 */
export class WranglerTailInput {
  #summary = new ObservationSummary();
  #frame: string[] = []; #stack: string[] = []; #quoted = false; #escaped = false;
  #frameBytes = 0; #frames = 0; #newlines = 0; #lineBytes = 0; #separated = true;

  addText(text: string) {
    for (const char of text) {
      const bytes = Buffer.byteLength(char, 'utf8');
      if (char === '\n') {
        if (++this.#newlines > SUMMARY_LIMITS.lines) limit();
        this.#lineBytes = 0;
      } else if ((this.#lineBytes += bytes) > TAIL_LIMITS.envelopeBytes) limit();
      if (!this.#stack.length) {
        if (whitespace(char)) { this.#separated = true; continue; }
        if (char !== '{' || !this.#separated) invalid();
        if (++this.#frames > TAIL_LIMITS.envelopes) limit();
        this.#stack.push('}'); this.#frame = ['{']; this.#frameBytes = 1;
        this.#separated = false; continue;
      }
      if ((this.#frameBytes += bytes) > TAIL_LIMITS.envelopeBytes) limit();
      this.#frame.push(char);
      if (this.#quoted) {
        if (this.#escaped) this.#escaped = false;
        else if (char === '\\') this.#escaped = true;
        else if (char === '"') this.#quoted = false;
      } else if (char === '"') this.#quoted = true;
      else if (char === '{' || char === '[') {
        if (this.#stack.length >= TAIL_LIMITS.depth) limit();
        this.#stack.push(char === '{' ? '}' : ']');
      } else if (char === '}' || char === ']') {
        if (this.#stack.pop() !== char) invalid();
        if (!this.#stack.length) {
          this.#accept(this.#frame.join('')); this.#frame = []; this.#frameBytes = 0;
        }
      }
    }
  }

  #accept(text: string) {
    let envelope: unknown;
    try { envelope = JSON.parse(text); } catch { invalid(); }
    if (!object(envelope) || !Array.isArray(envelope.logs)) invalid();
    for (const log of envelope.logs) {
      if (!object(log) || !Array.isArray(log.message)) invalid();
      let appLine: string | undefined;
      for (const argument of log.message) {
        // The collector logs one JSON string. Object or multi-argument app
        // records are refused rather than silently dropping a known observation.
        if (observed(argument)) invalid();
        if (typeof argument !== 'string' || !argument.trimStart().startsWith('{')) continue;
        let value: unknown;
        try { value = JSON.parse(argument); } catch { invalid(); }
        if (observed(value)) {
          if (log.message.length !== 1) invalid();
          appLine = argument;
        }
      }
      // One placeholder per unrelated console entry, never its private text.
      this.#summary.addLine(appLine ?? '{}');
    }
  }

  report() {
    if (this.#stack.length || this.#quoted) invalid();
    if (this.#lineBytes && this.#newlines >= SUMMARY_LIMITS.lines) limit();
    return this.#summary.report();
  }
}
