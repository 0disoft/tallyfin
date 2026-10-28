import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { i18nViewPlugin, renderWithLocale as renderToStaticMarkup } from '../../tests/i18n-fixture.mjs';

const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints: [fileURLToPath(new URL('../EventWorkspace.tsx', import.meta.url))], bundle: true,
  write: false, format: 'esm', platform: 'node', jsx: 'automatic', loader: { '.css': 'empty' },
  plugins: [i18nViewPlugin, { name: 'shared-react', setup(build) {
    build.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
  } }],
});
const { default: View } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const row = (name, count, source = 'browser') => ({ definition: { name, label: name, source, properties: {} }, source, count });
const rows = [row('first', 0), row('unknown', null), row('private-server', 900, 'server')];
const render = props => renderToStaticMarkup(createElement(View, { rows, filtered: rows, source: 'browser', query: '',
  selectedEvent: 'first', compare: false, previous: null, onQuery() {}, onSource() {}, onSelect() {}, ...props }));

test('event explorer retains zero and unknown counts, source isolation and original order', () => {
  const html = render();
  assert.ok(html.indexOf('aria-label="first"') < html.indexOf('aria-label="unknown"'));
  assert.equal(html.includes('private-server'), false);
  assert.match(html, /전체 이벤트 합계<\/span><strong>—/);
  assert.match(html, /aria-label="first" aria-pressed="true"/);
  assert.match(html, />0<\/strong>/);
  const empty = render({ query: 'no-match', filtered: [] });
  assert.match(empty, /검색 결과가 없어요/);
  assert.match(empty, /선택 기간 합계/); // Searching must not change the selected event.
});

test('comparison preserves unknown prior counts and prevents fabricated growth from prior zero', () => {
  const current = [row('first', 5), row('new-event', 4), row('missing-count', null)];
  const html = render({ rows: current, filtered: current, compare: true, previous: {
    totalEvents: 0, events: [{ name: 'first', count: 0 }], meta: { from: '2026-10-15', to: '2026-10-21', timeZone: 'Asia/Seoul' },
  } });
  assert.match(html, /이전 0건 · —/);
  assert.equal(/Infinity|NaN/.test(html), false);
  assert.match(html, /aria-label="first 이전 건수"/);
  assert.equal(html.includes('aria-label="new-event 이전 건수"'), false);
  assert.equal(html.includes('aria-label="missing-count 현재 건수"'), false);
});
