import type { ReactNode } from 'react';
import HelpTooltip from './HelpTooltip';

/** Use on label text only; interactive controls use HelpTooltip directly. */
export default function HelpTerm({ content, children }: { content: string; children: ReactNode }) {
  return <HelpTooltip content={content}>{trigger => <span {...trigger} className="help-term" tabIndex={0}>{children}</span>}</HelpTooltip>;
}
