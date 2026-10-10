import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer as httpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { collectorOrigin, collectorProxy } from '../scripts/local-proxy.mjs';

test('local proxy preserves path, query and headers while the login callback stays in the SPA', async () => {
  for (const value of ['https://127.0.0.1:5188', 'http://remote.example.invalid',
    'http://127.0.0.1:5188/path', 'http://127.0.0.1:5188?value=private']) assert.throws(() => collectorOrigin(value));
  const upstream = httpServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ path: req.url, marker: req.headers['x-tallyfin-test'], origin: req.headers.origin }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  let server;
  try {
    const target = `http://127.0.0.1:${upstream.address().port}`;
    const root = fileURLToPath(new URL('../', import.meta.url));
    server = await createServer({ root, configFile: fileURLToPath(new URL('../vite.config.mjs', import.meta.url)),
      server: { host: '127.0.0.1', port: 0, strictPort: true, proxy: collectorProxy(target) }, logLevel: 'silent' });
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    const response = await fetch(`${origin}/v1/projects?limit=2`, { headers: { 'x-tallyfin-test': 'forwarded', Origin: origin } });
    assert.deepEqual(await response.json(), { path: '/v1/projects?limit=2', marker: 'forwarded', origin });
    for (const path of ['/auth/callback?error=access_denied', '/v10']) {
      const page = await fetch(`${origin}${path}`); assert.equal(page.status, 200); assert.match(await page.text(), /id="root"/);
    }
  } finally {
    await server?.close();
    await new Promise(resolve => upstream.close(resolve));
  }
});
