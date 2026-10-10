import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { closed } from '@tallyfin/core';
import { installation } from './installation.ts';

async function jsonFile(path: string): Promise<unknown> {
  const file = await open(path, 'r');
  try {
    if ((await file.stat()).size > 32768) throw Error();
    const bytes = await file.readFile(); if (bytes.byteLength > 32768) throw Error();
    return JSON.parse(bytes.toString('utf8'));
  } finally { await file.close(); }
}

/** Reject separately edited or relocated files before compiling a different login/Worker topology. */
export async function preparedInstallation(directory: string, root: string) {
  try {
    const output = resolve(directory);
    const manifest = await jsonFile(resolve(output, 'installation.json'));
    if (!closed(manifest, ['schemaVersion', 'input']) || manifest.schemaVersion !== 'tallyfin.installation/v1') throw Error();
    const plan = installation(manifest.input, root, output);
    const expected = [
      ['admin.wrangler.json', plan.admin], ['collector.wrangler.json', plan.collector],
      ['admin-login.json', plan.loginSettings], ['oidc-registration.json', plan.registration],
    ] as const;
    for (const [name, value] of expected) if (!isDeepStrictEqual(await jsonFile(resolve(output, name)), value)) throw Error();
    return plan;
  } catch { throw new TypeError('Invalid prepared installation'); }
}
