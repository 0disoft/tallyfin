import { useEffect } from 'react';

export function installUnloadWarning(target: EventTarget): () => void {
  const warn = (event: Event) => {
    event.preventDefault();
    (event as BeforeUnloadEvent).returnValue = '';
  };
  target.addEventListener('beforeunload', warn);
  return () => target.removeEventListener('beforeunload', warn);
}

export default function useUnloadWarning(active: boolean): void {
  useEffect(() => active ? installUnloadWarning(window) : undefined, [active]);
}
