import { createI18n } from '@0disoft/saylo-core';
import { createSayloReact } from '@0disoft/saylo-react';
import { connectDev } from '@0disoft/saylo-vite/client';
import { catalogSource, initialCatalogs, initialLocale, initialNamespaces, timeZone } from 'virtual:saylo/lazy';
import type { AppSchema } from './schema.generated';
import { readLocale, saveLocale, supportedLocale } from './preference';
import { loadLocaleFont } from './fonts';

function preferenceStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

// One client-app owner, outside React renders/StrictMode. Locale is never a key.
export const adminI18n = createI18n<AppSchema>({
  catalogSource, initialCatalogs, initialNamespaces, locale: initialLocale, timeZone,
});
export const { SayloProvider, useI18n } = createSayloReact<AppSchema>();

export let localeRestoreFailed = false;
export async function restoreAdminLocale() {
  try {
    const locale = readLocale(preferenceStorage());
    await loadLocaleFont(locale);
    await adminI18n.setLocale(locale);
  }
  catch { localeRestoreFailed = true; } // Keep the boot locale and show the retryable selector error.
}

/** Load the detailed catalogs with the API workspace, never on a locale-driven remount. */
export async function loadWorkspaceCatalogs() {
  await adminI18n.setNamespaces(['admin', 'workspace', 'analysis', 'settings', 'operations', 'messages', 'sample']);
}

export async function setAdminLocale(value: string) {
  const locale = supportedLocale(value);
  await loadLocaleFont(locale);
  await adminI18n.setLocale(locale);
  if (adminI18n.getSnapshot().locale === locale) saveLocale(preferenceStorage(), locale);
}

if (import.meta.hot) {
  const disconnect = connectDev(adminI18n, { catalogSource });
  import.meta.hot.dispose(() => { disconnect(); adminI18n.dispose(); });
}
