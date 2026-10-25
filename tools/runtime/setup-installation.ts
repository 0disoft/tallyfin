import { createInterface, type Interface } from 'node:readline/promises';
import { stdin, stderr, stdout } from 'node:process';
import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { secureEndpoint } from '../../apps/admin/src/auth/config.ts';
import { installation, InstallationConfigError } from './installation.ts';
import { writeInstallation } from './write-installation.ts';

export type SetupHost = {
  interactive: boolean;
  signal?: AbortSignal;
  ask: (prompt: string) => Promise<string>;
  inform: (line: string) => void;
  result: (line: string) => void;
};

const workerName = (value: string) => /^[a-z][a-z0-9-]{0,62}$/.test(value);
const endpoint = (value: string) => { try { secureEndpoint(value); return true; } catch { return false; } };
const algorithms = (value: string) => {
  const list = value.split(',');
  return list.length <= 2 && list.every(item => ['RS256', 'ES256'].includes(item)) && new Set(list).size === list.length;
};

/** Collect public configuration only. The existing installation validator remains authoritative. */
export async function installationAnswers(host: Pick<SetupHost, 'ask' | 'inform'>) {
  const answer = async (label: string, valid: (value: string) => boolean, fallback = '') => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const raw = await host.ask(`${label}${fallback ? ` [${fallback}]` : ''}: `);
      if (typeof raw !== 'string' || Buffer.byteLength(raw) > 2048) throw Error('invalid-setup-answer');
      const value = raw.trim() || fallback;
      if (valid(value)) return value;
      host.inform('Invalid value. Check the field format; no files have been written.');
    }
    throw Error('invalid-setup-answer');
  };
  const yes = async (label: string) => (await answer(`${label} (y/n)`, value => value === 'y' || value === 'n', 'n')) === 'y';
  const accountId = await answer('Cloudflare account ID (32 lowercase hex characters)', value => /^[0-9a-f]{32}$/.test(value) && !/^0+$/.test(value));
  const adminOrigin = await answer('Administrator HTTPS origin (no path or trailing slash)', value => {
    try { const url = new URL(value); return endpoint(value) && url.origin === value && !url.port; } catch { return false; }
  });
  const origin = new URL(adminOrigin), workersDev = origin.hostname.endsWith('.workers.dev');
  const adminWorker = await answer('Administrator Worker name', value => workerName(value) &&
    (!workersDev || origin.hostname.startsWith(`${value}.`)));
  const collectorWorker = await answer('Collector Worker name (different from administrator)', value => workerName(value) && value !== adminWorker);
  const databaseName = await answer('D1 database name', value => /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value));
  const databaseId = await answer('D1 database ID (lowercase UUID)', value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) && !/^0+-0+-0+-0+-0+$/.test(value));
  const collectorWorkersDev = await yes('Expose collector on workers.dev');
  let browserIngestLimit: { namespaceId: string; limit: number; period: number } | undefined;
  if (await yes('Enable pre-D1 browser request limiting')) {
    const namespaceId = await answer('Browser limiter namespace ID (unique positive safe integer for this account)',
      value => /^[1-9]\d{0,15}$/.test(value) && Number.isSafeInteger(Number(value)));
    const limit = Number(await answer('Browser limiter requests per project per location and window',
      value => /^[1-9]\d{0,15}$/.test(value) && Number.isSafeInteger(Number(value))));
    const period = Number(await answer('Browser limiter window in seconds (10 or 60)', value => ['10', '60'].includes(value), '60'));
    browserIngestLimit = { namespaceId, limit, period };
    host.inform('This approximate per-location limit counts all browser requests, including preflights and retries. Existing D1 quotas remain in effect.');
  }
  const issuer = await answer('Administrator OIDC issuer (exact HTTPS address)', endpoint);
  const jwksUri = await answer('Administrator access-token JWKS HTTPS address', endpoint);
  const audience = await answer('Administrator API access-token audience', value => !!value);
  const clientId = await answer('Public browser OIDC client ID (never a client secret)', value => !!value);
  const scope = await answer('Browser login scopes', value => /^[\x21-\x7e ]+$/.test(value) && value.split(/ +/).includes('openid'), 'openid');
  const resource = await answer('Browser resource parameter (optional; not inferred from audience)', value => {
    if (!value) return true;
    try { const url = new URL(value); return !url.hash && !url.username && !url.password; } catch { return false; }
  });
  const idTokenAlgorithm = await answer('Browser ID-token algorithm (RS256 or ES256)', value => ['RS256', 'ES256'].includes(value), 'RS256');
  const apiAlgorithms = await answer('Administrator access-token algorithms (comma-separated RS256/ES256)', algorithms, 'RS256');
  const tokenType = await answer('Administrator access-token typ (at+jwt or JWT)', value => ['at+jwt', 'JWT'].includes(value), 'at+jwt');
  const settings: Record<string, string> = { ADMIN_AUTH_MODE: 'oidc', OIDC_ISSUER: issuer, OIDC_AUDIENCE: audience,
    OIDC_JWKS_URI: jwksUri, OIDC_ALGORITHMS: apiAlgorithms, OIDC_TOKEN_TYPE: tokenType };
  if (await yes('Enable separate server publisher authentication')) {
    settings.PUBLISHER_AUTH_MODE = 'oidc';
    settings.PUBLISHER_OIDC_ISSUER = await answer('Publisher OIDC issuer (exact HTTPS address)', endpoint);
    settings.PUBLISHER_OIDC_JWKS_URI = await answer('Publisher access-token JWKS HTTPS address', endpoint);
    settings.PUBLISHER_OIDC_AUDIENCE = await answer('Publisher audience (different from administrator API)', value => !!value && value !== audience);
    settings.PUBLISHER_OIDC_ALGORITHMS = await answer('Publisher access-token algorithms (comma-separated RS256/ES256)', algorithms, 'RS256');
    settings.PUBLISHER_OIDC_TOKEN_TYPE = await answer('Publisher access-token typ (at+jwt or JWT)', value => ['at+jwt', 'JWT'].includes(value), 'at+jwt');
  }
  return {
    adminOrigin,
    admin: { workerName: adminWorker, accountId, collectorWorkerName: collectorWorker, workersDev,
      ...(!workersDev ? { domain: origin.hostname } : {}) },
    collector: { workerName: collectorWorker, accountId, databaseName, databaseId, workersDev: collectorWorkersDev, settings,
      ...(browserIngestLimit ? { browserIngestLimit } : {}) },
    login: { issuer, clientId, scope, idTokenAlgorithm, ...(resource ? { resource } : {}) },
  };
}

export async function runInstallationSetup(argv: string[], host: SetupHost, root: string) {
  if (argv.length === 1 && argv[0] === '--help') {
    host.result('npm run install:setup -- --out <new-directory>\nGuided public configuration on an interactive terminal. Writes the same five local files as install:prepare after review. No login, secret/token request, network, registration, resource creation or deployment. For automation use install:prepare --file.'); return;
  }
  if (argv.length !== 2 || argv[0] !== '--out' || !argv[1] || argv[1].startsWith('--')) throw Error('invalid-setup-arguments');
  if (!host.interactive) throw Error('interactive-terminal-required');
  host.signal?.throwIfAborted();
  const output = resolve(argv[1]);
  try { await lstat(output); throw Error('output-already-exists'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  host.inform('Enter public configuration only. Never enter tokens, passwords or client secrets. No network requests are made.');
  const input = await installationAnswers(host), plan = installation(input, root, output);
  host.inform(JSON.stringify({ administrator: input.adminOrigin, callback: plan.registration.redirectUri,
    administratorWorker: plan.admin.name, collectorWorker: plan.collector.name,
    issuer: plan.registration.issuer, accessTokenAudience: plan.registration.accessToken.audience,
    publisherEnabled: plan.collector.vars.PUBLISHER_AUTH_MODE === 'oidc',
    browserIngestLimit: plan.collector.ratelimits?.[0] ?? null, output }, null, 2));
  const confirmation = await host.ask('Write these five local configuration files? (y/N): ');
  if (confirmation !== 'y') { host.result(JSON.stringify({ prepared: false, cancelled: true, remoteChanges: false })); return; }
  host.result(JSON.stringify(await writeInstallation(input, root, output, host.signal)));
  host.inform('Next: review oidc-registration.json, register the public client with your provider, and use the existing build/check commands. Resource existence and operational login have not been verified.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let terminal: Interface | undefined;
  const controller = new AbortController();
  const stop = () => { controller.abort(); terminal?.close(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const host: SetupHost = { interactive: !!stdin.isTTY && !!stderr.isTTY, signal: controller.signal,
    ask: async prompt => {
      controller.signal.throwIfAborted();
      if (!terminal) {
        terminal = createInterface({ input: stdin, output: stderr, terminal: true });
        terminal.once('close', () => controller.abort());
        terminal.on('SIGINT', stop);
      }
      return terminal.question(prompt, { signal: controller.signal });
    },
    inform: line => { stderr.write(`${line}\n`); }, result: line => { stdout.write(`${line}\n`); },
  };
  runInstallationSetup(process.argv.slice(2), host, fileURLToPath(new URL('../../', import.meta.url)))
    .catch(error => {
      stderr.write(`${JSON.stringify({ code: controller.signal.aborted ? 'installation_setup_cancelled' : 'installation_setup_failed',
        ...(error instanceof InstallationConfigError ? { field: error.field } : {}) })}\n`);
      process.exitCode = controller.signal.aborted ? 130 : 1;
    }).finally(() => { terminal?.close(); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); });
}
