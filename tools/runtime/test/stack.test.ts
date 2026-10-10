import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { supervise } from '../supervise.ts';
import { runCli } from '../../provision/cli.ts';
import { example } from '../../../packages/storage-d1/test/helpers.ts';

async function freePort() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  await new Promise<void>(resolve => server.close(() => resolve()));
  return address.port;
}
async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'tallyfin-stack-'));
  try { await run(directory); }
  finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  }
}

test('supervisor closes both listeners on shutdown and closes a sibling on unexpected exit', async () => {
  await temporary(async directory => {
    const script = join(directory, 'child.mjs');
    await writeFile(script, `import {createServer} from 'node:http';
      const server=createServer((req,res)=>res.end('ok'));
      server.listen(0,'127.0.0.1',()=>{
        process.send({type:'ready',url:'http://127.0.0.1:'+server.address().port});
        if(process.argv.includes('--fail')) setTimeout(()=>{server.close(()=>process.exit(1));},300);
      });
      process.on('message',m=>{if(m.type==='shutdown')server.close(()=>{process.disconnect();});});
      process.on('disconnect',()=>server.close());`);
    for (const failure of [false, true]) {
      const abort = new AbortController(); let urls: string[] = [];
      const running = supervise([
        { cwd: directory, args: [script, ...(failure ? ['--fail'] : [])] },
        { cwd: directory, args: [script] },
      ], servers => { urls = servers.map(server => server.url); if (!failure) abort.abort(); }, abort.signal);
      if (failure) await assert.rejects(running, /Development server stopped/); else await running;
      assert.equal(urls.length, 2);
      for (const url of urls) await assert.rejects(fetch(url));
    }
    const abort = new AbortController();
    const fail = join(directory, 'failure.mjs');
    await writeFile(fail, 'process.exit(1);');
    await assert.rejects(supervise([
      { cwd: directory, args: [script] }, { cwd: directory, args: [fail] },
    ], () => assert.fail('startup should not complete'), abort.signal), /Development server stopped/);
  });
});

test('one command serves admin, proxies to the initialized collector and shuts down both servers', async () => {
  await temporary(async directory => {
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const state = join(directory, 'state'); const file = join(directory, 'registry.json');
    await writeFile(file, JSON.stringify(example('registry')));
    await runCli(['init', '--local', '--state-dir', state, '--apply'], () => {});
    await runCli(['register', '--local', '--state-dir', state, '--file', file, '--apply'], () => {});
    const adminPort = await freePort(); let collectorPort = await freePort();
    while (collectorPort === adminPort) collectorPort = await freePort();
    const child = spawn(process.execPath, ['tools/runtime/stack.ts', '--local', '--state-dir', state,
      '--admin-port', String(adminPort), '--collector-port', String(collectorPort)],
      { cwd: root, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
    let errors = ''; child.stderr?.on('data', chunk => { errors = (errors + String(chunk)).slice(-8192); });
    const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Stack startup timed out')), 20_000);
      child.on('message', message => { if (message && typeof message === 'object' && 'type' in message && message.type === 'ready') { clearTimeout(timer); resolve(); } });
      void closed.then(() => { clearTimeout(timer); reject(Error(`Stack exited before readiness: ${errors}`)); });
      child.once('error', reject);
    });
    try {
      await ready;
      const admin = `http://127.0.0.1:${adminPort}`;
      const page = await fetch(admin); assert.equal(page.status, 200);
      const pageText = await page.text(); assert.match(pageText, /id="root"/); assert.match(pageText, /Tallyfin · 관리자/);
      const demo = await fetch(`${admin}/demo`); assert.equal(demo.status, 200); assert.match(await demo.text(), /id="root"/);
      const callback = await fetch(`${admin}/auth/callback?error=access_denied`);
      assert.equal(callback.status, 200); assert.match(await callback.text(), /id="root"/);
      const response = await fetch(`${admin}/v1/projects`);
      assert.equal(response.status, 401); assert.match(response.headers.get('content-type') ?? '', /json/);
      assert.equal((await response.json()).error.code, 'unauthorized');
    } finally {
      const fallback = setTimeout(() => child.kill(), 15_000);
      if (child.connected) child.send({ type: 'shutdown' });
      try { await closed; } finally { clearTimeout(fallback); }
    }
    assert.equal(child.exitCode, 0, errors);
    await assert.rejects(fetch(`http://127.0.0.1:${adminPort}`));
    await assert.rejects(fetch(`http://127.0.0.1:${collectorPort}`));
  });
});
