import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEventHandler, type PointerEventHandler, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import './source-tooltip.css';

const HOVER_DELAY_MS = 2000, LEAVE_DELAY_MS = 150;
const OPEN_EVENT = 'tallyfin:help-tooltip-open';
type Trigger<T extends HTMLElement> = {
  ref: RefObject<T | null>; 'aria-describedby': string;
  onPointerEnter: PointerEventHandler<T>; onPointerLeave: PointerEventHandler<T>; onPointerCancel: PointerEventHandler<T>;
  onFocus: FocusEventHandler<T>; onBlur: FocusEventHandler<T>; onClick: () => void;
};

/** The trigger retains its native semantics; only supplemental help is portalled. */
export default function HelpTooltip<T extends HTMLElement = HTMLSpanElement>({ content, children }: {
  content: string; children: (trigger: Trigger<T>) => ReactNode;
}) {
  const id = useId(), anchor = useRef<T>(null), tooltip = useRef<HTMLDivElement>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null), hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hovered = useRef(false), focused = useRef(false);
  const [open, setOpen] = useState(false), [position, setPosition] = useState({ left: 0, top: 0, width: 300 });
  const clearTimers = () => {
    if (showTimer.current !== null) clearTimeout(showTimer.current);
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    showTimer.current = hideTimer.current = null;
  };
  const dismiss = () => { clearTimers(); setOpen(false); };
  const reveal = () => { document.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id })); setOpen(true); };
  const enter = () => {
    hovered.current = true;
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    hideTimer.current = null;
    if (!open && showTimer.current === null) showTimer.current = setTimeout(() => {
      showTimer.current = null; reveal();
    }, HOVER_DELAY_MS);
  };
  const leave = () => {
    hovered.current = false;
    if (showTimer.current !== null) clearTimeout(showTimer.current);
    showTimer.current = null;
    if (!focused.current) hideTimer.current = setTimeout(dismiss, LEAVE_DELAY_MS);
  };
  useLayoutEffect(() => {
    if (!open || !anchor.current || !tooltip.current) return;
    const rect = anchor.current.getBoundingClientRect(), width = Math.min(300, window.innerWidth - 24);
    tooltip.current.style.width = `${width}px`;
    const height = tooltip.current.getBoundingClientRect().height;
    const top = rect.bottom + 8 + height <= window.innerHeight - 12 ? rect.bottom + 8 : rect.top - height - 8;
    setPosition({ width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top: Math.max(12, Math.min(top, window.innerHeight - height - 12)) });
  }, [open, content]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing && (open || showTimer.current !== null)) { event.preventDefault(); dismiss(); }
    };
    const anotherOpened = (event: Event) => { if ((event as CustomEvent<string>).detail !== id) dismiss(); };
    document.addEventListener('keydown', escape);
    document.addEventListener(OPEN_EVENT, anotherOpened);
    if (open) { window.addEventListener('resize', dismiss); document.addEventListener('scroll', dismiss, true); }
    return () => {
      clearTimers(); document.removeEventListener('keydown', escape); document.removeEventListener(OPEN_EVENT, anotherOpened);
      window.removeEventListener('resize', dismiss); document.removeEventListener('scroll', dismiss, true);
    };
  }, [open, id]);
  return <>
    {children({ ref: anchor, 'aria-describedby': id,
      onPointerEnter: event => { if (event.pointerType !== 'touch') enter(); }, onPointerLeave: leave,
      onPointerCancel: () => { hovered.current = false; dismiss(); },
      onFocus: event => { focused.current = event.currentTarget.matches(':focus-visible'); if (focused.current) { clearTimers(); reveal(); } },
      onBlur: () => { focused.current = false; if (!hovered.current) dismiss(); }, onClick: dismiss })}
    {createPortal(<div ref={tooltip} id={id} role="tooltip" className="source-help-tooltip" hidden={!open}
      style={position} onPointerEnter={enter} onPointerLeave={leave}>{content}</div>, document.body)}
  </>;
}
