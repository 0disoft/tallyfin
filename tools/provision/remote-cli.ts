import { open } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { preparedInstallation } from '../runtime/prepared-installation.ts';
import { creatorOperation } from './creators.ts';
import { ProvisionError } from './input.ts';
import { RemoteCreatorProvisioner, type CreatorQuery, type RemoteCreatorTarget } from './remote-creators.ts';
import { remoteCreatorQuery } from './remote-wrangler.ts';

export const REMOTE_HELP = `Tallyfin trusted operator: remote creator permission only
npm run provision:remote-creators -- <creator-grant|creator-revoke> --remote --dir <prepared-installation> --file <identity-json> [--apply --expect-plan <sha256>]
Preview reads the selected remote DB. Apply requires the exact preview hash.
Grant input: issuer, subject, maxProjects (1..1000). Revoke input: issuer, subject.
Use the administrator identity verified by GET /v1/identity; no inferred email or client ID.
Uses installed Wrangler authentication. No login, migration, deployment, project grant or token issuance.`;

export async function runRemoteCreatorCli(argv: string[], write = (line: string) => process.stdout.write(`${line}\n`), query?: CreatorQuery) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0]!)) { write(REMOTE_HELP); return; }
  const [command, ...flags] = argv;
  const options = new Map<string, string | boolean>();
  for (let i = 0; i < flags.length; i++) {
    const key = flags[i]!;
    if (options.has(key)) throw new ProvisionError('invalid_arguments', '중복 옵션을 제거해 주세요.');
    if (['--remote', '--apply'].includes(key)) options.set(key, true);
    else if (['--dir', '--file', '--expect-plan'].includes(key) && flags[i + 1] && !flags[i + 1]!.startsWith('--')) options.set(key, flags[++i]!);
    else throw new ProvisionError('invalid_arguments', '지원하지 않는 옵션이에요. --help를 확인해 주세요.');
  }
  if (!command || !['creator-grant', 'creator-revoke'].includes(command) || options.get('--remote') !== true ||
    typeof options.get('--dir') !== 'string' || typeof options.get('--file') !== 'string' ||
    (options.has('--apply') !== options.has('--expect-plan')) ||
    (options.has('--expect-plan') && !/^[0-9a-f]{64}$/.test(String(options.get('--expect-plan')))))
    throw new ProvisionError('invalid_arguments', '명령·원격 대상·설치 경로·입력과 적용 계획 해시를 확인해 주세요.');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  let target: RemoteCreatorTarget;
  try {
    const installation = await preparedInstallation(String(options.get('--dir')), root);
    const collector = installation.collector, database = collector.d1_databases[0]!;
    target = { accountId: collector.account_id, workerName: collector.name,
      databaseId: database.database_id, databaseName: database.database_name, issuer: collector.vars.OIDC_ISSUER };
  } catch { throw new ProvisionError('invalid_target', '수정되지 않은 설치 설정 묶음이 필요해요. install:prepare로 새로 준비해 주세요.'); }
  let input: unknown;
  try {
    const file = await open(String(options.get('--file')), 'r');
    try {
      if ((await file.stat()).size > 65536) throw Error();
      const bytes = await file.readFile(); if (bytes.byteLength > 65536) throw Error();
      input = JSON.parse(bytes.toString('utf8'));
    } finally { await file.close(); }
  } catch { throw new ProvisionError('invalid_input', '유효한 64KiB 이하의 계정 JSON 파일이 필요해요.'); }
  creatorOperation(command, input);
  const tool = new RemoteCreatorProvisioner(target, query ?? remoteCreatorQuery(root, target));
  const plan = await tool.plan(command, input);
  if (options.has('--expect-plan') && plan.planHash !== options.get('--expect-plan'))
    throw new ProvisionError('plan_changed', '대상·입력·DB 상태가 미리보기와 달라졌어요. 새 계획을 확인해 주세요.');
  const result = options.has('--apply') ? await tool.apply(plan) : { applied: false, changes: 0 };
  const { issuer: _issuer, ...publicTarget } = target;
  write(JSON.stringify({ remote: true, preview: !options.has('--apply'), target: publicTarget, plan, result }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRemoteCreatorCli(process.argv.slice(2)).catch(error => {
    const failure = error instanceof ProvisionError ? error : new ProvisionError('operation_failed', '원격 생성 권한 작업에 실패했어요. 대상과 반영 여부를 확인해 주세요.');
    process.stderr.write(`${JSON.stringify({ code: failure.code, message: failure.message })}\n`); process.exitCode = 1;
  });
}
