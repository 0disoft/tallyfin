import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { i18nViewPlugin, renderWithLocale as renderToStaticMarkup } from '../../tests/i18n-fixture.mjs';

const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints: [fileURLToPath(new URL('../GoalWorkflowDetail.tsx', import.meta.url))], bundle: true,
  write: false, format: 'esm', platform: 'node', jsx: 'automatic', plugins: [i18nViewPlugin, { name: 'shared-react', setup(build) {
    build.onResolve({ filter: /^(?:react(?:\/.*)?|recharts)$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
  } }],
});
const { default: Detail, GoalWorkflowComparison: Comparison } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const load = summary => ({ definition: { id: 'conversion', label: '파일 변환', startEvent: 'start', successEvent: 'success', failureEvent: null },
  response: { meta: { schemaVersion: 2, from: '2026-10-22', to: '2026-10-28' }, summary, days: [] } });
const props = { compare: false, comparisonStatus: 'idle', comparisonError: null };
const empty = { startedAttempts: 0, succeededAttempts: 0, failedAttempts: null, pendingAttempts: 0, completionRate: null };

test('goal summary preserves unknown failure/rate, observed zero counts and registered event keys', () => {
  const html = renderToStaticMarkup(createElement(Detail, { ...props, load: load(empty) }));
  assert.match(html, /확정 실패<\/dt><dd>—/);
  assert.match(html, /시작<\/dt><dd>0/);
  assert.match(html, /실패 이벤트가 없어 확정 실패는 미측정/);
  assert.match(html, /<dd>start<\/dd>/);
  assert.equal(html.includes('goal-outcome-track'), false);
  assert.equal(/NaN|Infinity/.test(html), false);
});

test('goal comparison uses percentage points and signed counts without inventing a prior zero rate', () => {
  const current = load({ ...empty, startedAttempts: 100, succeededAttempts: 86, pendingAttempts: 14, completionRate: 86 });
  const previous = load({ ...empty, startedAttempts: 100, succeededAttempts: 80, pendingAttempts: 20, completionRate: 80 });
  const html = renderToStaticMarkup(createElement(Comparison, { load: current, previousLoad: previous }));
  assert.match(html, /\+6.0%p/); assert.match(html, /\+6건/); assert.match(html, /-6건/);
  const unknown = renderToStaticMarkup(createElement(Comparison, { load: current, previousLoad: load(empty) }));
  assert.match(unknown, /완료율<\/th><td class="number-cell">86.0%<\/td><td class="number-cell">—<\/td><td class="number-cell">—/);
  assert.equal(/NaN|Infinity/.test(unknown), false);
});
