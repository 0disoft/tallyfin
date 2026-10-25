import { mkdir, open, unlink, rmdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { siteIntegration } from './site-integration.ts';

export async function prepareSite(argv: string[]) {
  if (argv.length === 1 && argv[0] === '--help') return { help: 'npm run site:prepare -- --file <public-site-json> --out <new-directory>\nNew sites, schema 1 only. Writes public registry, API request bodies, disabled browser config, template/CSP settings and a consent wrapper. No remote requests, credentials, publication or privacy approval.' };
  const options = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]!, value = argv[i + 1];
    if (!['--file', '--out'].includes(key) || options.has(key) || !value || value.startsWith('--')) throw Error('Invalid arguments');
    options.set(key, value);
  }
  if (options.size !== 2) throw Error('Missing arguments');
  const file = await open(options.get('--file')!, 'r');
  let input: unknown;
  try {
    if ((await file.stat()).size > 16384) throw Error('Input too large');
    const bytes = await file.readFile(); if (bytes.byteLength > 16384) throw Error('Input too large');
    input = JSON.parse(bytes.toString('utf8'));
  } finally { await file.close(); }
  const plan = siteIntegration(input), output = resolve(options.get('--out')!);
  const artifacts = [['registry.json', plan.registry], ['project-create.json', plan.creation], ['schema-draft.json', plan.draft],
    ['schema-publication.review.json', plan.publication], ['browser-config.json', plan.configuration],
    ['template-config.json', plan.template], ['requests.json', plan.requests]] as const;
  await mkdir(dirname(output), { recursive: true }); await mkdir(output);
  const written: string[] = [];
  try {
    for (const [name, value] of [...artifacts, ['analytics.ts', plan.module] as const]) {
      const path = join(output, name), handle = await open(path, 'wx', 0o600); written.push(path);
      try { await handle.writeFile(typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'); }
      finally { await handle.close(); }
    }
  } catch (error) {
    for (const path of written) await unlink(path).catch(() => {});
    await rmdir(output).catch(() => {}); throw error;
  }
  return { prepared: true, output, files: [...artifacts.map(([name]) => name), 'analytics.ts'], remoteChanges: false, registrationVerified: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  prepareSite(process.argv.slice(2)).then(value => console.log(JSON.stringify(value))).catch(() => {
    console.error(JSON.stringify({ code: 'site_preparation_failed', message: 'Check the reviewed public input, enum cardinality and a new output directory. Use --help. No registration occurred.' }));
    process.exitCode = 1;
  });
}
