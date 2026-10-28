import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createStore, parseCatalog } from '@0disoft/saylo-core';
import { readLocale, saveLocale, supportedLocale, LOCALE_KEY } from '../i18n/preference.ts';
import { createMessageText } from '../i18n/message-text.ts';

test('language preferences accept only the supported UI locales', () => {
  for (const value of [null, undefined, '', 'en-US', '{}']) assert.equal(supportedLocale(value), 'en');
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

test('shell catalogs have matching keys and preserve workflow labels as data', () => {
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

test('every detailed namespace has matching KO/EN keys and compatible message contracts', () => {
  const catalogs = [];
  const folders = ['ko', 'en'].map(locale => new URL(`../../locales/${locale}/`, import.meta.url));
  const names = readdirSync(folders[0]).filter(name => name.endsWith('.json')).sort();
  assert.deepEqual(names, readdirSync(folders[1]).filter(name => name.endsWith('.json')).sort());
  for (const name of names) {
    const pair = folders.map((folder, i) => {
      const raw = readFileSync(new URL(name, folder), 'utf8');
      const values = JSON.parse(raw);
      assert.ok(Object.keys(values).length > 0, name);
      return { values, catalog: parseCatalog(raw, { locale: i ? 'en' : 'ko', namespace: name.slice(0, -5) }) };
    });
    assert.deepEqual(Object.keys(pair[0].values).sort(), Object.keys(pair[1].values).sort(), name);
    catalogs.push(...pair.map(item => item.catalog));
  }
  // Store creation validates every translation's argument contract against KO.
  const store = createStore({ baseLocale: 'ko', locale: 'en', catalogs });
  try {
    for (const namespace of ['workspace', 'analysis', 'settings', 'operations', 'messages'])
      assert.ok(store.getSnapshot().loadedNamespaces.includes(namespace), namespace);
    assert.equal(store.t('workspace:rangeApplied', { range: '2026.10.22 – 10.28' }), 'Applied range: 2026.10.22 – 10.28');
  } finally { store.dispose(); }
});

test('stored helper errors change language without mutating their source or captured data', () => {
  const catalogs = ['ko', 'en'].map(locale => parseCatalog(readFileSync(new URL(`../../locales/${locale}/messages.json`, import.meta.url), 'utf8'), { locale, namespace: 'messages' }));
  const store = createStore({ baseLocale: 'ko', locale: 'en', catalogs });
  const source = '프로젝트 이름을 1~80자로 입력해 주세요.';
  const opaque = 'custom_event · 원본 {value}';
  try {
    let snapshot = store.getSnapshot();
    const english = createMessageText(snapshot.t, snapshot.locale);
    assert.equal(english(source), 'Enter a project name of 1 to 80 characters.');
    assert.equal(english('요청이 실패했어요. (HTTP 429)'), 'The request failed. (HTTP 429)');
    assert.equal(english('v12 정의를 불러왔어요.'), 'Loaded the v12 definition.');
    assert.equal(english(`API 응답이 계약 형식과 달라요. (${opaque})`), `The API response does not match the contract format. (${opaque})`);
    assert.equal(english(opaque), opaque);
    assert.equal(english('prefix 요실패 (HTTP 429)'), 'prefix 요실패 (HTTP 429)');
    assert.equal(english('요청이 실패했어요. (HTTP private-value)'), '요청이 실패했어요. (HTTP private-value)');
    assert.equal(english(undefined), ''); assert.equal(english(null), '');
    store.setLocale('ko'); snapshot = store.getSnapshot();
    const korean = createMessageText(snapshot.t, snapshot.locale);
    assert.equal(korean(source), source);
    assert.equal(korean('v12 정의를 불러왔어요.'), 'v12 정의를 불러왔어요.');
    assert.equal(source, '프로젝트 이름을 1~80자로 입력해 주세요.');
  } finally { store.dispose(); }
});
