import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fontAssets } from '../scripts/font-assets.mjs';

const require = createRequire(import.meta.url);
const faces = css => css.match(/@font-face\s*\{[^}]+\}/g) ?? [];
const property = (face, name) => face.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1];

for (const [name, family, weights] of [
  ['noto-sans', 'Noto Sans', ['100 900']],
  ['noto-sans-kr', 'Noto Sans KR', ['400 500', '700', '900']],
  ['noto-sans-sc', 'Noto Sans SC', ['100 900']],
  ['noto-sans-jp', 'Noto Sans JP', ['100 900']],
  ['noto-sans-devanagari', 'Noto Sans Devanagari', ['100 900']],
  ['noto-sans-thai', 'Noto Sans Thai', ['100 900']],
]) {
  test(`${name}: upstream character coverage and files survive weight compatibility mapping`, () => {
    const id = require.resolve(`@fontsource-variable/${name}/wght.css`);
    const source = faces(readFileSync(id, 'utf8'));
    const output = faces(fontAssets().transform(readFileSync(id, 'utf8'), id).code);
    assert.ok(source.length > 0);
    assert.equal(output.length, source.length * weights.length);
    for (const original of source) {
      const variants = output.filter(face => property(face, 'unicode-range') === property(original, 'unicode-range'));
      assert.deepEqual(variants.map(face => property(face, 'font-weight')), weights);
      for (const variant of variants) {
        assert.equal(property(variant, 'font-family'), `'${family}'`);
        assert.equal(property(variant, 'src'), property(original, 'src'));
        assert.equal(property(variant, 'font-display'), 'swap');
      }
    }
    // Multiple weights must reference the same subset asset, not new downloads.
    assert.equal(new Set(output.map(face => property(face, 'src'))).size, source.length);
  });
}

test('font transform leaves app CSS alone and rejects incompatible upstream font ranges', () => {
  const plugin = fontAssets();
  assert.equal(plugin.transform('body { color: blue }', '/src/styles.css'), null);
  const id = require.resolve('@fontsource-variable/noto-sans/wght.css');
  const source = readFileSync(id, 'utf8');
  assert.throws(() => plugin.transform(source.replaceAll('font-weight: 100 900;', 'font-weight: 100 300;'), id), /Unsupported variable font/);
  assert.throws(() => plugin.transform('', id), /No font faces/);
});

test('font licenses accompany the emitted self-hosted assets unchanged', () => {
  const emitted = [];
  fontAssets().generateBundle.call({ emitFile: asset => emitted.push(asset) });
  assert.equal(emitted.length, 6);
  for (const name of ['noto-sans', 'noto-sans-kr', 'noto-sans-sc', 'noto-sans-jp', 'noto-sans-devanagari', 'noto-sans-thai']) {
    const license = emitted.find(asset => asset.fileName === `fonts/${name}-OFL.txt`);
    assert.equal(license?.source, readFileSync(require.resolve(`@fontsource-variable/${name}/LICENSE`), 'utf8'));
  }
});
