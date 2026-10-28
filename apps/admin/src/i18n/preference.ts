export const LOCALE_KEY = 'tallyfin.uiLocale';
// ZDP docs/45-cross-cutting-product-standards.md; native names stay recognizable.
export const TARGET_LOCALES = [
  { code: 'en', name: 'English' },
  { code: 'zh', name: '简体中文' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'ko', name: '한국어' },
  { code: 'ja', name: '日本語' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'ru', name: 'Русский' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'ms', name: 'Bahasa Melayu' },
  { code: 'th', name: 'ไทย' },
] as const;
export type AdminLocale = typeof TARGET_LOCALES[number]['code'];
export const ACTIVE_LOCALES: readonly AdminLocale[] = TARGET_LOCALES.map(item => item.code);
export const FALLBACK_LOCALE = 'en';
export const INITIAL_LOCALE = 'ko';

export function supportedLocale(value: unknown): AdminLocale {
  return ACTIVE_LOCALES.find(locale => locale === value) ?? FALLBACK_LOCALE;
}

/** Preferences are optional; denied browser storage must not prevent sign-in. */
export function readLocale(storage: Pick<Storage, 'getItem'> | null): AdminLocale {
  try {
    const saved = storage?.getItem(LOCALE_KEY);
    return saved == null ? INITIAL_LOCALE : supportedLocale(saved);
  } catch { return INITIAL_LOCALE; }
}

export function saveLocale(storage: Pick<Storage, 'setItem'> | null, locale: AdminLocale): void {
  try { storage?.setItem(LOCALE_KEY, locale); }
  catch { /* The current tab still switches when persistence is unavailable. */ }
}
