import { useEffect, useRef } from 'react';

export function installUnloadWarning(target: EventTarget, shouldWarn: () => boolean = () => true): () => void {
  const warn = (event: Event) => {
    if (!shouldWarn()) return;
    event.preventDefault();
    (event as BeforeUnloadEvent).returnValue = '';
  };
  target.addEventListener('beforeunload', warn);
  return () => target.removeEventListener('beforeunload', warn);
}

export default function useUnloadWarning(active: boolean, shouldWarn?: () => boolean): void {
  const check = useRef(shouldWarn); check.current = shouldWarn;
  useEffect(() => active ? installUnloadWarning(window, () => check.current?.() ?? active) : undefined, [active]);
}
