import { open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { openLocal, initialize } from './local.ts';
import { operation, ProvisionError } from './input.ts';
import { Provisioner } from './store.ts';

export const HELP = `Tallyfin local provisioning (Node 24)
npm run provision -- <init|register|grant|revoke> --local --state-dir <directory> [--file <json>] [--apply] [--expect-plan <sha256>] [--allow-local-http]
Default: preview only. init --apply creates local tables; other commands require an initialized DB.
register reads the registry JSON. grant/revoke read projectId, issuer, subject and (grant only) role.
No remote mode, bearer token, cloud login or deployment. Use filesystem access only as a trusted local DB operator.`;

export async function runCli(argv: string[], write = (line: string) => process.stdout.write(`${line}\n`)): Promise<void> {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0]!)) { write(HELP); return; }
  const [command, ...flags] = argv;
  const options = new Map<string, string | boolean>();
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i]!;
    if (options.has(flag)) throw new ProvisionError('invalid_arguments', '중복 옵션을 제거해 주세요.');
    if (['--local', '--apply', '--allow-local-http'].includes(flag)) options.set(flag, true);
    else if (['--state-dir', '--file', '--expect-plan'].includes(flag) && flags[i + 1] && !flags[i + 1]!.startsWith('--')) options.set(flag, flags[++i]!);
    else throw new ProvisionError('invalid_arguments', '지원하지 않는 옵션이에요. --help를 확인해 주세요.');
  }
  if (!command || !['init', 'register', 'grant', 'revoke'].includes(command) || options.get('--local') !== true ||
    typeof options.get('--state-dir') !== 'string' || (command === 'init' && (options.has('--file') || options.has('--expect-plan') || options.has('--allow-local-http'))) ||
    (command !== 'init' && typeof options.get('--file') !== 'string') ||
    (options.has('--expect-plan') && (options.get('--apply') !== true || !/^[0-9a-f]{64}$/.test(String(options.get('--expect-plan'))))))
    throw new ProvisionError('invalid_arguments', '명령·--local·DB 경로·입력 파일을 확인해 주세요. --help로 형식을 볼 수 있어요.');
  let input: unknown;
  if (command !== 'init') {
    const file = await open(String(options.get('--file')), 'r');
    try {
      if ((await file.stat()).size > 65536) throw Error();
      const bytes = await file.readFile();
      if (bytes.byteLength > 65536) throw Error();
      input = JSON.parse(bytes.toString('utf8'));
    } catch { throw new ProvisionError('invalid_input', '입력 JSON 파일은 유효한 형식의 64KiB 이하여야 해요.'); }
    finally { await file.close(); }
    operation(command, input, options.has('--allow-local-http')); // Validate before opening a DB.
  }
  const local = await openLocal(String(options.get('--state-dir')));
  try {
    if (command === 'init') { write(JSON.stringify({ local: true, operation: 'init', ...await initialize(local.db, options.has('--apply')) })); return; }
    const tool = new Provisioner(local.db, options.has('--allow-local-http'));
    const plan = await tool.plan(command, input);
    if (options.has('--expect-plan') && plan.planHash !== options.get('--expect-plan'))
      throw new ProvisionError('plan_changed', '미리보기 이후 상태가 달라졌어요. 새 계획을 확인해 주세요.');
    const result = options.has('--apply') ? await tool.apply(plan) : { applied: false, changes: 0 };
    write(JSON.stringify({ local: true, preview: !options.has('--apply'), plan, result }));
  } finally { await local.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).catch(error => {
    const failure = error instanceof ProvisionError ? error : new ProvisionError('operation_failed', '로컬 작업에 실패했어요. 파일·DB·입력 형식을 확인해 주세요.');
    process.stderr.write(`${JSON.stringify({ code: failure.code, message: failure.message })}\n`);
    process.exitCode = 1;
  });
}
