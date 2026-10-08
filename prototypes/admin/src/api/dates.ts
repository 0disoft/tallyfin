// Project-local calendar helpers. Dates are derived from the project time zone
// and the browser clock; no built-in fixture date is used in API mode.

export const PERIODS: number[] = [7, 14, 30];

export function todayInZone(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function periodRange(today: string, period: number): { from: string; to: string } {
  return { from: shiftDate(today, 1 - period), to: today };
}

export function rangeLabel(from: string, to: string): string {
  return `${from.replaceAll('-', '.')} – ${to.slice(5).replace('-', '.')}`;
}
