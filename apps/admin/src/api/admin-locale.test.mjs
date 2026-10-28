import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStore, parseCatalog } from '@0disoft/saylo-core';
import { readLocale, saveLocale, supportedLocale, LOCALE_KEY } from '../i18n/preference.ts';

test('language preferences accept only the supported UI locales', () => {
  for (const value of [null, undefined, '', 'en-US', 'fr', '{}']) assert.equal(supportedLocale(value), 'ko');
  assert.equal(readLocale({ getItem: key => { assert.equal(key, LOCALE_KEY); return 'en'; } }), 'en');
  assert.equal(supportedLocale('ko'), 'ko');
});

test('blocked browser storage does not prevent locale selection', () => {
  assert.equal(readLocale({ getItem() { throw new Error('blocked'); } }), 'ko');
  assert.equal(readLocale(null), 'ko');
  assert.doesNotThrow(() => saveLocale({ setItem() { throw new Error('quota'); } }, 'en'));
  const writes = [];
  saveLocale({ setItem: (...entry) => writes.push(entry) }, 'en');
  assert.deepEqual(writes, [[LOCALE_KEY, 'en']]);
});

test('pilot catalogs have matching keys and preserve workflow labels as data', () => {
  const entries = ['ko', 'en'].map(locale => {
    const raw = readFileSync(new URL(`../../locales/${locale}/admin.json`, import.meta.url), 'utf8');
    return { values: JSON.parse(raw), catalog: parseCatalog(raw, { locale, namespace: 'admin' }) };
  });
  assert.deepEqual(Object.keys(entries[0].values).sort(), Object.keys(entries[1].values).sort());
  const store = createStore({ baseLocale: 'ko', locale: 'ko', catalogs: entries.map(entry => entry.catalog) });
  try {
    assert.equal(store.t('admin:undefined'), '미정의');
    store.setLocale('en');
    assert.equal(store.t('admin:undefined'), 'Undefined');
    assert.equal(store.t('admin:recentDays', { days: 14 }), 'Last 14 days');
    assert.ok(store.t('admin:workflowStarted', { workflow: 'custom_event · 원본' }).includes('custom_event · 원본'));
  } finally { store.dispose(); }
});
