import { useRef, useState } from 'react';
import { rangeError, rangeLabel, RETENTION_DAYS, shiftDate, type DateRange } from './api/dates';

export default function DateRangePicker({ range, today, timeZone, onApply }: {
  range: DateRange; today: string; timeZone: string; onApply: (range: DateRange) => void;
}) {
  const [draft, setDraft] = useState(range);
  const [error, setError] = useState<string | null>(null);
  const fromInput = useRef<HTMLInputElement>(null);
  const dirty = draft.from !== range.from || draft.to !== range.to;
  const minimum = shiftDate(today, 1 - RETENTION_DAYS);
  return <section className="custom-date-range" aria-labelledby="custom-range-heading">
    <h2 id="custom-range-heading">직접 기간 선택</h2>
    <form noValidate onSubmit={event => {
      event.preventDefault();
      const message = rangeError(draft, today);
      setError(message);
      if (message) { fromInput.current?.focus(); return; }
      onApply(draft);
    }}>
      <label className="api-field" htmlFor="custom-range-from"><span>시작일</span>
        <input ref={fromInput} className="text-input" id="custom-range-from" type="date" value={draft.from} min={minimum} max={today}
          aria-invalid={!!error} aria-describedby="custom-range-help custom-range-state"
          onInput={event => { const value = event.currentTarget.value; setDraft(previous => ({ ...previous, from: value })); setError(null); }} />
      </label>
      <label className="api-field" htmlFor="custom-range-to"><span>종료일</span>
        <input className="text-input" id="custom-range-to" type="date" value={draft.to} min={minimum} max={today}
          aria-invalid={!!error} aria-describedby="custom-range-help custom-range-state"
          onInput={event => { const value = event.currentTarget.value; setDraft(previous => ({ ...previous, to: value })); setError(null); }} />
      </label>
      <button className="primary-button" type="submit">기간 적용</button>
    </form>
    <p id="custom-range-help" className="field-help">{timeZone} 기준 · {minimum} ~ {today} 안에서 최대 31일을 선택해요. 시작일과 종료일도 포함해요.</p>
    <p id="custom-range-state" className={error ? 'form-error' : 'context-note'} role={error ? 'alert' : 'status'}>
      {error ?? (dirty ? `아직 적용하지 않았어요. 결과와 CSV는 ${rangeLabel(range.from, range.to)} 기준이에요.`
        : `적용된 기간: ${rangeLabel(range.from, range.to)}`)}
    </p>
  </section>;
}
