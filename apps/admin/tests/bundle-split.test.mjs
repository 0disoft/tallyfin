import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { test } from 'node:test';

// Run after build; this examines the emitted graph, rather than import syntax.
const root = new URL('../dist/client/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('.vite/manifest.json', root), 'utf8'));
const entryKey = Object.keys(manifest).find(key => manifest[key].isEntry);
function graph(key, seen = new Set()) {
  assert.ok(manifest[key], `missing manifest chunk ${key}`);
  if (seen.has(key)) return seen;
  seen.add(key);
  for (const imported of manifest[key].imports ?? []) graph(imported, seen);
  return seen;
}
function bytes(key) { return readFileSync(new URL(manifest[key].file, root)); }

test('initial emitted graph defers API management and its nested screens', () => {
  assert.ok(entryKey); const initial = graph(entryKey);
  for (const key of ['src/LiveDashboard.tsx', 'src/LiveSettingsWorkspace.tsx', 'src/LiveGoals.tsx', 'src/LiveProjectCreate.tsx', 'src/auth/OidcLogin.tsx', 'src/TrendChart.tsx', 'src/ObservationReportPanel.tsx']) {
    assert.ok(manifest[key]?.isDynamicEntry, `${key} must have a deferred entry`);
    assert.equal(initial.has(key), false, `${key} must not be in the initial static graph`);
  }
  const initialGzip = [...initial].reduce((total, key) => total + gzipSync(bytes(key)).length, 0);
  assert.ok(initialGzip <= 100 * 1024, `initial gzip JS ${initialGzip} exceeds 100 KiB budget`);
});
test('opening API connection does not eagerly import settings, goals or project creation', () => {
  const api = graph('src/LiveDashboard.tsx');
  for (const key of ['src/LiveSettingsWorkspace.tsx', 'src/LiveGoals.tsx', 'src/LiveProjectCreate.tsx', 'src/ObservationReportPanel.tsx'])
    assert.equal(api.has(key), false, `${key} must load only when opened`);
  for (const [key, chunk] of Object.entries(manifest)) {
    if (!chunk.file.endsWith('.js')) continue;
    assert.ok(bytes(key).length <= 500_000, `${chunk.file} exceeds 500 kB chunk budget`);
    for (const dependency of [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])]) assert.ok(manifest[dependency]);
    for (const css of chunk.css ?? []) assert.ok(readFileSync(new URL(css, root)).length > 0);
  }
});
