import type { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { ObservationSummary, ObservationSummaryError, SUMMARY_LIMITS } from './observation-summary.ts';

export const SUMMARY_HELP = `node tools/runtime/summarize-observations.ts --stdin
Package alias: npm run --silent logs:summary -- --stdin (PowerShell: npm.cmd).
Read UTF-8 app JSON lines from non-interactive stdin and print a private, bounded aggregate.
No network, credentials, files, mutations or automatic Cloudflare export.
Limits: 8 MiB, 50000 lines, 16 KiB per line, 30 seconds. Platform envelopes are not unpacked.
Observed responses and sampling-weighted request estimates are separate; not exact counts, p95 or SLO.
Use --help for this offline usage text.`;
type CliCode = 'invalid_arguments' | 'stdin_required' | 'input_unavailable' | 'input_timeout' | 'output_unavailable';
export class ObservationCliError extends Error {
  readonly code: CliCode;
  constructor(code: CliCode) { super(code); this.name = 'ObservationCliError'; this.code = code; }
}

/** Consume a single bounded stream; release listeners/timer and stop reading after any failure. */
export function readObservationSummary(input: Readable, timeoutMs = 30000): Promise<ReturnType<ObservationSummary['report']>> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
    return Promise.reject(new ObservationCliError('invalid_arguments'));
  return new Promise((resolve, reject) => {
    const summary = new ObservationSummary(), decoder = new TextDecoder('utf-8', { fatal: true });
    let pending = '', bytes = 0, settled = false;
    const cleanup = () => {
      clearTimeout(timer); input.off('data', data); input.off('end', end);
      input.off('error', error); input.off('close', close); input.pause();
    };
    const fail = (reason: unknown) => {
      if (settled) return; settled = true; cleanup(); input.destroy();
      reject(reason instanceof ObservationSummaryError || reason instanceof ObservationCliError
        ? reason : new ObservationCliError('input_unavailable'));
    };
    const accept = (text: string) => {
      pending += text;
      let start = 0, newline: number;
      while ((newline = pending.indexOf('\n', start)) !== -1) {
        summary.addLine(pending.slice(start, newline)); start = newline + 1;
      }
      pending = pending.slice(start);
      if (Buffer.byteLength(pending, 'utf8') > SUMMARY_LIMITS.lineBytes)
        throw new ObservationSummaryError('input_limit');
    };
    const data = (chunk: Buffer | string) => {
      try {
        bytes += typeof chunk === 'string' ? Buffer.byteLength(chunk, 'utf8') : chunk.byteLength;
        if (bytes > SUMMARY_LIMITS.bytes) throw new ObservationSummaryError('input_limit');
        const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
        let text: string;
        try { text = decoder.decode(buffer, { stream: true }); }
        catch { throw new ObservationSummaryError('invalid_log'); }
        accept(text);
      } catch (reason) { fail(reason); }
    };
    const end = () => {
      try {
        let remaining: string;
        try { remaining = decoder.decode(); } catch { throw new ObservationSummaryError('invalid_log'); }
        accept(remaining);
        if (pending) summary.addLine(pending);
        const report = summary.report(); settled = true; cleanup(); resolve(report);
      } catch (reason) { fail(reason); }
    };
    const error = () => fail(new ObservationCliError('input_unavailable'));
    const close = () => { if (!settled) error(); };
    const timer = setTimeout(() => fail(new ObservationCliError('input_timeout')), timeoutMs);
    input.on('data', data); input.once('end', end); input.once('error', error); input.once('close', close);
    if (input.destroyed || input.readableEnded) error();
    else input.resume();
  });
}

export async function runObservationSummary(args: string[], input: Readable & { isTTY?: boolean } = process.stdin) {
  if (args.length === 1 && args[0] === '--help') return SUMMARY_HELP;
  if (args.length !== 1 || args[0] !== '--stdin') throw new ObservationCliError('invalid_arguments');
  if (input.isTTY) throw new ObservationCliError('stdin_required');
  return JSON.stringify(await readObservationSummary(input));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // A closed output pipe must not turn into an unhandled stack trace.
  process.stdout.on('error', () => { process.exitCode = 1; });
  runObservationSummary(process.argv.slice(2)).then(text => {
    process.stdout.write(text + '\n', error => {
      if (error) { process.stderr.write(JSON.stringify({ code: 'output_unavailable' }) + '\n'); process.exitCode = 1; }
    });
  }).catch(error => {
    process.stderr.write(JSON.stringify({ code: error instanceof ObservationSummaryError || error instanceof ObservationCliError
      ? error.code : 'input_unavailable' }) + '\n');
    process.exitCode = 1;
  });
}
