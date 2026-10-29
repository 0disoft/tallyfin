import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { EventSource } from './api/types';
import { useI18n } from './i18n';
import './source-tooltip.css';

const HOVER_DELAY_MS = 2000;
const LEAVE_DELAY_MS = 150;

function SourceButton({ label, help, selected, onSelect, open, onOpen, onClose }: {
  label: string; help: string; selected: boolean; onSelect: () => void;
  open: boolean; onOpen: () => void; onClose: () => void;
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null), tooltip = useRef<HTMLDivElement>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hovered = useRef(false), focused = useRef(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 300 });
  const clearTimers = () => {
    if (showTimer.current !== null) clearTimeout(showTimer.current);
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    showTimer.current = hideTimer.current = null;
  };
  const dismiss = () => { clearTimers(); onClose(); };
  const enter = () => {
    hovered.current = true;
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    hideTimer.current = null;
    if (!open && showTimer.current === null) showTimer.current = setTimeout(() => {
      showTimer.current = null; onOpen();
    }, HOVER_DELAY_MS);
  };
  const leave = () => {
    hovered.current = false;
    if (showTimer.current !== null) clearTimeout(showTimer.current);
    showTimer.current = null;
    if (!focused.current) hideTimer.current = setTimeout(dismiss, LEAVE_DELAY_MS);
  };
  useLayoutEffect(() => {
    if (!open || !button.current || !tooltip.current) return;
    const anchor = button.current.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 24);
    tooltip.current.style.width = `${width}px`;
    const height = tooltip.current.getBoundingClientRect().height;
    const top = anchor.bottom + 8 + height <= window.innerHeight - 12
      ? anchor.bottom + 8 : anchor.top - height - 8;
    setPosition({ width, left: Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12)),
      top: Math.max(12, Math.min(top, window.innerHeight - height - 12)) });
  }, [open, help]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing && (open || showTimer.current !== null)) {
        event.preventDefault(); dismiss();
      }
    };
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', dismiss);
    document.addEventListener('scroll', dismiss, true);
    return () => {
      clearTimers();
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', dismiss);
      document.removeEventListener('scroll', dismiss, true);
    };
  }, [open]);
  return <>
    <button ref={button} type="button" aria-pressed={selected} aria-describedby={id}
      onPointerEnter={event => { if (event.pointerType !== 'touch') enter(); }} onPointerLeave={leave}
      onPointerCancel={() => { hovered.current = false; dismiss(); }}
      onFocus={event => { focused.current = event.currentTarget.matches(':focus-visible'); if (focused.current) { clearTimers(); onOpen(); } }}
      onBlur={() => { focused.current = false; if (!hovered.current) dismiss(); }}
      onClick={() => { dismiss(); onSelect(); }}>{label}</button>
    {createPortal(<div ref={tooltip} id={id} role="tooltip" className="source-help-tooltip" hidden={!open}
      style={position} onPointerEnter={enter} onPointerLeave={leave}>{help}</div>, document.body)}
  </>;
}

export default function EventSourceSwitch({ source, onSource }: {
  source: EventSource; onSource: (source: EventSource) => void;
}) {
  const { t } = useI18n();
  const [active, setActive] = useState<EventSource | null>(null);
  return <div className="event-source-switch" role="group" aria-label={t('analysis:sourceGroup')}>
    {(['browser', 'server'] as const).map(value => <SourceButton key={value} selected={source === value}
      open={active === value} onOpen={() => setActive(value)} onClose={() => setActive(current => current === value ? null : current)}
      label={value === 'browser' ? t('analysis:sourceBrowser') : t('analysis:sourceServer')}
      help={value === 'browser' ? t('analysis:sourceBrowserHelp') : t('analysis:sourceServerHelp')}
      onSelect={() => onSource(value)} />)}
  </div>;
}
