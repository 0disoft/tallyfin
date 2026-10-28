import { useRef, useState } from 'react';
import { useI18n } from './i18n';
import { useMessageText } from './i18n/messages';
import { rangeError, rangeLabel, RETENTION_DAYS, shiftDate, type DateRange } from './api/dates';

export default function DateRangePicker({ range, today, timeZone, onApply }: {
  range: DateRange; today: string; timeZone: string; onApply: (range: DateRange) => void;
}) {
  const { t } = useI18n();
  const messageText = useMessageText();
  const [draft, setDraft] = useState(range);
  const [error, setError] = useState<string | null>(null);
  const fromInput = useRef<HTMLInputElement>(null);
  const dirty = draft.from !== range.from || draft.to !== range.to;
  const minimum = shiftDate(today, 1 - RETENTION_DAYS);
  return <section className="custom-date-range" aria-labelledby="custom-range-heading">
    <h2 id="custom-range-heading">{t('workspace:customRangeHeading')}</h2>
    <form noValidate onSubmit={event => {
      event.preventDefault();
      const message = rangeError(draft, today);
      setError(message);
      if (message) { fromInput.current?.focus(); return; }
      onApply(draft);
    }}>
      <label className="api-field" htmlFor="custom-range-from"><span>{t('workspace:rangeFrom')}</span>
        <input ref={fromInput} className="text-input" id="custom-range-from" type="date" value={draft.from} min={minimum} max={today}
          aria-invalid={!!error} aria-describedby="custom-range-help custom-range-state"
          onInput={event => { const value = event.currentTarget.value; setDraft(previous => ({ ...previous, from: value })); setError(null); }} />
      </label>
      <label className="api-field" htmlFor="custom-range-to"><span>{t('workspace:rangeTo')}</span>
        <input className="text-input" id="custom-range-to" type="date" value={draft.to} min={minimum} max={today}
          aria-invalid={!!error} aria-describedby="custom-range-help custom-range-state"
          onInput={event => { const value = event.currentTarget.value; setDraft(previous => ({ ...previous, to: value })); setError(null); }} />
      </label>
      <button className="primary-button" type="submit">{t('workspace:applyRange')}</button>
    </form>
    <p id="custom-range-help" className="field-help">{t('workspace:rangeHelp', { timeZone, minimum, today })}</p>
    <p id="custom-range-state" className={error ? 'form-error' : 'context-note'} role={error ? 'alert' : 'status'}>
      {error ? messageText(error) : t(dirty ? 'workspace:rangeUnapplied' : 'workspace:rangeApplied', { range: rangeLabel(range.from, range.to) })}
    </p>
  </section>;
}
