import { useEffect, useRef } from 'react';

/** Keep native disclosure state while adding the dismissal behavior of a menu. */
export default function useHeaderMenu(enabled: boolean) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const menu = ref.current;
    if (!enabled || !menu) return;
    const document = menu.ownerDocument;
    const dismissOutside = (event: Event) => {
      // Do not steal focus from the control the user clicked or tabbed to.
      if (menu.open && !event.composedPath().includes(menu)) menu.open = false;
    };
    const dismissEscape = (event: KeyboardEvent) => {
      if (!menu.open || event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      menu.open = false;
      menu.querySelector<HTMLElement>(':scope > summary')?.focus({ preventScroll: true });
    };
    const opened = () => {
      if (!menu.open) return;
      for (const other of document.querySelectorAll<HTMLDetailsElement>('details[data-header-menu][open]')) {
        if (other !== menu) other.open = false;
      }
    };
    document.addEventListener('pointerdown', dismissOutside, true);
    document.addEventListener('focusin', dismissOutside);
    document.addEventListener('keydown', dismissEscape);
    menu.addEventListener('toggle', opened);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true);
      document.removeEventListener('focusin', dismissOutside);
      document.removeEventListener('keydown', dismissEscape);
      menu.removeEventListener('toggle', opened);
    };
  }, [enabled]);
  return ref;
}
