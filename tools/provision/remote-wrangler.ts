import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { ProvisionError } from './input.ts';
import type { CreatorQuery, RemoteCreatorTarget } from './remote-creators.ts';

type Execute = (file: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; windowsHide: boolean; maxBuffer: number; timeout: number }) => Promise<{ stdout: string }>;

/** Uses the installed CLI and its existing authentication; never forwards arbitrary config or SQL from a user. */
export function remoteCreatorQuery(root: string, target: RemoteCreatorTarget, execute: Execute = promisify(execFile)): CreatorQuery {
  const destination = Object.freeze({ ...target });
  return async sql => {
    const directory = await mkdtemp(join(tmpdir(), 'tallyfin-creator-query-'));
    const config = join(directory, 'wrangler.json'), envFile = join(directory, 'empty.env');
    try {
      await writeFile(config, JSON.stringify({ name: 'tallyfin-creator-operator', account_id: destination.accountId, send_metrics: false,
        d1_databases: [{ binding: 'DB', database_name: destination.databaseName, database_id: destination.databaseId }] }), { flag: 'wx', mode: 0o600 });
      await writeFile(envFile, '', { flag: 'wx', mode: 0o600 });
      const env: NodeJS.ProcessEnv = { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false', WRANGLER_SEND_ERROR_REPORTS: 'false',
        WRANGLER_WRITE_LOGS: 'false', WRANGLER_LOG_SANITIZE: 'true', WRANGLER_API_ENVIRONMENT: 'production' };
      for (const name of ['CLOUDFLARE_API_BASE_URL', 'CF_API_BASE_URL', 'CLOUDFLARE_ACCOUNT_ID', 'CF_ACCOUNT_ID', 'CLOUDFLARE_ENV', 'WRANGLER_ENV',
        'CLOUDFLARE_COMPLIANCE_REGION', 'WRANGLER_LOG', 'WRANGLER_OUTPUT_FILE_PATH', 'WRANGLER_OUTPUT_FILE_DIRECTORY', 'NODE_OPTIONS']) delete env[name];
      // Invoke the installed CLI entry directly so timeout does not leave the bin launcher's child running.
      const result = await execute(process.execPath, ['--no-warnings', resolve(root, 'node_modules/wrangler/wrangler-dist/cli.js'),
        'd1', 'execute', 'DB', '--config', config, '--env-file', envFile, '--remote', '--json', '--command', sql],
      { cwd: directory, env, windowsHide: true, maxBuffer: 2 * 1024 * 1024, timeout: 30000 });
      return JSON.parse(result.stdout);
    } catch { throw new ProvisionError('database_unavailable', '원격 DB 호출 결과를 확인하지 못했어요. 인증·마이그레이션·반영 여부를 확인해 주세요.'); }
    finally {
      // Wrangler can create .wrangler caches. Verify this newly-created scratch path before deleting it.
      const child = relative(resolve(tmpdir()), resolve(directory));
      if (!child.startsWith('tallyfin-creator-query-') || child.includes('..') || isAbsolute(child))
        throw new ProvisionError('cleanup_failed', '임시 디렉터리 경로를 확인하지 못했어요. DB 반영 여부와 별도로 정리가 필요해요.');
      try { await rm(directory, { recursive: true, force: true, maxRetries: 2 }); }
      catch { throw new ProvisionError('cleanup_failed', '임시 파일을 정리하지 못했어요. DB 반영 여부와 별도로 정리가 필요해요.'); }
    }
  };
}
