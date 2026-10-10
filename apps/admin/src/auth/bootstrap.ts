import { CALLBACK_PATH } from './config.ts';

export function captureCallback(href: string, clean: (path: string) => void): URL | null {
  const url = new URL(href);
  if (url.pathname !== CALLBACK_PATH) return null;
  // Scrub code/state/errors before discovery, token exchange, or rendering.
  clean(CALLBACK_PATH);
  return url;
}

let callback = typeof window === 'undefined' ? null : captureCallback(window.location.href,
  path => window.history.replaceState(null, '', path));
export function initialCallback(): URL | null { return callback; }
export function clearCallback(): void { callback = null; }
