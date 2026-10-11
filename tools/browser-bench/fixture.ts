import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { runCli } from '../provision/cli.ts';
import { startLocal } from '../runtime/local.ts';
import { DEFAULT_SETTINGS } from '../../apps/collector/src/config.ts';

/** Ephemeral local DB; no administrator HTTP reads or authentication bypass. */
export async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'tallyfin-browser-bench-'));
  let collector: Awaited<ReturnType<typeof startLocal>> | undefined;
  let collectorStopped = false;
  const requests: { bodyBytes: number; status: number; originPresent: boolean; referrerPresent: boolean;
    credentialsPresent: boolean; bodyHash: string; accepted: number; duplicates: number }[] = [];
  const faults: (502 | 'lost-after-commit')[] = [];
  const assets = new Map<string, { content: string | Uint8Array; type: string }>();
  const server = createServer((req, res) => {
    void (async () => {
      res.setHeader('cache-control', 'no-store');
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const asset = assets.get(url.pathname);
      if (asset && req.method === 'GET') {
        res.setHeader('content-type', asset.type); res.end(asset.content); return;
      }
      if (url.pathname !== '/v1/projects/sembom/batches' || req.method !== 'POST') {
        res.writeHead(404); res.end(); return;
      }
      // Only aggregate transport metrics are retained; request bodies are forwarded then discarded.
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 16384) { res.writeHead(413); res.end(); return; }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      const record = { bodyBytes: bytes, status: 0, bodyHash: createHash('sha256').update(body).digest('hex'), accepted: 0, duplicates: 0,
        originPresent: Boolean(req.headers.origin),
        referrerPresent: Boolean(req.headers.referer), credentialsPresent: Boolean(req.headers.cookie || req.headers.authorization) };
      requests.push(record);
      const fault = faults.shift();
      if (fault === 502) { record.status = 502; res.writeHead(502); res.end(); return; }
      try {
        const response = await fetch(`${collector!.url.origin}${url.pathname}`, {
          method: 'POST', body, signal: AbortSignal.timeout(3000),
          headers: { 'content-type': String(req.headers['content-type'] ?? ''), origin: String(req.headers.origin ?? '') },
        });
        const text = await response.text();
        if (response.status === 200) {
          const result = JSON.parse(text); record.accepted = result.accepted; record.duplicates = result.duplicates;
        }
        // Commit first, then lose the HTTP response. The native browser fetch must retry the same events.
        if (fault === 'lost-after-commit') {
          if (response.status !== 200) throw Error('Recovery fixture did not commit');
          res.destroy(); return;
        }
        record.status = response.status;
        res.writeHead(response.status, { 'content-type': 'application/json' });
        res.end(text);
      } catch { record.status = 503; res.writeHead(503); res.end(); }
    })().catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
  });
  async function close() {
    await new Promise<void>(done => { server.close(() => done()); server.closeAllConnections(); });
    try { if (!collectorStopped) await collector?.close(); }
    finally {
      if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw Error('Invalid benchmark temporary directory');
      await rm(directory, { recursive: true, force: true });
    }
  }
  try {
    const bundle = await build({ entryPoints: [fileURLToPath(new URL('./sdk.ts', import.meta.url))], bundle: true,
      write: false, minify: true, format: 'esm', platform: 'browser', target: 'es2022' });
    const sdk = bundle.outputFiles[0]!.contents;
    assets.set('/sdk.mjs', { content: sdk, type: 'text/javascript' });
    assets.set('/page.mjs', { content: await readFile(new URL('./page.mjs', import.meta.url), 'utf8'), type: 'text/javascript' });
    assets.set('/', { content: await readFile(new URL('./page.html', import.meta.url), 'utf8'), type: 'text/html' });
    await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
    const address = server.address(); if (!address || typeof address === 'string') throw Error();
    const origin = `http://127.0.0.1:${address.port}`;
    const registry = JSON.parse(await readFile(new URL('../../api/examples/registry.json', import.meta.url), 'utf8'));
    registry.allowedOrigins = [origin];
    const state = join(directory, 'db'); const file = join(directory, 'registry.json');
    await writeFile(file, JSON.stringify(registry));
    await runCli(['init', '--local', '--state-dir', state, '--apply'], () => true);
    await runCli(['register', '--local', '--state-dir', state, '--file', file, '--allow-local-http', '--apply'], () => true);
    collector = await startLocal(state, { ...DEFAULT_SETTINGS, ALLOW_LOCAL_HTTP: 'true' }, 0);
    return { origin, requests, sdkBytes: sdk.length, sdkGzipBytes: gzipSync(sdk).length,
      recoverNextCollection() { faults.push(502, 'lost-after-commit'); },
      async snapshot() {
        if (collectorStopped) throw Error('Collector already stopped');
        const rows = await collector!.db.batch([
          collector!.db.prepare('SELECT event_name, sum(count) AS count FROM event_daily_counts GROUP BY event_name ORDER BY event_name'),
          collector!.db.prepare('SELECT sum(started_count) AS started, sum(succeeded_count) AS succeeded FROM workflow_daily_counts'),
          collector!.db.prepare('SELECT COUNT(*) AS count FROM event_receipts'),
        ]);
        if (rows.some((row: { success: boolean }) => !row.success)) throw Error('Cannot verify local DB aggregates');
        return { events: rows[0]!.results, workflows: rows[1]!.results, receipts: rows[2]!.results[0]!.count };
      },
      async stopCollector() { if (!collectorStopped) { await collector!.close(); collectorStopped = true; } },
      close,
    };
  } catch (error) { await close(); throw error; }
}
