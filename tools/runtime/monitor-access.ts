import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { preparedInstallation } from './prepared-installation.ts';
import { checkInstallationAccess, readAccessToken } from './install-access-check.ts';
import { advanceAccessMonitor, monitorPolicy, monitorState } from './access-monitor.ts';
import { withMonitorFile } from './access-monitor-file.ts';
import { awaitRequest } from '../../apps/admin/src/api/request-lifecycle.ts';

const HELP = 'npm run monitor:access -- --dir <prepared-installation> --state <local-state.json> --failure-threshold <1..100> --recovery-threshold <1..100> --max-gap-seconds <1..86400> --token-stdin\nOne authenticated read check per invocation. Validates installation and monitor state before reading a fresh existing token from non-interactive stdin. Emits fixed diagnostics and notification intent only. No token issuance, scheduler, notification delivery or remote writes. Exit 0: verified access with no open incident; 1: attention required; 2: input/state/tool failure.';
export async function runAccessMonitorCli(argv: string[], write = (line: string) => { process.stdout.write(line + '\n'); },
  options: { readToken?: () => Promise<string>; fetchImpl?: typeof fetch; now?: () => number; signal?: AbortSignal } = {}): Promise<number> {
  if (argv.length === 1 && argv[0] === '--help') { write(HELP); return 0; }
  const signal = options.signal ?? new AbortController().signal;
  signal.throwIfAborted();
  const values = new Map<string, string>(); let stdin = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (flag === '--token-stdin' && !stdin) { stdin = true; continue; }
    if (!['--dir', '--state', '--failure-threshold', '--recovery-threshold', '--max-gap-seconds'].includes(flag) ||
      values.has(flag) || !argv[i + 1] || argv[i + 1]!.startsWith('--')) throw Error('invalid-monitor-arguments');
    values.set(flag, argv[++i]!);
  }
  if (!stdin || values.size !== 5) throw Error('invalid-monitor-arguments');
  const number = (flag: string) => { const value = values.get(flag)!; if (!/^[1-9]\d*$/.test(value)) throw Error('invalid-monitor-policy'); return Number(value); };
  const policy = monitorPolicy({ failureThreshold: number('--failure-threshold'), recoveryThreshold: number('--recovery-threshold'), maxGapSeconds: number('--max-gap-seconds') });
  const directory = values.get('--dir')!, statePath = resolve(values.get('--state')!);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const plan = await preparedInstallation(directory, root);
  if (['installation.json', 'admin.wrangler.json', 'collector.wrangler.json', 'admin-login.json', 'oidc-registration.json']
    .some(name => resolve(directory, name).toLowerCase() === statePath.toLowerCase())) throw Error('invalid-monitor-state-path');
  const target = createHash('sha256').update(JSON.stringify([plan.registration, plan.admin.account_id,
    plan.collector.name, plan.collector.d1_databases[0]!.database_id])).digest('hex');
  const report = await withMonitorFile(statePath, async previous => {
    const before = monitorState(previous, target, policy);
    if (before && (options.now ?? Date.now)() <= Date.parse(before.checkedAt)) throw Error('invalid-monitor-clock');
    const tokenDeadline = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
    let token = await awaitRequest(tokenDeadline, () => options.readToken ? options.readToken() : readAccessToken(process.stdin, tokenDeadline));
    try {
      const access = await checkInstallationAccess(plan, token, options.fetchImpl, AbortSignal.any([signal, AbortSignal.timeout(15000)]));
      const next = advanceAccessMonitor(previous, target, policy, access.accessChecksPassed, (options.now ?? Date.now)());
      return { nextState: next.nextState, result: {
        schemaVersion: 'tallyfin.access-monitor/v1', checkedAt: next.nextState.checkedAt, targetFingerprint: target,
        scope: 'administrator_access', accessVerified: access.accessChecksPassed, serviceHealth: 'unknown',
        incidentOpen: next.nextState.incidentOpen, event: next.event, notify: next.notify,
        consecutiveFailures: next.nextState.consecutiveFailures, consecutivePasses: next.nextState.consecutivePasses,
        sampleGapExceeded: next.sampleGapExceeded, checks: access.checks, remoteChanges: false, notificationsSent: false,
      } };
    } finally { token = ''; }
  });
  write(JSON.stringify(report));
  return report.accessVerified && !report.incidentOpen ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController(), stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  runAccessMonitorCli(process.argv.slice(2), undefined, { signal: controller.signal }).then(code => { process.exitCode = code; }).catch(() => {
    console.error(JSON.stringify({ code: 'access_monitor_failed', message: 'Check --help, installation, state ownership and the existing token source.' }));
    process.exitCode = 2;
  }).finally(() => { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); });
}
