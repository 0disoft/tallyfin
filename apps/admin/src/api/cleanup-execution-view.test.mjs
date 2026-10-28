import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { i18nViewPlugin, renderWithLocale as renderToStaticMarkup } from '../../tests/i18n-fixture.mjs';
import { ObservationSummary } from '../../../../tools/runtime/observation-summary.ts';
import { parseObservationReport } from './observation-report.ts';

test('cleanup execution evidence renders through the actual report view; legacy reports do not invent timings', async () => {
  const require = createRequire(import.meta.url);
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../ObservationReportView.tsx', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', loader: { '.css': 'empty' },
    plugins: [i18nViewPlugin, { name: 'shared-react', setup(build) {
      build.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
    } }],
  });
  const { default: View } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  const summary = new ObservationSummary();
  summary.addLine(JSON.stringify({ runId: '01000000-0000-4000-8000-000000000002', code: 'retention_cleanup',
    attempted: 0, completed: 0, failed: 0, cursorAdvanced: false,
    execution: { elapsedMs: 20000, stopReason: 'time_budget', interruptedProjects: 0, checkpointedProjects: 0, scheduleLagMs: 1234 } }));
  const report = parseObservationReport(summary.report()), html = renderToStaticMarkup(createElement(View, { report }));
  assert.match(html, /실행 시간 한도/); assert.match(html, /20,000ms/); assert.match(html, /1,234ms/);
  assert.match(html, /결과를 확인하지 못한 작업/); assert.match(html, /커서 진행을 확인한 시도/);
  assert.match(html, /시간·페이지 한도는 다음 실행으로 넘긴 상태/);
  const legacy = new ObservationSummary();
  legacy.addLine(JSON.stringify({ runId: '01000000-0000-4000-8000-000000000002', code: 'retention_cleanup',
    attempted: 1, completed: 1, failed: 0, cursorAdvanced: true }));
  const oldHtml = renderToStaticMarkup(createElement(View, { report: parseObservationReport(legacy.report()) }));
  assert.doesNotMatch(oldHtml, /관측한 최대 실행 시간|관측한 최대 예약 실행 지연/);
});
