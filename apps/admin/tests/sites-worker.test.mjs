import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import worker from "../worker/index.js";

test("serves existing static assets without a fallback", async () => {
  const calls = [];
  const response = await worker.fetch(new Request("https://example.test/assets/app.js"), {
    ASSETS: {
      fetch: async (request) => {
        calls.push(new URL(request.url).pathname);
        return new Response("asset", { status: 200 });
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/assets/app.js"]);
});

test("falls back to index.html for an unknown app route", async () => {
  const calls = [];
  const response = await worker.fetch(
    new Request("https://example.test/flow/step-two?source=share", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async (request) => {
          const url = new URL(request.url);
          calls.push(url.pathname + url.search);
          return new Response(url.pathname === "/index.html" ? "app" : "missing", {
            status: url.pathname === "/index.html" ? 200 : 404,
          });
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/flow/step-two?source=share", "/index.html"]);
});

test("does not turn missing API or write requests into the app shell", async () => {
  for (const request of [
    new Request("https://example.test/api/missing", { headers: { accept: "application/json" } }),
    new Request("https://example.test/flow", { method: "POST", headers: { accept: "text/html" } }),
  ]) {
    let calls = 0;
    const response = await worker.fetch(request, {
      ASSETS: {
        fetch: async () => {
          calls += 1;
          return new Response("missing", { status: 404 });
        },
      },
    });

    assert.equal(response.status, 404);
    assert.equal(calls, 1);
  }
});

test("reserves every /v1 API request regardless of Accept, method or colliding assets", async () => {
  for (const method of ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"]) {
    for (const path of ["/v1", "/v1/", "/v1/projects/missing"]) {
      const response = await worker.fetch(new Request("https://example.test" + path, {
        method, headers: { accept: "text/html" },
      }), { ASSETS: { fetch: () => assert.fail("API must not reach static assets") } });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("retry-after"), "5");
      if (method === "HEAD") assert.equal(await response.text(), "");
      else assert.equal((await response.json()).error.code, "admin_api_unavailable");
    }
  }
});

test("streams the original URL, credentials, origin and write body once to the collector", async () => {
  let calls = 0;
  const input = "https://example.test/v1/projects/demo/settings?schemaVersion=1";
  const response = await worker.fetch(new Request(input, {
    method: "PUT", headers: { Authorization: "Bearer unit-test-only", Origin: "https://service.test", "Content-Type": "application/json" },
    body: '{"name":"updated"}',
  }), {
    ASSETS: { fetch: () => assert.fail("API must not reach static assets") },
    COLLECTOR: { fetch: async request => {
      calls++;
      assert.equal(request.url, input);
      assert.equal(request.method, "PUT");
      assert.equal(request.redirect, "manual");
      assert.equal(request.headers.get("authorization"), "Bearer unit-test-only");
      assert.equal(request.headers.get("origin"), "https://service.test");
      assert.equal(await request.text(), '{"name":"updated"}');
      return Response.json({ error: { code: "settings_conflict" } }, { status: 409, headers: { "Retry-After": "12", "X-Request-ID": "unit-request", Vary: "Origin" } });
    } },
  });
  assert.equal(calls, 1);
  assert.equal(response.status, 409);
  assert.equal(response.headers.get("x-request-id"), "unit-request");
  assert.equal(response.headers.get("retry-after"), "12");
  assert.equal(response.headers.get("vary"), "Origin");
  assert.equal((await response.json()).error.code, "settings_conflict");
});

test("preserves collector errors and redirects without replacing them with HTML or retrying", async () => {
  for (const status of [401, 403, 404, 429, 503, 307]) {
    let calls = 0;
    const response = await worker.fetch(new Request("https://example.test/v1/projects", { headers: { accept: "text/html" } }), {
      ASSETS: { fetch: () => assert.fail("API must not reach static assets") },
      COLLECTOR: { fetch: async () => { calls++; return new Response("upstream", { status, headers: { Location: "https://other.test/", "Retry-After": "10" } }); } },
    });
    assert.equal(calls, 1);
    assert.equal(response.status, status);
    assert.equal(await response.text(), "upstream");
  }
});

test("upstream exceptions produce a fixed unavailable error without leaking exception text", async () => {
  let calls = 0;
  const response = await worker.fetch(new Request("https://example.test/v1/projects", { method: "POST", body: "write" }), {
    ASSETS: { fetch: () => assert.fail("API must not reach static assets") },
    COLLECTOR: { fetch: async () => { calls++; throw Error("private upstream diagnostic"); } },
  });
  assert.equal(calls, 1);
  assert.equal(response.status, 503);
  assert.equal(await response.text(), '{"error":{"code":"admin_api_unavailable"}}');
});

test("callback, demo and /v10 stay app routes; missing JS never becomes the app shell", async () => {
  for (const path of ["/auth/callback?error=access_denied", "/demo", "/v10", "/assets/missing.js"]) {
    const calls = [];
    const response = await worker.fetch(new Request("https://example.test" + path, { headers: { accept: "text/html" } }), {
      COLLECTOR: { fetch: () => assert.fail("non-API route must not reach collector") },
      ASSETS: { fetch: async request => { const pathname = new URL(request.url).pathname; calls.push(pathname); return new Response("asset", { status: pathname === "/index.html" ? 200 : 404 }); } },
    });
    assert.equal(response.status, path.startsWith("/assets/") ? 404 : 200);
    if (!path.startsWith("/assets/")) assert.equal(calls.at(-1), "/index.html");
  }
});

test("emits the files required by Sites packaging", async () => {
  await access(new URL("../dist/client/index.html", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../dist/.openai/hosting.json", import.meta.url));
});

test('fallback cancels the discarded asset body on success, exception and cancellation without awaiting cleanup', async () => {
  for (const outcome of ['success', 'throw', 'reject', 'abort']) {
    for (const cleanup of ['resolve', 'reject', 'stall', 'throw']) {
      let calls = 0, canceled = 0;
      const error = outcome === 'abort' ? new DOMException('Canceled', 'AbortError') : Error('fallback failed');
      const assets = { fetch() {
        if (++calls === 1) return { status: 404, body: { cancel() {
          canceled++;
          if (cleanup === 'throw') throw Error('cleanup failed');
          if (cleanup === 'reject') return Promise.reject(Error('cleanup failed'));
          if (cleanup === 'stall') return new Promise(() => {});
          return Promise.resolve();
        } } };
        if (outcome === 'throw') throw error;
        if (outcome !== 'success') return Promise.reject(error);
        return new Response('app');
      } };
      const response = worker.fetch(new Request('https://example.test/deep/link', { headers: { accept: 'text/html' } }), { ASSETS: assets });
      if (outcome === 'success') assert.equal(await (await response).text(), 'app');
      else await assert.rejects(response, failure => failure === error);
      assert.equal(canceled, 1); assert.equal(calls, 2);
    }
  }
});

test('forwarded asset streams are left for the caller to consume or cancel', async () => {
  let canceled = 0;
  const original = new Response(new ReadableStream({ cancel() { canceled++; } }), { status: 404 });
  const response = await worker.fetch(new Request('https://example.test/assets/missing.js'), { ASSETS: { fetch: async () => original } });
  assert.equal(response, original); assert.equal(canceled, 0);
  await response.body.cancel(); assert.equal(canceled, 1);
});
