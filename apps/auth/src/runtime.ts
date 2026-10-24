import { createAuth } from './auth.ts';
import { loginPage, loginScript, loginStyle } from './pages.ts';
export { MaintenanceClock } from './maintenance.ts';

const cache = new WeakMap<object, ReturnType<typeof createAuth>>();
const reads = new Set(['/api/auth/.well-known/openid-configuration', '/api/auth/.well-known/oauth-authorization-server',
  '/api/auth/jwks', '/api/auth/oauth2/authorize', '/api/auth/get-session']);
const writes = new Set(['/api/auth/sign-in/email', '/api/auth/sign-out', '/api/auth/change-password', '/api/auth/oauth2/token']);
const BODY_LIMIT = 16384;

async function boundedRequest(request: Request, secret: string) {
  const headers = new Headers(request.headers);
  const address = headers.get('cf-connecting-ip') ?? 'unknown';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(address)));
  const pseudoIp = Array.from({ length: 8 }, (_, i) => ((digest[i * 2]! << 8) | digest[i * 2 + 1]!).toString(16)).join(':');
  headers.set('cf-connecting-ip', pseudoIp);
  headers.delete('x-forwarded-for'); headers.delete('x-real-ip');
  if (!request.body) return new Request(request, { headers });
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  const deadline = AbortSignal.any([request.signal, AbortSignal.timeout(10000)]);
  const abort = () => { void reader.cancel().catch(() => {}); };
  deadline.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      deadline.throwIfAborted();
      const next = await reader.read(); deadline.throwIfAborted(); if (next.done) break;
      size += next.value.byteLength;
      if (size > BODY_LIMIT) { await reader.cancel(); throw new RangeError('Request too large'); }
      chunks.push(next.value);
    }
  } finally { deadline.removeEventListener('abort', abort); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new Request(request.url, { method: request.method, headers, body: bytes, redirect: 'manual', signal: request.signal });
}

function secure(response: Response, origin: string | null, adminOrigin: string) {
  const result = new Response(response.body, response);
  result.headers.set('Cache-Control', 'no-store');
  result.headers.set('Referrer-Policy', 'no-referrer');
  result.headers.set('X-Content-Type-Options', 'nosniff');
  result.headers.set('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  if (origin === adminOrigin) {
    result.headers.set('Access-Control-Allow-Origin', origin);
    result.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    result.headers.set('Access-Control-Allow-Headers', 'Content-Type');
    result.headers.append('Vary', 'Origin');
  }
  return result;
}

export default {
  async scheduled(_event, env) {
    // IP pseudonyms are abuse-prevention state, not permanent identity records.
    await env.AUTH_DB.prepare('DELETE FROM rateLimit WHERE lastRequest < ?').bind(Date.now() - 86400000).run();
  },
  async fetch(request, env) {
    const url = new URL(request.url); const origin = request.headers.get('Origin');
    const wrap = (response: Response) => secure(response, origin, env.ADMIN_ORIGIN);
    if (url.origin !== env.AUTH_ORIGIN) return wrap(new Response(null, { status: 400 }));
    if (request.method === 'OPTIONS') return wrap(new Response(null, { status: origin === env.ADMIN_ORIGIN ? 204 : 403 }));
    if (request.method === 'GET') {
      if (url.pathname === '/health') return wrap(Response.json({ status: 'ok', authentication: 'better-auth' }));
      if (url.pathname === '/sign-in') {
        const adminOrigin = new URL(env.ADMIN_ORIGIN);
        if (adminOrigin.protocol !== 'https:' || adminOrigin.origin !== env.ADMIN_ORIGIN) return wrap(new Response(null, { status: 503 }));
        return wrap(new Response(loginPage.replace('<html lang="ko">', `<html lang="ko" data-admin-origin="${adminOrigin.origin}">`), { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
      }
      if (url.pathname === '/login.js') return wrap(new Response(loginScript, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } }));
      if (url.pathname === '/login.css') return wrap(new Response(loginStyle, { headers: { 'Content-Type': 'text/css; charset=utf-8' } }));
    }
    const maintenance = url.pathname === '/maintenance' && ['GET', 'POST'].includes(request.method);
    if (!maintenance && !(request.method === 'GET' && reads.has(url.pathname)) && !(request.method === 'POST' && writes.has(url.pathname)))
      return wrap(new Response(null, { status: 404 }));
    try {
      let auth = cache.get(env);
      if (!auth) {
        auth = createAuth({ database: env.AUTH_DB, origin: env.AUTH_ORIGIN, adminOrigin: env.ADMIN_ORIGIN, secret: env.BETTER_AUTH_SECRET, adminEmail: env.ADMIN_EMAIL });
        cache.set(env, auth);
      }
      if (maintenance) {
        if (request.method === 'POST' && origin !== env.AUTH_ORIGIN) return wrap(new Response(null, { status: 403 }));
        const session = await auth.api.getSession({ headers: request.headers });
        if (session?.user.email.toLowerCase() !== env.ADMIN_EMAIL.toLowerCase()) return wrap(new Response(null, { status: 401 }));
        const clock = env.MAINTENANCE.getByName('installation');
        return wrap(Response.json(await (request.method === 'POST' ? clock.start() : clock.status())));
      }
      return wrap(await auth.handler(await boundedRequest(request, env.BETTER_AUTH_SECRET)));
    } catch (error) {
      if (error instanceof RangeError) return wrap(new Response(null, { status: 413 }));
      console.error(JSON.stringify({ code: 'authentication_unavailable' }));
      return wrap(Response.json({ error: { code: 'authentication_unavailable' } }, { status: 503 }));
    }
  },
} satisfies ExportedHandler<AuthEnv>;
