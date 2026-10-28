import { createStore } from '@0disoft/saylo-core';
import { createSayloReact } from '@0disoft/saylo-react';
import { connectDev } from '@0disoft/saylo-vite/client';
import { baseLocale, initialCatalogs, timeZone } from 'virtual:saylo';
import type { AppSchema } from './schema.generated';
import { readLocale, saveLocale, supportedLocale } from './preference';

function preferenceStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

// One client-app owner, outside React renders/StrictMode. Locale is never a key.
export const adminI18n = createStore<AppSchema>({
  catalogs: initialCatalogs, baseLocale, locale: readLocale(preferenceStorage()), timeZone,
});
export const { SayloProvider, useI18n } = createSayloReact<AppSchema>();

export function setAdminLocale(value: string) {
  const locale = supportedLocale(value);
  adminI18n.setLocale(locale);
  saveLocale(preferenceStorage(), locale);
}

if (import.meta.hot) {
  const disconnect = connectDev(adminI18n, { hot: import.meta.hot });
  import.meta.hot.dispose(() => { disconnect(); adminI18n.dispose(); });
}
