import type { AdminLocale } from './preference';

// Additional scripts load with their language; Noto Sans and Noto Sans KR are shared assets.
const loaders = {
  zh: () => import('@fontsource-variable/noto-sans-sc/wght.css'),
  ja: () => import('@fontsource-variable/noto-sans-jp/wght.css'),
  hi: () => import('@fontsource-variable/noto-sans-devanagari/wght.css'),
  th: () => import('@fontsource-variable/noto-sans-thai/wght.css'),
};

export async function loadLocaleFont(locale: AdminLocale) {
  if (locale in loaders) await loaders[locale as keyof typeof loaders]();
}
