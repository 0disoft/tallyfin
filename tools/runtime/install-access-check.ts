import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Readable } from 'node:stream';
import { closed, PROJECT_ID } from '@tallyfin/core';
import { parseAdminIdentity } from '../../apps/admin/src/api/admin-identity-contract.ts';
import { secureEndpoint } from '../../apps/admin/src/auth/config.ts';
import { preparedInstallation } from './prepared-installation.ts';
import type { installation } from './installation.ts';

type Plan = ReturnType<typeof installation>;
type Check = { id: string; status: 'pass' | 'fail' | 'unknown'; code: string };
const MAX_BYTES = 16384, MAX_TOKEN_BYTES = 8192;
class AccessResponseError extends Error {
  readonly status: Check['status'];
  constructor(status: Check['status'], code: string) { super(code); this.status = status; }
}
function accessToken(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value.length > MAX_TOKEN_BYTES ||
    !/^[A-Za-z0-9._~+/-]+=*$/.test(value) || value !== value.trim()) throw Error('invalid-access-token');
  return value;
}
function projectId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 48 && value === value.trim() && PROJECT_ID.test(value);
}
function projectObserved(value: unknown): boolean {
  if (!closed(value, ['data', 'page']) || !Array.isArray(value.data) || value.data.length > 1 ||
    !closed(value.page, ['limit', 'nextCursor']) || value.page.limit !== 1) throw Error();
  for (const row of value.data) {
    if (!closed(row, ['id', 'name', 'status', 'timeZone']) || !projectId(row.id) ||
      typeof row.name !== 'string' || row.name.length < 1 || row.name.length > 80 ||
      !['active', 'paused'].includes(row.status as string) || typeof row.timeZone !== 'string' ||
      row.timeZone.length < 1 || row.timeZone.length > 64) throw Error();
    new Intl.DateTimeFormat('en', { timeZone: row.timeZone });
  }
  if (value.page.nextCursor !== null && (!projectId(value.page.nextCursor) || value.data.length !== 1 ||
    value.page.nextCursor !== value.data[0].id)) throw Error();
  return value.data.length === 1;
}
async function json(response: Response, signal: AbortSignal): Promise<unknown> {
  const invalid = () => new AccessResponseError('fail', 'api-response-invalid');
  if (!response.body || response.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    await response.body?.cancel(); throw invalid();
  }
  const length = response.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) { await response.body.cancel(); throw invalid(); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const part = await reader.read(); signal.throwIfAborted(); if (part.done) break;
      size += part.value.byteLength; if (size > MAX_BYTES) throw invalid(); chunks.push(part.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw invalid(); }
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Sends an existing administrator access token only to the reviewed admin origin. Three gated reads, no writes or retries. */
export async function checkInstallationAccess(plan: Plan, bearer: string, fetchImpl: typeof fetch = fetch,
  signal: AbortSignal = new AbortController().signal) {
  signal.throwIfAborted();
  let token = accessToken(bearer);
  const origin = plan.registration.browserOrigin;
  secureEndpoint(origin);
  if (new URL(origin).origin !== origin || origin !== plan.loginSettings.origin ||
    plan.registration.issuer !== plan.collector.vars.OIDC_ISSUER) throw Error('invalid-installation-target');
  const checks: Check[] = [];
  let visibleProjectObserved: boolean | null = null;
  const probe = async (id: string, path: '/v1/identity' | '/v1/health' | '/v1/projects?limit=1', validate: (value: unknown) => void) => {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
    try {
      deadline.throwIfAborted();
      const response = await fetchImpl(`${origin}${path}`, { method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, signal: deadline,
        redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
      if (response.status !== 200) {
        await response.body?.cancel();
        throw new AccessResponseError(response.status === 401 || response.status === 403 ? 'fail' : 'unknown',
          response.status === 401 ? 'administrator-authentication-rejected' : response.status === 403 ? 'administrator-access-rejected' : 'api-http-response-unverified');
      }
      const value = await json(response, deadline);
      try { validate(value); } catch (error) {
        if (error instanceof AccessResponseError) throw error;
        throw new AccessResponseError('fail', 'api-response-invalid');
      }
      checks.push({ id, status: 'pass', code: 'authenticated-read-verified' }); return true;
    } catch (error) {
      signal.throwIfAborted();
      checks.push({ id, status: error instanceof AccessResponseError ? error.status : 'unknown',
        code: error instanceof AccessResponseError ? error.message : 'api-response-unverified' }); return false;
    }
  };
  try {
    const identity = await probe('admin-identity', '/v1/identity', value => {
      if (parseAdminIdentity(value).issuer !== plan.registration.issuer)
        throw new AccessResponseError('fail', 'identity-issuer-mismatch');
    });
    let storageRead = false;
    if (identity) storageRead = await probe('admin-storage-read', '/v1/health', value => {
      if (!closed(value, ['status', 'scope']) || value.status !== 'ok' || value.scope !== 'administrator_storage_read')
        throw new AccessResponseError('fail', 'api-response-invalid');
    });
    else checks.push({ id: 'admin-storage-read', status: 'unknown', code: 'identity-check-required' });
    if (storageRead) await probe('project-list', '/v1/projects?limit=1', value => { visibleProjectObserved = projectObserved(value); });
    else checks.push({ id: 'project-list', status: 'unknown', code: identity ? 'storage-check-required' : 'identity-check-required' });
    signal.throwIfAborted();
    return { schemaVersion: 'tallyfin.install-access-check/v2', checkedAt: new Date().toISOString(),
      accessChecksPassed: checks.every(check => check.status === 'pass'), visibleProjectObserved,
      operationalReadinessVerified: false, remoteChanges: false, tokensRequested: false, checks,
      manualRequired: ['actual-browser-login-and-token-renewal', 'initial-owner-or-creator-permissions', 'collection-and-cron', 'backup-and-restore'] };
  } finally { token = ''; }
}

/** Non-interactive stdin only: credentials never become command arguments, files, reports or diagnostic exceptions. */
export async function readAccessToken(stream: Readable & { isTTY?: boolean } = process.stdin,
  signal = AbortSignal.timeout(30000)): Promise<string> {
  if (stream.isTTY) throw Error('token-stdin-required');
  const chunks: Buffer[] = []; let size = 0;
  const abort = () => { stream.destroy(); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    for await (const chunk of stream) {
      signal.throwIfAborted(); const bytes = Buffer.from(chunk); size += bytes.byteLength;
      if (size > MAX_TOKEN_BYTES + 2) throw Error('invalid-access-token'); chunks.push(bytes);
    }
    signal.throwIfAborted();
    const value = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    return accessToken(value.replace(/\r?\n$/, ''));
  } finally {
    signal.removeEventListener('abort', abort); stream.destroy();
    for (const chunk of chunks) chunk.fill(0);
  }
}
export async function runInstallAccessCheckCli(argv: string[], write = (line: string) => process.stdout.write(`${line}\n`),
  options: { readToken?: () => Promise<string>; fetchImpl?: typeof fetch } = {}) {
  if (argv.length === 1 && argv[0] === '--help') {
    write('npm run install:access-check -- --dir <prepared-installation> --token-stdin\nRevalidates installation files before reading one existing access token from non-interactive stdin. Checks identity, administrator storage reads and one project from the reviewed HTTPS admin origin. Stops dependent reads after a failed check. No token issuance, writes, redirect, retry or credential output.'); return true;
  }
  if (argv.length !== 3 || argv[0] !== '--dir' || !argv[1] || argv[1].startsWith('--') || argv[2] !== '--token-stdin')
    throw Error('invalid-install-access-check-arguments');
  const plan = await preparedInstallation(argv[1], fileURLToPath(new URL('../../', import.meta.url)));
  let token = await (options.readToken ?? readAccessToken)();
  try {
    const report = await checkInstallationAccess(plan, token, options.fetchImpl, AbortSignal.timeout(15000));
    write(JSON.stringify(report)); return report.accessChecksPassed;
  } finally { token = ''; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runInstallAccessCheckCli(process.argv.slice(2)).then(passed => { if (!passed) process.exitCode = 1; })
    .catch(() => { console.error(JSON.stringify({ code: 'installation_access_check_failed',
      message: 'Use --help, an unchanged prepared installation and a token supplied through non-interactive stdin.' })); process.exitCode = 1; });
}
