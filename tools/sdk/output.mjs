import assert from 'node:assert/strict';
import { rm, realpath } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Clean only the named SDK's own output, including files left by older declaration layouts. */
export async function cleanSdkOutput(name) {
  assert.ok(name === 'browser' || name === 'server');
  const root = await realpath(fileURLToPath(new URL('../../', import.meta.url)));
  const source = await realpath(join(root, 'packages', name));
  assert.equal(relative(root, source), join('packages', name), 'SDK directory escapes the checkout');
  const output = join(source, 'dist');
  assert.equal(relative(source, output), 'dist');
  await rm(output, { recursive: true, force: true });
  return output;
}
