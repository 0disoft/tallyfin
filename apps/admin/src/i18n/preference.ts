export const LOCALE_KEY = 'tallyfin.uiLocale';
export type AdminLocale = 'ko' | 'en';

export function supportedLocale(value: unknown): AdminLocale {
  return value === 'en' ? 'en' : 'ko';
}

/** Preferences are optional; denied browser storage must not prevent sign-in. */
export function readLocale(storage: Pick<Storage, 'getItem'> | null): AdminLocale {
  try { return supportedLocale(storage?.getItem(LOCALE_KEY)); }
  catch { return 'ko'; }
}

export function saveLocale(storage: Pick<Storage, 'setItem'> | null, locale: AdminLocale): void {
  try { storage?.setItem(LOCALE_KEY, locale); }
  catch { /* The current tab still switches when persistence is unavailable. */ }
}
