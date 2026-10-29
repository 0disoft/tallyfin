import type { EventSource } from './api/types';
import { useI18n } from './i18n';
import HelpTooltip from './HelpTooltip';

export default function EventSourceSwitch({ source, onSource }: {
  source: EventSource; onSource: (source: EventSource) => void;
}) {
  const { t } = useI18n();
  return <div className="event-source-switch" role="group" aria-label={t('analysis:sourceGroup')}>
    {(['browser', 'server'] as const).map(value => <HelpTooltip<HTMLButtonElement> key={value}
      content={value === 'browser' ? t('analysis:sourceBrowserHelp') : t('analysis:sourceServerHelp')}>
      {trigger => <button {...trigger} type="button" aria-pressed={source === value}
        onClick={() => { trigger.onClick(); onSource(value); }}>{value === 'browser' ? t('analysis:sourceBrowser') : t('analysis:sourceServer')}</button>}
    </HelpTooltip>)}
  </div>;
}
