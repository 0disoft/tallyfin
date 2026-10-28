import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createStore, parseCatalog } from '@0disoft/saylo-core';
import { createSayloReact } from '@0disoft/saylo-react';

const { SayloProvider, useI18n } = createSayloReact();
export { useI18n };
const catalogs = ['ko', 'en'].flatMap(locale => {
  const folder = new URL(`../locales/${locale}/`, import.meta.url);
  return readdirSync(folder).filter(file => file.endsWith('.json')).map(file =>
    parseCatalog(readFileSync(new URL(file, folder), 'utf8'), { locale, namespace: file.slice(0, -5) }));
});

/** Render actual components and catalogs without the browser-only Vite transport. */
export function renderWithLocale(element, locale = 'ko') {
  const store = createStore({ baseLocale: 'ko', locale, catalogs });
  const instance = { ...store, getServerSnapshot: () => store.getSnapshot() };
  try { return renderToStaticMarkup(createElement(SayloProvider, { instance }, element)); }
  finally { store.dispose(); }
}

const source = fileURLToPath(new URL('../src/i18n', import.meta.url));
export const i18nViewPlugin = { name: 'admin-test-i18n', setup(build) {
  build.onResolve({ filter: /(?:^|\/)(?:i18n|index)(?:\.ts)?$/ }, args => {
    const path = resolve(dirname(args.importer), args.path);
    if (path === source || path === resolve(source, 'index') || path === resolve(source, 'index.ts'))
      return { path: import.meta.url, external: true };
  });
} };
